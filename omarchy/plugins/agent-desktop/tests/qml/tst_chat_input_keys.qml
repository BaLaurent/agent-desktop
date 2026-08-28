import QtQuick
import QtTest

// The chat input's keyboard contract.
//
// Every branch of `_onKey` was dead: the handler compared `event.key` — an
// INTEGER Qt keycode — against strings like "Enter" and "Escape", so nothing
// ever matched. Enter did not send, Escape did not stop a running turn, and the
// slash/mention popups could not be navigated. Neither gate could see it:
// qmllint cannot type-check a member read off an untyped `property var`, and the
// compile gate only compiles.
//
// So this drives `_onKey` directly with the same shape Qt delivers, and asserts
// the observable effect. A future rename back to strings fails here.
Item {
  width: 600
  height: 300

  // Records what the input asked the store to do.
  QtObject {
    id: fakeStore
    property bool streaming: false
    property int sendCount: 0
    property int stopCount: 0
    property string lastText: ""
    property var rpc: fakeRpc

    function send(text, attachments) { sendCount += 1; lastText = String(text) }
    function stop() { stopCount += 1 }
  }

  QtObject {
    id: fakeRpc
    property bool connected: true
    function invoke(channel, args, onOk, onErr) { return 1 }
    function subscribe() {}
    function unsubscribe() {}
    function setting(key, fallback) { return fallback }
  }

  QtObject {
    id: fakeSettings
    property var values: ({ sendOnEnter: "true" })
    function get(key, fallback) {
      return values[key] !== undefined ? values[key] : (fallback === undefined ? "" : fallback)
    }
    function effective(a, b, key) { return get(key, "") }
  }

  // A Qt key event carries an int `key`, an int `modifiers`, and a writable
  // `accepted`. Mirrored exactly so a handler that reads any of the three
  // behaves as it does at runtime.
  function keyEvent(k, mods) {
    return { key: k, modifiers: mods === undefined ? 0 : mods, accepted: false, text: "" }
  }

  property var inputC: null
  function inputComponent() {
    if (!inputC) inputC = Qt.createComponent("../../components/ChatInput.qml", Component.PreferSynchronous)
    return inputC
  }

  Item { id: host }

  function makeInput(props) {
    var merged = ({ store: fakeStore, settingsStore: fakeSettings })
    for (var k in props) merged[k] = props[k]
    return inputComponent().createObject(host, merged)
  }

  TestCase {
    name: "ChatInputKeys"
    when: windowShown

    function init() {
      fakeStore.streaming = false
      fakeStore.sendCount = 0
      fakeStore.stopCount = 0
      fakeStore.lastText = ""
      fakeSettings.values = ({ sendOnEnter: "true" })
    }

    function test_component_compiles() {
      verify(inputComponent().status === Component.Ready,
        inputComponent().errorString())
    }

    // The regression that started this: Return must send when sendOnEnter is on.
    function test_return_sends_when_sendOnEnter_true() {
      var input = makeInput({})
      input.content = "hello"
      var e = keyEvent(Qt.Key_Return)
      input._onKey(e)
      compare(fakeStore.sendCount, 1, "Return must send when sendOnEnter is true")
      compare(fakeStore.lastText, "hello")
      compare(e.accepted, true, "the handler must accept the key so no newline is inserted")
      input.destroy()
    }

    // The keypad Enter is a different keycode and must behave the same.
    function test_keypad_enter_also_sends() {
      var input = makeInput({})
      input.content = "hello"
      input._onKey(keyEvent(Qt.Key_Enter))
      compare(fakeStore.sendCount, 1)
      input.destroy()
    }

    // Shift+Return is a newline, never a send.
    function test_shift_return_does_not_send() {
      var input = makeInput({})
      input.content = "hello"
      var e = keyEvent(Qt.Key_Return, Qt.ShiftModifier)
      input._onKey(e)
      compare(fakeStore.sendCount, 0, "Shift+Return must insert a newline, not send")
      compare(e.accepted, false)
      input.destroy()
    }

    // With sendOnEnter off, Ctrl+Return sends and a bare Return does not.
    function test_ctrl_return_when_sendOnEnter_false() {
      fakeSettings.values = ({ sendOnEnter: "false" })
      var input = makeInput({})
      input.content = "hello"
      input._onKey(keyEvent(Qt.Key_Return))
      compare(fakeStore.sendCount, 0, "bare Return must not send when sendOnEnter is false")
      input._onKey(keyEvent(Qt.Key_Return, Qt.ControlModifier))
      compare(fakeStore.sendCount, 1, "Ctrl+Return must send when sendOnEnter is false")
      input.destroy()
    }

    // Escape stops a running turn.
    function test_escape_stops_a_running_turn() {
      fakeStore.streaming = true
      var input = makeInput({})
      var e = keyEvent(Qt.Key_Escape)
      input._onKey(e)
      compare(fakeStore.stopCount, 1, "Escape must stop a running turn")
      compare(e.accepted, true)
      input.destroy()
    }

    // With nothing running, Escape dismisses only when the surface offered a
    // dismiss callback — the window passes none, the overlay does.
    function test_escape_dismisses_only_when_offered() {
      var dismissed = 0
      var input = makeInput({ onDismiss: function () { dismissed += 1 } })
      input._onKey(keyEvent(Qt.Key_Escape))
      compare(fakeStore.stopCount, 0)
      compare(dismissed, 1, "Escape must dismiss when a callback was supplied")
      input.destroy()

      var plain = makeInput({})
      plain._onKey(keyEvent(Qt.Key_Escape))
      compare(fakeStore.stopCount, 0, "Escape must not stop when nothing is running")
      plain.destroy()
    }
  }
}
