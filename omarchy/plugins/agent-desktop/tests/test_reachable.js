const assert = require('assert')
const fs = require('fs')
const path = require('path')

// Unreachable-capability gate.
//
// This plugin has now shipped the SAME defect four times: a capability fully
// implemented, sometimes fully unit-tested, that no production code can reach.
// Each one looked finished and was dead:
//
//   ConversationsStore.ensureQuickChat  6 QML tests, zero callers. The quick
//                                      chat could not send AT ALL: ChatStore
//                                      .send() returns silently when
//                                      conversationId <= 0.
//   ChatStore.regenerate               zero callers. MessageList shipped a
//                                      Regenerate button gated on an
//                                      onRegenerate callback nothing set.
//   MessageList.onEdit/onFork          same — three invisible buttons.
//   SchedulerStore.makeNotifyArgs      zero callers, its own comment said
//                                      "these two helpers" with one left.
//
// A channel-level audit CANNOT see this class: a store that invokes
// `messages:regenerate` makes the channel look used even when the function
// wrapping it is dead. So the unit of analysis here is the store function and
// the component callback, not the channel.
//
// Direction of the check: report a declared capability with no reference
// outside its own file and outside tests/. That is deliberately conservative —
// see SKIP below for what is excluded and why.
const ROOT = path.join(__dirname, '..')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'tests' || e.name === 'node_modules' || e.name === 'bridge') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.qml')) out.push(p)
  }
  return out
}

const files = walk(ROOT)
const sources = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]))

// Called by the host or by QML itself, not by plugin code.
const SKIP_FUNCTIONS = new Set([
  // Service.qml lifecycle contract, invoked from onConnected_ or the shell.
  'load', 'open', 'close', 'dismiss',
  // QML/Qt entry points.
  'toString', 'valueOf',
])

// Capabilities deliberately left unsurfaced, each with the reason. This list
// is the point of the gate: an entry here is a DECISION on the record, not an
// oversight, and adding one costs a sentence explaining why. Anything not
// listed and not reachable fails the build.
const SKIP_UNSURFACED = new Map([
  ['FilesStore.move',
    'needs a destination directory. Offering it means a folder picker, which ' +
    'CONTRACTS.md §2 reserves for App.qml, or drag-and-drop this plugin has ' +
    'no framework for. A half-wired move that can only target the cwd would ' +
    'be worse than none.'],
  ['FilesStore.prepareSession',
    'needs a chosen method plus a multi-file source selection. That is a ' +
    'surface of its own ("start a session from these files"), not a context ' +
    'menu entry on one node.'],
  ['SchedulerStore.conversationTasks',
    'SchedulerPage has no notion of an active conversation — its only inputs ' +
    'are store.tasks and store.taskOrder, and it treats conversation_id as a ' +
    'free-text field on a task. Wiring a filter would mean inventing a ' +
    '"this conversation only" mode nobody asked for. The store function is ' +
    'unit-tested, so the capability is verified; it is simply not surfaced.'],
  ['SchedulerStore.storeChanged',
    'redundant rather than dropped. QML emits a property-change notification ' +
    'for every `property var` automatically, so bound UI already updates; ' +
    'this explicit signal announces the same thing a second time and no ' +
    'listener needs it. Kept only because removing it means editing four ' +
    'emission sites for no user-visible change — unlike the Move… button, ' +
    'nothing a user does is lost here.'],
  ['ShortcutsStore.storeChanged',
    'same as SchedulerStore.storeChanged. The comment at ShortcutsStore.qml:27 ' +
    'says it fires "so any bound UI updates", which QML property notifications ' +
    'already guarantee.'],
])

// Leading OR trailing `_` is this repo's marker for "internal to its own
// file", so those are excluded outright.
const isPrivate = (name) => name.startsWith('_') || name.endsWith('_')

// A capability is reachable if its name is USED anywhere in production code
// outside its own declaration. Getting this predicate right took three tries,
// and both wrong versions are worth naming because each hid a different half
// of the truth:
//
//   `name(` only          — missed handlers passed BY REFERENCE
//                           (rpc.subscribe("messages:stream", store.handleStream))
//                           and internal helpers called from their own file.
//   any mention of `name` — counted COMMENTS as usage, which silently hid
//                           FilesStore.trash: the only occurrence of that word
//                           anywhere in components/ is a sentence in a
//                           FileTree.qml comment describing signals.
//
// So: strip comments AND string literals, then match the bare word. That
// keeps reference-passing (a real usage) and drops both prose and channel
// names — the latter mattered: `FilesStore.duplicate` is declared, invokes
// "files:duplicate", and is called by nothing. Matching inside strings made
// its own channel name look like a caller and hid it.
function stripNonCode(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
}

