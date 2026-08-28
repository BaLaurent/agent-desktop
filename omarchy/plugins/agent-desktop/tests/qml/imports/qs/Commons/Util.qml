pragma Singleton
import QtQuick

// Offscreen stand-in for Commons/Util.
QtObject {
  function alpha(color, a) { return Qt.rgba(color.r, color.g, color.b, a) }
  function isPlainObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v) }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }
}
