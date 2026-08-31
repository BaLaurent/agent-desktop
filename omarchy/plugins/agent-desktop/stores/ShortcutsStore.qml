import QtQuick
import "../lib/shortcutKeys.js" as ShortcutKeys

// ShortcutsStore — the shortcuts:list / shortcuts:update surface.
//
// The keyboard_shortcuts table stores in-app shortcuts (action → keybinding),
// not OS-global ones — the latter stay in bindings.lua and are out of scope.
//
// `keybinding` strings follow a fixed format: modifier names joined by "+"
// in a canonical order, then the key. The seed data (`src/core/db/seed.ts`
// `seedShortcuts`) and the renderer's `keyEventToAccelerator` both produce
// the same spelling:
//
//   "Ctrl+N"             — single modifier + key
//   "Ctrl+Shift+V"       — modifiers in Ctrl/Super/Alt/Shift order
//   "Alt+Space"          — literal "Space" for the space key
//   "Alt+Shift+Space"
//   "Super+A"
//
// The page captures a key combination by intercepting `Keys.onPressed` on
// a focused Item and passing the event to `formatKeybinding` below, which
// applies that same spelling, then calling `update(id, keybinding)` here.
// The store writes via
// `shortcuts:update(id, keybinding)`; the renderer achieves the same
// through `shortcuts.update(id, accelerator)`.
//
// One authoritative owner per value: the list. A patch from a successful
// update replaces the row in place so the page does not flash, and the
// `storeChanged()` signal fires so any bound UI (the capture field, the
// "Reset to defaults" button) updates.
QtObject {
  id: store

  // Service.qml, which owns invoke/subscribe.
  required property var rpc

  property var shortcuts: []      // KeyboardShortcut[]
  property bool loaded: false
  property bool loading: false
  property string error: ""

  // Capture state: when non-null, the page is recording for that id.
  // The store does not own the conflict check (the page handles it
  // because it owns the UI affordance); this property is read by the
  // page to render the recording row.
  property int recordingId: -1

  signal storeChanged()

  function load() {
    loading = true
    rpc.invoke("shortcuts:list", [], applyList, function(err) {
      loading = false
      loaded = false
      error = String(err)
    })
  }

  function applyList(rows) {
    shortcuts = Array.isArray(rows) ? rows : []
    loading = false
    loaded = true
    storeChanged()
  }

  function startRecording(id) {
    recordingId = Number(id)
  }

  function stopRecording() {
    recordingId = -1
  }

  function update(id, keybinding, onDone, onErr) {
    var targetId = Number(id)
    var value = String(keybinding || "")
    rpc.invoke("shortcuts:update", [targetId, value], function() {
      // Patch in place so the row does not flash; the list re-renders
      // via Object.values-style iteration the page does.
      var next = []
      var i
      for (i = 0; i < shortcuts.length; i++) {
        var row = shortcuts[i]
        if (row && row.id === targetId) {
          var patched = {}
          for (var k in row) patched[k] = row[k]
          patched.keybinding = value
          next.push(patched)
        } else if (row) {
          next.push(row)
        }
      }
      shortcuts = next
      recordingId = -1
      storeChanged()
      if (onDone) onDone()
    }, function(err) {
      error = String(err)
      if (onErr) onErr(err)
    })
  }

  // Format a QML key event into the keybinding string the table stores.
  //
  // A QML `KeyEvent` is NOT a DOM `KeyboardEvent`: it has `modifiers` (a
  // Qt.KeyboardModifiers bitmask) and an integer `key` (Qt.Key_*), and no
  // `ctrlKey`/`altKey`/`shiftKey`/`metaKey` at all. Reading the DOM names off
  // it — which this function did, copied from the React page — yields
  // `undefined` for every modifier and stringifies the raw keycode, so
  // Ctrl+Shift+V was persisted as "86". The spelling rule lives in
  // lib/shortcutKeys.js so it can be held to the React page's spelling by test.
  //
  // Returns "" when the combination is not committable (Escape, a bare
  // modifier, or a key with no spelling); the page reads that as "keep
  // recording" and handles Escape as cancel.
  function formatKeybinding(event) {
    if (!event) return ""
    return ShortcutKeys.format(event.modifiers, event.key)
  }
}