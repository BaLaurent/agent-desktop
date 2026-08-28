pragma ComponentBehavior: Bound

import QtQuick

import "../lib/piUi.js" as PiUi

// Owner of the pi:uiEvent / pi:uiRequest chrome state.
//
// Two responsibilities, both delegated to lib/piUi.js so the reducer is
// node-testable:
//
//   1. Reduce every pi:uiEvent into the chrome state (notify toasts,
//      setStatus chips, setWidget blocks, working message, title, and
//      header/footer PiUINode trees).
//   2. Queue pi:uiRequest dialogs so the modal can render them. The
//      modal answers via rpc.respond(id, payload) — the bridge writes
//      {"type":"respond",...} which the server routes to respondPIUI.
//
// The store never imports Quickshell (CONTRACTS.md §2) and never imports
// qt.labs.platform. A dismissed dialog ALWAYS sends cancelled:true —
// see lib/piUi.responseFor. Otherwise the omp responder would hang the
// turn until cancelPendingPIUI.
QtObject {
  id: store

  required property var rpc

  // ---- chrome state -------------------------------------------------------

  // Transient toasts rendered by PiUIChrome. Each carries a unique id.
  property var toasts: []

  // KEYED map: key -> text. A second setStatus for the same key replaces;
  // an empty text drops the chip.
  property var statuses: ({})
  // KEYED map: key -> { key, content: string[], placement: 'aboveEditor'|'belowEditor' }
  property var widgets: ({})

  property string workingMessage: ""
  property string title: ""
  // Header / footer are PiUINode trees (rendered by PiUINode.qml).
  property var headerNode: null
  property var footerNode: null

  // ---- modal queue --------------------------------------------------------

  // The currently shown request, or null when no dialog is up.
  property var activeRequest: null
  // FIFO queue. One dialog at a time — `activeRequest` is the head; new
  // requests land at the tail.
  property var requestQueue: []

  // ---- subs ---------------------------------------------------------------

  Component.onCompleted: {
    store.rpc.subscribe("pi:uiEvent", store.handleUiEvent)
    store.rpc.subscribe("pi:uiRequest", store.handleUiRequest)
  }
  Component.onDestruction: {
    store.rpc.unsubscribe("pi:uiEvent", store.handleUiEvent)
    store.rpc.unsubscribe("pi:uiRequest", store.handleUiRequest)
  }

  // ---- push handlers ------------------------------------------------------

  function handleUiEvent(ev) {
    var next = PiUi.reduceEvent({
      toasts: store.toasts,
      statuses: store.statuses,
      widgets: store.widgets,
      workingMessage: store.workingMessage,
      title: store.title,
      header: store.headerNode,
      footer: store.footerNode
    }, ev)
    // Reassign every property so QML change-signals fire on each one
    // independently. The reducer returns a fresh shape every time, so
    // no field is skipped.
    store.toasts = next.toasts
    store.statuses = next.statuses
    store.widgets = next.widgets
    store.workingMessage = next.workingMessage
    store.title = next.title
    store.headerNode = next.header
    store.footerNode = next.footer
  }

  function handleUiRequest(req) {
    if (!req || typeof req !== "object") return
    if (store.activeRequest === null) {
      store.activeRequest = req
    } else {
      // Append to the tail; the modal pops the next one when the current
      // dialog is answered.
      var next = store.requestQueue.slice()
      next.push(req)
      store.requestQueue = next
    }
  }

  // ---- modal API ----------------------------------------------------------

  // Pop the head of the queue into activeRequest. Called by the modal
  // when the user answers the current dialog.
  function popNext() {
    // Queue holds the pending requests; activeRequest holds the head.
    // On pop, the head moves out of the queue and into activeRequest.
    // If the queue is empty, the modal closes (activeRequest = null).
    var head = null
    var remaining = []
    for (var i = 0; i < store.requestQueue.length; i++) {
      if (i === 0) head = store.requestQueue[i]
      else remaining.push(store.requestQueue[i])
    }
    store.requestQueue = remaining
    store.activeRequest = head
  }

  // Answer the current request and advance. `outcome` is the modal's
  // payload — submitted: true|false plus the chosen value.
  function answerCurrent(outcome) {
    var req = store.activeRequest
    if (!req) return
    var kind = PiUi.describeRequest(req).kind
    var payload = PiUi.responseFor(kind, outcome)
    store.rpc.respond(req.id, payload)
    store.popNext()
  }

  // Dismiss without answering — the modal's close / escape handler.
  // Cancelled is always sent; the omp responder needs that signal to
  // stop waiting.
  function dismissCurrent() {
    var req = store.activeRequest
    if (!req) return
    store.rpc.respond(req.id, { cancelled: true })
    store.popNext()
  }

  // ---- toast helpers (chrome owns rendering; this only mutates state) ----

  function dismissToast(id) {
    if (store.toasts.length === 0) return
    var next = []
    for (var i = 0; i < store.toasts.length; i++) {
      if (store.toasts[i].id !== id) next.push(store.toasts[i])
    }
    if (next.length !== store.toasts.length) store.toasts = next
  }

  // Convenience for the chrome: clear the entire chrome state (used
  // when switching backend / on turn end). Keeps the queue — a request
  // in flight still has to be answered.
  function resetChrome() {
    store.toasts = []
    store.statuses = ({})
    store.widgets = ({})
    store.workingMessage = ""
    store.title = ""
    store.headerNode = null
    store.footerNode = null
  }
}