function hasProductionCaller(name, ownFile) {
  const word = new RegExp(`\\b${name}\\b`)
  for (const [f, src] of sources) {
    let body = stripNonCode(src)
    if (f === ownFile) {
      body = body.replace(new RegExp(`^\\s*function\\s+${name}\\s*\\([^)]*\\)`, 'gm'), '')
    }
    if (word.test(body)) return true
  }
  return false
}
const findings = []
const skipped = []
let checkedFns = 0
let checkedCallbacks = 0
let checkedSignals = 0

for (const [file, src] of sources) {
  const rel = path.relative(ROOT, file)
  const isStore = rel.startsWith('stores/')

  // ---- store functions ----
  if (isStore) {
    for (const m of src.matchAll(/^\s*function\s+([a-zA-Z_][\w]*)\s*\(/gm)) {
      const name = m[1]
      if (isPrivate(name) || SKIP_FUNCTIONS.has(name)) continue
      checkedFns++
      if (hasProductionCaller(name, file)) continue
      const key = path.basename(file, '.qml') + '.' + name
      const reason = SKIP_UNSURFACED.get(key)
      if (reason) { skipped.push(`${key}: ${reason}`); continue }
      findings.push(`${rel}: function ${name}() has no production caller (only tests, or nothing)`)
    }
  }

  // ---- component callback properties (`property var onX: null`) ----
  //
  // A null-defaulted callback is how this plugin lets a parent opt in to a
  // row action. When no parent ever assigns it, the control it gates is
  // invisible — which is exactly how Edit/Regenerate/Fork stayed dead.
  for (const m of src.matchAll(/^\s*property\s+var\s+(on[A-Z][\w]*)\s*:\s*null/gm)) {
    const name = m[1]
    checkedCallbacks++
    const assignPattern = new RegExp(`\\b${name}\\s*:`)
    let assigned = false
    for (const [otherFile, otherSrc] of sources) {
      if (otherFile === file) continue
      if (assignPattern.test(otherSrc)) { assigned = true; break }
    }
    if (!assigned) findings.push(`${rel}: callback ${name} is never assigned by any parent — whatever it gates is unreachable`)
  }

  // ---- signals nobody handles ----
  //
  // The third shape of the same defect, and the one that produces the worst
  // symptom: a VISIBLE, ENABLED control whose click goes nowhere. Found this
  // way — ConversationActionBar's "Move…" button (tooltip: "Move selected
  // conversations into a folder") emitted `requestMovePicker()` and the
  // Sidebar mount had no handler, and ConversationRow's two "Export as…"
  // entries emitted `exportRequested(format)` that nothing in the chain
  // forwarded.
  //
  // Handler-name derivation is the subtle part: QML uppercases the first
  // LETTER, not the first character, so `_recheckRequested` is handled by
  // `on_RecheckRequested`. Deriving it naively reported that signal as an
  // orphan when ChatView.qml:202 handles it — one false positive is enough to
  // get a gate ignored.
  for (const m of stripNonCode(src).matchAll(/^\s*signal\s+([a-zA-Z_][\w]*)\s*\(/gm)) {
    const name = m[1]
    checkedSignals++
    const handler = 'on' + name.replace(/^(_*)([a-zA-Z])/, (_, u, c) => u + c.toUpperCase())
    const pats = [
      new RegExp(`\\b${handler}\\s*[:(]`),
      new RegExp(`\\.${name}\\s*\\.connect\\s*\\(`),
      new RegExp(`function\\s+${handler}\\s*\\(`),
    ]
    let handled = false
    for (const [otherFile, otherSrc] of sources) {
      // Own file counts: a Repeater delegate's signal is legitimately handled
      // by its own component root.
      const body = otherFile === file
        ? stripNonCode(otherSrc).replace(new RegExp(`^\\s*signal\\s+${name}\\s*\\([^)]*\\)`, 'gm'), '')
        : stripNonCode(otherSrc)
      if (pats.some((p) => p.test(body))) { handled = true; break }
    }
    if (handled) continue
    const key = path.basename(file, '.qml') + '.' + name
    const reason = SKIP_UNSURFACED.get(key)
    if (reason) { skipped.push(`${key}: ${reason}`); continue }
    findings.push(`${rel}: signal ${name}() has no handler — anything that emits it is a dead control`)
  }
}

assert.ok(checkedFns > 0, 'expected to find store functions to check')
assert.ok(checkedCallbacks > 0, 'expected to find callback properties to check')

assert.deepStrictEqual(
  findings,
  [],
  'Unreachable capability: implemented, possibly tested, and no production ' +
    'code can get to it. Either wire it or delete it — do not leave it as ' +
    'scaffolding that reads as finished.\n  ' + findings.join('\n  ')
)

console.log(
  `test_reachable: ok (${checkedFns} store functions, ${checkedCallbacks} callbacks` +
    `, ${checkedSignals} signals, ${skipped.length} deliberately unsurfaced)`
)
