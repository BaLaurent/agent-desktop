.pragma library

// The keybinding spelling shared by this front and the React renderer.
//
// A decision, so it lives here rather than in the store: the rule has to agree
// with `keyEventToAccelerator` in
// src/renderer/components/settings/ShortcutSettings.tsx and with the seed data
// in src/core/db/seed.ts, and the only way to hold it to that is a test that
// runs the exact bytes the shell loads.
//
// WHY THIS FILE EXISTS AT ALL. The store used to format a QML `KeyEvent` by
// reading `event.ctrlKey` / `event.altKey` / `event.shiftKey` / `event.metaKey`
// and treating `event.key` as a string — the shape of a DOM `KeyboardEvent`,
// copied across from the React page. A QML KeyEvent has none of those: it
// carries `modifiers` (a Qt.KeyboardModifiers bitmask) and an integer `key`
// (a Qt.Key_* code). Every one of those reads was `undefined`, so every capture
// dropped its modifiers and stringified the raw keycode: Ctrl+Shift+V was
// persisted as "86". The mapping is therefore a table, not four boolean reads.
//
// The Qt constants are spelled numerically because this file has to run in node
// (where `Qt` does not exist). tests/qml/tst_shortcuts_store.qml pins every one
// of them against the real Qt enum, so a wrong value fails a test instead of
// silently mis-spelling a shortcut.

// Qt.KeyboardModifiers bits.
var MOD_SHIFT = 0x02000000
var MOD_CONTROL = 0x04000000
var MOD_ALT = 0x08000000
var MOD_META = 0x10000000

// Qt.Key_Space. Named rather than emitted as " " because the table stores the
// literal word — "Alt+Space", not "Alt+ ".
var KEY_SPACE = 0x20

// Qt.Key_Escape. Cancels a recording, so it is never a committable binding.
var KEY_ESCAPE = 0x01000000

// Qt.Key_F1; F1..F35 are contiguous from here.
var KEY_F1 = 0x01000030
var FUNCTION_KEY_COUNT = 35

// A modifier on its own is not a combination: the page must not commit "Ctrl"
// while the user is still reaching for the second key. Qt.Key_AltGr and the
// Hyper keys are refused for the same reason, which is a deliberate divergence
// from the React page — its refusal list omits them, and it would happily
// persist "AltGraph".
var BARE_MODIFIERS = {}
BARE_MODIFIERS[0x01000020] = true   // Qt.Key_Shift
BARE_MODIFIERS[0x01000021] = true   // Qt.Key_Control
BARE_MODIFIERS[0x01000022] = true   // Qt.Key_Meta
BARE_MODIFIERS[0x01000023] = true   // Qt.Key_Alt
BARE_MODIFIERS[0x01000053] = true   // Qt.Key_Super_L
BARE_MODIFIERS[0x01000054] = true   // Qt.Key_Super_R
BARE_MODIFIERS[0x01000056] = true   // Qt.Key_Hyper_L
BARE_MODIFIERS[0x01000057] = true   // Qt.Key_Hyper_R
BARE_MODIFIERS[0x01001103] = true   // Qt.Key_AltGr

// Qt.Key_* -> the name DOM `KeyboardEvent.key` uses, so a string captured here
// is interchangeable with one captured in the React page.
var NAMED_KEYS = {}
NAMED_KEYS[0x01000001] = "Tab"          // Qt.Key_Tab
NAMED_KEYS[0x01000002] = "Tab"          // Qt.Key_Backtab — Qt reports Shift+Tab
                                        // as Backtab, and the seed data spells
                                        // that combination "Shift+Tab".
NAMED_KEYS[0x01000003] = "Backspace"    // Qt.Key_Backspace
NAMED_KEYS[0x01000004] = "Enter"        // Qt.Key_Return — DOM calls both Return
NAMED_KEYS[0x01000005] = "Enter"        // Qt.Key_Enter     and keypad Enter this
NAMED_KEYS[0x01000006] = "Insert"       // Qt.Key_Insert
NAMED_KEYS[0x01000007] = "Delete"       // Qt.Key_Delete
NAMED_KEYS[0x01000008] = "Pause"        // Qt.Key_Pause
NAMED_KEYS[0x01000009] = "PrintScreen"  // Qt.Key_Print
NAMED_KEYS[0x01000010] = "Home"         // Qt.Key_Home
NAMED_KEYS[0x01000011] = "End"          // Qt.Key_End
NAMED_KEYS[0x01000012] = "ArrowLeft"    // Qt.Key_Left
NAMED_KEYS[0x01000013] = "ArrowUp"      // Qt.Key_Up
NAMED_KEYS[0x01000014] = "ArrowRight"   // Qt.Key_Right
NAMED_KEYS[0x01000015] = "ArrowDown"    // Qt.Key_Down
NAMED_KEYS[0x01000016] = "PageUp"       // Qt.Key_PageUp
NAMED_KEYS[0x01000017] = "PageDown"     // Qt.Key_PageDown
NAMED_KEYS[0x01000024] = "CapsLock"     // Qt.Key_CapsLock
NAMED_KEYS[0x01000025] = "NumLock"      // Qt.Key_NumLock
NAMED_KEYS[0x01000026] = "ScrollLock"   // Qt.Key_ScrollLock
NAMED_KEYS[0x01000055] = "ContextMenu"  // Qt.Key_Menu
NAMED_KEYS[0x01000058] = "Help"         // Qt.Key_Help

// The name for one Qt.Key_* code, or "" when the key cannot be half of a
// binding (a bare modifier, Escape, or a key this front has no spelling for).
// Refusing is the safe answer: the old code's fallback was to stringify the
// keycode, which persisted "16777268" as a shortcut.
function keyName(key) {
  var code = Number(key)
  if (!isFinite(code)) return ""
  if (code === KEY_ESCAPE) return ""
  if (BARE_MODIFIERS[code] === true) return ""
  if (code === KEY_SPACE) return "Space"
  if (NAMED_KEYS[code] !== undefined) return NAMED_KEYS[code]
  if (code > KEY_F1 - 1 && code < KEY_F1 + FUNCTION_KEY_COUNT) {
    return "F" + String(code - KEY_F1 + 1)
  }
  // Printable ASCII. Qt.Key_A..Z are 0x41..0x5A and Qt.Key_0..9 are 0x30..0x39,
  // so this already yields the upper-cased letter the table stores, and it is
  // what makes the seeded "Ctrl+," reachable.
  if (code > KEY_SPACE && code < 0x7f) return String.fromCharCode(code)
  return ""
}

// The modifier names, in the fixed order the React page emits them:
// Ctrl, Super, Alt, Shift.
function modifierNames(modifiers) {
  var bits = Number(modifiers) || 0
  var parts = []
  if (bits & MOD_CONTROL) parts.push("Ctrl")
  if (bits & MOD_META) parts.push("Super")
  if (bits & MOD_ALT) parts.push("Alt")
  if (bits & MOD_SHIFT) parts.push("Shift")
  return parts
}

// The canonical keybinding string for a QML key event's `modifiers` and `key`,
// or "" when the combination is not committable.
function format(modifiers, key) {
  var name = keyName(key)
  if (name === "") return ""
  return modifierNames(modifiers).concat([name]).join("+")
}
