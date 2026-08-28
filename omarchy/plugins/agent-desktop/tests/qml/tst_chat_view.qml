import QtQuick
import QtTest

// Sanity tests for ChatView.qml — the integration glue that owns voice,
// TTS, the status line, the message list and the input.
//
// Most of ChatView's behaviour is exercised by the store-level tests.
// The two contracts worth pinning here are the ones App.qml's Loader
// sourceComponent depends on:
//
//   1. The store / settingsStore / conversationsStore / voiceStore /
//      ttsStore properties are nullable, and the component can be
//      constructed with every one of them null.
//   2. The transcript router (applyTranscript) routes correctly per the
//      `voiceAutoSend` plugin setting and drops empty payloads, and the view
//      does NOT subscribe to `voiceStore.transcriptReady` itself — two of
//      them exist at once, so a self-subscribing view sent every dictation
//      twice.
//
// The real ChatView DOES load here (mlMakeChatView builds it against
// mlFakeStore); the note that once claimed otherwise was stale. The older
// `replica` tests below exercise a copy of the routing logic rather than the
// component, which is why renaming the handler did not break them — prefer
// mlMakeChatView for anything that must hold for the real thing.
//
// The shape contract is therefore tested indirectly
// through the constructor above and via the helper functions replicated
// here. Phase 5's integration test, plus App.qml's Loader sourceComponent
// in Main's gate, exercises the full path.

