const assert = require('assert')
const fs = require('fs')
const path = require('path')

// Every channel the plugin INVOKES must exist on the server.
//
// This is the one defect class that no other gate in this plugin can see. The
// offscreen QML tests drive a fake `rpc` whose `invoke()` accepts any string,
// so a typo'd or removed channel name passes the whole suite and fails only at
// runtime, with a bare "Unknown channel: …" the user never sees. That is
// exactly how a bug-report UI got built against `bug:getMainErrors`,
// `bug:scrub` and `bug:send`: all three are DEFINED in
// src/core/handlers/bugReport.ts, but `registerCoreHandlers` imports the
// registrar and never invokes it, so the server answers Unknown channel.
//
// The rule is split by CALL SHAPE, which makes the check self-maintaining and
// removes any hand-kept allowlist:
//
//   rpc.invoke("x:y")     -> request/response. MUST be `registrar.handle`d.
//   rpc.subscribe("x:y")  -> server push. Never handled; emitted by
//                            broadcast() / sendToRenderer() / notifyRenderer().
//
// Scope matters and cost me two wrong answers while writing this: handlers are
// registered in `src/core/handlers/*.ts`, in SUBDIRECTORIES of it, and in
// `src/core/services/*.ts` (Discord registers its three there). Scanning only
// `handlers/*.ts` reported 13 false missing channels. So the scan is `src/`
// recursive, and nothing narrower.
const PLUGIN = path.join(__dirname, '..')
const REPO = path.resolve(PLUGIN, '../../..')
const SRC = path.join(REPO, 'src')

function walk(dir, filter, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '__tests__'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, filter, out)
    else if (filter(e.name)) out.push(p)
  }
  return out
}

// ---- what the server offers -------------------------------------------

const serverFiles = walk(SRC, (n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))
const registered = new Set()
const pushed = new Set()

for (const f of serverFiles) {
  const src = fs.readFileSync(f, 'utf8')
  for (const m of src.matchAll(/registrar\.handle\(\s*['"]([^'"]+)['"]/g)) registered.add(m[1])
  // Push emitters. Three spellings exist in this codebase; a channel emitted
  // by any of them is server->client and is never registered.
  for (const m of src.matchAll(/(?:broadcast|sendToRenderer|notifyRenderer)\(\s*['"]([^'"]+)['"]/g)) pushed.add(m[1])
  // engine.ts declares the push channel map as a type; entries there count too.
  for (const m of src.matchAll(/^\s*'([a-z][a-zA-Z]*:[a-zA-Z]+)':\s*\[/gm)) pushed.add(m[1])
}

// ---- what the plugin asks for -----------------------------------------

const pluginFiles = walk(
  PLUGIN,
  (n) => n.endsWith('.qml') || n.endsWith('.js')
).filter((p) => {
  const rel = path.relative(PLUGIN, p)
  return !rel.startsWith('tests') && !rel.startsWith('bridge') && !rel.startsWith('node_modules')
})

const invokes = new Map()
const subscribes = new Map()

for (const f of pluginFiles) {
  const rel = path.relative(PLUGIN, f)
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    // Drop line comments: prose naming a channel is not a call.
    const code = line.replace(/^\s*\/\/.*$/, '')
    for (const m of code.matchAll(/\binvoke\s*\(\s*["']([a-z][a-zA-Z]*:[a-zA-Z]+)["']/g)) {
      if (!invokes.has(m[1])) invokes.set(m[1], [])
      invokes.get(m[1]).push(`${rel}:${i + 1}`)
    }
    for (const m of code.matchAll(/\b(?:subscribe|unsubscribe)\s*\(\s*["']([a-z][a-zA-Z]*:[a-zA-Z]+)["']/g)) {
      if (!subscribes.has(m[1])) subscribes.set(m[1], [])
      subscribes.get(m[1]).push(`${rel}:${i + 1}`)
    }
  })
}

assert.ok(registered.size > 50, `only found ${registered.size} registered channels — the scan is broken, not the plugin`)
assert.ok(invokes.size > 50, `only found ${invokes.size} invoked channels — the scan is broken`)

const problems = []

for (const [ch, sites] of invokes) {
  if (registered.has(ch)) continue
  if (pushed.has(ch)) {
    problems.push(`${ch} is a server PUSH channel but the plugin invokes it (${sites.join(', ')})`)
    continue
  }
  problems.push(`${ch} is invoked but no registrar.handle registers it (${sites.join(', ')})`)
}

for (const [ch, sites] of subscribes) {
  if (pushed.has(ch) || registered.has(ch)) continue
  problems.push(`${ch} is subscribed but nothing on the server ever emits it (${sites.join(', ')})`)
}

assert.deepStrictEqual(
  problems,
  [],
  'Channel contract broken. The offscreen suite cannot catch this — its fake ' +
    'rpc accepts any channel name — so it surfaces live as "Unknown channel".\n  ' +
    problems.join('\n  ')
)

console.log(
  `test_channels: ok (${invokes.size} invoked, ${subscribes.size} subscribed, ` +
    `against ${registered.size} registered + ${pushed.size} push)`
)
