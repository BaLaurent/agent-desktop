import QtQuick
import QtTest
import "../../lib/shortcutKeys.js" as ShortcutKeys

// ShortcutsStore.formatKeybinding, fed REAL QML key events.
//
// This is the one contract in the store that cannot be tested on a plain
// object: its whole job is to read a `KeyEvent`, and a QML `KeyEvent` is not
// a DOM `KeyboardEvent`. It carries `modifiers` (a Qt.KeyboardModifiers
// bitmask), an integer `key` (Qt.Key_*) and a `text` string — it has no
// `ctrlKey`/`altKey`/`shiftKey`/`metaKey` at all, and `key` never equals
// "Escape" or " ".
//
// A hand-built fake event would let the DOM spelling pass, which is exactly
// how the recorder shipped broken: every capture produced a bare stringified
// keycode with the modifiers silently dropped. So the events here come from
// TestCase.keyClick through a focused Item, the same path the settings page
// uses.
//
// The numeric Qt constants in lib/shortcutKeys.js are pinned here against the
// real enum. The module has to spell them as numbers because it also runs in
// node, and a wrong number there would mis-spell a shortcut in a way no node
// test could see.
Item {
  width: 200
  height: 200

  QtObject {
    id: fakeRpc
    property var calls: []
    function invoke(channel, args, onOk, onErr) {
      calls = calls.concat([{ channel: channel, args: args, ok: onOk, err: onErr }])
    }
    function reset() { calls = [] }
  }

  Loader {
    id: storeLoader
    Component.onCompleted: setSource("../../stores/ShortcutsStore.qml", ({ rpc: fakeRpc }))
  }

  // The capture surface: same shape as ShortcutSettings' capture Item, so the
  // event that reaches formatKeybinding is the event the page really gets.
  Item {
    id: capture
    focus: true
    width: 10
    height: 10
    property string last: "unset"
    Keys.onPressed: function (event) {
      last = storeLoader.item.formatKeybinding(event)
      event.accepted = true
    }
  }

  TestCase {
    name: "ShortcutsStore.formatKeybinding"
    when: windowShown

    function init() {
      verify(storeLoader.item, "store loaded")
      capture.forceActiveFocus()
      capture.last = "unset"
      fakeRpc.reset()
    }

    function press(key, mods) {
      keyClick(key, mods === undefined ? Qt.NoModifier : mods)
      // Delivery is synchronous for keyClick, but assert it happened rather
      // than silently comparing against the initial value.
      verify(capture.last !== "unset", "key event reached the handler")
      return capture.last
    }

    function test_plain_letter() {
      compare(press(Qt.Key_B), "B")
    }

    function test_single_modifier() {
      compare(press(Qt.Key_N, Qt.ControlModifier), "Ctrl+N")
    }

    // The canonical order the seed data and the React renderer both produce:
    // Ctrl, Super, Alt, Shift — then the key.
    function test_modifier_order() {
      compare(press(Qt.Key_V, Qt.ControlModifier | Qt.ShiftModifier), "Ctrl+Shift+V")
      compare(press(Qt.Key_G, Qt.ControlModifier | Qt.AltModifier | Qt.ShiftModifier),
              "Ctrl+Alt+Shift+G")
    }

    function test_super_is_meta() {
      compare(press(Qt.Key_A, Qt.MetaModifier), "Super+A")
    }

    // The table stores the literal word for the spacebar, not " ".
    function test_space_is_spelled() {
      compare(press(Qt.Key_Space, Qt.AltModifier), "Alt+Space")
      compare(press(Qt.Key_Space, Qt.AltModifier | Qt.ShiftModifier), "Alt+Shift+Space")
    }

    // Named keys keep their spelling instead of becoming a keycode.
    function test_named_keys() {
      compare(press(Qt.Key_F5), "F5")
      compare(press(Qt.Key_Tab, Qt.ControlModifier), "Ctrl+Tab")
    }

    // Escape cancels: it must format to "" so the page takes its cancel branch
    // rather than binding a shortcut to Escape.
    function test_escape_is_empty() {
      compare(press(Qt.Key_Escape), "")
    }

    // A bare modifier press is not a combination yet — the page must not
    // commit "Ctrl" as a keybinding while the user is still holding it down.
    function test_bare_modifier_is_empty() {
      compare(press(Qt.Key_Control, Qt.ControlModifier), "")
      compare(press(Qt.Key_Shift, Qt.ShiftModifier), "")
      compare(press(Qt.Key_Alt, Qt.AltModifier), "")
      compare(press(Qt.Key_Meta, Qt.MetaModifier), "")
    }

    // update() is what the page calls once a capture is clean; assert the wire
    // shape so a formatting fix cannot quietly change what gets persisted.
    function test_update_sends_canonical_string() {
      storeLoader.item.update(7, "Ctrl+Shift+V")
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "shortcuts:update")
      compare(fakeRpc.calls[0].args[0], 7)
      compare(fakeRpc.calls[0].args[1], "Ctrl+Shift+V")
    }

    // Every numeric constant the module carries, against the real enum. These
    // are the values a node test has to take on trust.
    function test_qt_constants_are_pinned() {
      compare(ShortcutKeys.MOD_SHIFT, Qt.ShiftModifier)
      compare(ShortcutKeys.MOD_CONTROL, Qt.ControlModifier)
      compare(ShortcutKeys.MOD_ALT, Qt.AltModifier)
      compare(ShortcutKeys.MOD_META, Qt.MetaModifier)
      compare(ShortcutKeys.KEY_SPACE, Qt.Key_Space)
      compare(ShortcutKeys.KEY_ESCAPE, Qt.Key_Escape)
      compare(ShortcutKeys.KEY_F1, Qt.Key_F1)
      // F1..F35 must be contiguous for the computed range to hold.
      compare(Qt.Key_F35 - Qt.Key_F1 + 1, ShortcutKeys.FUNCTION_KEY_COUNT)
    }

    function test_named_key_table_is_pinned() {
      var expected = {}
      expected[Qt.Key_Tab] = "Tab"
      expected[Qt.Key_Backtab] = "Tab"
      expected[Qt.Key_Backspace] = "Backspace"
      expected[Qt.Key_Return] = "Enter"
      expected[Qt.Key_Enter] = "Enter"
      expected[Qt.Key_Insert] = "Insert"
      expected[Qt.Key_Delete] = "Delete"
      expected[Qt.Key_Pause] = "Pause"
      expected[Qt.Key_Print] = "PrintScreen"
      expected[Qt.Key_Home] = "Home"
      expected[Qt.Key_End] = "End"
      expected[Qt.Key_Left] = "ArrowLeft"
      expected[Qt.Key_Up] = "ArrowUp"
      expected[Qt.Key_Right] = "ArrowRight"
      expected[Qt.Key_Down] = "ArrowDown"
      expected[Qt.Key_PageUp] = "PageUp"
      expected[Qt.Key_PageDown] = "PageDown"
      expected[Qt.Key_CapsLock] = "CapsLock"
      expected[Qt.Key_NumLock] = "NumLock"
      expected[Qt.Key_ScrollLock] = "ScrollLock"
      expected[Qt.Key_Menu] = "ContextMenu"
      expected[Qt.Key_Help] = "Help"
      for (var code in expected) {
        compare(ShortcutKeys.keyName(Number(code)), expected[code],
                "keyName(" + code + ")")
      }
    }

    // The refusal set, against the real enum rather than remembered numbers.
    function test_bare_modifier_table_is_pinned() {
      var bare = [Qt.Key_Shift, Qt.Key_Control, Qt.Key_Meta, Qt.Key_Alt,
                  Qt.Key_Super_L, Qt.Key_Super_R, Qt.Key_Hyper_L, Qt.Key_Hyper_R,
                  Qt.Key_AltGr]
      for (var i = 0; i < bare.length; i++) {
        compare(ShortcutKeys.keyName(bare[i]), "", "bare modifier " + bare[i])
      }
    }
  }
}
