import QtQuick
import QtTest

// The Shortcuts settings page, driven the way a user drives it: press Record,
// then press a key combination.
//
// tst_shortcuts_store.qml covers the spelling in isolation. This covers the
// PAGE: that the Record button starts a recording, that a real key event
// reaching Keys.onPressed commits the canonical string through
// `shortcuts:update`, that Escape cancels instead of committing, and that a
// combination another row already owns is refused. Three of those four were
// broken and none of them was observable from the store alone — the page
// compared `event.key === "Escape"` (never true for an integer Qt.Key_*) and
// so committed a stringified keycode for the cancel key too.
//
// The real ShortcutsStore is used, with only the rpc faked, so the page is
// tested against the same store the shell gives it.
Item {
  id: harness
  width: 700
  height: 500

  QtObject {
    id: fakeRpc
    property var calls: []
    function invoke(channel, args, onOk, onErr) {
      calls = calls.concat([{ channel: channel, args: args, ok: onOk, err: onErr }])
    }
    function reset() { calls = [] }
    function updateCalls() {
      var out = []
      for (var i = 0; i < calls.length; i++) {
        if (calls[i].channel === "shortcuts:update") out.push(calls[i])
      }
      return out
    }
    // The store clears `recordingId` in the SUCCESS callback, so a test that
    // never answers is asserting against a half-finished write.
    function acceptLast(channel) {
      var all = calls
      for (var i = all.length - 1; i >= 0; i--) {
        if (all[i].channel === channel) { all[i].ok(); return }
      }
      throw new Error("no call to " + channel)
    }
  }

  Loader {
    id: storeLoader
    Component.onCompleted: setSource("../../stores/ShortcutsStore.qml", ({ rpc: fakeRpc }))
  }

  Loader {
    id: pageLoader
    width: harness.width
    focus: true
  }

  // Find a control by its `text`, without adding objectNames to production
  // code just to be testable.
  function findByText(node, wanted) {
    if (!node) return null
    if (node.text !== undefined && String(node.text) === wanted) return node
    var kids = node.children
    if (!kids) return null
    for (var i = 0; i < kids.length; i++) {
      var hit = findByText(kids[i], wanted)
      if (hit) return hit
    }
    return null
  }

  TestCase {
    name: "ShortcutSettings"
    when: windowShown

    property var store: storeLoader.item
    property var page: pageLoader.item

    function initTestCase() {
      verify(storeLoader.item, "store loaded")
      pageLoader.setSource("../../components/settings/ShortcutSettings.qml",
                           ({ store: storeLoader.item }))
      verify(pageLoader.item, "page loaded")
    }

    // Two rows is enough to have a conflict; the shapes match what
    // shortcuts:list returns.
    function init() {
      fakeRpc.reset()
      storeLoader.item.applyList([
        { id: 1, action: "new_conversation", keybinding: "Ctrl+N", enabled: 1 },
        { id: 2, action: "stop_tts", keybinding: "Ctrl+Shift+T", enabled: 1 },
      ])
      storeLoader.item.stopRecording()
      pageLoader.item.captured = ""
      pageLoader.item.conflictId = -1
      fakeRpc.reset()
    }

    // The Record button exists, is labelled, and starting a recording flips it
    // to Cancel — the affordance the user reads to know it is listening.
    function test_record_button_starts_and_labels_recording() {
      var btn = harness.findByText(pageLoader.item, "Record")
      verify(btn, "a Record button is rendered")
      btn.clicked()
      compare(storeLoader.item.recordingId, 1, "the first row is recording")
      verify(harness.findByText(pageLoader.item, "Cancel"),
             "the recording row's button reads Cancel")
    }

    // The full user gesture in one test: click Record, then press the keys.
    //
    // NOTE ON WHAT THIS CANNOT PROVE. Passing here does NOT mean the page gets
    // the keyboard in the real shell. There is no App.qml in this harness, and
    // App.qml claims the window's active focus for `windowBody`; a declarative
    // `focus: true` on a deep child loses to that. A version of this page
    // without the explicit `forceActiveFocus()` grab passed this test and was
    // dead live — Record flipped to "Cancel" and keystrokes went nowhere. The
    // grab is verified by a live A/B (record a shortcut, read the DB), and this
    // test only guards the wiring below the focus layer.
    function test_click_then_type_commits() {
      var btn = harness.findByText(pageLoader.item, "Record")
      verify(btn, "a Record button is rendered")
      btn.clicked()
      compare(storeLoader.item.recordingId, 1)

      keyClick(Qt.Key_G, Qt.ControlModifier | Qt.AltModifier)
      var updates = fakeRpc.updateCalls()
      compare(updates.length, 1, "the keystroke after the click reached the page")
      compare(updates[0].args[0], 1)
      compare(updates[0].args[1], "Ctrl+Alt+G")
    }

    // The release edge, which IS observable offscreen: recording ends, and the
    // 1px capture Item must hand the keyboard back. Because the grab writes
    // `focus` imperatively (destroying any binding on it), the "off" edge has to
    // write it back explicitly — otherwise this item keeps active focus for the
    // rest of the session and silently eats the page's keys.
    function test_capture_releases_focus_when_recording_ends() {
      var btn = harness.findByText(pageLoader.item, "Record")
      btn.clicked()
      compare(storeLoader.item.recordingId, 1)
      storeLoader.item.stopRecording()
      // Same key, now that nothing is recording: it must not be captured.
      fakeRpc.reset()
      keyClick(Qt.Key_G, Qt.ControlModifier | Qt.AltModifier)
      compare(fakeRpc.updateCalls().length, 0,
              "keys must not be swallowed once recording has ended")
    }

    // The whole point: a real key event, through the page's own handler,
    // persists the canonical spelling.
    //
    // The recording ends when the SERVER confirms, not on the keystroke — the
    // store clears `recordingId` in the success callback. So a write that is
    // refused leaves the row listening, which is the behaviour that lets the
    // user try again rather than being told a rejected binding took.
    function test_key_press_commits_canonical_string() {
      storeLoader.item.startRecording(2)
      keyClick(Qt.Key_V, Qt.ControlModifier | Qt.ShiftModifier)
      var updates = fakeRpc.updateCalls()
      compare(updates.length, 1, "exactly one shortcuts:update")
      compare(updates[0].args[0], 2)
      compare(updates[0].args[1], "Ctrl+Shift+V")
      compare(storeLoader.item.recordingId, 2, "still recording until the server answers")

      fakeRpc.acceptLast("shortcuts:update")
      compare(storeLoader.item.recordingId, -1, "the confirmed write ends the recording")
      compare(storeLoader.item.shortcuts[1].keybinding, "Ctrl+Shift+V",
              "and the row shows the new binding")
    }

    // A refused write must not leave the row claiming the new binding.
    function test_refused_write_keeps_listening_and_surfaces_the_error() {
      storeLoader.item.startRecording(2)
      keyClick(Qt.Key_V, Qt.ControlModifier | Qt.ShiftModifier)
      var updates = fakeRpc.updateCalls()
      compare(updates.length, 1)
      updates[0].err("Shortcut 2 not found")
      compare(storeLoader.item.recordingId, 2, "still recording after a refusal")
      compare(storeLoader.item.shortcuts[1].keybinding, "Ctrl+Shift+T",
              "the stored binding is untouched by a refused write")
      verify(String(storeLoader.item.error).length > 0, "the refusal is surfaced")
    }

    function test_space_commits_the_word() {
      storeLoader.item.startRecording(2)
      keyClick(Qt.Key_Space, Qt.AltModifier)
      var updates = fakeRpc.updateCalls()
      compare(updates.length, 1)
      compare(updates[0].args[1], "Alt+Space")
    }

    // Escape must cancel. Before the fix this committed the keycode.
    function test_escape_cancels_without_committing() {
      storeLoader.item.startRecording(2)
      keyClick(Qt.Key_Escape)
      compare(fakeRpc.updateCalls().length, 0, "Escape must not persist anything")
      compare(storeLoader.item.recordingId, -1, "Escape ends the recording")
    }

    // A bare modifier is not a combination: keep listening, persist nothing.
    function test_bare_modifier_keeps_listening() {
      storeLoader.item.startRecording(2)
      keyClick(Qt.Key_Control, Qt.ControlModifier)
      compare(fakeRpc.updateCalls().length, 0, "a bare Ctrl must not persist")
      compare(storeLoader.item.recordingId, 2, "still recording")
    }

    // Taking a combination another row owns must be refused and reported,
    // not silently written over. This can only work because the captured
    // spelling now equals the stored spelling.
    function test_conflict_is_refused_and_reported() {
      storeLoader.item.startRecording(2)
      keyClick(Qt.Key_N, Qt.ControlModifier)
      compare(fakeRpc.updateCalls().length, 0, "a conflicting combination is not persisted")
      compare(pageLoader.item.conflictId, 1, "the conflicting row is named")
      compare(pageLoader.item.captured, "Ctrl+N", "the live capture is shown")
      compare(storeLoader.item.recordingId, 2, "still recording so the user can retry")
    }

    // Re-recording a row to the value it already has is a no-op conflict with
    // itself — the row must not be reported as conflicting with itself.
    function test_same_row_same_value_is_not_a_conflict() {
      storeLoader.item.startRecording(2)
      keyClick(Qt.Key_T, Qt.ControlModifier | Qt.ShiftModifier)
      var updates = fakeRpc.updateCalls()
      compare(updates.length, 1, "committing a row's own value is allowed")
      compare(updates[0].args[1], "Ctrl+Shift+T")
      compare(pageLoader.item.conflictId, -1)
    }

    // Nothing may be captured when no row is recording.
    function test_keys_are_ignored_when_not_recording() {
      compare(storeLoader.item.recordingId, -1)
      keyClick(Qt.Key_V, Qt.ControlModifier | Qt.ShiftModifier)
      compare(fakeRpc.updateCalls().length, 0)
    }
  }
}
