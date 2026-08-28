// palette is the rule every surface colour in this plugin follows. It exists
// because the alternative — a literal hex per component — is the bug the whole
// theme sweep removed: twelve components each picked their own
// `Qt.darker(Color.background, n)` and four different values of `n`, and none of
// them worked on a light theme.
//
// What is worth testing here is not "does hslToRgb round-trip" but the two
// PROPERTIES the callers depend on and cannot see:
//   - the derived syntax classes are mutually distinguishable at any accent,
//     including a grey one (the saturation floor);
//   - the gauge's mid colour really lands BETWEEN accent and urgent on the
//     short arc, which is the only reason it reads as "warning" rather than as
//     a third unrelated hue.
const assert = require('assert')
const { load, deepEqual } = require('./load')

const P = load('lib/palette.js')

// Matrix Monokai — the theme the plugin was developed against.
const LIME = '#a6e22e'
const ROSE = '#f92672'
const MUTED = '#3e3d32'
const FG = '#f8f8f2'

// ---- elevation -------------------------------------------------------------

// The ladder is monotonic and clamped. A component asking for a level it made
// up must land on the deepest well rather than on `undefined`, which QML would
// turn into a transparent surface — i.e. an invisible card.
assert.strictEqual(P.surfaceAlpha(0), 0)
assert.ok(P.surfaceAlpha(1) > P.surfaceAlpha(0), 'level 1 lifts off the page')
assert.ok(P.surfaceAlpha(2) > P.surfaceAlpha(1), 'level 2 sits above level 1')
assert.ok(P.surfaceAlpha(3) > P.surfaceAlpha(2), 'level 3 is the deepest well')
assert.strictEqual(P.surfaceAlpha(99), P.surfaceAlpha(3), 'clamped at the top')
assert.strictEqual(P.surfaceAlpha(-4), P.surfaceAlpha(0), 'clamped at the bottom')
assert.strictEqual(P.surfaceAlpha('nope'), P.surfaceAlpha(0), 'non-numeric is level 0')
assert.ok(P.surfaceAlpha(3) < 0.35, 'a wash must stay a wash, not become a fill')

// A tint has to outweigh the deepest structural surface, or a failed-task strip
// reads as just another card.
assert.ok(P.tintAlpha() > P.surfaceAlpha(3), 'a semantic tint is louder than elevation')

// ---- colour parsing --------------------------------------------------------

deepEqual(P.parseColor('#000000'), { r: 0, g: 0, b: 0 })
deepEqual(P.parseColor('#ffffff'), { r: 1, g: 1, b: 1 })
// Qt writes #aarrggbb once alpha drops below 255; the alpha byte is dropped, so
// a translucent token still yields its own hue instead of a wrong one.
deepEqual(P.parseColor('#80ff0000'), { r: 1, g: 0, b: 0 })
deepEqual(P.parseColor('#f00'), { r: 1, g: 0, b: 0 })
assert.strictEqual(P.parseColor('accent'), null, 'a role name is not a colour')
assert.strictEqual(P.parseColor(''), null)
assert.strictEqual(P.parseColor(null), null)
assert.strictEqual(P.parseColor('#12345'), null, 'a malformed literal is refused')

assert.strictEqual(P.toHex({ r: 1, g: 0, b: 0 }), '#ff0000')
assert.strictEqual(P.toHex(P.parseColor(LIME)), LIME, 'round-trips a theme token')
// Clamped rather than wrapped: a computed channel slightly out of gamut must not
// wrap around to the opposite end and flip the hue.
assert.strictEqual(P.toHex({ r: 1.4, g: -0.2, b: 0.5 }), '#ff0080')

// ---- hue rotation ----------------------------------------------------------

assert.ok(Math.abs(P.rotateHue(0.5, 180) - 0.0) < 1e-9, 'wraps forward past 1')
assert.ok(Math.abs(P.rotateHue(0.1, -180) - 0.6) < 1e-9, 'wraps backward below 0')

// ---- syntax palette --------------------------------------------------------

const syn = P.syntaxColors(LIME, ROSE, MUTED, FG, 'monospace')

