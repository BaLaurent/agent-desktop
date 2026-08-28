// Offscreen stand-in for /usr/share/omarchy/shell/Commons/Border.qml.
//
// Property and signal NAMES mirror the real component exactly. tests/test_stub_fidelity.js
// asserts that, because a stub that GRANTS what the shell withholds lets code
// compile in tests and be refused by the live shell.
//
// The SPEC SHAPE matters as much as the names, and this stub used to get it
// wrong: it returned `{ color, width }` while the shell returns
// `{ color, widths: { top, right, bottom, left }, gradient }`. Every call site
// that hand-rolled `borderSpec: ({ color: c, width: 1 })` therefore passed the
// suite and rendered NO BORDER live, because the real
// `Border.uniformWidth(spec)` reads `spec.widths.top` and got `undefined`.
// Mirroring `widths` here is what makes the compile gate catch that again, so
// do not "simplify" it back to a scalar.
pragma Singleton
import QtQuick

QtObject {
  // ---- spec factories (shape-faithful) ----

  function widthSpec(width) {
    var n = Number(width)
    if (!isFinite(n) || n < 0) n = 0
    return ({ top: n, right: n, bottom: n, left: n })
  }

  function none() { return flat("transparent", 0) }

  function flat(color, width) {
    return ({
      color: color === undefined || color === null ? "transparent" : color,
      widths: widthSpec(width),
      gradient: ({ colors: [], angle: 0, enabled: false })
    })
  }

  function value(section, key) { return undefined }
  function valueOr(section, keys) { return undefined }
  function alpha(section, key, fallback) { return fallback }
  function cssColor(color, opacity) { return color }
  function sameColor(a, b) { return a === b }

  function localOrSurfaceSpec(section, token, localColor, defaultColor, fallbackWidth, alphaKey) {
    return flat(localColor !== undefined ? localColor : defaultColor,
                fallbackWidth !== undefined ? fallbackWidth : 1)
  }

  function surfaceSpec(section, token, fallbackColor, fallbackWidth, alphaKey) {
    return flat(fallbackColor, fallbackWidth)
  }

  function hyprlandActiveSpec(fallbackColor, fallbackWidth) {
    return flat(fallbackColor, fallbackWidth)
  }

  function withWidth(spec, width) {
    if (!spec) return none()
    return ({ color: spec.color, gradient: spec.gradient, widths: widthSpec(width) })
  }

  // ---- accessors, mirroring BorderGeometry.js exactly ----

  function maxWidth_(widths) {
    if (!widths) return 0
    return Math.max(widths.top || 0, widths.right || 0, widths.bottom || 0, widths.left || 0)
  }

  function isUniform_(widths) {
    if (!widths) return true
    return widths.top === widths.right
      && widths.right === widths.bottom
      && widths.bottom === widths.left
  }

  function top(spec) { return spec && spec.widths ? spec.widths.top : 0 }
  function right(spec) { return spec && spec.widths ? spec.widths.right : 0 }
  function bottom(spec) { return spec && spec.widths ? spec.widths.bottom : 0 }
  function left(spec) { return spec && spec.widths ? spec.widths.left : 0 }
  function uniformWidth(spec) { return spec && spec.widths ? spec.widths.top : 0 }
  function color(spec) { return spec ? spec.color : "transparent" }

  function isNone(spec) { return !spec || maxWidth_(spec.widths) <= 0 }

  function needsOverlay(spec) {
    if (!spec) return false
    if (maxWidth_(spec.widths) <= 0) return false
    return !!(spec.gradient && spec.gradient.enabled) || !isUniform_(spec.widths)
  }

  function canUseNative(spec) {
    return !!spec && maxWidth_(spec.widths) > 0 && !needsOverlay(spec)
  }
}
