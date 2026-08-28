const assert = require('assert')
const fs = require('fs')
const path = require('path')

// Stub SHAPE fidelity — the hole that made the whole plugin's borders invisible.
//
// `gen-stubs.js --check` guards declaration NAMES only; its own generated
// header says so ("the object's declaration NAMES matter; the bodies are
// deliberately empty"). That is enough for the auto-generated stubs, whose
// bodies really are empty, but NOT for the hand-written Commons singletons
// (Border, Color, Style, Util) whose bodies return real values that call sites
// destructure.
//
// The failure that motivated this file: the hand-written `Border` stub returned
// `{ color, width }` while the shell returns
// `{ color, widths: { top, right, bottom, left }, gradient }`. Same function
// name, so the name check passed. Five call sites then hand-rolled
// `borderSpec: ({ color: c, width: 1 })`, which the suite accepted and the live
// shell rendered as NO BORDER AT ALL, because the real
// `Border.uniformWidth(spec)` reads `spec.widths.top` and got `undefined`.
// The quick-chat overlay was consequently invisible against a dark desktop:
// its card fill measured rgb(12,12,10) with the desktop at rgb(18,13,11), and
// the 1px accent border that should have separated them was never drawn.
//
// The asymmetry that matters, and why only one direction is fatal:
//
//   stub GRANTS a key the shell lacks  -> compiles in tests, BREAKS LIVE. Fatal.
//   stub WITHHOLDS a key the shell has -> fails in tests, works live. Safe,
//                                        and deliberate: the stubs are subsets.
//
// So this gate fails only on the first direction, and reports the second as
// information.
const ROOT = path.join(__dirname, '..')
const SHELL = '/usr/share/omarchy/shell/Commons'

// Nested value objects that call sites reach into by key. Adding a new one here
// is cheap; the cost of NOT having it is a binding that silently reads
// undefined on the live shell only.
const SHARED_OBJECTS = {
  Color: ['bar', 'menu', 'notifications', 'popups', 'tooltip'],
  Style: ['bar', 'font', 'spacing'],
}

function innerKeys(file, name) {
  const src = fs.readFileSync(file, 'utf8')
  const re = new RegExp(`property\\s+(?:var|QtObject)\\s+${name}\\s*:\\s*`, 'm')
  const m = re.exec(src)
  if (!m) return null

  let i = m.index + m[0].length
  while (i < src.length && src[i] !== '{') i++
  if (i >= src.length) return null

  let depth = 0
  const start = i
  let end = i
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }

  const body = src.slice(start + 1, end)
  const keys = new Set()
  for (const k of body.matchAll(/(?:^|[,{\s])([a-zA-Z_][\w]*)\s*:/gm)) keys.add(k[1])
  for (const k of body.matchAll(/property\s+\w+\s+([a-zA-Z_][\w]*)/g)) keys.add(k[1])
  return keys
}

// Not every machine running the suite has Omarchy installed. Skip rather than
// fail there — but never skip silently on a machine that DOES have it, which is
// where the drift would actually be introduced.
if (!fs.existsSync(SHELL)) {
  console.log('test_stub_shape: skipped (no shell at ' + SHELL + ')')
  process.exit(0)
}

const dangerous = []
const checked = []

for (const [file, names] of Object.entries(SHARED_OBJECTS)) {
  const realFile = path.join(SHELL, file + '.qml')
  const stubFile = path.join(ROOT, 'tests/qml/imports/qs/Commons', file + '.qml')
  assert.ok(fs.existsSync(stubFile), `missing stub: ${stubFile}`)

  for (const name of names) {
    const real = innerKeys(realFile, name)
    const stub = innerKeys(stubFile, name)
    assert.ok(real, `could not read ${file}.${name} from the shell — has it been restructured?`)
    assert.ok(stub, `could not read ${file}.${name} from the stub`)

    for (const k of stub) {
      if (!real.has(k)) dangerous.push(`${file}.${name}.${k} — stub grants it, shell does not have it`)
    }
    checked.push(`${file}.${name}`)
  }
}

assert.deepStrictEqual(
  dangerous,
  [],
  'A stub grants a key the live shell does not have. Code using it will pass ' +
    'this suite and read undefined on the real shell.\n  ' + dangerous.join('\n  ')
)

// The Border spec shape specifically, because this is the one that shipped
// broken and a key-set comparison alone would not catch it: `flat()` builds its
// value in a function body rather than declaring a nested object.
const borderStub = path.join(ROOT, 'tests/qml/imports/qs/Commons/Border.qml')
const borderSrc = fs.readFileSync(borderStub, 'utf8')

assert.ok(
  /widths\s*:/.test(borderSrc),
  'the Border stub must model `widths`, not a scalar `width` — the shell reads ' +
    'spec.widths.top, so a scalar stub teaches call sites a shape that renders no border'
)
assert.ok(
  !/return\s*\(\{\s*color\s*:[^}]*\bwidth\s*:/.test(borderSrc),
  'the Border stub returns a scalar `width` key; that is the exact drift that ' +
    'made five call sites render no border while the suite stayed green'
)
assert.ok(
  /function\s+uniformWidth\s*\([^)]*\)\s*\{[^}]*widths/.test(borderSrc),
  'Border.uniformWidth in the stub must read from `widths` like the shell does'
)
assert.ok(
  /function\s+canUseNative/.test(borderSrc),
  'Border.canUseNative must exist in the stub — BorderSurface gates border.width on it'
)

console.log(`test_stub_shape: ok (${checked.length} shared objects, Border spec shape pinned)`)