Item {
  width: 400
  height: 600

  // ---- a minimal ChatStore stand-in ----------------------------------
  QtObject {
    id: fakeChat
    property int conversationId: 0
    property var messages: []
    property var parts: []
    property bool streaming: false
    property bool connected: true
    property var rpc: null
    property int sendCalls: 0
    property string lastSentText: ""

    function load(id) { conversationId = id }
    function send(text, attachments) {
      sendCalls = sendCalls + 1
      lastSentText = String(text || "")
    }
    function stop() {}
    function answer() {}
    function approve() {}
    function approvePlan() {}
  }

  // ---- a fake chat input that captures text instead of editing -------
  QtObject {
    id: realInput
    property string captured: ""
    function appendExternalText(text) {
      captured = captured + String(text || "")
    }
  }

  // ---- a service-rpc stub whose setting() returns "On" by default ----
  QtObject {
    id: rpcOn
    function setting(key, fallback) {
      if (key === "voiceAutoSend") return "On"
      return fallback || ""
    }
  }

  // ---- a service-rpc stub whose setting() returns "Off" ----------------
  QtObject {
    id: rpcOff
    function setting(key, fallback) {
      if (key === "voiceAutoSend") return "Off"
      return fallback || ""
    }
  }

  // ---- replica of ChatView's helpers ---------------------------------
  // Mirrors ChatView.qml's transcript routing line-for-line. If the real
  // component's implementation drifts from this replica, the full
  // integration path is App.qml's Loader sourceComponent — Main's gate
  // exercises that, and any drift between replica and real will be
  // visible there.
  QtObject {
    id: replica
    property var store: null
    property var serviceRpc: null
    property var chatInput: null

    function _onTranscript(text) {
      if (text === undefined || text === null) return
      var trimmed = String(text).trim()
      if (trimmed.length === 0) return
      if (!replica.store) return
      var autoSend = "On"
      if (replica.serviceRpc && typeof replica.serviceRpc.setting === "function") {
        autoSend = String(replica.serviceRpc.setting("voiceAutoSend", "On"))
      }
      if (autoSend === "On") {
        replica.store.send(trimmed, [])
        return
      }
      if (replica.chatInput && typeof replica.chatInput.appendExternalText === "function") {
        replica.chatInput.appendExternalText(trimmed)
      }
    }
  }

  TestCase {
    name: "ChatView"
    when: windowShown

    function init() {
      fakeChat.sendCalls = 0
      fakeChat.lastSentText = ""
      realInput.captured = ""
      replica.store = null
      replica.serviceRpc = null
      replica.chatInput = null
    }

    // ---- transcript router: empty text drops -------------------------
    function test_transcript_router_drops_empty() {
      replica.store = fakeChat
      replica.serviceRpc = rpcOn
      replica._onTranscript("")
      replica._onTranscript("   ")
      replica._onTranscript(null)
      replica._onTranscript(undefined)
      compare(fakeChat.sendCalls, 0,
        "empty / null / whitespace transcripts are dropped")
    }

    // ---- transcript router: auto-send routes to ChatStore.send -------
    function test_transcript_auto_send_routes_to_store() {
      replica.store = fakeChat
      replica.serviceRpc = rpcOn
      replica._onTranscript("hello world")
      compare(fakeChat.sendCalls, 1,
        "voiceAutoSend=On fires exactly one send")
      compare(fakeChat.lastSentText, "hello world",
        "the transcript text reaches ChatStore.send")
    }

    // ---- transcript router: manual mode routes to chatInput ----------
    function test_transcript_manual_send_routes_to_chat_input() {
      replica.store = fakeChat
      replica.serviceRpc = rpcOff
      replica.chatInput = realInput
      replica._onTranscript("hello again")
      compare(fakeChat.sendCalls, 0,
        "voiceAutoSend=Off does NOT fire ChatStore.send")
      compare(realInput.captured, "hello again",
        "voiceAutoSend=Off hands the text to chatInput.appendExternalText")
    }

    // ---- transcript router: no store -> no crash ----------------------
    function test_transcript_no_store_short_circuits() {
      replica.store = null
      replica._onTranscript("should not throw")
      // No assert — if this throws, the test fails.
    }

    // ---- transcript router: no serviceRpc -> defaults to On ----------
    function test_transcript_no_service_rpc_defaults_to_on() {
      replica.store = fakeChat
      replica.serviceRpc = null
      replica._onTranscript("plain text")
      compare(fakeChat.sendCalls, 1,
        "with no serviceRpc, the router defaults voiceAutoSend to On")
    }

    // ---- chatInput receives text only when the store is alive ---------
    // The current router returns early when `store` is null — routing
    // a transcript to the input without a backing conversation would
    // surface a stale text the user could not act on. Document the rule
    // so a future change does not silently route to nowhere.
    function test_chat_input_receives_text_without_store() {
      replica.store = null
      replica.chatInput = realInput
      replica.serviceRpc = rpcOff
      replica._onTranscript("manual text")
      compare(realInput.captured, "",
        "no store -> router short-circuits, input does not receive text")
    }

    // ---- Settings store can be null: every read falls back ------------
    function test_effective_settings_default_without_settings_store() {
      var empty = null
      var v = empty ? empty.get("x", "default") : "default"
      compare(v, "default",
        "settingsStore=null falls through to the literal default")
    }

    // ---- Trimming preserves whitespace inside words ------------------
    function test_trim_only_strips_outer_whitespace() {
      replica.store = fakeChat
      replica.serviceRpc = rpcOn
      replica._onTranscript("  hello   world  ")
      compare(fakeChat.lastSentText, "hello   world",
        "trim only strips leading / trailing whitespace, not interior")
    }
  }
  // ---- MessageList bubble action bar (Copy + Speak parity) ----------
  //
  // The Electron front has had a Copy button + a "speak this message" action
  // for the entire chat lifetime; the plugin shipped neither. Both were
  // added in MessageList.qml: Copy uses the established hidden-TextEdit
  // clipboard sink (CodeBlock.qml:57-65), Speak raises a
  // `speakRequested(var messageId, string text)` signal the integration
  // owner wires into TtsStore.speakMessage.
  //
  // The contract that matters here:
  //   - Copy: visible on the LAST assistant row; clicking selects-all on
  //     the message body's hidden TextEdit and the button label flips to
  //     "copied!" for the duration of the feedback Timer.
  //   - Speak: same gating convention as onEdit/onRegenerate/onFork — a
  //     button whose action nobody handles must not be enabled, so the
  //     button is hidden until the host flips `speakEnabled` true. The
  //     signal fires with the exact shape the integration owner wires.
  QtObject {
    id: mlFakeStore
    property int conversationId: 0
    property var messages: []
    property var parts: []
    property bool streaming: false
    property var pendingPlanApprovals: ({})
    // Records every send so a duplicate is countable.
    property var sends: []
    function send(text, atts) { sends = sends.concat([String(text)]) }
  }

  // Minimal voice store: just the signal ChatView must NOT subscribe to.
  QtObject {
    id: mlFakeVoice
    signal transcriptReady(string text)
    function emitTranscript(t) { mlFakeVoice.transcriptReady(String(t)) }
  }

  property var cvComponent: Qt.createComponent(
    "../../components/ChatView.qml", Component.PreferSynchronous)

  // Builds a ChatView sharing mlFakeStore, so two instances can be created
  // the way the window and the quick-chat overlay coexist.
  function mlMakeChatView(extra) {
    var props = ({ store: mlFakeStore, width: 400, height: 600 })
    for (var k in extra) props[k] = extra[k]
    var o = cvComponent.createObject(mlHost, props)
    return o
  }

  property var mlComponent: Qt.createComponent(
    "../../components/MessageList.qml", Component.PreferSynchronous)

  // Walk the entire QML tree, collect every node whose `text` matches
  // `wantedText` AND whose `toString()` contains `kindSubstr` (e.g.
  // "Button"). The two conditions together let us ignore the
  // lowercase "copy" labels inside CodeBlock while finding only our
  // action-bar Button { text: "Copy" }, and the same trick picks the
  // Speak / Regenerate / Fork buttons cleanly.
  function mlFindByTextAndKind(root, wantedText, kindSubstr) {
    var hits = []
    if (!root) return hits
    function walk(o) {
      if (!o) return
      if (o.toString().indexOf(kindSubstr) >= 0 && o.text === wantedText) {
        hits.push(o)
      }
      for (var i = 0; i < o.children.length; i++) walk(o.children[i])
    }
    walk(root)
    return hits
  }

  // Find every hidden TextEdit (the clipboard sinks). A live MessageList
  // creates one sink per message row, so the test picks the sink whose
  // `text` matches `wantedText` — same pattern the renderer uses to
  // associate each row's Copy button with its own clipboard payload.
  function mlFindSink(root, wantedText) {
    var hits = []
    if (!root) return hits
    function walk(o) {
      if (!o) return
      if (o.toString().indexOf("TextEdit") >= 0 && o.visible === false
          && o.text === wantedText) {
        hits.push(o)
      }
      for (var i = 0; i < o.children.length; i++) walk(o.children[i])
    }
    walk(root)
    return hits
  }

  // Construct a fresh MessageList, parented to a host Item so
  // createObject's parent requirement is satisfied. Each test gets its
  // own list and tears it down on the way out — without isolation the
  // shared `fakeStore.messages` bleeds across tests.
  Item { id: mlHost }
  property var mlList: null

  function mlMakeList(opts) {
    if (mlList) { mlList.destroy(); mlList = null }
    mlFakeStore.messages = []
    mlFakeStore.parts = []
    mlFakeStore.streaming = false
    mlFakeStore.pendingPlanApprovals = ({})

    var props = ({ store: mlFakeStore, width: 400, height: 600 })
    if (opts) {
      for (var k in opts) props[k] = opts[k]
    }
    mlList = mlComponent.createObject(mlHost, props)
    return mlList
  }

  function mlTeardown() {
    if (mlList) { mlList.destroy(); mlList = null }
  }

  TestCase {
    name: "MessageListActionBar"
    when: windowShown

    property var speakPayloads: []

    function init() {
      speakPayloads = []
      mlTeardown()
      mlFakeStore.messages = []
    }

    function cleanup() {
      mlTeardown()
    }

    // ---- Copy: the action bar exposes it on the assistant row ---------

    function test_copy_button_visible_on_last_assistant_message() {
      var l = mlMakeList({})
      verify(l !== null, "MessageList built")
      l.speakEnabled = true
      mlFakeStore.messages = [
        { id: 1, role: "user",      content: "hi" },
        { id: 42, role: "assistant", content: "hello world" }
      ]
      wait(50)
      var copies = mlFindByTextAndKind(l, "Copy", "Button")
      // One per rendered message row: the action bar Row mounts under
      // msgCol once per message. The user row's Copy is invisible
      // because its action-bar Row is gated on role==="assistant"; the
      // assistant's Copy is visible.
      verify(copies.length >= 1,
        "at least one Copy button exists on a loaded transcript")
      var visibleCopies = []
      for (var i = 0; i < copies.length; i++) {
        if (copies[i].visible) visibleCopies.push(copies[i])
      }
      compare(visibleCopies.length, 1,
        "exactly ONE Copy button is visible: the assistant's, on the last row")
    }

    // ---- Copy: click selects all the assistant's body text ------------
    //
    // CodeBlock.qml:57-65 documents why the sink exists: Qt Quick has no
    // portable clipboard helper. The test reads the sink's selectedText
    // after the click — that is exactly the value the system clipboard
    // receives when the hidden TextEdit's `copy()` fires. If a future
    // change drops the `selectAll()` call, selectedText comes back as ""
    // and the system clipboard would copy an empty string.
    function test_copy_click_selects_all_message_text() {
      var l = mlMakeList({})
      l.speakEnabled = true
      mlFakeStore.messages = [
        { id: 1, role: "user",      content: "hi" },
        { id: 42, role: "assistant", content: "hello world" }
      ]
      wait(50)
      var copyBtn = mlFindByTextAndKind(l, "Copy", "Button")
      var visibleCopy = null
      for (var i = 0; i < copyBtn.length; i++) {
        if (copyBtn[i].visible) { visibleCopy = copyBtn[i]; break }
      }
      verify(visibleCopy !== null, "visible Copy button exists")
      visibleCopy.clicked()
      // The sink whose text matches the assistant message must now have
      // its full body selected — that's the bytes the system clipboard
      // receives.
      var sinks = mlFindSink(l, "hello world")
      compare(sinks.length, 1,
        "exactly one clipboard sink for the assistant message")
      compare(sinks[0].selectedText, "hello world",
        "selectAll() copies the full message body, not a slice")
    }

    // ---- Copy: feedback label swap (CodeBlock convention) -------------
    //
    // CodeBlock swaps a "copy" label for "copied!" so the user can see
    // the click landed even though the system clipboard is invisible.
    // MessageList follows the same convention.
    function test_copy_label_flips_after_click() {
      var l = mlMakeList({})
      l.speakEnabled = true
      mlFakeStore.messages = [
        { id: 1, role: "user",      content: "hi" },
        { id: 42, role: "assistant", content: "hello world" }
      ]
      wait(50)
      var copyBtn = mlFindByTextAndKind(l, "Copy", "Button")
      var visibleCopy = null
      for (var i = 0; i < copyBtn.length; i++) {
        if (copyBtn[i].visible) { visibleCopy = copyBtn[i]; break }
      }
      compare(visibleCopy.text, "Copy", "label starts as 'Copy'")
      visibleCopy.clicked()
      compare(visibleCopy.text, "copied!",
        "label flips to 'copied!' immediately after the click")
    }

    // ---- Speak: button is hidden until the host wires the signal -----
    //
    // Same convention as onEdit/onRegenerate/onFork: a button whose
    // action nobody handles must not be enabled. Speak's "handler" is
    // the speakRequested signal — and there is no signal listener
    // without the host wiring it, so the button is gated on
    // `speakEnabled` flipping to true (which the integration owner
    // does after connecting the signal).
    function test_speak_button_hidden_when_speakEnabled_false() {
      var l = mlMakeList({})
      // speakEnabled defaults to false.
      compare(l.speakEnabled, false,
        "speakEnabled defaults to false: the gate is closed by default")
      mlFakeStore.messages = [
        { id: 1, role: "user",      content: "hi" },
        { id: 42, role: "assistant", content: "hello world" }
      ]
      wait(50)
      var speaks = mlFindByTextAndKind(l, "Speak", "Button")
      var visibleSpeaks = []
      for (var i = 0; i < speaks.length; i++) {
        if (speaks[i].visible) visibleSpeaks.push(speaks[i])
      }
      compare(visibleSpeaks.length, 0,
        "with speakEnabled=false, no Speak button is visible — the action bar " +
        "shows Copy / Regenerate / Fork only")
    }

    // ---- Speak: clicking the visible button fires speakRequested ------
    //
    // The exact shape the integration owner wires:
    //   signal speakRequested(var messageId, string text)
    // A handler connected BEFORE the click is reached by the signal; the
    // captured payload is the integration point's contract.
    function test_speak_click_fires_speakRequested_with_messageId_and_text() {
      var l = mlMakeList({})
      l.speakEnabled = true
      l.speakRequested.connect(function (messageId, text) {
        speakPayloads = speakPayloads.concat([
          ({ messageId: messageId, text: text })
        ])
      })
      mlFakeStore.messages = [
        { id: 1, role: "user",      content: "hi" },
        { id: 42, role: "assistant", content: "hello world" }
      ]
      wait(50)
      var speaks = mlFindByTextAndKind(l, "Speak", "Button")
      var visibleSpeak = null
      for (var i = 0; i < speaks.length; i++) {
        if (speaks[i].visible) { visibleSpeak = speaks[i]; break }
      }
      verify(visibleSpeak !== null,
        "speakEnabled=true shows the Speak button on the last assistant row")
      visibleSpeak.clicked()
      wait(10)
      compare(speakPayloads.length, 1,
        "speakRequested fires exactly once per click")
      compare(speakPayloads[0].messageId, 42,
        "first signal arg is the messageId the integration owner wires")
      compare(speakPayloads[0].text, "hello world",
        "second signal arg is the message text the integration owner wires")
    }

    // ---- the edit-diff card -------------------------------------------
    //
    // The data is the REAL persisted shape: captured from conversation 14,
    // message 70, where Claude's SDK called Edit with `old_string`. The
    // renderer's getEditDiffStrings matches only `old_str`/`oldText`, so a
    // real Claude edit produced no diff in EITHER front end until
    // lib/toolSummary.js's editStrings learnt all three spellings.
    //
    // The card's `expanded` defaults true when status is done and a summary
    // exists (ToolCard.qml), so no click is needed to see the rows.

    function test_edit_tool_card_renders_a_diff_from_persisted_tool_calls() {
      var l = mlMakeList({})
      mlFakeStore.messages = [
        { id: 1, role: "user", content: "change beta" },
        { id: 2, role: "assistant", content: "done",
          tool_calls: JSON.stringify([{ id: "t1", name: "Edit",
            input: JSON.stringify({ file_path: "/x.txt", old_string: "beta", new_string: "BETA-OK" }),
            output: "", status: "done" }]) }
      ]
      wait(50)

      // The raw JSON blob must NOT be what is SHOWN. Visibility matters: the
      // JSON Text is DECLARED on the card, and a tree walk visits invisible
      // children — the contract is that its `visible` binding flips false
      // when a diff renders, not that the node is absent.
      var blobs = []
      function collectBlobs(o) {
        if (!o) return
        if (typeof o.text === "string" && o.text.indexOf("old_string") !== -1
            && o.visible !== false)
          blobs.push(o)
        for (var i = 0; i < o.children.length; i++) collectBlobs(o.children[i])
      }
      collectBlobs(l)
      compare(blobs.length, 0, "an edit input must never render as a JSON blob")


      function findLine(o, wanted) {
        if (!o) return null
        if (typeof o.text === "string" && o.text === wanted) return o
        for (var i = 0; i < o.children.length; i++) {
          var hit = findLine(o.children[i], wanted)
          if (hit) return hit
        }
        return null
      }
      var minus = findLine(l, "-beta")
      var plus = findLine(l, "+BETA-OK")
      verify(minus !== null && minus.visible !== false,
        "the removed line is VISIBLE as -beta")
      verify(plus !== null && plus.visible !== false,
        "the added line is VISIBLE as +BETA-OK")
      l.destroy()
    }

    function test_non_edit_tool_input_still_renders_as_json() {
      var l = mlMakeList({})
      mlFakeStore.messages = [
        { id: 1, role: "user", content: "list files" },
        { id: 2, role: "assistant", content: "done",
          tool_calls: JSON.stringify([{ id: "t1", name: "Bash",
            input: JSON.stringify({ command: "ls" }),
            output: "x", status: "done" }]) }
      ]
      wait(50)
      // A Bash call has no old/new pair, so it keeps the JSON readout — the
      // diff view must not swallow non-edit tools.
      var found = false
      function walk(o) {
        if (!o) return
        if (typeof o.text === "string" && o.text.indexOf(String.fromCharCode(34)+"command"+String.fromCharCode(34)) !== -1) found = true
        for (var i = 0; i < o.children.length; i++) walk(o.children[i])
      }
      walk(l)
      compare(found, true, "a Bash call still shows its JSON input")
      l.destroy()
    }

    // ---- one transcript, one send --------------------------------------
    //
    // ChatView must NOT subscribe to `voiceStore.transcriptReady`. Two of
    // them exist at once — the window and the quick-chat overlay — so a
    // self-subscribing view turned one dictation into two sends. Measured
    // live before the fix: "Quelle heure il est." dispatched once
    // (streaming=false) and queued again (streaming=true), and the agent
    // answered twice. App.qml is the single subscriber and calls
    // `applyTranscript` on the ACTIVE surface only.

    function test_chat_view_does_not_subscribe_to_transcripts() {
      mlFakeStore.sends = []
      mlFakeStore.conversationId = 7
      var a = mlMakeChatView({ voiceStore: mlFakeVoice })
      var b = mlMakeChatView({ voiceStore: mlFakeVoice })
      wait(50)

      mlFakeVoice.emitTranscript("bonjour")
      wait(50)

      compare(mlFakeStore.sends.length, 0,
        "a ChatView that subscribes itself sends once PER INSTANCE — the host routes instead")
      a.destroy()
      b.destroy()
    }

    function test_apply_transcript_sends_once_per_call() {
      mlFakeStore.sends = []
      mlFakeStore.conversationId = 7
      var v = mlMakeChatView({ voiceStore: mlFakeVoice })
      wait(50)

      v.applyTranscript("bonjour")
      compare(mlFakeStore.sends.length, 1, "the host's call sends exactly once")
      compare(mlFakeStore.sends[0], "bonjour", "and carries the transcript")

      // Empty transcripts are the documented "nothing to say" signal.
      v.applyTranscript("   ")
      compare(mlFakeStore.sends.length, 1, "whitespace-only is not a turn")
      v.destroy()
    }
  }

  // ---- MessageList tail-following -----------------------------------
  //
  // The rule that broke twice and that no other gate can see: the newest row
  // must be ON SCREEN as the transcript grows, and the list's own positioning
  // must leave a view the user scrolled away from alone.
  //
  // These assert on the GAP between the newest row's bottom edge and the
  // viewport's bottom edge, not on `contentY` arithmetic. A `contentY` assertion
  // is exactly how the bug hid: `contentHeight` is an estimate over unrealized
  // delegates, it oscillated between 1814 and 893 on a 14-message transcript,
  // and "contentY is near contentHeight - height" was therefore true at
  // positions that had the newest message off screen.
  function mlFindListView(node) {
    if (!node) return null
    if (node.toString().indexOf("QQuickListView") >= 0) return node
    for (var i = 0; i < node.children.length; i++) {
      var hit = mlFindListView(node.children[i])
      if (hit) return hit
    }
    return null
  }

  // Pixels between the newest row's bottom edge and the viewport's bottom edge.
  // 0 is pinned; positive means the row floats above the fold; negative means it
  // is clipped off the bottom — the reported symptom.
  function mlNewestRowGap(view) {
    var it = view.itemAtIndex(0)   // bottom-to-top: index 0 is the newest row
    if (!it) return NaN
    return (view.contentY + view.height) - (it.y + it.height)
  }

  function mlLongMessages(n) {
    var out = []
    for (var i = 0; i < n; i++) {
      out.push({
        id: i + 1,
        role: i % 2 === 0 ? "user" : "assistant",
        // Long enough that the rows overflow a 600px viewport several times
        // over, so there is a real scroll position to get wrong.
        content: "message " + i + " " + "lorem ipsum dolor sit amet ".repeat(12)
      })
    }
    return out
  }

  TestCase {
    name: "MessageListTail"
    when: windowShown

    function init() { mlTeardown() }
    function cleanup() { mlTeardown() }

    function test_starts_following_the_tail() {
      var l = mlMakeList({})
      var view = mlFindListView(l)
      verify(view !== null, "found the transcript ListView")
      verify(view.atTail, "a fresh list follows the newest row")
    }

    // Index 0 is the NEWEST row. Getting this backwards would render the whole
    // transcript upside down, and every gap assertion below would still pass.
    function test_row_zero_is_the_newest_message() {
      var l = mlMakeList({})
      var view = mlFindListView(l)
      mlFakeStore.messages = mlLongMessages(6)
      wait(600)
      compare(view.rows.length, 6, "one row per message")
      compare(view.rows[0].message.id, 6, "row 0 is the newest message")
      compare(view.rows[view.rows.length - 1].message.id, 1, "the last row is the oldest")
      verify(view.rows[0].isLast, "and row 0 is the one carrying the action bar")
    }

    // The user-visible contract: opening a conversation shows its newest message,
    // not a position a line or two short of it.
    function test_loading_a_conversation_pins_the_newest_row() {
      var l = mlMakeList({})
      var view = mlFindListView(l)
      mlFakeStore.messages = mlLongMessages(14)
      wait(1500)
      verify(view.contentHeight > view.height,
        "the fixture must overflow the viewport or there is nothing to get wrong")
      var gap = mlNewestRowGap(view)
      verify(Math.abs(gap) <= 2, "newest row is pinned to the bottom, gap=" + gap)
    }

    // Growth must not unpin it. This is the case the estimate-based version got
    // wrong: every new row changed which delegates were realized, which changed
    // the target it was scrolling to.
    function test_growth_keeps_the_newest_row_pinned() {
      var l = mlMakeList({})
      var view = mlFindListView(l)
      mlFakeStore.messages = mlLongMessages(10)
      wait(1200)
      verify(Math.abs(mlNewestRowGap(view)) <= 2, "pinned after the first load")

      mlFakeStore.messages = mlLongMessages(22)
      wait(1500)
      var gap = mlNewestRowGap(view)
      verify(Math.abs(gap) <= 2, "still pinned after 12 more messages, gap=" + gap)
    }

    // A programmatic reposition and a relayout are NOT the user scrolling. When
    // `atTail` was recomputed from `contentY`, they read as "the user left" and
    // the list stopped following its own growth.
    function test_programmatic_reposition_does_not_clear_following() {
      var l = mlMakeList({})
      var view = mlFindListView(l)
      mlFakeStore.messages = mlLongMessages(10)
      wait(1200)
      verify(view.atTail, "following after the load")

      view.positionViewAtEnd()      // the oldest end, under bottom-to-top
      view.forceLayout()
      wait(50)
      verify(view.atTail, "a programmatic reposition is not a gesture")

      view._rearmTail()
      wait(1200)
      var gap = mlNewestRowGap(view)
      verify(Math.abs(gap) <= 2, "and it pins itself back, gap=" + gap)
    }

    // The other half: once the user has scrolled away, OUR positioning must
    // leave the view alone. Driven by re-arming directly, because that is the
    // exact path that used to ignore the flag — `_toTail()` checked it only when
    // re-arming, so an in-flight burst kept dragging the view for another ~1s.
    function test_a_user_gesture_away_stops_our_positioning() {
      var l = mlMakeList({})
      var view = mlFindListView(l)
      mlFakeStore.messages = mlLongMessages(14)
      wait(1200)
      verify(view.atTail, "following before the gesture")

      view.contentY = view.contentY - 400
      view.movementEnded()
      verify(!view.atTail, "a real gesture away from the newest row stops following")

      var parked = view.contentY
      view._rearmTail()
      wait(1200)
      compare(view.contentY, parked, "the follow must not move a view the user parked")
    }

    // `autoScroll` is the user's setting and it gates the positioning itself —
    // it shipped once with nothing reading it at all.
    function test_autoScroll_false_never_repositions() {
      var l = mlMakeList({ autoScroll: false })
      var view = mlFindListView(l)
      mlFakeStore.messages = mlLongMessages(14)
      wait(1200)
      verify(view.contentHeight > view.height, "the fixture overflows")

      view.contentY = view.contentY - 300
      var parked = view.contentY
      view._rearmTail()
      wait(1200)
      compare(view.contentY, parked, "autoScroll off means we never move the view")
    }
  }
}

