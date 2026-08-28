pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui

import "lib/surface.js" as Surface
import "components"

// The plugin's panel entry point, and the whole front end.
//
// Two windows, one shown at a time, chosen by the payload `open()` receives:
//
//   FloatingWindow  the app window that replaces the Electron window. Hyprland
//                   treats it as an ordinary toplevel, so it tiles, alt-tabs
//                   and can be left open.
//   PanelWindow     the quick-chat overlay: layer shell, exclusive keyboard
//                   focus, dismissed by Escape or a click on the scrim.
//
// No durable state lives here. `manifest.keepLoaded` keeps the Loader active so
// the window survives being closed, but everything worth keeping is in the
// service's stores — so if the shell ever destroys this item anyway, the
// rebuilt window reconstructs from store state instead of losing it.
Item {
  id: root

  // Injected by the shell's panel Loader (shell.qml onLoaded). `opened` is read
  // back by shell.isPluginOpen (shell.qml:506).
  property var shell: null
  property var manifest: null
  property var service: null
  property bool opened: false

  // Which of the two windows is showing. Only open() writes it.
  property string surface: "window"

  readonly property string pluginId: manifest && manifest.id
    ? String(manifest.id) : "agent-desktop"

  // Which full-width page the app window is showing: "chat", "scheduler" or
  // "settings". The chat surface is the default and the quick overlay is always
  // chat, so this only ever changes in the app window.
  property string view: "chat"

  // An omp extension may set the window title through `pi:uiEvent setTitle`.
  // Empty means "use the plugin's own title".
  property string extensionTitle: ""

  // The active conversation's working directory. The Files and Git panes are
  // scoped to it, which is what makes them "this conversation's files" rather
  // than a filesystem browser bolted onto a chat client.
  readonly property string activeCwd: service && service.conversationsStore
    ? String(service.conversationsStore.activeCwd || "")
    : ""

  // ---- sidebar collapse state --------------------------------------------
  //
  // The sidebar's `visible` is `!root.sidebarCollapsed`; the panel's left
  // anchor gives the slack when it's open and yields when it's not. The state
  // is persisted via SettingsStore.set("sidebar_collapsed", ...) — the local
  // optimistic write snaps the UI immediately, the server write survives a
  // shell restart, and on next load SettingsStore.loaded triggers a restore
  // from the same key.

  property bool sidebarCollapsed: false

  function setSidebarCollapsed(v) {
    sidebarCollapsed = v
    // settingsStore.set refuses unknown keys; "sidebar_collapsed" must be
    // whitelisted server-side (see src/core/services/settings.ts:132). The
    // write is best-effort: a refusal is logged on `error`, never thrown,
    // so the in-memory flip sticks even if persistence fails.
    if (service && service.settingsStore) {
      service.settingsStore.set("sidebar_collapsed", v ? "true" : "false")
    }
  }
  // Restore the persisted collapse state once SettingsStore has loaded.
  // `_settingsKey` is the store itself, null until the shell injects it;
  // a 250 ms Timer polls while the wiring is missing or the store has not
  // finished loading. Either path writes `sidebarCollapsed` from the
  // persisted value.
  //
  // (`Connections.target` is a property, not a signal — `onTargetChanged`
  // is silently ignored, so we cannot rely on the target flipping null → store
  // to fire anything. The Timer is the second-best option: low cost, only
  // runs while the store is unwired, never after `_settingsReady` is true.)
  // One-shot recovery probe. `Qt.callLater` re-schedules itself recursively
  // until the store is loaded, then writes `sidebarCollapsed` from the
  // persisted value. The probe only schedules the next call if the store
  // is not yet loaded — once the value is set, the loop ends.
  //
  // Why `Qt.callLater` instead of a Timer or `Connections.onLoadedChanged`:
  //   - Timer's `running` binding has subtle re-evaluation edge cases when
  //     multiple properties flip in quick succession during plugin warm-up.
  //   - `Connections.target` is a property, not a signal — `onTargetChanged`
  //     is silently ignored. A late wire-up would therefore never trigger.
  //   - `Qt.callLater` always fires on the next event-loop tick, regardless
  //     of where the App item is in its lifecycle.
  readonly property var settingsTarget: root.service && root.service.settingsStore
    ? root.service.settingsStore
    : null
  property bool _settingsReady: false

  // The quick overlay has no sidebar, so nothing there ever selects a
  // conversation — and `ChatStore.send()` returns silently when
  // `conversationId <= 0`. That is why typing in the overlay cleared the input
  // and produced no message: there was no conversation to send to.
  //
  // `ConversationsStore.ensureQuickChat(mode)` resolves (or pins) the right
  // one. It was fully implemented and unit-tested but had no production
  // caller. It MUST run after settings load: it reads the pinned id out of
  // `quickChat_conversationId`, and reading that before the store is loaded
  // sees empty and creates a fresh "Quick Chat" every single time — which is
  // exactly the trail of empty "Quick Chat" rows already in this database.
  property string _pendingQuickChatMode: ""

  function _resolveQuickChat() {
    if (root._pendingQuickChatMode.length === 0) return
    if (!root._settingsReady) return
    if (!root.service || !root.service.conversationsStore) return
    var mode = root._pendingQuickChatMode
    root._pendingQuickChatMode = ""
    root.service.conversationsStore.ensureQuickChat(mode)
  }

  function _probeSettings() {
    if (root._settingsReady) {
      root._resolveQuickChat()
      return
    }
    if (root.settingsTarget && root.settingsTarget.loaded === true) {
      root._settingsReady = true
      root.sidebarCollapsed =
        root.settingsTarget.get("sidebar_collapsed", "false") === "true"
      root._resolveQuickChat()
      return
    }
    Qt.callLater(root._probeSettings)
  }

  // The single root-level `Component.onCompleted`. QML permits exactly one per
  // object, and a second one is not an override — it is
  // "Property value set multiple times", which fails the whole FILE to load.
  // That took the entire front end down while every offscreen gate stayed
  // green, because App.qml imports Quickshell and so is excluded from the
  // component-compile gate. Add first-tick work here rather than declaring
  // another handler.
  Component.onCompleted: {
    Qt.callLater(root._probeSettings)
    Qt.callLater(root._resolveActiveInput)
  }

  function open(payload) {
    surface = Surface.surfaceFor(payload)
    opened = true
    // Opening the app is what brings the connection up. The service spawns its
    // bridge on demand rather than at login, and the stores only load once the
    // bridge authenticates — so without this the two wait on each other and
    // nothing ever connects.
    if (service && typeof service.connectNow === "function") service.connectNow()

    var voiceRequest = Surface.isVoiceRequest(payload)

    // Bind the overlay to a conversation before the user can type into it.
    // Queued rather than called: settings may still be loading, and the probe
    // above drains this the moment they land.
    if (surface === "quick") {
      root._pendingQuickChatMode = voiceRequest ? "voice" : "text"
      root._resolveQuickChat()
      if (root._pendingQuickChatMode.length > 0) Qt.callLater(root._probeSettings)
    }

    // A `mode:voice` summon is the keyboard toggle: the same key that opens
    // the overlay also flips the mic, so a second press during the capture
    // stops it. The store's `toggle()` is idempotent across "starting" and
    // "recording" states (see VoiceStore.qml).
    if (voiceRequest && service && service.voiceStore) {
      service.voiceStore.toggle()
    }
    Qt.callLater(root.focusSurface)
  }

  function dismiss() {
    // A voice capture is owned by the bridge, not the surface — closing the
    // overlay mid-dictation must drop the audio, not just hide the panel.
    if (service && service.voiceStore
        && (service.voiceStore.recording || service.voiceStore.starting)) {
      service.voiceStore.cancel()
    }
    opened = false
    if (shell && typeof shell.hide === "function") shell.hide(pluginId)
  }

  // Focusing the textarea is a race against the compositor: `open()` runs
  // before the window maps, and even `onVisibleChanged` fires before Hyprland
  // has activated the layer surface — `forceActiveFocus()` in either place is
  // a no-op, which left the overlay holding the keyboard and dropping every
  // key until the user clicked the input by hand.
  //
  // So focus is retried until it demonstrably took, rather than fired once and
  // hoped. `focusAttempts` bounds it so a surface that can never focus (no
  // chat view mounted, say) stops costing ticks.
  property int _focusAttempts: 0

  function focusSurface() {
    root._focusAttempts = 0
    focusRetry.restart()
  }

  // The attach button in ChatInput emits a signal that cannot bubble
  // through ChatView (we do not own ChatView.qml). Subscribe to it on
  // whatever ChatInput is currently live — `Connections` is the QML
  // pattern for listening to a signal on an object held only through a
  // property reference.
  //
  // `_activeInput` is a polled read rather than a tracked binding:
  // ChatView assigns `chatInput` from a child's `onCompleted`, and QML
  // cannot observe the assignment (no signal). A `Qt.callLater` probe
  // resolves the input on the next tick and again whenever the visible
  // surface flips, and `Connections` re-binds to the result.
  property var _activeInput: null

  function _resolveActiveInput() {
    var page = root._activeChatView()
    root._activeInput = (page && page.chatInput) ? page.chatInput : null
  }

  // Re-poll whenever the visible surface flips. The root
  // `Component.onCompleted` above covers the first tick; these cover the rest.
  onSurfaceChanged: Qt.callLater(root._resolveActiveInput)
  // `view` is read inside `_activeChatView()`; surface flips are also
  // driven by `open()`, which sets `view` indirectly only via the rail.
  // Track the rail state too so a switch from chat to settings to chat
  // re-resolves the input.
  onViewChanged: Qt.callLater(root._resolveActiveInput)

  // One more probe for the case where the user is on chat when App loads
  // but ChatView's child hasn't run `onCompleted` yet.
  //
  // Bounded twice over, because `running: _activeInput === null` alone spins
  // at 10 Hz forever on every surface that legitimately has NO chat input
  // (Settings, Files, Git, Scheduler): it can never resolve there, so the
  // "until it resolves" condition is never satisfied.
  //   - gated on a surface that actually hosts a ChatView, and
  //   - capped, so a genuinely broken mount stops costing ticks.
  property int _inputProbeAttempts: 0
  readonly property bool _surfaceHasChatInput:
    root.opened && (root.surface === "quick" || root.view === "chat")

  on_SurfaceHasChatInputChanged: root._inputProbeAttempts = 0

  Timer {
    id: attachResolveProbe
    interval: 100
    repeat: true
    running: root._activeInput === null
            && root._surfaceHasChatInput
            && root._inputProbeAttempts < 30
    onTriggered: {
      root._inputProbeAttempts += 1
      root._resolveActiveInput()
    }
  }

  function _handleAttachRequested() {
    if (!root.service) return
    // Out of process, because the Qt.labs.platform dialog this replaced
    // segfaulted the entire Quickshell process — see components/FilePicker.qml
    // for the backtrace. Two earlier faults also lived here and each produced
    // a button that did nothing: `root.attachDialog` (an id is not a property
    // of App, so the whole function threw) and `currentFile = null` (a QUrl
    // refuses null). Both are gone with the dialog.
    attachPicker.open()
  }

  // A chosen file may be unsupported by the backend or unreadable. The
  // bridge returns a structured error; surface it via notify-send the
  // same way the export-error path does. A successful info reply is
  // pushed straight into the active ChatInput through `addAttachment()`.
  function _processAttachPath(path) {
    if (!path) return
    var input = root._activeInput
    if (!input || typeof input.addAttachment !== "function") return
    if (!root.service || typeof root.service.invoke !== "function") return
    root.service.invoke("attachments:getInfo", [path],
      function (info) {
        if (!info) return
        // `path` comes from the PICK, not from `info`. Measured reply shape:
        //   {"name":"x.png","size":1013097,"type":"image/png"}
        // — no `path` field. Reading `info.path` produced `undefined`, and
        // `ChatInput.addAttachment` rejects a pathless attachment on its
        // first line, so every pick was dropped in silence: the picker
        // closed, nothing appeared, nothing was logged.
        var payload = {
          name: info.name,
          path: path,
          type: info.type,
          size: info.size
        }
        input.addAttachment(payload)
      },
      function (err) {
        Quickshell.execDetached([
          "notify-send", "-a", "Agent Desktop", "-u", "critical",
          "Attach failed", String(err)
        ])
      }
    )
  }

  // Rebinds to whichever ChatInput is live. When `_activeInput` flips
  // from null to a ChatInput, the new `onAttachRequested` handler kicks
  // in — a `Connections` is the only way to subscribe to a signal on an
  // object held through a property reference.
  Connections {
    target: root._activeInput
    ignoreUnknownSignals: true
    function onAttachRequested() { root._handleAttachRequested() }
  }


  // The ONE subscriber to voice transcripts.
  //
  // ChatView used to subscribe itself, and there are two of them — the window
  // and the quick-chat overlay — so a single dictation was delivered twice and
  // sent twice. Measured live: "Quelle heure il est." dispatched once
  // (streaming=false) then queued again (streaming=true), and the agent
  // answered both. Worse, ChatView's binder reconnected on every
  // `voiceStore` change without ever disconnecting, so the count could grow.
  //
  // Routing belongs here: App.qml already resolves which surface is active
  // (CONTRACTS.md §2), and the transcript must land where the user is looking.
  Connections {
    target: root.service ? root.service.voiceStore : null
    ignoreUnknownSignals: true
    function onTranscriptReady(text) {
      var view = root._activeChatView()
      if (!view || typeof view.applyTranscript !== "function") return
      view.applyTranscript(text)
    }
  }

  function _activeChatView() {
    if (root.surface === "quick") return quickChat
    if (root.view !== "chat") return null
    return windowContent.item
  }

  function _tryFocus() {
    if (root.surface === "quick") quickChat.forceActiveFocus()
    else windowBody.forceActiveFocus()

    var page = root._activeChatView()
    if (!page || typeof page.focusInput !== "function") return true  // nothing to focus
    page.focusInput()
    return page.inputHasFocus === true
  }

  Timer {
    id: focusRetry
    interval: 60
    repeat: true
    running: false
    onTriggered: {
      root._focusAttempts += 1
      if (root._tryFocus() || root._focusAttempts >= 25) focusRetry.stop()
    }
  }

  // ---- shared chrome ------------------------------------------------------

  readonly property color dotColor: {
    if (!service) return Color.urgent
    if (!service.bridgeAlive) return Color.urgent
    if (!service.serverUp) return Color.urgent
    return service.connected ? Color.accent : Color.muted
  }

  readonly property string connectionLabel: {
    if (!service) return "no service"
    if (!service.bridgeAlive) return "bridge down"
    if (!service.serverUp) return "server down"
    if (!service.connected) return "connecting…"
    return "connected"
  }

  // The model actually in effect, read from the global settings map. A
  // per-conversation override lands on top of this once a conversation is
  // selected (Phase 2).
  readonly property string modelLabel: {
    if (!service || !service.settingsStore) return ""
    return service.settingsStore.get("ai_model", "")
  }

  readonly property string backendLabel: {
    if (!service || !service.settingsStore) return ""
    return service.settingsStore.get("ai_sdkBackend", "")
  }

  // ---- the app window -----------------------------------------------------

  FloatingWindow {
    id: appWindow
    visible: root.opened && root.surface === "window"
    title: root.extensionTitle.length > 0
      ? "Agent Desktop — " + root.extensionTitle
      : "Agent Desktop"
    color: Color.background
    implicitWidth: 1200
    implicitHeight: 800
    minimumSize: Qt.size(760, 520)

    // `visible` is a one-way binding on purpose. An `onVisibleChanged` handler
    // that called dismiss() when the window went invisible was tried and is
    // wrong twice over: Quickshell emits visibleChanged while the backing window
    // is still being brought up, so the handler dismissed the window on its own
    // first show; and it is unnecessary, because Quickshell's FloatingWindow
    // does not act on an xdg close request — measured with `hyprctl dispatch
    // killactive`, the window stays mapped and `visible` stays true. So there is
    // no imperative write to reconcile, and `opened` has exactly one writer.
    //
    // Focusing on show IS safe and necessary, for the same mapping-order
    // reason as the overlay below: open() runs focusSurface() before this
    // window exists, so the caret never landed in the chat input. This handler
    // only ever focuses — it never writes `opened`.
    onVisibleChanged: if (visible) Qt.callLater(root.focusSurface)

    Rectangle {
      anchors.fill: parent
      color: Color.background

      // Three regions that must share one row: the sidebar toggle plus
      // connection state, the view rail, and the backend/model readout. They
      // were anchored independently (left / centerIn / right), which reads fine
      // at 1900 px and overlaps into illegibility at 900 — so the width is
      // arbitrated explicitly instead. The rail gets the slack, and the readout
      // yields first because it is the only purely informational part.
      RowLayout {
        id: windowHeader
        anchors { top: parent.top; left: parent.left; right: parent.right }
        anchors.margins: Style.spacing.md
        height: Style.bar.sizeHorizontal
        spacing: Style.spacing.md

        Row {
          id: headerLeft
          Layout.alignment: Qt.AlignVCenter
          spacing: Style.spacing.md

          // The sidebar toggle is permanent: above the overlay threshold it
          // collapses the sidebar (the layout stays valid; the chat fills the
          // gap), below the threshold it pushes the overlay closed. Either
          // way, the button label reflects what a press will do.
          Button {
            anchors.verticalCenter: parent.verticalCenter
            text: root.sidebarCollapsed ? "Conversations" : "Hide list"
            onClicked: root.setSidebarCollapsed(!root.sidebarCollapsed)
          }

          Rectangle {
            width: Style.spacing.lg
            height: Style.spacing.lg
            radius: width / 2
            anchors.verticalCenter: parent.verticalCenter
            color: root.dotColor
          }

          Text {
            anchors.verticalCenter: parent.verticalCenter
            font.family: Style.font.family
            font.pixelSize: Style.font.body
            color: Color.foreground
            // The dot already carries the state; the word is the nicety that
            // goes first when the row is tight.
            text: root.connectionLabel
          }
        }

        // The view rail. `view` is the single owner of which page is showing.
        // Clipped rather than wrapped: a rail that reflows onto two lines would
        // change the header's height and push the whole body down.
        Item {
          Layout.fillWidth: true
          Layout.alignment: Qt.AlignVCenter
          Layout.fillHeight: true
          clip: true

          Row {
            id: viewRail
            anchors.centerIn: parent
            spacing: Style.spacing.sm

            Repeater {
              model: [
                { key: "chat", label: "Chat" },
                { key: "files", label: "Files" },
                { key: "git", label: "Git" },
                { key: "notebook", label: "Notebook" },
                { key: "openscad", label: "OpenSCAD" },
                { key: "scheduler", label: "Scheduler" },
                { key: "settings", label: "Settings" }
              ]
              delegate: Button {
                id: viewButton
                required property var modelData
                text: viewButton.modelData.label
                selected: root.view === viewButton.modelData.key
                onClicked: root.view = viewButton.modelData.key
              }
            }
          }
        }

        Text {
          Layout.maximumWidth: Math.max(0, windowHeader.width * 0.25)
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
          opacity: 0.7
          color: Color.foreground
          elide: Text.ElideRight
          // Hidden rather than squeezed once the rail needs the room: this is
          // the same information the Settings page shows in full.
          visible: windowHeader.width > viewRail.implicitWidth + headerLeft.implicitWidth + implicitWidth + 3 * Style.spacing.md
          text: root.backendLabel.length > 0
            ? root.backendLabel + " · " + root.modelLabel
            : ""
        }
      }

      PanelSeparator {
        id: windowRule
        anchors { top: windowHeader.bottom; left: parent.left; right: parent.right }
        anchors.topMargin: Style.spacing.md
      }

      // Three regions: navigation (sidebar), the chat content, and whichever
      // full-width page the rail has selected. `view` is the only thing that
      // decides which of the latter two is showing.
      Item {
        id: windowBody
        anchors {
          top: windowRule.bottom
          left: parent.left
          right: parent.right
          bottom: parent.bottom
        }
        anchors.margins: Style.spacing.panelPadding
        focus: true

        // Below 720 px the sidebar overlays the content instead of pushing it.
        // One discrete mode; the single Sidebar component chooses its own
        // positioning below that threshold.
        readonly property bool sidebarOverlays: width < 720

        // The sidebar — always the same component, only its placement changes.
        // Above 720 it pushes the content (anchored to sidebar.right); below
        // it covers it (anchored to parent.left, with a dimming veil that
        // catches the outside-click-to-dismiss).
        Sidebar {
          id: sidebar
          anchors { top: parent.top; bottom: parent.bottom; left: parent.left }
          width: 280
          visible: !root.sidebarCollapsed
          z: 2
          store: root.service ? root.service.conversationsStore : null
          // Step 4 — wire the signals Sidebar emits. Both previously had
          // no listener: importing JSON or exporting Markdown would do
          // nothing. The dialogs live here because they need Qt.labs.platform,
          // which a leaf component may not import (CONTRACTS.md §2).
          onOpenImportPicker: importPicker.open()
          onOpenExportPicker: function(conversationId, format) {
            root.exportConversationId = conversationId
            root.exportFormat = format
            exportPicker.open()
          }
        }

        // The dimming veil in overlay mode — only mounted while the sidebar
        // is showing AND covering the content. Above 720 px the sidebar
        // pushes, not overlays, so the veil would be wrong; the conditional
        // `visible` keeps it inert.
        MouseArea {
          anchors.fill: parent
          z: 1
          visible: sidebar.visible && windowBody.sidebarOverlays
          onClicked: root.setSidebarCollapsed(true)
        }

        Loader {
          id: windowContent
          anchors {
            top: parent.top
            bottom: parent.bottom
            right: parent.right
          }
          anchors.left: (sidebar.visible && !windowBody.sidebarOverlays)
            ? sidebar.right
            : parent.left
          anchors.leftMargin: (sidebar.visible && !windowBody.sidebarOverlays)
            ? Style.spacing.panelGap
            : 0
          sourceComponent: {
            if (root.view === "settings") return settingsPage
            if (root.view === "scheduler") return schedulerPage
            if (root.view === "files") return filesPane
            if (root.view === "git") return gitPane
            if (root.view === "notebook") return notebookPane
            if (root.view === "openscad") return openScadPage
            return chatSurface
          }
        }

        Component {
          id: chatSurface
          ChatView {
            store: root.service ? root.service.chatStore : null
            settingsStore: root.service ? root.service.settingsStore : null
            conversationsStore: root.service ? root.service.conversationsStore : null
            voiceStore: root.service ? root.service.voiceStore : null
            ttsStore: root.service ? root.service.ttsStore : null
            // ChatView reads `voiceAutoSend` via serviceRpc.setting(); without
            // this wire the property is null and the setting silently falls
            // back to "On" — a quiet bug that surfaces when a user has set
            // it to "Off" and sees dictation auto-submit anyway.
            serviceRpc: root.service
            compact: false
            surface: "window"
            // The app window had NO close path at all without this wire.
            // Quickshell's FloatingWindow ignores an xdg close request (measured
            // with `killactive` — see the comment on `appWindow`), and neither
            // `omarchy-shell shell toggle agent-desktop` nor the `hide` IPC verb
            // reaches `dismiss()`: toggle re-summons and `hide` only lowers the
            // shell's panel wrapper, leaving `opened` true and the window mapped.
            // So the only writer of `opened = false` is this callback, and the
            // overlay was the only surface that passed it. Escape now closes the
            // window exactly as it closes the overlay, via the same
            // ChatInput.onDismiss path that already unwinds an edit and stops a
            // running turn first.
            onDismiss: root.dismiss
          }
        }

        Component {
          id: schedulerPage
          SchedulerPage {
            store: root.service ? root.service.schedulerStore : null
          }
        }

        Component {
          id: settingsPage
          SettingsPage {
            settingsStore: root.service ? root.service.settingsStore : null
            rpc: root.service
            manifest: root.manifest
            // The one Quickshell dependency the settings tree needs, injected
            // rather than imported so every settings component stays loadable by
            // qmltestrunner (CONTRACTS.md §2). App.qml is a window, so it may
            // import Quickshell; a leaf component may not.
            execOpen: function(argv) { Quickshell.execDetached(argv) }
            mcpStore: root.service ? root.service.mcpStore : null
            toolsStore: root.service ? root.service.toolsStore : null
            knowledgeStore: root.service ? root.service.knowledgeStore : null
            macrosStore: root.service ? root.service.macrosStore : null
            shortcutsStore: root.service ? root.service.shortcutsStore : null
            ttsStore: root.service ? root.service.ttsStore : null
          }
        }

        // Both panes are scoped to the active conversation's cwd — that is what
        // makes "the files" and "the repo" mean something rather than being a
        Component {
          id: filesPane
          FilesPane {
            store: root.service ? root.service.filesStore : null
            gitStore: root.service ? root.service.gitStore : null
            cwd: root.activeCwd
            onChangeCwdRequested: root.openCwdPicker()

            // FileTree emits intent; the pane bubbles it here. Three of these
            // go BACK into the store rather than shelling out directly,
            // because the store re-emits them as `revealRequested` /
            // `openExternalRequested` / `trashRequested` and Service.qml is
            // the documented single place that runs a host command
            // ("stores raise a signal; the shelling out happens here, once").
            // Bypassing that seam here would give two places that spawn
            // processes.
            onRevealRequested: function (p) {
              if (root.service && root.service.filesStore) root.service.filesStore.revealInFileManager(p)
            }
            onOpenExternalRequested: function (p) {
              if (root.service && root.service.filesStore) root.service.filesStore.openExternal(p)
            }
            onTrashConfirmed: function (p) {
              if (root.service && root.service.filesStore) root.service.filesStore.trash(p)
            }
            // Not a host command: `files:openTerminalHere` is a server RPC,
            // so it goes straight through without the signal detour.
            onOpenTerminalRequested: function (p) {
              if (root.service && root.service.filesStore) root.service.filesStore.openTerminalHere(p)
            }
          }
        }

        Component {
          id: gitPane
          GitPane {
            // The store is cwd-scoped and Service.qml re-scopes it whenever the
            // active conversation (or its cwd) changes, so the pane only reads.
            store: root.service ? root.service.gitStore : null
            onChangeCwdRequested: root.openCwdPicker()
          }
        }

        Component {
          id: notebookPane
          NotebookPane {
            store: root.service ? root.service.jupyterStore : null
            // A leaf pane may not spawn a host dialog (CONTRACTS.md §2), and
            // the one it used to own crashed the shell. App.qml picks.
            onOpenRequested: notebookPicker.open()
          }
        }

        Component {
          id: openScadPage
          OpenScadPage {
            store: root.service ? root.service.openScadStore : null
            onOpenScadRequested: scadPicker.open()
            onExportStlRequested: {
              if (!root.service || !root.service.openScadStore) return
              // Seed the save dialog beside the source, with the right suffix.
              stlPicker.startPath = String(root.service.openScadStore.scadPath || "")
                .replace(/\.scad$/, ".stl")
              stlPicker.open()
            }
          }
        }
      }
    }
  }

  // ---- the quick-chat overlay --------------------------------------------

  PanelWindow {
    id: quickPanel
    visible: root.opened && root.surface === "quick"
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "agent-desktop-quickchat"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    // Focus on MAP, not on open(). `open()` defers focusSurface() by one tick
    // with Qt.callLater, but the layer surface is not mapped yet at that
    // point, and forceActiveFocus() on an item in an unmapped window is a
    // no-op. The result was an overlay that held the Wayland keyboard and
    // dropped every keystroke until the user clicked the textarea by hand.
    // Focus-only on purpose: an onVisibleChanged that ALSO dismissed is the
    // documented trap noted on the FloatingWindow above.
    onVisibleChanged: if (visible) Qt.callLater(root.focusSurface)

    Rectangle {
      // Quick-chat overlay. The dim uses the same `menu.scrim` token every
      // other Omarchy menu surface uses, so this plugin dims the desktop
      // exactly like the rest of the shell — and a user or theme can tune it
      // via `menu.scrim` + `menu.scrim-alpha` in shell.toml. The card's own
      // `Color.popups.border` is what separates it from the wallpaper.
      color: Color.menu.scrim
      // Qt's onClicked already requires the press AND the release to land here,
      // so a click that began on the card — or one that was in flight against
      // whatever was on screen before this surface mapped — cannot dismiss.
      MouseArea { anchors.fill: parent; onClicked: root.dismiss() }
    }

    BorderSurface {
      id: quickCard
      width: Math.min(1100, quickPanel.width - 2 * Style.gapsOut)
      height: Math.min(820, quickPanel.height - 2 * Style.gapsOut)
      radius: Style.cornerRadius
      anchors.horizontalCenter: parent.horizontalCenter
      y: Style.gapsOut
      color: Color.popups.background
      // Border.flat(), NOT a hand-rolled `({color, width})`: the shell's
      // Border helper reads `spec.widths.top`, so a scalar `width` key makes
      // `uniformWidth()` return 0 and the border silently never draws.
      borderSpec: Border.flat(Color.popups.border, 2)

      Item {
        id: quickHeader
        anchors { top: parent.top; left: parent.left; right: parent.right }
        anchors.margins: Style.spacing.md
        height: Style.bar.sizeHorizontal

        Row {
          anchors { left: parent.left; verticalCenter: parent.verticalCenter }
          spacing: Style.spacing.md

          Rectangle {
            width: Style.spacing.lg
            height: Style.spacing.lg
            radius: width / 2
            anchors.verticalCenter: parent.verticalCenter
            color: root.dotColor
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            font.family: Style.font.family
            font.pixelSize: Style.font.body
            color: Color.popups.text
            text: root.connectionLabel
          }
        }

        Text {
          anchors { right: parent.right; verticalCenter: parent.verticalCenter }
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
          opacity: 0.7
          color: Color.popups.text
          text: root.modelLabel
        }
      }

      // The same ChatView the app window uses, only compact: sidebar and view
      // rail omitted, transcript preloaded to the last `quickChatHistoryTurns`
      // messages. There is exactly one chat implementation — a divergence
      // between the overlay and the window would be a bug, not a variant.
      ChatView {
        id: quickChat
        anchors {
          top: quickHeader.bottom
          left: parent.left
          right: parent.right
          bottom: parent.bottom
        }
        anchors.margins: Style.spacing.panelPadding
        // No `focus: true` here on purpose. ChatView's textarea declares
        // `focus: true` itself, and two claimants in the same focus scope
        // fight: whichever is evaluated last wins, and when this Item won the
        // caret never reached the input.

        store: root.service ? root.service.chatStore : null
        settingsStore: root.service ? root.service.settingsStore : null
        conversationsStore: root.service ? root.service.conversationsStore : null
        voiceStore: root.service ? root.service.voiceStore : null
        serviceRpc: root.service
        compact: true
        surface: "quick"
        // Escape in the overlay stops a running turn first and otherwise
        // dismisses — root.dismiss() ALSO cancels any in-flight voice
        // capture, so the user can back out of a dictation without sending
        // it.
        onDismiss: root.dismiss
      }
    }
  }

  // ---- folder / file pickers ---------------------------------------------
  //
  // Leaf panes and the sidebar emit intent (`changeCwdRequested()`,
  // `openImportPicker()`, `openExportPicker(id, format)`) and cannot own these
  // dialogs themselves — Qt.labs.platform is a Quickshell-adjacent module that
  // a leaf store/component may not import. App.qml already imports everything
  // it needs; the dialogs live here and write back to the store on accept.

  property int exportConversationId: -1
  property string exportFormat: "markdown"

  // Point the ACTIVE conversation at a working directory. Until this existed
  // there was no way to set `cwd` anywhere in the plugin, which left the Files
  // pane stuck on "No cwd", the Git pane telling the user to "Set cwd to a
  // repo" with no means to do it, and @-mentions / slash commands unable to
  // resolve. The Electron front did this from ChatView.tsx:185
  // (`handleChangeCwd` -> system.selectFolder -> updateConversation).
  function openCwdPicker() {
    if (!root.service || !root.service.conversationsStore) return
    var id = Number(root.service.conversationsStore.activeId || 0)
    if (id <= 0) return
    cwdPicker.startPath = root.activeCwd.length > 0 ? root.activeCwd + "/" : ""
    cwdPicker.open()
  }

  // ---- pickers -------------------------------------------------------------
  //
  // All four of these were `Qt.labs.platform` FileDialog / FolderDialog, and
  // every one of them SEGFAULTED the whole Quickshell process — the user's
  // bar and every other plugin with it. See components/FilePicker.qml for the
  // measured backtrace. They run out of process now.

  FilePicker {
    id: cwdPicker
    mode: "folder"
    title: "Choose the conversation's working directory"
    onPicked: function (paths) {
      var path = paths.length > 0 ? paths[0] : ""
      if (!path) return
      if (!root.service || !root.service.conversationsStore) return
      var id = Number(root.service.conversationsStore.activeId || 0)
      if (id <= 0) return
      // `update()` is the generic row patch; the server broadcasts
      // conversations:refresh, which is what re-scopes the Files and Git
      // stores through Service.qml's onActiveCwdChanged.
      root.service.conversationsStore.update(id, { cwd: path })
    }
    onFailed: function (reason) { root._notifyPickerFailure(reason) }
  }

  FilePicker {
    id: importPicker
    mode: "open"
    title: "Import conversation"
    filters: ["Conversations | *.json"]
    onPicked: function (paths) {
      var path = paths.length > 0 ? paths[0] : ""
      if (!path || !root.service || !root.service.conversationsStore) return
      importReader.path = path
    }
    onFailed: function (reason) { root._notifyPickerFailure(reason) }
  }

  // FileView reads the file off disk. The store takes the raw text and
  // parses it (CONTRACTS.md §conversations-store).
  FileView {
    id: importReader
    onLoaded: {
      if (!root.service || !root.service.conversationsStore) return
      // text() is the whole file content; importJson parses.
      root.service.conversationsStore.importJson(text())
    }
  }

  FilePicker {
    id: exportPicker
    mode: "save"
    title: "Export conversation"
    filters: ["Markdown | *.md", "JSON | *.json"]
    onPicked: function (paths) {
      var path = paths.length > 0 ? paths[0] : ""
      if (!path || !root.service || !root.service.conversationsStore) return
      if (root.exportConversationId < 0) return
      root.service.conversationsStore.exportConversation(
        root.exportConversationId,
        root.exportFormat,
        function(content) {
          // Success: write the rendered Markdown to disk.
          exportWriter.path = path
          exportWriter.setText(content)
        },
        function(err) {
          // Surface the failure through notify-send (Service.notify_ already
          // honours notificationConfig).
          Quickshell.execDetached([
            "notify-send", "-a", "Agent Desktop", "-u", "critical",
            "Export failed", String(err)
          ])
        }
      )
    }
    onFailed: function (reason) { root._notifyPickerFailure(reason) }
  }
  FileView {
    id: exportWriter
    onLoaded: root.exportConversationId = -1
  }

  // Attachment picker. Multi-select because users routinely want to attach
  // several files at once; `attachments:getInfo` is invoked per file, so each
  // pick is independently validated before it lands in the chips row. A bad
  // pick is dropped (notify-send), good picks accumulate.
  //
  // The active ChatInput is read at pick time, not at open time, so an attach
  // started from the quick overlay still targets the overlay's input.
  FilePicker {
    id: attachPicker
    mode: "files"
    title: "Attach files"
    filters: [
      "Images | *.png *.jpg *.jpeg *.gif *.webp *.svg *.bmp",
      "Documents | *.pdf *.txt *.md *.json *.csv *.log",
      "All files | *"
    ]
    onPicked: function (paths) {
      for (var i = 0; i < paths.length; i++) root._processAttachPath(paths[i])
    }
    onFailed: function (reason) { root._notifyPickerFailure(reason) }
  }

  // One place for "the picker itself broke", so a missing zenity says so
  // instead of looking like a dead button.
  function _notifyPickerFailure(reason) {
    Quickshell.execDetached([
      "notify-send", "-a", "Agent Desktop", "-u", "critical",
      "File picker unavailable", String(reason)
    ])
  }

  FilePicker {
    id: notebookPicker
    mode: "open"
    title: "Open notebook"
    filters: ["Notebooks | *.ipynb"]
    onPicked: function (paths) {
      if (paths.length === 0 || !root.service || !root.service.jupyterStore) return
      root.service.jupyterStore.load(paths[0])
    }
    onFailed: function (reason) { root._notifyPickerFailure(reason) }
  }

  FilePicker {
    id: scadPicker
    mode: "open"
    title: "Open .scad"
    filters: ["OpenSCAD | *.scad"]
    onPicked: function (paths) {
      if (paths.length === 0 || !root.service || !root.service.openScadStore) return
      root.service.openScadStore.setScadPath(paths[0])
    }
    onFailed: function (reason) { root._notifyPickerFailure(reason) }
  }

  FilePicker {
    id: stlPicker
    mode: "save"
    title: "Export STL"
    filters: ["STL | *.stl"]
    onPicked: function (paths) {
      if (paths.length === 0 || !root.service || !root.service.openScadStore) return
      var store = root.service.openScadStore
      store.exportStl(store.scadPath, paths[0])
    }
    onFailed: function (reason) { root._notifyPickerFailure(reason) }
  }

  //
  // An extension can raise a dialog while either surface is showing, so the
  // modal is declared here on the root rather than inside a window: whichever
  // window is visible parents it, and neither can hide it.
  //
  // A dismissed dialog ALWAYS answers `cancelled:true` (PiUiStore guarantees
  // it) — without that reply the omp turn hangs until cancelPendingPIUI.
  PiUIModal {
    id: piModal
    store: root.service ? root.service.piUiStore : null
    parent: root.surface === "quick" ? quickPanel.contentItem : appWindow.contentItem
    anchors.fill: parent
    z: 1000
  }

  PiUIChrome {
    id: piChrome
    store: root.service ? root.service.piUiStore : null
    parent: root.surface === "quick" ? quickPanel.contentItem : appWindow.contentItem
    anchors.fill: parent
    z: 900
    // setTitle is a window concern, so the chrome asks rather than reaching.
    onTitleRequested: function(title) { root.extensionTitle = String(title || "") }
  }

}
