import QtQuick
import QtTest

// ChatStore exercises the full subscribe/dispatch path: messages:stream
// chunks are filtered by conversationId, coalesced into parts via
// lib/streamParts.js, committed on `done`, and the queue gets drained when
// streaming finishes.
//
// The fake rpc captures every invoke PER CALL (last-callback-only fakes
// already cost us a regression). Tests assert against the right call by
// looking up by channel.

Item {
  width: 200
  height: 200

  // ---- minimal SettingsStore stand-in ----------------------------------
  QtObject {
    id: fakeSettings
    property var values: ({ ai_sdkBackend: "claude-agent-sdk" })
    function get(key, fallback) {
      return values[key] !== undefined ? values[key] : (fallback || "")
    }
  }

  // ---- fake rpc: per-call-capture ---------------------------------------
  QtObject {
    id: fakeRpc

    property var calls: []
    property var subs: ({})

    function invoke(channel, args, onOk, onErr) {
      calls = calls.concat([{ channel: channel, args: args || [], ok: onOk, err: onErr }])
      return calls.length
    }

    function cancel(rid) { /* no-op for tests */ }
    function respond(id, payload) { /* no-op for tests */ }
    function recStart() {}
    function recStop() {}
    function recCancel() {}

    signal recordingChanged(bool active)
    signal audioReady(string b64)

    property bool serverUp: true
    property bool bridgeAlive: true
    property bool connected: true
    property string lastError: ""
    property bool busy: false
    property string pluginId: "agent-desktop"
    property string pluginDir: ""
    property var shell: null
    property var settings: ({})
    property var settingsStore: fakeSettings

    function subscribe(channel, handler) {
      var list = subs[channel]
      if (!list) { list = []; subs[channel] = list }
      if (list.indexOf(handler) === -1) list.push(handler)
    }
    function unsubscribe(channel, handler) {
      var list = subs[channel]
      if (!list) return
      var i = list.indexOf(handler)
      if (i >= 0) list.splice(i, 1)
    }
    function setting(key, fallback) {
      if (settings && settings[key] !== undefined && settings[key] !== null) return settings[key]
      return fallback
    }

    // ---- test helpers --------------------------------------------------

    // Reset only the call log; subscriptions are kept across init() so the
    // store's Component.onCompleted subscriptions stay alive between tests.
    function reset() { calls = [] }

    function acceptLatest(channel, result) {
      for (var i = calls.length - 1; i >= 0; i--) {
        if (calls[i].channel === channel) {
          if (calls[i].ok) calls[i].ok(result)
          return
        }
      }
      throw new Error("no pending call to " + channel)
    }

    function acceptAll(channel, result) {
      for (var i = 0; i < calls.length; i++) {
        if (calls[i].channel === channel && calls[i].ok) calls[i].ok(result)
      }
    }

    function refuseLatest(channel, message) {
      for (var i = calls.length - 1; i >= 0; i--) {
        if (calls[i].channel === channel) {
          if (calls[i].err) calls[i].err(message)
          return
        }
      }
      throw new Error("no pending call to " + channel)
    }

    function callsTo(channel) {
      var out = []
      for (var i = 0; i < calls.length; i++) if (calls[i].channel === channel) out.push(calls[i])
      return out
    }

    // Drive every handler registered for a channel with one payload.
    function emit(channel, data) {
      var list = subs[channel]
      if (!list) return
      var handlers = list.slice()
      for (var i = 0; i < handlers.length; i++) {
        try { handlers[i](data) } catch (e) { console.warn("handler threw:", e) }
      }
    }
  }

  Loader {
    id: storeLoader
    Component.onCompleted: setSource("../../stores/ChatStore.qml", ({ rpc: fakeRpc, settingsStore: fakeSettings }))
  }

  TestCase {
    name: "ChatStore"
    when: windowShown

    property var store: storeLoader.item

    function initTestCase() {
      verify(store !== null, "ChatStore.qml loaded")
    }

    function init() {
      fakeRpc.reset()
      store.conversationId = 0
      store.messages = []
      store.clearedAt = ""
      store.compactSummary = ""
      store.parts = []
      store.streaming = false
      store.error = ""
      store.contextDisplay = null
      store.queue = []
      store.queuePaused = false
      store.pendingApproval = null
      store.pendingAsk = null
      store.pendingPlan = null
      store.pendingPlanApprovals = ({})
    }

    // ---- chunk filtering --------------------------------------------------

    function test_stream_chunk_for_other_conversation_is_ignored() {
      store.conversationId = 5
      fakeRpc.emit("messages:stream", {
        type: "text",
        content: "ignored",
        conversationId: 99
      })
      compare(store.parts.length, 0,
        "chunks for a different conversationId must not enter our part list")
    }

    function test_stream_chunk_without_conversationId_is_accepted() {
      store.conversationId = 5
      fakeRpc.emit("messages:stream", { type: "text", content: "ok" })
      compare(store.parts.length, 1)
      compare(store.parts[0].content, "ok")
    }

    // ---- full turn lifecycle: text chunks + done commits the assistant --

    function test_done_commits_an_assistant_message() {
      store.conversationId = 7
      fakeRpc.emit("messages:stream", { type: "text", content: "PO", conversationId: 7 })
      fakeRpc.emit("messages:stream", { type: "text", content: "N", conversationId: 7 })
      fakeRpc.emit("messages:stream", { type: "text", content: "G", conversationId: 7 })
      compare(store.streaming, true, "streaming is on after the first chunk")
      compare(store.parts.length, 1, "three text chunks coalesce")
      compare(store.parts[0].content, "PONG")
      var beforeCount = store.messages.length

      var turnFired = false
      store.turnEnded.connect(function (s) { turnFired = true })

      fakeRpc.emit("messages:stream", { type: "done", conversationId: 7 })

      compare(store.streaming, false)
      compare(store.parts.length, 0)
      compare(store.messages.length, beforeCount + 1,
        "the assistant turn is committed on done")
      var last = store.messages[store.messages.length - 1]
      compare(last.role, "assistant")
      compare(last.content, "PONG")
      compare(turnFired, true, "turnEnded signal fires on commit")
    }

    // ---- send while streaming queues instead of dispatching -------------

    function test_send_while_streaming_queues() {
      store.conversationId = 11
      store.streaming = true
      store.send("first follow-up", [])
      compare(store.queue.length, 1)
      compare(store.queue[0].content, "first follow-up")
      compare(fakeRpc.callsTo("messages:send").length, 0,
        "no messages:send fires while streaming and queue is the right shape")
    }

    // ---- clear() writes an ISO cleared_at -------------------------------

    function test_clear_writes_iso_cleared_at_and_calls_update() {
      store.conversationId = 13
      store.clearedAt = ""
      store.clear()
      compare(store.clearedAt.length > 0, true, "clearedAt is set locally")
      var iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(store.clearedAt)
      compare(iso, true, "clearedAt matches the ISO 8601 form the server expects")
      var calls = fakeRpc.callsTo("conversations:update")
      compare(calls.length, 1)
      compare(calls[0].args[0], 13)
      compare(calls[0].args[1].cleared_at, store.clearedAt)
      compare(calls[0].args[1].compact_summary, null)
    }

    // ---- plan approval: two distinct paths ------------------------------

    // PI path (plan_approval_request / approvePlan): writes
    // ai_permissionMode='bypassPermissions' into ai_overrides, then sends a
    // NEW user message — NOT a respondToApproval call.
    function test_plan_approval_pi_path_writes_override_then_sends_message() {
      store.conversationId = 21
      fakeRpc.reset()
      // The PI plan-approval UI persists AFTER the turn ends — the agent
      // calls exit_plan_mode (emitting plan_approval_request), then `done`
      // commits the turn and the user clicks Approve. So the realistic
      // sequence is plan_approval_request -> done -> user clicks.
      fakeRpc.emit("messages:stream", {
        type: "plan_approval_request",
        conversationId: 21,
        content: "step 1: refactor"
      })
      fakeRpc.emit("messages:stream", { type: "done", conversationId: 21 })
      store.approvePlan(21, true, "")
      // conversations:get fires first to read existing overrides.
      var getCalls = fakeRpc.callsTo("conversations:get")
      compare(getCalls.length, 1, "conversations:get fires once to read existing overrides")
      // Accept the get so its callback fires conversations:update.
      fakeRpc.acceptLatest("conversations:get", { id: 21, ai_overrides: null })
      // conversations:update fires with the bypassPermissions override.
      var updCalls = fakeRpc.callsTo("conversations:update")
      compare(updCalls.length, 1)
      var overrides = JSON.parse(updCalls[0].args[1].ai_overrides)
      compare(overrides.ai_permissionMode, "bypassPermissions")
      // Accept the update so its callback fires send() -> messages:send.
      fakeRpc.acceptLatest("conversations:update", undefined)
      console.log("after acceptLatest update, calls:", fakeRpc.calls.map(function(c){return c.channel}).join(","))
      compare(fakeRpc.callsTo("messages:respondToApproval").length, 0,
        "PI plan approval does NOT call messages:respondToApproval")
      var sendCalls = fakeRpc.callsTo("messages:send")
      compare(sendCalls.length >= 1, true,
        "PI plan approval sends a new user message via messages:send")
    }

    // Claude tool_approval path (ExitPlanMode): uses respondToApproval
    // with behavior:'allow' or behavior:'deny' — and never writes
    // ai_permissionMode.
    function test_plan_approval_claude_path_calls_respondToApproval() {
      fakeRpc.reset()
      store.approve("req_xyz", true, "", true)
      var respCalls = fakeRpc.callsTo("messages:respondToApproval")
      compare(respCalls.length, 1)
      compare(respCalls[0].args[0], "req_xyz")
      compare(respCalls[0].args[1].behavior, "allow")
      compare(respCalls[0].args[1].dontAskAgain, true)
      compare(fakeRpc.callsTo("conversations:update").length, 0)
      compare(fakeRpc.callsTo("messages:send").length, 0,
        "Claude ExitPlanMode approval does NOT send a follow-up message")
    }

    function test_approve_deny_includes_message() {
      store.approve("req_d", false, "no thanks", false)
      var respCalls = fakeRpc.callsTo("messages:respondToApproval")
      compare(respCalls.length, 1)
      compare(respCalls[0].args[1].behavior, "deny")
      compare(respCalls[0].args[1].message, "no thanks")
    }

    function test_answer_passes_answers_map() {
      store.answer("req_q", { "what color?": "blue" })
      var respCalls = fakeRpc.callsTo("messages:respondToApproval")
      compare(respCalls.length, 1)
      compare(respCalls[0].args[0], "req_q")
      compare(respCalls[0].args[1].answers["what color?"], "blue")
    }

    function test_orphan_tool_input_is_dropped() {
      store.conversationId = 33
      fakeRpc.emit("messages:stream", {
        type: "tool_input",
        toolId: "tu_x",
        toolInput: '{"file":"/etc/passwd"}',
        conversationId: 33
      })
      compare(store.parts.filter(function (p) { return p.type === "tool" }).length, 0,
        "no phantom tool part is created from an orphan tool_input")
    }

    function test_send_while_idle_dispatches_messages_send() {
      store.conversationId = 41
      store.streaming = false
      store.send("hello agent", [])
      var sendCalls = fakeRpc.callsTo("messages:send")
      compare(sendCalls.length, 1)
      compare(sendCalls[0].args[0], 41)
      compare(sendCalls[0].args[1], "hello agent")
      compare(store.streaming, true,
        "the store enters streaming mode as soon as the user hits send")
    }

    function test_slash_clear_dispatches_clear_not_send() {
      store.conversationId = 51
      fakeRpc.emit("messages:stream", { type: "text", content: "anything", conversationId: 51 })
      fakeRpc.emit("messages:stream", { type: "done", conversationId: 51 })
      fakeRpc.reset()
      store.streaming = false
      store.send("/clear", [])
      compare(fakeRpc.callsTo("messages:send").length, 0)
      compare(fakeRpc.callsTo("conversations:update").length, 1)
    }

    function test_conversationUpdated_during_streaming_does_not_reload() {
      store.conversationId = 61
      store.streaming = true
      store.parts = [{ type: "text", content: "live" }]
      store.messages = [{ id: 1, role: "user", content: "ask" }]
      fakeRpc.emit("messages:conversationUpdated", 61)
      compare(fakeRpc.callsTo("conversations:get").length, 0)
    }

    function test_tool_result_marks_tool_done() {
      store.conversationId = 71
      fakeRpc.emit("messages:stream", {
        type: "tool_start", toolName: "Bash", toolId: "tu_q", conversationId: 71
      })
      fakeRpc.emit("messages:stream", {
        type: "tool_result",
        toolId: "tu_q",
        content: "ok",
        toolOutput: "hi",
        conversationId: 71
      })
      var tools = store.parts.filter(function (p) { return p.type === "tool" })
      compare(tools.length, 1, "exactly one tool part")
      compare(tools[0].status, "done", "tool status flipped to done")
      compare(tools[0].output, "hi", "tool output recorded")
    }

    // ---- a send with no conversation must not vanish ------------------
    // `send()` returned bare when `conversationId <= 0`, so a typed message
    // OR a finished voice transcript was discarded with nothing on screen and
    // nothing in the log. That is what made dictation look broken end to end
    // when the real gap was that no conversation had ever been selected.

    function test_send_with_no_conversation_reports_instead_of_dropping() {
      store.conversationId = 0
      store.error = ""
      store.send("hello", [])
      verify(store.error.length > 0,
        "a send that cannot go anywhere must say so")
      compare(store.streaming, false, "nothing is in flight")
    }

    function test_send_with_a_conversation_clears_the_stale_error() {
      store.conversationId = 0
      store.send("dropped", [])
      verify(store.error.length > 0, "precondition: the error is set")
      store.conversationId = 42
      store.send("delivered", [])
      compare(store.error, "",
        "a send that works must clear the previous complaint")
    }

    // ---- queue mutations -----------------------------------------------
    //
    // Parity with src/renderer/stores/chatStore.ts:500-560 (Electron).
    // The queue is client-side only — there is no server channel — so
    // every operation is a local array mutation that has to reassign
    // `queue` to fire change signals. The drain function (line ~237)
    // also has to honour `queuePaused`, which it did not before this
    // parity pass.

    function _seedQueue(items) {
      // Replace the queue wholesale — callers pass an array of
      // `{content, attachments}` records. The store's `send()` uses
      // that exact shape.
      store.queue = items.map(function (c) {
        return { content: c, attachments: [] }
      })
    }

    function test_removeFromQueue_drops_at_index() {
      store.conversationId = 101
      store.streaming = true
      _seedQueue(["alpha", "beta", "gamma"])
      store.removeFromQueue(1)
      compare(store.queue.length, 2)
      compare(store.queue[0].content, "alpha")
      compare(store.queue[1].content, "gamma",
        "removing index 1 drops the middle item and the tail shifts up")
    }

    function test_removeFromQueue_out_of_range_is_noop() {
      _seedQueue(["only"])
      store.removeFromQueue(-1)
      store.removeFromQueue(1)
      store.removeFromQueue(99)
      compare(store.queue.length, 1,
        "out-of-range indices must not silently corrupt the queue")
    }

    function test_editQueued_replaces_content() {
      _seedQueue(["draft one", "draft two"])
      store.editQueued(0, "polished one")
      compare(store.queue[0].content, "polished one")
      compare(store.queue[1].content, "draft two",
        "editing index 0 leaves the other items alone")
    }

    function test_editQueued_empty_is_noop() {
      _seedQueue(["keep me"])
      store.editQueued(0, "")
      compare(store.queue[0].content, "keep me",
        "blanking out a queued message must not silently enqueue an empty turn")
    }

    function test_editQueued_out_of_range_is_noop() {
      _seedQueue(["only"])
      store.editQueued(5, "anything")
      compare(store.queue[0].content, "only",
        "editing past the end must not extend the queue")
    }

    function test_reorderQueue_moves_item() {
      _seedQueue(["a", "b", "c", "d"])
      store.reorderQueue(0, 2)
      compare(store.queue[0].content, "b")
      compare(store.queue[1].content, "c")
      compare(store.queue[2].content, "a",
        "moving from 0 to 2 inserts the item at the target position")
      compare(store.queue[3].content, "d")
    }

    function test_reorderQueue_equal_indices_is_noop() {
      _seedQueue(["a", "b", "c"])
      store.reorderQueue(1, 1)
      compare(store.queue[1].content, "b",
        "moving to the same index is a no-op (splice+insert would shift by one)")
    }

    function test_reorderQueue_out_of_range_is_noop() {
      _seedQueue(["a", "b"])
      store.reorderQueue(0, 5)
      store.reorderQueue(5, 0)
      store.reorderQueue(-1, 0)
      compare(store.queue[0].content, "a")
      compare(store.queue[1].content, "b")
    }

    function test_clearQueue_empties_and_resets_pause() {
      store.streaming = true
      _seedQueue(["a", "b"])
      store.queuePaused = true
      store.clearQueue()
      compare(store.queue.length, 0)
      compare(store.queuePaused, false,
        "a cleared queue is meaningless when still paused; clearing unpauses too")
    }

    // ---- pause / resume semantics ---------------------------------

    // The original `_drainQueue()` ignored `queuePaused` entirely
    // (ChatStore.qml:49 declared it, line 93 reset it, nothing else
    // read it). On a turn end the drain fired regardless of pause.
    // That is the gap this fix closes.
    function test_pauseQueue_blocks_drain_on_turn_end() {
      store.conversationId = 200
      _seedQueue(["queued while paused"])
      store.queuePaused = true
      fakeRpc.emit("messages:stream", { type: "text", content: "x", conversationId: 200 })
      fakeRpc.emit("messages:stream", { type: "done", conversationId: 200 })
      compare(store.queue.length, 1,
        "paused: the queue survives the turn boundary")
      compare(fakeRpc.callsTo("messages:send").length, 0,
        "paused: the drain does NOT fire a messages:send")
    }

    function test_resumeQueue_drains_when_idle() {
      store.conversationId = 201
      _seedQueue(["queued one", "queued two"])
      store.queuePaused = true
      // End any in-flight turn so resume can drain.
      store.streaming = false
      fakeRpc.reset()
      store.resumeQueue()
      compare(store.queuePaused, false)
      compare(store.queue.length, 1,
        "resume drained the head; one item left")
      var sendCalls = fakeRpc.callsTo("messages:send")
      compare(sendCalls.length, 1,
        "resumeQueue drains immediately when no turn is in flight")
      compare(sendCalls[0].args[1], "queued one",
        "the head of the queue is what was sent")
    }

    function test_resumeQueue_does_not_drain_while_streaming() {
      store.conversationId = 202
      _seedQueue(["queued"])
      store.queuePaused = true
      store.streaming = true
      fakeRpc.reset()
      store.resumeQueue()
      compare(store.queuePaused, false)
      compare(store.queue.length, 1,
        "resume while streaming must not steal the turn from the live agent")
      compare(fakeRpc.callsTo("messages:send").length, 0)
    }
  }
}
