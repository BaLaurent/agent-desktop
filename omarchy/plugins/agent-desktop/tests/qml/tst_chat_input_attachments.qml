import QtQuick
import QtTest

// ChatInput's attachment contract.
//
// Attaching a file to a message was the plugin's one BLOCKER parity gap: the
// wire already carried it (`ChatStore.send(text, attachments)` threads the
// array all the way to `messages:send`) but no UI ever populated it, so the
// parameter was permanently `[]`. The feature shipped with zero tests, which
// is how a `send()` that quietly dropped the array — or one that refused an
// attachment-only message — would reach a user unnoticed.
//
// Driven directly rather than through clicks: the picker itself lives in
// App.qml (a leaf component may not import Qt.labs.platform), so the part
// that belongs to ChatInput is exactly this — accumulate, deduplicate,
// forward on send, and clear afterwards.
Item {
  width: 600
  height: 300

  // Records what the input asked the store to do. `lastAttachments` is the
  // whole point: asserting on `sendCount` alone would pass even if the array
  // were dropped on the floor.
  QtObject {
    id: fakeStore
    property bool streaming: false
    property int sendCount: 0
    property string lastText: ""
    property var lastAttachments: null
    property var rpc: fakeRpc

    function send(text, attachments) {
      sendCount += 1
      lastText = String(text)
      lastAttachments = attachments
    }
    // Edit is a DIFFERENT store call from send. Recording both separately is
    // the only way to catch a send() that routes an edit down the send path
    // (which would append a new message instead of replacing one) or an
    // edit target that leaks into the next ordinary message.
    property int editCount: 0
    property int lastEditId: 0
    property string lastEditText: ""
    function editMessage(messageId, content) {
      editCount += 1
      lastEditId = Number(messageId)
      lastEditText = String(content)
    }
    function regenerate() {}
    function stop() {}
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

  // The shape App.qml builds from `attachments:getInfo` plus the path it
  // already had. Verified live against the running server:
  //   attachments:getInfo('/tmp/probe.csv')
  //     -> { name: 'probe.csv', size: 18, type: 'text/csv' }
  function att(name, path, type, size) {
    return ({ name: name, path: path, type: type || "text/plain", size: size === undefined ? 10 : size })
  }

  TestCase {
    name: "ChatInputAttachments"
    when: windowShown

    function init() {
      fakeStore.sendCount = 0
      fakeStore.lastText = ""
      fakeStore.lastAttachments = null
      fakeStore.streaming = false
      fakeStore.editCount = 0
      fakeStore.lastEditId = 0
      fakeStore.lastEditText = ""
      fakeSettings.values = ({ sendOnEnter: "true" })
    }

    function test_starts_empty() {
      var input = makeInput({})
      compare(input.attachments.length, 0, "no attachments before the user picks any")
      input.destroy()
    }

    function test_addAttachment_appends_in_order() {
      var input = makeInput({})
      input.addAttachment(att("a.txt", "/tmp/a.txt"))
      input.addAttachment(att("b.png", "/tmp/b.png", "image/png", 2048))
      compare(input.attachments.length, 2)
      compare(input.attachments[0].name, "a.txt")
      compare(input.attachments[1].name, "b.png")
      compare(input.attachments[1].type, "image/png")
      compare(input.attachments[1].size, 2048)
      input.destroy()
    }

    // Path is the identity. The picker can be opened twice and land on the
    // same file; two identical chips would then send the same bytes twice.
    function test_addAttachment_dedups_by_path() {
      var input = makeInput({})
      input.addAttachment(att("a.txt", "/tmp/a.txt"))
      input.addAttachment(att("renamed-in-ui.txt", "/tmp/a.txt"))
      compare(input.attachments.length, 1, "same path twice yields one chip")
      compare(input.attachments[0].name, "a.txt", "the first pick wins")
      input.destroy()
    }

    // A malformed entry must not create a chip that cannot be sent or removed.
    function test_addAttachment_ignores_junk() {
      var input = makeInput({})
      input.addAttachment(null)
      input.addAttachment(undefined)
      input.addAttachment({})
      input.addAttachment({ name: "no path" })
      compare(input.attachments.length, 0, "an entry without a path is not an attachment")
      input.destroy()
    }

    function test_clearAttachments_empties() {
      var input = makeInput({})
      input.addAttachment(att("a.txt", "/tmp/a.txt"))
      input.addAttachment(att("b.txt", "/tmp/b.txt"))
      input.clearAttachments()
      compare(input.attachments.length, 0)
      input.destroy()
    }

    // The regression this file exists for: send() must hand the array to the
    // store, not silently drop it.
    function test_send_forwards_attachments() {
      var input = makeInput({})
      input.content = "look at this"
      input.addAttachment(att("a.csv", "/tmp/a.csv", "text/csv", 34))
      input.send()
      compare(fakeStore.sendCount, 1)
      compare(fakeStore.lastText, "look at this")
      verify(fakeStore.lastAttachments !== null, "attachments reached the store")
      compare(fakeStore.lastAttachments.length, 1)
      compare(fakeStore.lastAttachments[0].path, "/tmp/a.csv")
      compare(fakeStore.lastAttachments[0].type, "text/csv")
      input.destroy()
    }

    // Leaving them pending would re-send the same file on the next message.
    function test_send_clears_attachments_after_dispatch() {
      var input = makeInput({})
      input.content = "hi"
      input.addAttachment(att("a.txt", "/tmp/a.txt"))
      input.send()
      compare(input.attachments.length, 0, "pending list is emptied by a successful send")
      compare(input.content, "", "text is cleared the same way")
      input.destroy()
    }

    // "Summarise this file" with the file attached and no prose is a real
    // request. The pre-existing empty-text guard would have dropped it.
    function test_attachment_only_message_sends() {
      var input = makeInput({})
      input.content = ""
      input.addAttachment(att("report.pdf", "/tmp/report.pdf", "application/pdf", 9999))
      input.send()
      compare(fakeStore.sendCount, 1, "an attachment with no text is still a message")
      compare(fakeStore.lastAttachments.length, 1)
      input.destroy()
    }

    // Nothing to say and nothing to show: still a no-op, so Enter on an
    // untouched input cannot start an empty turn.
    function test_empty_and_no_attachments_does_not_send() {
      var input = makeInput({})
      input.content = "   "
      input.send()
      compare(fakeStore.sendCount, 0, "whitespace with no attachment must not send")
      input.destroy()
    }

    // `disabled` gates the whole input (auth missing / server down); an
    // attachment must not sneak past it.
    function test_disabled_blocks_attachment_only_send() {
      var input = makeInput({ disabled: true })
      input.addAttachment(att("a.txt", "/tmp/a.txt"))
      input.send()
      compare(fakeStore.sendCount, 0, "a disabled input sends nothing, attachment or not")
      input.destroy()
    }

    // Queued sends go through the same path, so the array must survive it.
    function test_streaming_send_still_carries_attachments() {
      fakeStore.streaming = true
      var input = makeInput({})
      input.content = "queued one"
      input.addAttachment(att("a.txt", "/tmp/a.txt"))
      input.send()
      compare(fakeStore.sendCount, 1, "ChatStore owns the queue decision, not ChatInput")
      compare(fakeStore.lastAttachments.length, 1, "attachments are not lost on a queued send")
      input.destroy()
    }

    // --- edit routing ------------------------------------------------------
    //
    // MessageList has shipped an Edit/Regenerate/Fork bar all along, but every
    // button was gated on a callback nothing ever set, so all three were
    // invisible and `ChatStore.regenerate()` had no caller. Wiring them made
    // `send()` load-bearing in a second way: with an edit target set it must
    // REPLACE a message, and with none it must SEND a new one. Getting that
    // wrong silently overwrites the user's history.

    function test_beginEdit_loads_the_message_into_the_composer() {
      var input = makeInput({})
      input.beginEdit(42, "original text")
      compare(input.editingMessageId, 42)
      compare(input.content, "original text")
      input.destroy()
    }

    // Attachments belong to the original message and cannot be re-derived, so
    // an edit must not inherit whatever happened to be pending.
    function test_beginEdit_clears_pending_attachments() {
      var input = makeInput({})
      input.addAttachment(att("stale.txt", "/tmp/stale.txt"))
      input.beginEdit(7, "text")
      compare(input.attachments.length, 0)
      input.destroy()
    }

    function test_send_while_editing_calls_editMessage_not_send() {
      var input = makeInput({})
      input.beginEdit(99, "before")
      input.content = "after"
      input.send()
      compare(fakeStore.editCount, 1, "an edit must go through editMessage")
      compare(fakeStore.sendCount, 0, "an edit must NOT append a new message")
      compare(fakeStore.lastEditId, 99)
      compare(fakeStore.lastEditText, "after")
      input.destroy()
    }

    // The leak that would corrupt history: if the target survived the send,
    // the NEXT ordinary message would overwrite the message just edited.
    function test_edit_target_does_not_leak_into_the_next_message() {
      var input = makeInput({})
      input.beginEdit(99, "before")
      input.content = "after"
      input.send()
      compare(input.editingMessageId, 0, "the edit target is cleared by the send")
      input.content = "a brand new message"
      input.send()
      compare(fakeStore.editCount, 1, "still exactly one edit")
      compare(fakeStore.sendCount, 1, "the following message is a normal send")
      compare(fakeStore.lastText, "a brand new message")
      input.destroy()
    }

    function test_cancelEdit_clears_target_and_composer() {
      var input = makeInput({})
      input.beginEdit(5, "text")
      input.cancelEdit()
      compare(input.editingMessageId, 0)
      compare(input.content, "")
      input.destroy()
    }

    // Escape must unwind the edit before anything else, or the overlay closes
    // with a hidden edit target still armed.
    function test_escape_cancels_edit_before_dismissing() {
      var dismissed = 0
      var input = makeInput({ onDismiss: function () { dismissed += 1 } })
      input.beginEdit(11, "text")
      input._onKey(keyEvent(Qt.Key_Escape))
      compare(input.editingMessageId, 0, "Escape cancels the edit")
      compare(dismissed, 0, "and does NOT also dismiss on the same press")
      input._onKey(keyEvent(Qt.Key_Escape))
      compare(dismissed, 1, "a second Escape then dismisses")
      input.destroy()
    }

    function keyEvent(k, mods) {
      return { key: k, modifiers: mods === undefined ? Qt.NoModifier : mods, accepted: false }
    }
  }
}
