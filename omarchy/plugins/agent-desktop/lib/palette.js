.pragma library

// Theme palette. Two decisions live here because a dozen components share them
// and would otherwise each re-invent one.
//
// 1. ELEVATION is a translucent FOREGROUND wash over the surface, never
//    `Qt.darker(Color.background, n)`. Darkening lifts a card on a dark theme
//    and buries it on a light one: the same binding produces a dark box on a
//    pale page. A wash reads as "raised" either way, and it is the shell's own
//    idiom — `Color.menu.selectedBackground` is `foreground` at alpha 0.08.
//
// 2. Anything the five theme tokens cannot name directly (a seven-class syntax
//    palette, a mid-severity gauge colour) is DERIVED from them by hue
//    rotation, so it stays inside the active theme's colour family instead of
//    being a literal that fits exactly one theme. That is the difference
//    between "the plugin has colours" and "the plugin wears the theme".
//
// Pure functions over hex strings and numbers, so tests/test_palette.js runs
// them with no QML engine (CONTRACTS.md §1, §2). QML passes `String(Color.x)`.

// ---- elevation -----------------------------------------------------------

// Wash alpha per elevation level; level 0 is the page itself. Three levels is
// the whole ladder this plugin needs: a card (bubbles, rows), a strip that must
// be read before the text around it (approvals, banners), and an inset well
// (code, tool output).
var SURFACE_ALPHAS = [0.0, 0.05, 0.09, 0.14]

function surfaceAlpha(level) {
  var i = Math.round(Number(level))
  if (!isFinite(i) || i < 0) i = 0
  if (i >= SURFACE_ALPHAS.length) i = SURFACE_ALPHAS.length - 1
  return SURFACE_ALPHAS[i]
}

// Wash alpha for a semantic tint (ok / failed / error strip). Deliberately the
// shell's own `selected-fill-alpha` default, so a tinted strip carries the same
// visual weight as a selected control.
function tintAlpha() {
  return 0.18
}

// ---- colour space --------------------------------------------------------

function _hex2(value) {
  var s = Math.max(0, Math.min(255, Math.round(value))).toString(16)
  return s.length === 1 ? "0" + s : s
}

// Accepts "#rgb", "#rrggbb", and Qt's "#aarrggbb" (which is what
// `String(someColor)` yields once alpha drops below 255). Returns {r,g,b} in
// 0..1, or null when the input is not a colour literal at all — a theme token
// can legitimately be a role name, and guessing would paint garbage.
function parseColor(value) {
  var s = String(value === undefined || value === null ? "" : value).replace(/^\s+|\s+$/g, "")
  if (s.charAt(0) === "#") s = s.slice(1)
  if (s.length === 3) {
    s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2)
  }
  if (s.length === 8) s = s.slice(2)
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null
  return {
    r: parseInt(s.slice(0, 2), 16) / 255,
    g: parseInt(s.slice(2, 4), 16) / 255,
    b: parseInt(s.slice(4, 6), 16) / 255
  }
}

function toHex(rgb) {
  if (!rgb) return ""
  return "#" + _hex2(rgb.r * 255) + _hex2(rgb.g * 255) + _hex2(rgb.b * 255)
}

// Hue in turns (0..1) rather than degrees, matching Qt's hslHue.
function rgbToHsl(rgb) {
  var max = Math.max(rgb.r, rgb.g, rgb.b)
  var min = Math.min(rgb.r, rgb.g, rgb.b)
  var l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: l }
  var d = max - min
  var s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  var h
  if (max === rgb.r) h = ((rgb.g - rgb.b) / d + (rgb.g < rgb.b ? 6 : 0)) / 6
  else if (max === rgb.g) h = ((rgb.b - rgb.r) / d + 2) / 6
  else h = ((rgb.r - rgb.g) / d + 4) / 6
  return { h: h, s: s, l: l }
}

function _channel(p, q, t) {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

function hslToRgb(hsl) {
  if (hsl.s === 0) return { r: hsl.l, g: hsl.l, b: hsl.l }
  var q = hsl.l < 0.5 ? hsl.l * (1 + hsl.s) : hsl.l + hsl.s - hsl.l * hsl.s
  var p = 2 * hsl.l - q
  return {
    r: _channel(p, q, hsl.h + 1 / 3),
    g: _channel(p, q, hsl.h),
    b: _channel(p, q, hsl.h - 1 / 3)
  }
}

// Wrapped to [0,1). Degrees in, turns out, because degrees are how a rotation
// table reads and turns are what the colour space wants.
function rotateHue(hue, degrees) {
  var v = (Number(hue) + Number(degrees) / 360) % 1
  return v < 0 ? v + 1 : v
}

// ---- derived roles -------------------------------------------------------

// Hue rotation off the accent, in degrees, per highlighter class. Chosen to be
// mutually distinguishable at any accent: ±45° reads as "related to the accent"
// (types, functions), 90° and 165° as distinct hues (numbers, strings).
var SYNTAX_ROTATIONS = { kw: 0, typ: 45, fn: -45, num: 90, str: 165 }

// A near-grey accent would collapse every rotation onto the same grey, so the
// derived classes get a saturation floor. Lightness is left at the accent's own
// value: how loud a highlight should be is the theme author's call.
var SYNTAX_MIN_SATURATION = 0.45

// The `colors` map lib/highlight.js expects: {family, defaultColor, kw, str,
// num, cmt, fn, typ, add, del}. `cmt` is the muted token (a comment IS de
// -emphasised text), and add/del are the diff pair, which the theme already
// names — accent for added, urgent for removed.
function syntaxColors(accent, urgent, muted, foreground, family) {
  var out = {
    family: String(family === undefined || family === null ? "" : family),
    defaultColor: String(foreground === undefined || foreground === null ? "" : foreground),
    cmt: String(muted === undefined || muted === null ? "" : muted),
    add: String(accent === undefined || accent === null ? "" : accent),
    del: String(urgent === undefined || urgent === null ? "" : urgent)
  }
  var rgb = parseColor(accent)
  if (!rgb) {
    // No parseable accent: every class falls back to body text rather than to
    // an invented colour. Unstyled beats wrong.
    for (var key in SYNTAX_ROTATIONS) out[key] = out.defaultColor
    return out
  }
  var hsl = rgbToHsl(rgb)
  var s = Math.max(hsl.s, SYNTAX_MIN_SATURATION)
  for (var cls in SYNTAX_ROTATIONS) {
    out[cls] = toHex(hslToRgb({ h: rotateHue(hsl.h, SYNTAX_ROTATIONS[cls]), s: s, l: hsl.l }))
  }
  return out
}

// Mid-severity colour for a three-step gauge (accent -> warning -> urgent).
// The hue midpoint on the SHORTER arc between accent and urgent, at the mean of
// their saturation and lightness: on a lime/rose theme that lands on orange,
// which is exactly what the step wants, and it keeps landing between the two
// tokens on a theme whose accent and urgent sit somewhere else entirely.
function warningColor(accent, urgent) {
  var a = parseColor(accent)
  var u = parseColor(urgent)
  if (!a || !u) return String(urgent === undefined || urgent === null ? "" : urgent)
  var ah = rgbToHsl(a)
  var uh = rgbToHsl(u)
  var forward = ((uh.h - ah.h) % 1 + 1) % 1
  var mid = forward <= 0.5 ? ah.h + forward / 2 : ah.h - (1 - forward) / 2
  mid = ((mid % 1) + 1) % 1
  return toHex(hslToRgb({ h: mid, s: (ah.s + uh.s) / 2, l: (ah.l + uh.l) / 2 }))
}
