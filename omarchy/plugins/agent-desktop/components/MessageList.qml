pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls

import qs.Commons

import "../lib/streamParts.js" as SP
import "../lib/palette.js" as Palette

// The chat transcript.
//
// Renders the persisted `messages` array plus the live `parts` from the
// store. Parts are dispatched by `kind` to the matching delegate:
//   - text/thinking -> MarkdownBlock / ThinkingBlock
//   - tool -> ToolCard (with turnActive so still-running tools don't spin
//     forever when the server skipped the result chunk — measured gap)
//   - tool_approval / ask_user / plan_approval_request -> the strips
//   - mcp_status / system_message / task_notification / retry -> rows
//   - task_group -> a column of the grouped ToolCards
//
// Persisted tool_calls are rehydrated into {type:'tool'} parts via
// lib/streamParts.partsFromToolCalls so the chat history renders
// identically to a live turn before any streaming starts.
Item {
  id: root

  property var store: null
  // Required inputs come from the parent (ChatView).
  property bool compact: false

  // Honoured by the tail-following logic at the bottom of this file. Defaults
  // ON to match the server's own default; the host passes the user's setting.
  property bool autoScroll: true
  property string surface: "window"  // "window" | "quick"

  // Effective SDK backend — controls whether ThinkingBlock shows.
  property string effectiveBackend: ""

  // Effective thinking toggle.
  property bool effectiveShowThinking: false

  // Effective agent display name.
  property string effectiveAgentName: ""

  // Optional: the row receives an `edit`/`regenerate`/`fork` callback so
  // a fuller chat surface can hook into the persisted bubble menu.
  property var onEdit: null
  property var onRegenerate: null
  property var onFork: null

  // Speak-this-message: the integration owner (ChatView) flips
  // `speakEnabled` to true once it has connected `speakRequested` to
  // TtsStore.speakMessage. Following the same gating convention as
  // onEdit/onRegenerate/onFork: a button whose action nobody handles
  // must not be enabled, so the Speak button is invisible until the
  // host wires it. The signal itself is unconditional — emitting it
  // with no listener attached is a no-op (see TestSpeakGateSignalFires).
  property bool speakEnabled: false
  signal speakRequested(var messageId, string text)
  // The transcript is laid out BOTTOM-TO-TOP over a reversed model, so model
  // index 0 — the NEWEST row — sits at the bottom of the view.
  //
  // That is not a style choice, it is what makes "keep the newest message in
  // view" expressible at all. A top-to-bottom ListView pins the newest message
  // by scrolling to `contentHeight - height`, and `contentHeight` is an ESTIMATE
  // whenever delegates are unrealized: it is the realized rows' real heights
  // plus the average applied to the rest. Repositioning changes WHICH rows are
  // realized, which changes the average, which changes the target. Measured on a
  // 14-message transcript, `contentHeight` flapped between 1814 and 893 forever
  // and `contentY` swung 486 -> -442 -> 293 with no fixed point — so the
  // transcript came to rest wherever the retry budget happened to run out,
  // sometimes a line short of the newest message and sometimes past it.
  //
  // Bottom-to-top removes the estimate from the question. The newest row is the
  // model's FIRST row, its position is index 0's own edge, and pinning there
  // needs no knowledge of the total height at all — so growth anywhere above it
  // cannot move it.
  ListView {
    id: list
    anchors.fill: parent
    clip: true
    spacing: Style.spacing.md
    verticalLayoutDirection: ListView.BottomToTop
    model: list.rows

    // A pure binding, not a cached function call.
    //
    // This was `model: list._rootRecompute()`, where the function both READ
    // `root.store.messages` and WROTE `list._lastMessagesRef` / `list._cache`.
    // A binding that assigns to a property it also depends on is a self
    // dependency: QML evaluated it once — while `messages` was still empty —
    // and then never re-evaluated, so a loaded conversation rendered a blank
    // transcript. The hand-rolled memo was also redundant, because a QML
    // binding already re-runs only when one of its dependencies changes.
    readonly property var rows: {
      // For each persisted message emit a row; if the newest message is the
      // user's and a stream is live, append the accumulating parts after it.
      var msgArr = root.store && root.store.messages ? root.store.messages : []
      var partsArr = root.store && root.store.parts ? root.store.parts : []

      var rows = []
      var liveStreaming = !!(root.store && root.store.streaming)

      for (var i = 0; i < msgArr.length; i++) {
        rows.push({ kind: "message", message: msgArr[i], isLast: i === msgArr.length - 1 })
      }
      if (liveStreaming && msgArr.length > 0) {
        var lastMsg = msgArr[msgArr.length - 1]
        if (lastMsg.role === "user") {
          // The user just sent something and we are waiting for the
          // assistant turn — show the live parts as a single composite
          // row.
          rows.push({ kind: "streaming", parts: partsArr })
        }
      }

      // Persist the plan-approval UI even when not streaming. This block
      // exists for the case where a plan_approval_request was queued
      // across the `done` boundary.
      if (root.store && root.store.pendingPlanApprovals
          && root.store.conversationId
          && root.store.pendingPlanApprovals[root.store.conversationId]
          && !liveStreaming) {
        rows.push({
          kind: "plan",
          approval: {
            type: "plan_approval_request",
            conversationId: root.store.conversationId,
            plan: root.store.pendingPlanApprovals[root.store.conversationId].plan
          }
        })
      }

      // Reversed for `verticalLayoutDirection: BottomToTop`: index 0 is drawn at
      // the BOTTOM, so the newest row must come first. Built in reading order
      // above and flipped once here, which keeps `isLast` and the
      // streaming/plan append rules stated the way they read.
      rows.reverse()
      return rows
    }

    delegate: Loader {
      id: rowLoader
      required property var modelData

      anchors { left: rowLoader.parent ? rowLoader.parent.left : undefined; right: rowLoader.parent ? rowLoader.parent.right : undefined }
      width: ListView.view ? ListView.view.width : 0
      sourceComponent: {
        var md = rowLoader.modelData
        if (!md) return null
        if (md.kind === "message") return messageComp
        if (md.kind === "streaming") return streamingComp
        if (md.kind === "plan") return planComp
        return null
      }

      Component {
        id: messageComp
        // A single persisted message. Rehydrate tool_calls into {type:'tool'}
        // parts and render them inline.
        Column {
          id: msgCol
          spacing: Style.spacing.md

          // NOT `required property var modelData`. A Component instantiated
          // through a Loader's `sourceComponent` does not receive the view's
          // `modelData` — only the Loader does. Declaring it required left it
          // uninitialised, the Component failed to instantiate, and the whole
          // transcript rendered blank while the store held the messages.
          // `pragma ComponentBehavior: Bound` makes reading the outer id legal.
          readonly property var modelData: rowLoader.modelData

          property var message: modelData ? modelData.message : null

          property var rehydrated: {
            if (!msgCol.message) return []
            var tcs = msgCol.message.tool_calls
            if (!tcs) return []
            var parts = SP.partsFromToolCalls(typeof tcs === "string" ? tcs : JSON.stringify(tcs))
            return parts
          }

          // User / assistant bubble.
          Rectangle {
            visible: !!msgCol.message
              && (msgCol.message.role === "user" || msgCol.message.role === "assistant")
            anchors { left: msgCol.left; right: msgCol.right }
            height: contentCol.implicitHeight + 2 * Style.spacing.md
            // User bubble = level 1 wash, assistant bubble = level 2 wash: a
            // reader can still tell whose turn a bubble is at a glance, while
            // both wear the active theme.
            color: msgCol.message && msgCol.message.role === "user"
              ? Util.alpha(Color.foreground, Palette.surfaceAlpha(1))
              : Util.alpha(Color.foreground, Palette.surfaceAlpha(2))

            Column {
              id: contentCol
              anchors {
                left: parent.left
                right: parent.right
                top: parent.top
                margins: Style.spacing.md
              }
              spacing: Style.spacing.sm

              Text {
                visible: msgCol.message && msgCol.message.role === "user"
                text: msgCol.message && msgCol.message.content ? msgCol.message.content : ""
                wrapMode: Text.Wrap
                font.family: Style.font.family
                font.pixelSize: Style.font.body
                color: Color.foreground
                anchors { left: parent.left; right: parent.right }
              }

              MarkdownBlock {
                visible: msgCol.message && msgCol.message.role === "assistant"
                text: msgCol.message && msgCol.message.content ? msgCol.message.content : ""
                anchors { left: parent.left; right: parent.right }
              }

              Repeater {
                model: msgCol.rehydrated
                delegate: ToolCard {
                  required property var modelData
                  // `String(x || "")` on every string-typed target: a
                  // rehydrated tool part carries only the fields the server
                  // stored, so `output` / `summary` are `undefined` on a call
                  // that produced neither, and QML refuses undefined for a
                  // `property string` — "Unable to assign [undefined] to
                  // QString", once per tool part, on every transcript load.
                  name: String(modelData.name || "")
                  // `id` is reserved (QML object identifier); pass via partId.
                  partId: String(modelData.id || "")
                  status: String(modelData.status || "")
                  input: modelData.input
                  output: String(modelData.output || "")
                  summary: String(modelData.summary || "")
                  turnActive: false
                  width: msgCol.width - 2 * Style.spacing.md
                }
              }
            }
          }

          // Bubble action bar (edit/regenerate/fork) on the LAST message.
          Row {
            visible: msgCol.modelData
              && msgCol.modelData.isLast
              && root.onEdit !== null
              && msgCol.message
              && msgCol.message.role === "user"
            spacing: Style.spacing.sm
            Button {
              text: "Edit"
              visible: root.onEdit !== null
              onClicked: if (root.onEdit) root.onEdit(msgCol.message)
            }
          }
          Row {
            visible: msgCol.modelData
              && msgCol.modelData.isLast
              && msgCol.message
              && msgCol.message.role === "assistant"
            spacing: Style.spacing.sm

            // Clipboard sink for the Copy button. Same mechanism as
            // components/CodeBlock.qml:57-65 — Qt Quick has no portable
            // clipboard helper, so a hidden TextEdit IS the clipboard.
            // `selectAll()` + `copy()` writes the selected text to the
            // system clipboard; `text` is bound to the message body so
            // `selectAll()` always copies the full content.
            TextEdit {
              id: copySink
              visible: false
              width: 0
              height: 0
              text: msgCol.message && msgCol.message.content
                ? String(msgCol.message.content)
                : ""
            }

            Button {
              text: copyFeedback.running ? "copied!" : "Copy"
              visible: true
              // Replace the inline `visible: ...` of the Edit/Regenerate
              // row above: this button is enabled whenever the action
              // bar shows, because copying a transcript row never has a
              // missing handler. The transient label swap is the
              // codebase convention for "feedback that something fired"
              // (see CodeBlock's copy label for the same intent).
              Timer {
                id: copyFeedback
                interval: 1200
                repeat: false
                running: false
              }
              onClicked: {
                copySink.selectAll()
                copySink.copy()
                copyFeedback.restart()
              }
            }

            // Speak-this-message. Same gating convention as onEdit /
            // onRegenerate / onFork — a button whose action nobody
            // handles must not be enabled, so visibility is driven by
            // `speakEnabled` (the host flips it true once it has
            // connected speakRequested to TtsStore.speakMessage). The
            // signal is declared on the root with the exact shape the
            // integration owner wires: `speakRequested(var messageId,
            // string text)`.
            Button {
              text: "Speak"
              visible: root.speakEnabled
              onClicked: root.speakRequested(
                msgCol.message && msgCol.message.id !== undefined
                  ? msgCol.message.id
                  : null,
                msgCol.message && msgCol.message.content
                  ? String(msgCol.message.content)
                  : ""
              )
            }

            Button {
              text: "Regenerate"
              visible: root.onRegenerate !== null
              onClicked: if (root.onRegenerate) root.onRegenerate(msgCol.message)
            }
            Button {
              text: "Fork"
              visible: root.onFork !== null
              onClicked: if (root.onFork) root.onFork(msgCol.message)
            }
          }
        }
      }

      Component {
        id: streamingComp
        // Live stream — render each part by kind. We split tool groups via
        // lib/streamParts.groupTasks and render task groups as a column.
        Column {
          id: stCol
          spacing: Style.spacing.md

          // Same reason as msgCol above: a Loader's sourceComponent does not
          // receive `modelData`.
          readonly property var modelData: rowLoader.modelData

          property var partsArr: modelData ? modelData.parts : []
          property var grouped: SP.groupTasks(partsArr || [])

          Repeater {
            model: stCol.grouped
            delegate: Loader {
              id: partLoader
              required property var modelData
              anchors { left: partLoader.parent ? partLoader.parent.left : undefined; right: partLoader.parent ? partLoader.parent.right : undefined }
              width: ListView.view ? ListView.view.width : 0

              sourceComponent: {
                var md = partLoader.modelData
                if (!md) return null
                if (md.type === "text") return textComp
                if (md.type === "thinking") return thinkingComp
                if (md.type === "tool") return toolComp
                if (md.type === "task_group") return taskGroupComp
                if (md.type === "tool_approval") return approvalComp
                if (md.type === "ask_user") return askComp
                if (md.type === "plan_approval_request") return planStripComp
                if (md.type === "mcp_status") return mcpComp
                if (md.type === "system_message") return sysComp
                if (md.type === "task_notification") return taskNotifComp
                if (md.type === "retry") return retryComp
                return null
              }

              Component {
                id: textComp
                MarkdownBlock {
                  text: partLoader.modelData ? (partLoader.modelData.content || "") : ""
                }
              }
              Component {
                id: thinkingComp
                ThinkingBlock {
                  visible: root.effectiveShowThinking
                  content: partLoader.modelData ? (partLoader.modelData.content || "") : ""
                  anchors { left: parent ? parent.left : undefined; right: parent ? parent.right : undefined }
                }
              }
              Component {
                id: toolComp
                ToolCard {
                  // Same coercion as the rehydrated delegate above: the
                  // ternary guards a null `modelData`, but a PRESENT part
                  // whose `output`/`summary` the server never stored still
                  // yields undefined, which a `property string` refuses.
                  name: String((partLoader.modelData && partLoader.modelData.name) || "")
                  // `id` is reserved; pass via partId.
                  partId: String((partLoader.modelData && partLoader.modelData.id) || "")
                  status: String((partLoader.modelData && partLoader.modelData.status) || "done")
                  input: partLoader.modelData ? partLoader.modelData.input : null
                  output: String((partLoader.modelData && partLoader.modelData.output) || "")
                  summary: String((partLoader.modelData && partLoader.modelData.summary) || "")
                  turnActive: true
                  width: ListView.view ? ListView.view.width : 0
                }
              }
              Component {
                id: taskGroupComp
                // A column of the grouped ToolCards. Each Task tool gets its
                // own ToolCard; the renderer collapses 2+ adjacent Tasks into
                // this group.
                Column {
                  spacing: Style.spacing.xs
                  anchors { left: parent ? parent.left : undefined; right: parent ? parent.right : undefined }
                  Repeater {
                    model: partLoader.modelData ? partLoader.modelData.items : []
                    delegate: ToolCard {
                      required property var modelData
                      name: String(modelData.name || "")
                      // `id` is reserved; pass via partId.
                      partId: String(modelData.id || "")
                      status: String(modelData.status || "")
                      input: modelData.input
                      output: String(modelData.output || "")
                      summary: String(modelData.summary || "")
                      turnActive: true
                      width: ListView.view ? ListView.view.width : 0
                    }
                  }
                }
              }
              Component {
                id: approvalComp
                ApprovalStrip {
                  approval: partLoader.modelData
                  store: root.store
                  width: ListView.view ? ListView.view.width : 0
                }
              }
              Component {
                id: askComp
                AskUserStrip {
                  askUser: partLoader.modelData
                  store: root.store
                  width: ListView.view ? ListView.view.width : 0
                }
              }
              Component {
                id: planStripComp
                PlanStrip {
                  approval: partLoader.modelData
                  store: root.store
                  width: ListView.view ? ListView.view.width : 0
                }
              }
              Component {
                id: mcpComp
                McpStatusRow {
                  mcp: partLoader.modelData
                  width: ListView.view ? ListView.view.width : 0
                }
              }
              Component {
                id: sysComp
                SystemMessageRow {
                  system: partLoader.modelData
                  width: ListView.view ? ListView.view.width : 0
                }
              }
              Component {
                id: taskNotifComp
                TaskNotificationRow {
                  task: partLoader.modelData
                  width: ListView.view ? ListView.view.width : 0
                }
              }
              Component {
                id: retryComp
                RetryBanner {
                  retry: partLoader.modelData
                  width: ListView.view ? ListView.view.width : 0
                }
              }
            }
          }

          // Stop button while streaming.
          Row {
            visible: root.store && root.store.streaming
            spacing: Style.spacing.sm
            Button {
              text: "Stop"
              onClicked: if (root.store) root.store.stop()
            }
          }
        }
      }

      Component {
        id: planComp
        PlanStrip {
          approval: rowLoader.modelData ? rowLoader.modelData.approval : null
          store: root.store
          width: ListView.view ? ListView.view.width : 0
        }
      }
    }
    // Follow the newest row. With the bottom-to-top origin above, "following"
    // is just "stay at the model's beginning", and index 0's edge needs no
    // estimate — so this is a position write with a fixed point, not a search.
    //
    // `atTail` is the USER'S intent, never a re-measurement of the current
    // offset. That distinction is load-bearing: the Electron front keeps
    // `isNearBottom` as a ref the user's own scrolls update
    // (src/renderer/components/chat/MessageList.tsx:207), so a growth burst asks
    // "was the user at the newest message BEFORE this grew?". Deriving the answer
    // from `contentY` instead cannot work, because contentY lags the content: at
    // the instant a delegate resolves its real height the view is not settled
    // yet, so a position-derived flag reads "the user scrolled away" and the list
    // stops following its own growth. An earlier version asked from
    // `onContentYChanged`, which fires for relayouts as much as for gestures.
    //
    // Qt already separates the two: `movementEnded` is raised only for real user
    // interaction — drag, flick, wheel — never for a programmatic position write
    // and never for a relayout. So the flag is written in exactly one place and
    // nothing else can falsify it, which also retires the `_settling` guard the
    // old version needed to keep its own scroll writes from being read as the
    // user leaving.
    property bool atTail: true

    onMovementEnded: {
      // `atYEnd` IS "showing the newest row": bottom-to-top puts model index 0
      // at the geometric bottom. Within one screen of it still counts, so a user
      // who scrolled up a couple of lines to finish a sentence still gets the
      // next reply.
      list.atTail = list.contentHeight <= list.height
        || list.atYEnd
        || list.contentY >= list.contentHeight + list.originY - list.height - 100
    }

    function _toTail() {
      if (!root.autoScroll) return
      // The user's intent gates the MOVE, not just the re-arm. Gating only the
      // re-arm left an in-flight burst dragging the view back for another ~1s
      // after the user had scrolled away, because each pass fires from the timer
      // and never re-read the flag.
      if (!list.atTail) return
      if (list.count === 0) return
      // The model's beginning, which bottom-to-top draws at the bottom of the
      // view. No `forceLayout()` and no clamp: there is nothing to converge on,
      // because index 0's position does not depend on any unrealized row.
      list.positionViewAtBeginning()
    }

    // A single logical change is several events — the row appears, then its
    // markdown, then its action bar finish sizing. Each one can nudge the newest
    // row's own height, so re-assert the pin per event; the budget bounds a
    // pathological burst instead of letting it spin, and any new change refills
    // it.
    property int _tailPasses: 0
    readonly property int _tailPassCap: 12

    Timer {
      id: tailTimer
      interval: 90
      repeat: true
      running: list._tailPasses < list._tailPassCap
      onTriggered: {
        list._tailPasses += 1
        list._toTail()
      }
    }

    function _rearmTail() {
      list._tailPasses = 0
    }

    // Opening a conversation lands on its newest message, like Electron. The
    // conversation ID is what says "a different conversation", NOT `count === 0`:
    // the store replaces its whole `messages` array on every update, and a
    // count-based stand-in would re-enable following behind the user's back.
    readonly property var conversationId: root.store ? root.store.conversationId : null
    onConversationIdChanged: {
      list.atTail = true
      list._rearmTail()
    }

    onCountChanged: if (list.atTail) list._rearmTail()
    onContentHeightChanged: if (list.atTail) list._rearmTail()
    // Empty-state placeholder.
    Text {
      visible: list.count === 0
      anchors.centerIn: parent
      text: root.surface === "quick"
        ? "Quick chat — type a message below"
        : "Send a message to start the conversation"
      color: Color.muted
      opacity: 0.6
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
    }
  }
}
