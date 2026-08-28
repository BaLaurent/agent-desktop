import QtQuick
import QtQuick.Layouts

import qs.Commons

pragma ComponentBehavior: Bound

// The single composed chat surface. Drop ONE into the app window and ONE
// into the quick-chat overlay; both share this implementation.
//
//   - ChatView receives the ChatStore and SettingsStore, plus `compact`
//     (true in the overlay: hides the status line and sidebar affordances)
//     and `surface` ("window" | "quick") for context.
//
// All store references are nullable. Before the bridge authenticates the
// service has not instantiated them, and the Loader in App.qml passes
// `null` for a brief construction window. Required properties that are
// momentarily null are a hard error in a Loader sourceComponent, so the
// store / settingsStore / conversationsStore properties are declared as
// nullable and every use is guarded. Behaviour:
//   - null store: the input is disabled, MessageList renders an empty
//     state, the strips/components do not mount.
//   - null settingsStore: defaults to empty for every read.
//   - null conversationsStore: per-conversation ai_overrides lookups
//     return the global default.
//
// Main wires:
//   - store.load(id) when the active conversation changes
//   - applyTranscript(text) -> called by App.qml for the ACTIVE surface
//   - store.turnEnded -> Main wires notify-send
Item {
  id: root

  property var store: null
  property var settingsStore: null
  // conversationsStore (Phase 3) — passed in so StatusLine + AuthBanner can
  // read per-conversation ai_overrides and persist new ones. Nullable for
  // the same reason as the other stores.
  property var conversationsStore: null

  // Phase 8 — voice capture + TTS. Nullable so QML tests and the overlay
  // can construct ChatView without these stores being instantiated yet.
  property var voiceStore: null
  property var ttsStore: null

  // Optional helper from Main.
  property var onDismiss: null

  property bool compact: false
  property string surface: "window"  // "window" | "quick"

  // Auth status from auth:getStatus. Null until the first call lands.
  property var authStatus: null

  // The plugin-local shell settings live on the service's rpc.setting(...)
  // path. Phase 8's transcript routing needs `voiceAutoSend`. We accept
  // the service's rpc object via the "serviceRpc" property (set by Main)
  // so QML tests can leave it null.
  property var serviceRpc: null

  // Effective settings the chat depends on.
  property string effectiveBackend:
    settingsStore ? settingsStore.get("ai_sdkBackend", "claude-agent-sdk") : ""
  property bool effectiveShowThinking:
    settingsStore ? settingsStore.get("ai_showThinking", "false") === "true" : false
  property string effectiveAgentName:
    settingsStore ? settingsStore.get("agent_name", "Agent") : "Agent"

  // The chat input instance, exposed as a property so the transcript
  // router can hand text to it without going through a signal that the
  // input component does not currently emit.
  property var chatInput: null

  // Forwarded to the textarea so the owning surface can put the caret in the
  // input as soon as it maps. Guarded: the Component child assigns
  // `root.chatInput` from its own onCompleted, so this is null for one tick.
  function focusInput() {
    if (root.chatInput && typeof root.chatInput.focusInput === "function") {
      root.chatInput.focusInput()
    }
  }

  // Forwarded so the owning surface can tell a successful focus from a
  // silently-dropped one.
  readonly property bool inputHasFocus: root.chatInput
    ? root.chatInput.inputHasFocus === true
    : false

  Component.onCompleted: {
    // Initial auth check (skipped if no store / no rpc yet).
    root._refreshAuth()
  }

  // Voice transcript routing, called BY THE HOST — this view does not
  // subscribe to `voiceStore.transcriptReady` itself.
  //
  // It used to, and `_bindVoiceStore` connected a fresh closure every time it
  // ran, in EVERY instance: the window and the quick-chat overlay both mount a
  // ChatView, so one dictation reached two subscribers and was sent twice —
  // measured live, "Quelle heure il est." dispatched once (streaming=false)
  // and then queued again (streaming=true), and the agent answered both.
  // App.qml owns cross-surface routing (CONTRACTS.md §2) and delivers the
  // transcript to the ACTIVE surface only.
  //
  // Two destinations per the `voiceAutoSend` plugin setting:
  //   "On"  (default) -> send immediately to the active conversation
  //   "Off"           -> put the text into the input field
  // Empty transcripts are NOT sent: Phase 8 fires transcriptReady on every
  // successful transcribe including the empty-text path (the documented
  // "nothing to say" signal), and a zero-length user message would be
  // a useless turn-start.
  function applyTranscript(text) {
    if (text === undefined || text === null) return
    var trimmed = String(text).trim()
    if (trimmed.length === 0) return
    if (!root.store) return
    var autoSend = "On"
    if (root.serviceRpc && typeof root.serviceRpc.setting === "function") {
      autoSend = String(root.serviceRpc.setting("voiceAutoSend", "On"))
    }
    if (autoSend === "On") {
      root.store.send(trimmed, [])
      return
    }
    // Manual mode — drop the text into the input field. The Component
    // child sets `root.chatInput = chatInput` from its onCompleted.
    if (root.chatInput && typeof root.chatInput.appendExternalText === "function") {
      root.chatInput.appendExternalText(trimmed)
    }
  }

  function _refreshAuth() {
    if (!root.store || !root.store.rpc) return
    root.store.rpc.invoke("auth:getStatus", [],
      function (result) {
        root.authStatus = result || { authenticated: false }
      },
      function () {
        root.authStatus = { authenticated: false, error: "auth:getStatus failed" }
      })
  }

  // Called by AuthBanner.
  function _recheckAuth() {
    if (!root.store || !root.store.rpc) return
    root.store.rpc.invoke("auth:login", [],
      function (result) { root.authStatus = result || { authenticated: false } },
      function (err) {
        root.authStatus = { authenticated: false, error: String(err) }
      })
  }

  // Derive effective auth gating: PI backend skips the gate entirely.
  property bool _authBlocks:
    root.store !== null
    && effectiveBackend !== "pi"
    && root.authStatus !== null
    && !root.authStatus.authenticated

  // cwd for slash commands + @-mentions: read from the active conversation
  // through the conversationsStore.
  property string _cwd: {
    if (!root.conversationsStore || !root.store) return ""
    var conv = root.conversationsStore.findById
      ? root.conversationsStore.findById(root.store.conversationId)
      : null
    return conv && conv.cwd ? conv.cwd : ""
  }

  property var _excludePatterns: {
    if (!settingsStore) return []
    try {
      var raw = settingsStore.get("files_excludePatterns", "")
      return raw ? JSON.parse(raw) : []
    } catch (e) { return [] }
  }

  Item {
    id: layout
    anchors.fill: parent

    // A ColumnLayout, not a Column, and that is the fix for "the newest message
    // is not visible".
    //
    // A Column is a positioner: it places children and reads their height, but
    // it never SIZES them. So the transcript had to compute its own height, and
    // the expression was
    //   layout.height - authBanner.height - inputArea.height - Style.spacing.md
    // which was wrong in both directions at once. It never subtracted
    // StatusLine — visible in the app window — so the stack overran the surface
    // by the status row's height and pushed the composer past the bottom edge;
    // and it DID subtract AuthBanner, which is `visible: false` for an
    // authenticated user and therefore already takes no space in a Column, so
    // the list gave away that many pixels for nothing as well. Either way the
    // bottom of the list was not where the user could see it, and MessageList's
    // tail-follow logic dutifully parked the newest message — and its action
    // bar — there.
    //
    // A ColumnLayout SIZES its children, so `Layout.fillHeight` on the
    // transcript is the remaining space by construction: there is no term left
    // to forget when a new row is added above the composer, which is exactly how
    // QueuePanel got left out of the old hand-maintained sum.
    ColumnLayout {
      anchors.fill: parent
      spacing: 0
      AuthBanner {
        id: authBanner
        Layout.fillWidth: true
        Layout.preferredHeight: implicitHeight
        // AuthBanner takes its own settingsStore reference; the property
        // being null is fine because every read inside it is guarded.
        settingsStore: root.settingsStore
        authStatus: root.authStatus
        on_RecheckRequested: root._recheckAuth()
      }

      // Sidebar / status affordances — only in the app window, not the
      // overlay. The renderer shows the status line above the input on
      // the full chat layout and omits it on the overlay.
      StatusLine {
        visible: !root.compact
        Layout.fillWidth: true
        Layout.preferredHeight: implicitHeight
        store: root.store
        settingsStore: root.settingsStore
        conversationsStore: root.conversationsStore
      }

      // The transcript takes whatever is left between the header rows and the
      // composer. `Layout.bottomMargin` is the gap the old height expression
      // subtracted by hand.
      MessageList {
        id: messageList
        Layout.fillWidth: true
        Layout.fillHeight: true
        Layout.bottomMargin: Style.spacing.md
        store: root.store
        compact: root.compact
        surface: root.surface
        effectiveBackend: root.effectiveBackend
        effectiveShowThinking: root.effectiveShowThinking
        effectiveAgentName: root.effectiveAgentName
        // The `autoScroll` setting existed and NOTHING read it: MessageList
        // positioned at the end unconditionally, so turning it off changed
        // nothing. Default "true" matches the server's own default.
        autoScroll: !root.settingsStore
          || root.settingsStore.get("autoScroll", "true") === "true"

        // Speak this message. `TtsStore.speakMessage` and the live
        // `tts:speakMessage` channel existed with no caller — the only TTS
        // affordance was a stop button for a state nothing could enter.
        // `speakEnabled` is the leaf's own guard against a dead control: it
        // stays false until a host actually connects the signal, which is
        // here.
        speakEnabled: root.ttsStore !== null
        onSpeakRequested: function (messageId, text) {
          if (!root.ttsStore || !root.conversationsStore) return
          var trimmed = String(text || "").trim()
          if (trimmed.length === 0) return
          root.ttsStore.speakMessage(trimmed,
            Number(root.conversationsStore.activeId || 0),
            Number(messageId || 0))
        }

        // MessageList ships an Edit/Regenerate/Fork bar on the last message,
        // but every button is gated on one of these callbacks being non-null
        // and NOTHING set them — so all three were permanently invisible and
        // `ChatStore.regenerate()` had no caller at all. The Electron front
        // has all three (pages/ChatView.tsx handleRegenerate / handleFork).
        onRegenerate: function (msg) {
          if (root.store) root.store.regenerate()
        }
        // Message-level fork. `ConversationsStore.fork` was reachable only
        // from ConversationRow, i.e. forking a whole conversation; forking AT
        // a message had no entry point.
        onFork: function (msg) {
          if (!root.conversationsStore || !msg) return
          root.conversationsStore.fork(root.conversationsStore.activeId, msg.id)
        }
        // Edit loads the message back into the composer and marks it as the
        // edit target; ChatInput then routes send() to `editMessage` instead
        // of `send`. Done there rather than here because ChatInput already
        // owns the send decision — splitting it would give two places that
        // decide what Enter means.
        onEdit: function (msg) {
          if (!msg || !root.chatInput) return
          root.chatInput.beginEdit(Number(msg.id), String(msg.content || ""))
        }
      }

      // Input area. Sized from the input's OWN content height, not a magic
      // constant: the previous `compact ? 80 : 120` under-allotted the real
      // ChatInput (a 3-row textarea plus the mic/Send row measures well past
      // 80 px), so in the quick overlay the input box drew past the bottom
      // edge of the card.
      // The input area IS a Column — no wrapper Item.
      //
      // It used to be `Item { height: <hand-maintained sum of children> }`,
      // which silently left the QueuePanel out of the total when that was
      // added. Deriving the Item's height from the Column instead produced a
      // BINDING LOOP (the Column anchors to the Item whose height the Column
      // decides), which QML resolves by handing out 0: measured `ia=0` while
      // `chatInput.height=84`, so the composer drew on top of the transcript
      // and clipped the last row's action bar.
      //
      // A Column is a positioner and already sizes ITSELF to its children, so
      // it needs no wrapper and no sum. It does NOT size its children, though
      // — each one carries `height: implicitHeight` below, which is why an
      // Item-rooted child like ChatInput would otherwise sit at height 0.
      Column {
        id: inputArea
        Layout.fillWidth: true
        Layout.preferredHeight: implicitHeight

          // No `visible` binding here on purpose. TtsIndicator owns its own
          // visibility (`visible: isSpeaking`) and hides itself while idle; a
          // second binding here made the row permanently visible and reduced the
          // component's own rule to dead code. An invisible item takes no space
          // in a Column, so nothing else has to know.
          TtsIndicator {
            width: inputArea.width
            height: implicitHeight
            store: root.ttsStore
          }

          // The queue, above the composer. `ChatStore.send()` has always
          // queued a message when a turn was streaming, but the only sign of
          // it was the words "queued: N" on the status row: the user could not
          // see what was queued, remove one, edit one, reorder, clear, or
          // pause. Electron has all six
          // (src/renderer/components/chat/QueuePanel.tsx). The panel hides
          // itself when the queue is empty, so it costs no space.
          QueuePanel {
            width: inputArea.width
            height: visible ? implicitHeight : 0
            store: root.store
          }

          ChatInput {
            id: chatInput
            width: inputArea.width
            // `height: implicitHeight` is REQUIRED, not redundant. A Column is
            // a positioner: it places children and reads their `height`, but
            // unlike a Layout it never SIZES them. An Item-rooted component
            // therefore sits at height 0 in a Column no matter what its
            // implicitHeight says — measured: `inputArea.h=0` while
            // `chatInput.implicitHeight=84`, so the composer drew over the
            // transcript and clipped the last row's action bar. The old
            // hand-maintained sum existed to work around exactly this; every
            // child in this Column now carries its own height instead, so a
            // new one cannot be silently left out of the total again.
            height: implicitHeight
            store: root.store
            settingsStore: root.settingsStore
            // Optional — the same VoiceStore wired in by Main. ChatInput only
            // uses it to mount the mic button and to show "listening…" /
            // "voix : <error>" on its status row; the transcript routing is
            // already done via App.qml routing to applyTranscript().
            voiceStore: root.voiceStore
            // Connection state lives on the RPC surface, not on the
            // ChatStore. Reading `store.connected` would evaluate to
            // undefined (ChatStore has no such property) and the input
            // would be permanently disabled — the documented
            // `property var` traps `undefined` into a silent fail.
            disabled: root._authBlocks
              || !root.store
              || !root.store.rpc
              || !root.store.rpc.connected
            onDismiss: root.onDismiss

            Component.onCompleted: {
              // Expose ourselves so the transcript router can find us. Without
              // this, `_onTranscript` cannot reach appendExternalText(), so
              // voiceAutoSend="Off" silently drops every dictation, and
              // `focusInput()` no-ops so the caret never lands in the input.
              root.chatInput = chatInput
              // Pull cwd + exclude patterns from the conversation, which is
              // what makes @-mentions and slash commands resolve at all.
              chatInput.setCwd(root._cwd, root._excludePatterns)
            }
          }

          // Switching conversation changes `_cwd`, and mentions/slash commands
          // are scoped to it. A mount-time setCwd() alone leaves them pointed
          // at whichever conversation happened to be active when the view was
          // first shown — the same class of staleness Service.qml calls out
          // for the Files and Git panes.
          Connections {
            target: root
            function on_CwdChanged() {
              if (root.chatInput) root.chatInput.setCwd(root._cwd, root._excludePatterns)
            }
          }
        }
    }
  }
}
