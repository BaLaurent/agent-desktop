const assert = require('assert')
const fs = require('fs')
const path = require('path')

// Every `borderSpec:` in the plugin must produce the shell's spec shape.
//
// The shell's Border helper (Commons/Border.qml) reads widths off
// `spec.widths.top`:
//
//   function uniformWidth(spec) { return spec && spec.widths ? spec.widths.top : 0 }
//   function canUseNative(spec) { return maxWidth(spec.widths) > 0 && !needsOverlay(spec) }
//
// and BorderSurface.qml gates its native border on exactly those:
//
//   border.width: Border.canUseNative(borderSpec) ? Border.uniformWidth(borderSpec) : 0
//
// So a hand-rolled `borderSpec: ({ color: c, width: 1 })` — scalar `width`,
// no `widths` — yields border.width 0 and draws NOTHING. That shipped in five
// places and was invisible to the suite, because the offscreen Border stub
// used to model the same wrong scalar shape.
//
// This gate is text-level on purpose: the generated BorderSurface stub has
// empty bodies, so no runtime QML assertion can observe a border that fails
// to paint. Requiring the factory call is what keeps the shape correct.
const ROOT = path.join(__dirname, '..')

function qmlFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'tests' || entry.name === 'node_modules' || entry.name === 'generated') continue
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) qmlFiles(p, out)
    else if (entry.name.endsWith('.qml')) out.push(p)
  }
  return out
}

const offenders = []
const checked = []

for (const file of qmlFiles(ROOT)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    const m = line.match(/\bborderSpec\s*:\s*(.+)$/)
    if (!m) return
    const rhs = m[1].trim()
    const rel = path.relative(ROOT, file)
    checked.push(`${rel}:${i + 1}`)

    // Accepted: any Border.* factory call — those build `widths` correctly.
    if (/^Border\s*\./.test(rhs)) return
    // Accepted: an explicit object literal that carries `widths`.
    if (/\bwidths\s*:/.test(rhs)) return
    // Accepted: a plain property/binding reference (delegated upward).
    if (/^[A-Za-z_$][\w$.]*$/.test(rhs)) return

    offenders.push(`${rel}:${i + 1}: ${rhs}`)
  })
}

assert.ok(checked.length > 0, 'expected to find at least one borderSpec binding to check')

assert.deepStrictEqual(
  offenders,
  [],
  'borderSpec must use a Border.* factory (or carry `widths`). A scalar ' +
    '`width:` key makes Border.uniformWidth() return 0, so the border never ' +
    'draws. Offenders:\n  ' + offenders.join('\n  ')
)

console.log(`test_border_spec: ok (${checked.length} borderSpec bindings)`)
