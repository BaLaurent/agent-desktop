import QtQuick

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
//   "Ctrl+Shift+V"       — modifiers in Ctrl/Alt/Shift/Super order
//   "Alt+Space"          — literal "Space" for the space key
//   "Alt+Shift+Space"
//   "Super+A"
//
// The page captures a key combination by intercepting `Keys.onPressed` on
// a focused Item, formatting the result with the same algorithm, and
// calling `update(id, keybinding)` here. The store writes via
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

  // Format a KeyboardEvent into the keybinding string the table stores.
  // Modifiers are emitted in a fixed order (Ctrl/Super/Alt/Shift), then
  // the key (literal "Space" for the spacebar; single chars are upper-
  // cased; Escape/Enter/etc. stay spelled). Matches keyEventToAccelerator
  // in src/renderer/components/settings/ShortcutSettings.tsx so the two
  // surfaces produce interchangeable strings.
  function formatKeybinding(event) {
    if (!event) return ""
    var parts = []
    if (event.ctrlKey) parts.push("Ctrl")
    if (event.metaKey) parts.push("Super")
    if (event.altKey) parts.push("Alt")
    if (event.shiftKey) parts.push("Shift")
    var key = event.key
    if (key === "Control" || key === "Meta" || key === "Alt"
        || key === "Shift" || key === "Super") return ""
    if (key === "Escape") return ""
    if (key === " " || key === "\u00A0") parts.push("Space")
    else if (key && key.length === 1) parts.push(key.toUpperCase())
    else if (key) parts.push(key)
    return parts.join("+")
  }
}