// The keys lib/highlight.js reads. A missing one is an unstyled token class,
// silently — highlight.js falls back to defaultColor without complaining.
for (const key of ['family', 'defaultColor', 'kw', 'str', 'num', 'cmt', 'fn', 'typ', 'add', 'del']) {
  assert.ok(Object.prototype.hasOwnProperty.call(syn, key), 'syntaxColors is missing ' + key)
}
assert.strictEqual(syn.family, 'monospace')
assert.strictEqual(syn.defaultColor, FG)
assert.strictEqual(syn.cmt, MUTED, 'a comment is de-emphasised text: the muted token')
assert.strictEqual(syn.add, LIME, 'diff add is the accent')
assert.strictEqual(syn.del, ROSE, 'diff del is the urgent token')
assert.strictEqual(syn.kw, LIME, 'keywords ARE the accent, unrotated')

// Distinguishability is the whole point of the rotation table: a palette whose
// classes collide is a code block rendered in one colour.
const classes = ['kw', 'typ', 'fn', 'num', 'str']
const seen = new Set(classes.map((c) => syn[c]))
assert.strictEqual(seen.size, classes.length, 'derived syntax classes collide: ' + JSON.stringify(syn))

// Every derived class stays inside the theme: same lightness as the accent, so
// none of them is suddenly a black or a white on a mid-lightness theme.
const accentL = P.rgbToHsl(P.parseColor(LIME)).l
for (const cls of classes) {
  const l = P.rgbToHsl(P.parseColor(syn[cls])).l
  assert.ok(Math.abs(l - accentL) < 0.03, cls + ' drifted off the accent lightness: ' + l)
}

// A grey accent is the case the saturation floor exists for: without it every
// rotation returns the same grey and the palette collapses.
const grey = P.syntaxColors('#808080', ROSE, MUTED, FG, 'monospace')
assert.strictEqual(new Set(classes.map((c) => grey[c])).size, classes.length,
  'a grey accent collapsed the palette: ' + JSON.stringify(grey))

// An unparseable accent must not invent colours — it falls back to body text.
const bad = P.syntaxColors('accent', ROSE, MUTED, FG, 'monospace')
for (const cls of classes) {
  assert.strictEqual(bad[cls], FG, cls + ' invented a colour from an unparseable accent')
}

// ---- warning colour --------------------------------------------------------

const warn = P.warningColor(LIME, ROSE)
const warnHsl = P.rgbToHsl(P.parseColor(warn))
const limeHsl = P.rgbToHsl(P.parseColor(LIME))
const roseHsl = P.rgbToHsl(P.parseColor(ROSE))

// Lime (~80°) to rose (~338°) is shorter going DOWN through orange than up
// through cyan/blue. Landing in 0..60° is the assertion that the short arc was
// taken; the long arc would put the "warning" step somewhere around cyan.
const warnDeg = warnHsl.h * 360
assert.ok(warnDeg >= 0 && warnDeg <= 60,
  'warning left the short arc between accent and urgent: ' + warnDeg.toFixed(1) + 'deg')

// It is a step BETWEEN the two, not a copy of either.
assert.notStrictEqual(warn.toLowerCase(), LIME)
assert.notStrictEqual(warn.toLowerCase(), ROSE)
assert.ok(Math.abs(warnHsl.s - (limeHsl.s + roseHsl.s) / 2) < 0.02, 'saturation is the mean')
assert.ok(Math.abs(warnHsl.l - (limeHsl.l + roseHsl.l) / 2) < 0.02, 'lightness is the mean')

// Symmetry: swapping the endpoints must pick the same arc, or the gauge's mid
// colour would depend on argument order.
assert.strictEqual(P.warningColor(ROSE, LIME), warn, 'the short arc is not order-dependent')

// A theme whose accent and urgent are the same token has no midpoint to find;
// the answer is that token, not a rotation away from it.
assert.strictEqual(P.warningColor(ROSE, ROSE).toLowerCase(), ROSE)

// Unparseable input degrades to urgent rather than to nothing: a gauge that
// loses its warning step should over-report severity, never under-report it.
assert.strictEqual(P.warningColor('accent', ROSE), ROSE)

console.log('test_palette: ok')
