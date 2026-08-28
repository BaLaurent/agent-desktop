pragma ComponentBehavior: Bound

import QtQuick

import "../lib/streamParts.js" as SP

// Owner of the ACTIVE conversation's transcript and live stream state.
//
// One authoritative owner per mutable value: this store holds the persisted
// messages plus the in-flight parts for the conversation whose id is
// conversationId. ConversationsStore (Phase 3) owns the LIST and the active
// id; when activeId changes, Main calls ChatStore.load(id) which:
//   1. fetches the conversation (with its messages) via conversations:get,
//   2. fires conversations:markOpened so the server knows the user is here.
//
// Persistence: messages.tool_calls is the JSON of the saved tool calls,
// rehydrated into {type:'tool'} parts via lib/streamParts.partsFromToolCalls
// so the chat history renders identically to a live turn before any
// streaming starts.
//
// No Quickshell imports — CONTRACTS.md §2 (a store must stay QML-testable).
// The bridge child (`bridge/bridge.mjs`) handles the audio capture; we
// receive a `recordingChanged(bool)` / `audioReady(string)` signal on `rpc`
// and emit the recordingState / audioReady property updates below.
QtObject {
  id: store

  required property var rpc
  required property var settingsStore

  // ---- conversation binding ---------------------------------------------

  property int conversationId: 0
  property var messages: []
  property string clearedAt: ""
  property string compactSummary: ""

  // ---- live stream state ------------------------------------------------

  property var parts: []
  property bool streaming: false
  property string error: ""
  property var contextDisplay: null
  property var pendingPlanApprovals: ({})

  // ---- queue ------------------------------------------------------------

  property var queue: []
  property bool queuePaused: false

  // ---- approvals / ask / plan ------------------------------------------

  property var pendingApproval: null
  property var pendingAsk: null
  property var pendingPlan: null

  // ---- turn-end notification (Main wires notify-send) -------------------

  signal turnEnded(string summaryText)

  // ---- handshake callbacks ---------------------------------------------

  // Set by the tst_*.qml; never used in production.
  property var _test_emitMacroLoad: null

  // ---- subs -------------------------------------------------------------

  Component.onCompleted: {
    store.rpc.subscribe("messages:stream", store.handleStream)
    store.rpc.subscribe("messages:conversationUpdated", store.handleConversationUpdated)
    // conversations:titleUpdated is owned by ConversationsStore (Phase 3) —
    // the LIST, not the active transcript, is what it patches.
  }

  Component.onDestruction: {
    store.rpc.unsubscribe("messages:stream", store.handleStream)
    store.rpc.unsubscribe("messages:conversationUpdated", store.handleConversationUpdated)
  }

  // ---- load + persist ---------------------------------------------------

  // Reset to a clean state when switching conversations.
  function _resetForNewConversation(id) {
    conversationId = id
    messages = []
    clearedAt = ""
    compactSummary = ""
    parts = []
    streaming = false
    error = ""
    contextDisplay = null
    queue = []
    queuePaused = false
    pendingApproval = null
    pendingAsk = null
    pendingPlan = null
  }

  // Called by Main when the active conversation changes.
  function load(id) {
    if (!id || id <= 0) return
    _resetForNewConversation(id)
    store.rpc.invoke("conversations:get", [id], function (result) {
      if (!result) return
      // The result is the conversation + its messages. Ignore responses for
      // stale ids that the user already switched away from.
      if (id !== conversationId) return
      messages = result.messages || []
      clearedAt = result.cleared_at || ""
      compactSummary = result.compact_summary || ""
    }, function (err) {
      error = String(err)
    })
    // Tell the server this conversation is now open.
    store.rpc.invoke("conversations:markOpened", [id], function () {},
                     function () { /* not fatal */ })
  }

  // ---- send / stop / regenerate / edit / clear --------------------------

  // A send with no active conversation used to `return` bare. The message —
  // typed, or a finished voice transcript — vanished with nothing on screen
  // and nothing in the log, which is how dictation came to look broken when
  // the real gap was that no conversation was selected. Report it instead;
  // ChatInput's status row renders `store.error`.
  function send(text, attachments) {
    if (!conversationId || conversationId <= 0) {
      error = "No conversation selected — pick one in the list first."
      return
    }
    error = ""
    if (streaming) {
      // Queue the message; ChatInput owns queue handling and renders the
      // pending chip list. Same dispatch shape as the React store:
      // addToQueue(conversationId, content, attachments).
      var next = queue.slice()
      next.push({ content: String(text || ""), attachments: attachments || [] })
      queue = next
      return
    }
    _sendNow(text, attachments)
  }

  function _sendNow(text, attachments) {
    if (!conversationId || conversationId <= 0) return
    streaming = true
    parts = []
    // Optimistic local user message (matches the renderer's sendMessage).
    var now = new Date().toISOString()
    var userMsg = ({
      id: Date.now(),
      conversation_id: conversationId,
      role: "user",
      content: String(text || ""),
      attachments: JSON.stringify(attachments || []),
      tool_calls: null,
      created_at: now,
      updated_at: now
    })
    messages = messages.concat([userMsg])

    var trimmed = String(text || "").trim()
    if (trimmed === "/clear") {
      clear()
      return
    }
    if (trimmed === "/compact") {
      compact()
      return
    }
    if (trimmed === "/context") {
      contextInfo()
      return
    }
    if (/^\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
      // Slash command: try the macros path. If the server returns null or
      // rejects, fall back to sending the literal text to the agent (the
      // renderer's processQueuedMessage does the same).
      var cmdName = trimmed.slice(1)
      store.rpc.invoke("macros:load", [cmdName], function (messages) {
        if (Array.isArray(messages) && messages.length > 0) {
          var first = messages[0]
          var rest = messages.slice(1)
          if (rest.length > 0) {
            var next = queue.slice()
            for (var i = 0; i < rest.length; i++) {
              next.push({ content: String(rest[i]), attachments: [] })
            }
            queue = next
          }
          // Drain any queued items first, then send the macro's first line.
          if (queue.length > 0) {
            _drainQueue()
          } else {
            _sendNow(first, [])
          }
        } else {
          _sendNow("/" + cmdName, [])
        }
      }, function () {
        _sendNow("/" + cmdName, [])
      })
      return
    }

    // Regular message.
    _invokeSend(text, attachments)
  }

  function _invokeSend(text, attachments) {
    // messages:send resolves only at turn end. A long-pending rid is normal
    // and must not be surfaced as an error — we drive all the turn-end
    // reactions off the `done` chunk instead.
    store.rpc.invoke(
      "messages:send",
      [conversationId, String(text || ""), attachments || []],
      function (assistantRow) {
        // The resolve value is the persisted assistant Message (or null when
        // the agent had nothing to say, e.g. on the PI plan-approval flow).
        // The `done` chunk committed the live view already; nothing else to
        // do here unless we want to reconcile against assistantRow — kept
        // as a hook for future parity.
      },
      function (err) {
        if (err === "WebSocket disconnected") {
          // The bridge will reconnect; the onReconnect handler (Phase 5)
          // reloads authoritative state from the DB.
          return
        }
        error = String(err)
        streaming = false
        parts = []
      }
    )
  }

  // (queue mutations section follows below)

  // ---- queue mutations (client-side) ---------------------------------

  // removeFromQueue(index): drops a single item by position. Reassigns
  // `queue` so the change signal fires (QML arrays are reference types;
  // in-place splice would not notify). Out-of-range is a silent no-op so
  // the panel can be defensive against stale indices.
  function removeFromQueue(index) {
    if (typeof index !== "number") return
    if (index < 0 || index >= queue.length) return
    var next = queue.slice()
    next.splice(index, 1)
    queue = next
  }

  // editQueued(index, content): replaces the queued message's content.
  // attachments are preserved. Empty content is a no-op so a cleared
  // textarea does not silently produce an empty turn.
  function editQueued(index, content) {
    if (typeof index !== "number") return
    if (index < 0 || index >= queue.length) return
    var text = String(content == null ? "" : content)
    if (text.length === 0) return
    var next = queue.slice()
    var cur = next[index]
    next[index] = ({ content: text, attachments: cur.attachments || [] })
    queue = next
  }

  // reorderQueue(from, to): moves an item between two positions. Matches
  // Electron's splice-based reorder (chatStore.ts:520-527). Out-of-range
  // is a silent no-op; equal positions are a no-op (the splice+insert
  // round-trip would otherwise shift an item by one).
  function reorderQueue(from, to) {
    if (typeof from !== "number" || typeof to !== "number") return
    if (from < 0 || from >= queue.length) return
    if (to < 0 || to >= queue.length) return
    if (from === to) return
    var next = queue.slice()
    var item = next[from]
    next.splice(from, 1)
    next.splice(to, 0, item)
    queue = next
  }

  // clearQueue(): empties the queue and resets the paused flag. A paused
  // queue with no items is meaningless — clearing also unpauses so the
  // next `send()` does not pick up a stale pause from a previous turn.
  function clearQueue() {
    queue = []
    queuePaused = false
  }

  // pauseQueue(): freezes draining. _drainQueue() checks the flag.
  function pauseQueue() {
    queuePaused = true
  }

  // resumeQueue(): unfreezes, and if no turn is in flight, kicks the
  // drain immediately so a queued message does not sit there waiting
  // for the user to send something else.
  function resumeQueue() {
    queuePaused = false
    if (!streaming && queue.length > 0) {
      _drainQueue()
    }
  }

  function stop() {
    if (!conversationId || conversationId <= 0) return
    store.rpc.invoke("messages:stop", [conversationId], function () {},
                     function () { /* not fatal */ })
  }

  function _drainQueue() {
    if (queue.length === 0) return
    if (queuePaused) return
    var head = queue[0]
    queue = queue.slice(1)
    // Send through the normal send path so streaming/coalescing still apply.
    // Force-send even if streaming is somehow true — the queue exists
    // exactly to feed messages sequentially.
    var wasStreaming = streaming
    streaming = false
    _sendNow(head.content, head.attachments || [])
    // (wasStreaming was a no-op aside from avoiding a recursion; left here
    // so the future Phase 5 reconnect hook has a place to attach.)
  }

  function regenerate() {
    if (!conversationId || conversationId <= 0) return
    streaming = true
    parts = []
    // Drop the last assistant message optimistically, matching the renderer.
    for (var i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        messages = messages.slice(0, i).concat(messages.slice(i + 1))
        break
      }
    }
    store.rpc.invoke("messages:regenerate", [conversationId], function () {},
                     function (err) {
                       error = String(err)
                       streaming = false
                       parts = []
                     })
  }

  function editMessage(messageId, content) {
    if (!messageId) return
    streaming = true
    parts = []
    store.rpc.invoke("messages:edit", [messageId, String(content || "")],
                     function () {},
                     function (err) {
                       error = String(err)
                       streaming = false
                       parts = []
                     })
  }

  function compact() {
    if (!conversationId || conversationId <= 0) return
    store.rpc.invoke("messages:compact", [conversationId],
                     function (result) {
                       if (result && typeof result === "object") {
                         if (typeof result.summary === "string") {
                           compactSummary = result.summary
                         }
                         if (typeof result.clearedAt === "string") {
                           clearedAt = result.clearedAt
                         }
                       }
                       // Refresh messages: the server persisted the
                       // compact summary; we pull the conversation so the
                       // divider/bubble text stays consistent.
                       load(conversationId)
                     },
                     function (err) {
                       error = String(err)
                     })
  }

  // `/clear` is `conversations:update(id, {cleared_at: <ISO now>})` — exactly
  // what the renderer's `clearContext` does (chatStore.ts:438).
  function clear() {
    if (!conversationId || conversationId <= 0) return
    var now = new Date().toISOString()
    clearedAt = now
    compactSummary = ""
    store.rpc.invoke(
      "conversations:update",
      [conversationId, { cleared_at: now, compact_summary: null }],
      function () {},
      function (err) {
        error = String(err)
      }
    )
  }

  function contextInfo() {
    if (!conversationId || conversationId <= 0) return
    store.rpc.invoke("context:getBreakdown", [conversationId],
                     function (breakdown) {
                       var payload = ({ breakdown: breakdown, shownAt: Date.now() })
                       var backend = store.settingsStore
                         ? store.settingsStore.get("ai_sdkBackend", "")
                         : ""
                       if (backend === "pi") {
                         store.rpc.invoke("pi:sessionStats", [conversationId],
                           function (res) {
                             if (res && res.stats) {
                               payload.piStats = ({
                                 cost: res.stats.cost,
                                 totalMessages: res.stats.totalMessages,
                                 toolCalls: res.stats.toolCalls
                               })
                             }
                             contextDisplay = payload
                           },
                           function () { contextDisplay = payload })
                       } else {
                         contextDisplay = payload
                       }
                     },
                     function (err) { error = String(err) })
  }

  // ---- approval / ask-user responses -----------------------------------

  // ExitPlanMode path: handled via messages:respondToApproval with a
  // 'allow'|'deny' behavior (ToolApprovalBlock.tsx). The store also keeps
  // the last-known pending approval around so the UI can render its
  // feedback text field after the user submits.
  function approve(requestId, allow, message, dontAskAgain) {
    if (!requestId) return
    var payload
    if (allow === true) {
      payload = ({ behavior: "allow" })
      if (dontAskAgain === true) payload.dontAskAgain = true
      if (message && String(message).length > 0) payload.message = String(message)
    } else if (allow === "exit_plan_approve") {
      // ExitPlanMode approve handled via a follow-up message + override,
      // NOT respondToApproval — see approvePlan() below. This branch is
      // retained as a guard so a stray UI call cannot crash the bridge.
      payload = ({ behavior: "deny" })
    } else {
      payload = ({ behavior: "deny" })
      if (message && String(message).length > 0) payload.message = String(message)
    }
    pendingApproval = null
    store.rpc.invoke("messages:respondToApproval", [requestId, payload],
                     function () { /* null result is normal, not failure */ },
                     function (err) { error = String(err) })
  }

  // PI plan-approval path: writes ai_permissionMode='bypassPermissions' into
  // the conversation's ai_overrides and sends a NEW user message — NOT a
  // respondToApproval call (PlanApprovalBlock.tsx).
  function approvePlan(conversationId, approve, feedback) {
    if (!conversationId || conversationId <= 0) return
    pendingPlanApprovals = _omitKey(pendingPlanApprovals, conversationId)
    if (approve) {
      // Merge ai_permissionMode='bypassPermissions' into existing overrides.
      // We round-trip through conversations:get so we keep the user's
      // current overrides; if the read fails we still write the minimum
      // payload because an empty ai_overrides still works.
      store.rpc.invoke("conversations:get", [conversationId], function (conv) {
        var overrides = {}
        try {
          if (conv && typeof conv.ai_overrides === "string" && conv.ai_overrides.length > 0) {
            overrides = JSON.parse(conv.ai_overrides)
          }
        } catch (e) {
          overrides = ({})
        }
        overrides.ai_permissionMode = "bypassPermissions"
        store.rpc.invoke(
          "conversations:update",
          [conversationId, { ai_overrides: JSON.stringify(overrides) }],
          function () {
            send("Plan approved — proceed with execution.", [])
          },
          function (err) { error = String(err) }
        )
      }, function (err) { error = String(err) })
    } else {
      var reason = feedback && String(feedback).trim().length > 0
        ? String(feedback).trim()
        : "(no specific feedback provided)"
      send("Plan rejected. Feedback: " + reason, [])
    }
  }

  function answer(requestId, answers) {
    if (!requestId) return
    pendingAsk = null
    store.rpc.invoke(
      "messages:respondToApproval",
      [requestId, { answers: answers || ({}) }],
      function () {},
      function (err) { error = String(err) }
    )
  }

  // ---- stream chunk handling -------------------------------------------

  function handleStream(chunk) {
    if (!chunk || typeof chunk !== "object") return
    // Chunks whose conversationId is set and differs from ours belong to
    // a different conversation's stream — ignore.
    if (chunk.conversationId !== undefined && chunk.conversationId !== null
        && chunk.conversationId !== conversationId) {
      return
    }

    // `task_notification` can arrive with no active stream (Phase 7);
    // handled inline because it also wants to update parts when streaming.
    if (chunk.type === "task_notification") {
      var summary = chunk.content !== undefined
        ? String(chunk.content)
        : "Agent task completed"
      // Inline append into parts only while we're actively streaming this
      // conversation.
      if (streaming) {
        var tnp = ({
          type: "task_notification",
          summary: summary
        })
        if (chunk.taskId !== undefined) tnp.taskId = chunk.taskId
        if (chunk.taskStatus !== undefined) tnp.taskStatus = chunk.taskStatus
        if (chunk.outputFile !== undefined) tnp.outputFile = chunk.outputFile
        parts = parts.concat([tnp])
      }
      return
    }

    // Auto-create the buffer when the first non-terminal chunk arrives
    // for this conversation. The renderer's ensureBuffer() does the same.
    if (!streaming && chunk.type !== "done" && chunk.type !== "error") {
      streaming = true
      parts = []
    }

    var next = SP.reduce(parts, chunk)
    // SP.reduce returns a new array (or the same reference when the chunk
    // was a no-op). Only reassign when it actually changed.
    if (next !== parts) parts = next

    // Track approvals / asks / plan-approval at store level so the UI can
    // render them even before the surrounding rendering framework picks up
    // the part.
    if (chunk.type === "tool_approval") {
      var ap = null
      try {
        ap = ({
          requestId: chunk.requestId,
          toolName: chunk.toolName,
          toolInput: chunk.toolInput ? JSON.parse(chunk.toolInput) : ({})
        })
      } catch (e) {
        ap = ({
          requestId: chunk.requestId,
          toolName: chunk.toolName,
          toolInput: ({})
        })
      }
      pendingApproval = ap
    }
    if (chunk.type === "ask_user") {
      var aq = null
      try {
        aq = ({
          requestId: chunk.requestId,
          questions: chunk.questions ? JSON.parse(chunk.questions) : []
        })
      } catch (e) {
        aq = null
      }
      pendingAsk = aq
    }
    if (chunk.type === "plan_approval_request") {
      pendingPlan = ({
        conversationId: chunk.conversationId,
        plan: chunk.content
      })
      // Persist into the per-conversation map so the UI can keep showing it
      // after the turn ends.
      var map = pendingPlanApprovals || ({})
      var nextMap = ({})
      for (var k in map) nextMap[k] = map[k]
      nextMap[chunk.conversationId] = ({ plan: String(chunk.content || "") })
      pendingPlanApprovals = nextMap
    }

    if (chunk.type === "done") {
      _commitTurn()
    } else if (chunk.type === "error") {
      error = chunk.content !== undefined
        ? String(chunk.content)
        : "Stream error"
      streaming = false
    }
  }

  function _commitTurn() {
    if (!streaming) return
    // Build the persisted assistant message from the live parts. We do NOT
    // need to await the messages:send resolve — `done` arrives first and
    // the resolve will reconcile. The renderer's chatStore.saveAssistant()
    // is the equivalent.
    var text = ""
    var thinking = ""
    var toolCallsJson = null
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i]
      if (!p) continue
      if (p.type === "text") text += (text.length > 0 ? "\n" : "") + (p.content || "")
      else if (p.type === "thinking") thinking += (thinking.length > 0 ? "\n" : "") + (p.content || "")
      else if (p.type === "tool") {
        // Persist the tool calls we observed so the next load() rehydrates
        // them as {type:'tool'} parts via partsFromToolCalls.
        if (!toolCallsJson) toolCallsJson = "[]"
        var arr = JSON.parse(toolCallsJson)
        var tc = ({
          id: p.id || ("tool_" + i),
          name: p.name || "tool",
          input: JSON.stringify(p.input || {}),
          output: p.output || p.summary || "",
          status: p.status === "done" ? "done" : "done"
        })
        arr.push(tc)
        toolCallsJson = JSON.stringify(arr)
      }
    }
    var now = new Date().toISOString()
    var assistantRow = ({
      id: Date.now(),
      conversation_id: conversationId,
      role: "assistant",
      content: text,
      attachments: "[]",
      tool_calls: toolCallsJson,
      created_at: now,
      updated_at: now
    })
    messages = messages.concat([assistantRow])

    // Capture a brief summary for the turn-end notification. Main wires
    // notify-send — a store must not shell out (CONTRACTS.md §2/§8).
    var summaryText = text
    if (summaryText.length > 280) summaryText = summaryText.slice(0, 280) + "…"

    parts = []
    streaming = false
    pendingApproval = null
    pendingAsk = null
    pendingPlan = null

    turnEnded(summaryText)

    // Drain any queued prompts.
    if (queue.length > 0) _drainQueue()
  }

  // ---- conversationUpdated / titleUpdated ------------------------------

  function handleConversationUpdated(convId) {
    if (convId !== conversationId) return
    if (streaming) return // active turn; don't clobber the live view
    store.rpc.invoke("conversations:get", [conversationId], function (result) {
      if (!result) return
      messages = result.messages || []
      clearedAt = result.cleared_at || clearedAt
      compactSummary = result.compact_summary || compactSummary
    }, function () {})
  }

  // ---- utils -----------------------------------------------------------

  function _omitKey(obj, key) {
    var out = ({})
    for (var k in obj) if (k !== String(key)) out[k] = obj[k]
    return out
  }
}
