import QtQuick
import QtTest

// PiUiStore, exercised in a real QML engine.
//
// The fake `rpc` mirrors tst_settings_store.qml: every invoke lands in
// `calls`, every subscription in `subs`. The store subscribes to
// `pi:uiEvent` and `pi:uiRequest`, so the fake MUST be able to emit
// pushes (via `emit()`) and record `respond` calls (the store answers
// pi:uiRequest dialogs by calling rpc.respond, NOT rpc.invoke). That
// is the whole contract under test here.
Item {
  width: 400
  height: 400

  QtObject {
    id: fakeRpc
    property var calls: []
    property var subs: []
    property var responds: []

    function invoke(channel, args, onOk, onErr) {
      calls = calls.concat([{ channel: channel, args: args || [], ok: onOk, err: onErr }])
      return calls.length
    }

    function subscribe(channel, handler) {
      subs = subs.concat([{ channel: channel, handler: handler }])
    }
    function unsubscribe(channel, handler) {
      var next = []
      for (var i = 0; i < subs.length; i++) {
        if (subs[i].channel === channel && subs[i].handler === handler) continue
        next.push(subs[i])
      }
      subs = next
    }

    // The store's modal flow calls rpc.respond(id, payload) — NOT
    // rpc.invoke. Recording these separately proves the answer path is
    // wired (the bridge writes {"op":"respond", ...} and the server
    // routes it to respondPIUI). If the store were to call rpc.invoke
    // instead, the omp responder would never fire.
    function respond(id, payload) {
      responds = responds.concat([{ id: String(id), payload: payload }])
    }
    // store's Component.onCompleted subscriptions stay alive between tests.
    function emit(channel, data) {
      for (var i = 0; i < subs.length; i++) {
        if (subs[i].channel === channel) subs[i].handler(data)
      }
    }

    function reset() { calls = []; responds = [] }
  }

  Loader {
    id: storeLoader
    Component.onCompleted: setSource("../../stores/PiUiStore.qml", ({ rpc: fakeRpc }))
  }

  TestCase {
    name: "PiUiStore"
    when: windowShown

    property var store: storeLoader.item

    function initTestCase() {
      verify(store !== null, "PiUiStore.qml loaded")
    }

    function init() {
      fakeRpc.reset()
      store.toasts = []
      store.statuses = ({})
      store.widgets = ({})
      store.workingMessage = ""
      store.title = ""
      store.headerNode = null
      store.footerNode = null
      store.activeRequest = null
      store.requestQueue = []
    }

    // ---- subs --------------------------------------------------------------

    function test_subscribes_to_pi_ui_channels_on_completion() {
      var chans = []
      for (var i = 0; i < fakeRpc.subs.length; i++) chans.push(fakeRpc.subs[i].channel)
      verify(chans.indexOf("pi:uiEvent") >= 0, "subscribed to pi:uiEvent")
      verify(chans.indexOf("pi:uiRequest") >= 0, "subscribed to pi:uiRequest")
    }

    // ---- notify push --------------------------------------------------------

    function test_notify_appends_a_toast() {
      fakeRpc.emit("pi:uiEvent", { method: "notify", message: "hello", level: "info" })
      compare(store.toasts.length, 1)
      compare(store.toasts[0].message, "hello")
      compare(store.toasts[0].level, "info")
    }

    // ---- setStatus keyed replace -------------------------------------------

    function test_setStatus_replaces_same_key() {
      fakeRpc.emit("pi:uiEvent", { method: "setStatus", key: "a", text: "one" })
      fakeRpc.emit("pi:uiEvent", { method: "setStatus", key: "b", text: "two" })
      fakeRpc.emit("pi:uiEvent", { method: "setStatus", key: "a", text: "updated" })
      compare(store.statuses.a, "updated")
      compare(store.statuses.b, "two", "different keys preserved on replace")
    }

    function test_setStatus_empty_text_drops_the_chip() {
      fakeRpc.emit("pi:uiEvent", { method: "setStatus", key: "x", text: "on" })
      compare(store.statuses.x, "on")
      fakeRpc.emit("pi:uiEvent", { method: "setStatus", key: "x", text: "" })
      compare(store.statuses.x, undefined, "empty text drops the chip")
    }

    // ---- setWidget ----------------------------------------------------------

    function test_setWidget_placement_defaults_above() {
      fakeRpc.emit("pi:uiEvent", { method: "setWidget", key: "w", content: ["line"] })
      compare(store.widgets.w.placement, "aboveEditor")
      compare(store.widgets.w.content[0], "line")
    }

    function test_setWidget_below_editor() {
      fakeRpc.emit("pi:uiEvent", {
        method: "setWidget",
        key: "w",
        content: ["a", "b"],
        placement: "belowEditor"
      })
      compare(store.widgets.w.placement, "belowEditor")
      compare(store.widgets.w.content.length, 2)
    }

    // ---- setWorkingMessage / setTitle --------------------------------------

    function test_setWorkingMessage_and_setTitle() {
      fakeRpc.emit("pi:uiEvent", { method: "setWorkingMessage", message: "thinking" })
      compare(store.workingMessage, "thinking")
      fakeRpc.emit("pi:uiEvent", { method: "setTitle", title: "Agent — Opus" })
      compare(store.title, "Agent — Opus")
    }

    function test_setTitle_with_non_string_is_ignored() {
      fakeRpc.emit("pi:uiEvent", { method: "setTitle", title: "good" })
      fakeRpc.emit("pi:uiEvent", { method: "setTitle", title: 42 })
      compare(store.title, "good", "numeric title is ignored")
    }

    // ---- setHeader / setFooter ---------------------------------------------

    function test_setHeader_normalizes_node() {
      fakeRpc.emit("pi:uiEvent", {
        method: "setHeader",
        component: { type: "text", content: "Header text", style: "bold" }
      })
      verify(store.headerNode !== null)
      compare(store.headerNode.type, "text")
      compare(store.headerNode.content, "Header text")
      compare(store.headerNode.style, "bold")
    }

    function test_setHeader_unknown_type_degrades_to_text() {
      fakeRpc.emit("pi:uiEvent", {
        method: "setHeader",
        component: { type: "no-such-type", payload: "anything" }
      })
      verify(store.headerNode !== null)
      compare(store.headerNode.type, "text", "unknown type degrades to text")
      compare(store.headerNode.style, "error", "degraded node is style=error")
    }

    function test_setFooter_null_clears() {
      fakeRpc.emit("pi:uiEvent", { method: "setFooter", component: { type: "divider" } })
      verify(store.footerNode !== null)
      fakeRpc.emit("pi:uiEvent", { method: "setFooter", component: null })
      compare(store.footerNode, null, "null component clears footer")
    }

    // ---- pi:uiRequest queue -------------------------------------------------

    function test_request_sets_activeRequest() {
      fakeRpc.emit("pi:uiRequest", {
        id: "r1", method: "editor", title: "Edit config", prefill: "key: val"
      })
      verify(store.activeRequest !== null)
      compare(store.activeRequest.id, "r1")
      compare(store.requestQueue.length, 0, "first request goes straight to active")
    }

    function test_second_request_is_queued() {
      fakeRpc.emit("pi:uiRequest", { id: "r1", method: "editor", title: "first" })
      fakeRpc.emit("pi:uiRequest", { id: "r2", method: "editor", title: "second" })
      compare(store.activeRequest.id, "r1", "first stays active")
      compare(store.requestQueue.length, 1)
      compare(store.requestQueue[0].id, "r2")
    }

    // ---- answer: editor -> value ------------------------------------------

    function test_answer_editor_sends_value_payload() {
      fakeRpc.emit("pi:uiRequest", { id: "r1", method: "editor", title: "Edit" })
      store.answerCurrent({ submitted: true, value: "the new value" })
      compare(fakeRpc.responds.length, 1)
      compare(fakeRpc.responds[0].id, "r1")
      compare(fakeRpc.responds[0].payload.value, "the new value")
      compare(fakeRpc.responds[0].payload.cancelled, undefined)
      compare(store.activeRequest, null, "queue advances past answered request")
    }

    // ---- answer: confirm -> confirmed --------------------------------------

    function test_answer_confirm_sends_confirmed() {
      fakeRpc.emit("pi:uiRequest", { id: "r1", method: "confirm", title: "Sure?" })
      store.answerCurrent({ submitted: true })
      compare(fakeRpc.responds[0].payload.confirmed, true)
    }

    function test_answer_confirm_no_sends_cancelled() {
      fakeRpc.emit("pi:uiRequest", { id: "r1", method: "confirm", title: "Sure?" })
      store.answerCurrent({ submitted: false })
      compare(fakeRpc.responds[0].payload.cancelled, true,
        "denying a confirm must send cancelled: true")
    }

    // ---- dismiss: ALWAYS cancelled -----------------------------------------

    function test_dismiss_always_sends_cancelled() {
      fakeRpc.emit("pi:uiRequest", { id: "r1", method: "editor", title: "Edit" })
      store.dismissCurrent()
      compare(fakeRpc.responds.length, 1)
      compare(fakeRpc.responds[0].payload.cancelled, true,
        "dismissed modal must ALWAYS send cancelled: true")
      compare(fakeRpc.responds[0].payload.value, undefined,
        "dismiss must not also send a value")
    }

    function test_dismiss_with_queue_advances() {
      fakeRpc.emit("pi:uiRequest", { id: "r1", method: "editor", title: "first" })
      fakeRpc.emit("pi:uiRequest", { id: "r2", method: "editor", title: "second" })
      store.dismissCurrent()
      compare(store.activeRequest.id, "r2", "dismissing r1 promotes r2")
      compare(fakeRpc.responds.length, 1)
      compare(fakeRpc.responds[0].id, "r1")
    }

    function test_answer_with_queue_advances() {
      fakeRpc.emit("pi:uiRequest", { id: "r1", method: "editor", title: "first" })
      fakeRpc.emit("pi:uiRequest", { id: "r2", method: "input", title: "second" })
      store.answerCurrent({ submitted: true, value: "v1" })
      compare(store.activeRequest.id, "r2")
      compare(fakeRpc.responds[0].id, "r1")
      compare(fakeRpc.responds[1], undefined,
        "second request not yet answered")
      store.answerCurrent({ submitted: true, value: "v2" })
      compare(fakeRpc.responds.length, 2)
      compare(fakeRpc.responds[1].payload.value, "v2")
    }

    // ---- dismissToast -------------------------------------------------------

    function test_dismissToast_removes_by_id() {
      fakeRpc.emit("pi:uiEvent", { method: "notify", message: "first" })
      fakeRpc.emit("pi:uiEvent", { method: "notify", message: "second" })
      var firstId = store.toasts[0].id
      store.dismissToast(firstId)
      compare(store.toasts.length, 1)
      compare(store.toasts[0].message, "second")
    }

    // ---- resetChrome --------------------------------------------------------

    function test_resetChrome_keeps_queue() {
      fakeRpc.emit("pi:uiEvent", { method: "setTitle", title: "X" })
      fakeRpc.emit("pi:uiEvent", { method: "setStatus", key: "a", text: "1" })
      fakeRpc.emit("pi:uiRequest", { id: "r1", method: "editor", title: "Edit" })
      store.resetChrome()
      compare(store.title, "")
      compare(store.statuses.a, undefined)
      compare(store.activeRequest.id, "r1",
        "resetChrome must NOT drop a pending dialog")
    }
  }
}
