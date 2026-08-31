const assert = require('assert')
const { load } = require('./load')

const K = load('lib/shortcutKeys.js')

// Qt.Key_* / Qt.KeyboardModifiers values. Spelled here as well as in the module
// so a typo in one is not silently agreed with by the other;
// tests/qml/tst_shortcuts_store.qml pins the module's copies against the real
// Qt enum, which is what makes these numbers trustworthy rather than folklore.
const SHIFT = 0x02000000
const CONTROL = 0x04000000
const ALT = 0x08000000
const META = 0x10000000

const Key = {
  Space: 0x20,
  Comma: 0x2c,
  A: 0x41,
  B: 0x42,
  N: 0x4e,
  V: 0x56,
  Zero: 0x30,
  Nine: 0x39,
  Escape: 0x01000000,
  Tab: 0x01000001,
  Backtab: 0x01000002,
  Backspace: 0x01000003,
  Return: 0x01000004,
  Enter: 0x01000005,
  Delete: 0x01000007,
  Home: 0x01000010,
  Left: 0x01000012,
  PageDown: 0x01000017,
  Shift: 0x01000020,
  Control: 0x01000021,
  Meta: 0x01000022,
  Alt: 0x01000023,
  F1: 0x01000030,
  F5: 0x01000034,
  F12: 0x0100003b,
  F35: 0x01000052,
  Super_L: 0x01000053,
  AltGr: 0x01001103,
}

// ---- the spelling the seed data uses -------------------------------------
//
// Every one of these is a real row in src/core/db/seed.ts seedShortcuts. If the
// front cannot re-produce a seeded string from the key press that means it, then
// re-recording a shortcut to the value it already had would rewrite the row to
// something else — and the React page, which still writes the seeded spelling,
// would disagree with this one.
;[
  ['Ctrl+N', CONTROL, Key.N],
  ['Enter', 0, Key.Return],
  ['Ctrl+B', CONTROL, Key.B],
  ['Ctrl+,', CONTROL, Key.Comma],
  ['Ctrl+Shift+V', CONTROL | SHIFT, Key.V],
  ['Shift+Tab', SHIFT, Key.Backtab],
  ['Alt+Space', ALT, Key.Space],
  ['Alt+Shift+Space', ALT | SHIFT, Key.Space],
  ['Super+A', META, Key.A],
].forEach(function (row) {
  assert.strictEqual(K.format(row[1], row[2]), row[0],
    'seeded spelling ' + row[0] + ' must round-trip')
})

// ---- modifier order ------------------------------------------------------
//
// Ctrl, Super, Alt, Shift — the order keyEventToAccelerator emits. Any other
// order produces a string that compares unequal to the stored one, so the
// conflict check would miss a real collision.
assert.strictEqual(K.format(CONTROL | META | ALT | SHIFT, Key.A), 'Ctrl+Super+Alt+Shift+A')
assert.strictEqual(K.format(SHIFT | ALT | META | CONTROL, Key.A), 'Ctrl+Super+Alt+Shift+A',
  'the order of the bits must not change the order of the names')
assert.strictEqual(K.format(ALT | SHIFT, Key.V), 'Alt+Shift+V')
assert.strictEqual(K.format(META | SHIFT, Key.V), 'Super+Shift+V')

// ---- key names -----------------------------------------------------------

assert.strictEqual(K.keyName(Key.A), 'A')
assert.strictEqual(K.keyName(Key.Zero), '0')
assert.strictEqual(K.keyName(Key.Nine), '9')
assert.strictEqual(K.keyName(Key.Comma), ',')
assert.strictEqual(K.keyName(Key.Space), 'Space', 'the table stores the word, not " "')

// DOM `KeyboardEvent.key` spellings, so a string captured here is
// interchangeable with one captured in the React page.
;[
  [Key.Tab, 'Tab'],
  [Key.Backtab, 'Tab'],
  [Key.Backspace, 'Backspace'],
  [Key.Return, 'Enter'],
  [Key.Enter, 'Enter'],
  [Key.Delete, 'Delete'],
  [Key.Home, 'Home'],
  [Key.Left, 'ArrowLeft'],
  [Key.PageDown, 'PageDown'],
].forEach(function (pair) {
  assert.strictEqual(K.keyName(pair[0]), pair[1])
})

// The whole function-key range, computed rather than tabulated — so the bounds
// are what get tested.
assert.strictEqual(K.keyName(Key.F1), 'F1')
assert.strictEqual(K.keyName(Key.F5), 'F5')
assert.strictEqual(K.keyName(Key.F12), 'F12')
assert.strictEqual(K.keyName(Key.F35), 'F35')
assert.strictEqual(K.keyName(Key.F35 + 1), '',
  'one past F35 is Super_L, not F36')

// ---- what must NOT be committable ----------------------------------------
//
// The bug this file exists for: the old code fell through to stringifying the
// keycode, so pressing Escape stored "16777216" and merely holding Ctrl stored
// "16777249". Everything unnameable must refuse instead.
assert.strictEqual(K.format(0, Key.Escape), '', 'Escape cancels; it is never a binding')
assert.strictEqual(K.format(CONTROL | SHIFT, Key.Escape), '',
  'Escape with modifiers still cancels')

;[
  ['Shift', Key.Shift, SHIFT],
  ['Control', Key.Control, CONTROL],
  ['Meta', Key.Meta, META],
  ['Alt', Key.Alt, ALT],
  ['Super_L', Key.Super_L, META],
  ['AltGr', Key.AltGr, ALT],
].forEach(function (row) {
  assert.strictEqual(K.format(row[2], row[1]), '',
    'a bare ' + row[0] + ' press is not a combination')
})

// A key with no spelling refuses rather than persisting a number. 0x0100010a is
// Qt.Key_Massyo, a Japanese input key with no DOM equivalent.
assert.strictEqual(K.keyName(0x0100010a), '')
assert.strictEqual(K.format(CONTROL, 0x0100010a), '')

// Nothing may ever return a bare number as a string — the whole failure mode.
;[
  Key.Escape, Key.Control, Key.Shift, Key.Alt, Key.Meta, Key.Super_L, Key.AltGr,
  0x0100010a, 0x01000200, -1, 0, 0x7f, 0x80,
].forEach(function (key) {
  const out = K.format(CONTROL, key)
  assert.ok(!/[0-9]{3,}/.test(out),
    'format(' + key + ') must not contain a keycode, got ' + JSON.stringify(out))
})

// Junk in, "" out — never a crash and never a keycode.
;[undefined, null, NaN, 'V', {}].forEach(function (key) {
  assert.strictEqual(K.keyName(key), '', 'non-numeric key ' + String(key) + ' must refuse')
})

// A missing/garbage modifier bitmask must not poison the key name.
assert.strictEqual(K.format(undefined, Key.A), 'A')
assert.strictEqual(K.format(null, Key.A), 'A')
assert.strictEqual(K.format(NaN, Key.A), 'A')

// Modifier bits Qt sets that this spelling ignores on purpose: KeypadModifier
// (0x20000000) and GroupSwitchModifier (0x40000000) are not part of any stored
// binding, so keypad Enter must spell the same as Enter.
assert.strictEqual(K.format(0x20000000, Key.Enter), 'Enter')
assert.strictEqual(K.format(CONTROL | 0x20000000, Key.Enter), 'Ctrl+Enter')

console.log('shortcutKeys: ok')
