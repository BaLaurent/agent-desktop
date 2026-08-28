.pragma library

// Which window a summon payload asks for.
//
// A decision, so it lives in JS rather than in a binding: App.qml imports
// Quickshell for FloatingWindow and PanelWindow, and Quickshell's QML plugin is
// statically linked into the quickshell binary — so App.qml itself cannot be
// instantiated by qmltestrunner. Keeping the routing rule here is what makes it
// testable at all.
//
// The shell hands `open(payload)` whatever string the caller passed, which is a
// Hyprland bind's single-quoted JSON in practice. Anything unparseable, absent,
// or unrecognised is the app window: a payload typo must not produce a dead
// surface.

var WINDOW = "window"
var QUICK = "quick"

// `text` and `voice` are the spellings the existing ALT+SPACE and
// ALT+SHIFT+SPACE binds already send, and both mean quick chat. `quick` is the
// name the bar widget and the new SUPER+A bind use.
var QUICK_MODES = ["quick", "text", "voice"]

function parsePayload(payload) {
  if (payload === undefined || payload === null) return {}
  if (typeof payload === "object") return payload
  var text = String(payload)
  if (text.length === 0) return {}
  try {
    var parsed = JSON.parse(text)
    // A JSON array or a bare `null` parses fine and is not a payload.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return parsed
  } catch (e) {
    return {}
  }
}
function surfaceFor(payload) {
  var mode = String(parsePayload(payload).mode || "")
  return QUICK_MODES.indexOf(mode) >= 0 ? QUICK : WINDOW
}

// A voice summon request is the signal that distinguishes "open the quick
// chat overlay AND toggle the mic" from the other quick modes (which only
// open the overlay). Kept here so the routing rule stays testable in node.
function isVoiceRequest(payload) {
  return String(parsePayload(payload).mode || "") === "voice"
}


// The bar widget's `openOnClick` setting names a surface in its own spelling
// ("Window" / "QuickChat") because that is what reads well in the shell's
// settings UI. One place translates it.
function surfaceForClickSetting(value) {
  return String(value) === "QuickChat" ? QUICK : WINDOW
}

function otherSurface(surface) {
  return surface === QUICK ? WINDOW : QUICK
}
