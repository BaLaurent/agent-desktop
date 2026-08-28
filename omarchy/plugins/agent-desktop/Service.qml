import QtQuick
import Quickshell
import Quickshell.Io
import "stores"
import "lib/notify.js" as Notify

// Service singleton. Three jobs, and nothing else:
//
//   1. own the stdio<->WS bridge child and its restart policy,
//   2. be the RPC surface — invoke(channel, args, onOk, onErr) plus
//      subscribe(channel, handler) — over the bridge's generic proxy framing,
//   3. host the stores, so their lifetime is the service's and the app window
//      can be destroyed and rebuilt without losing state.
//
// It knows no channel names. Every feature lives in a store under stores/ that
// takes `rpc: root`; adding a surface never edits this file's dispatcher.
//
// The omamail shape: invisible Item, all real work in properties/functions.
Item {
  id: root

  visible: false
  width: 0
  height: 0

  // Injected by the shell when the service singleton is constructed
  // (shell.qml ensureService). `settings` is NOT one of them -- the bar widget
  // pushes plugin settings across in pushSettings() because the shell hands
  // them to the bar widget, not to us.
  property var shell: null
  property var manifest: null
  property var pluginRegistry: null
  property var barWidgetRegistry: null
  property var omarchyPath: null

  readonly property string pluginId: manifest && manifest.id
    ? String(manifest.id) : "agent-desktop"
  readonly property string pluginDir: manifest && manifest.__sourceDir
    ? String(manifest.__sourceDir) : ""

  // ---- plugin-local settings (shell-side knobs, not agent.db settings) -----

  readonly property var defaultSettingValues: ({
    openOnClick: "Window",
    notifyWhenHidden: "On",
    voiceAutoSend: "On",
    quickChatHistoryTurns: 6
  })
  property var settings: defaultSettingValues

  function applySettings(next) {
    if (!next) return
    var merged = ({})
    for (var k in defaultSettingValues) merged[k] = defaultSettingValues[k]
    for (var n in next) {
      if (next[n] === undefined || next[n] === null) continue
      merged[n] = next[n]
    }
    if (JSON.stringify(merged) !== JSON.stringify(settings)) settings = merged
  }

  function setting(key, fallback) {
    if (settings && settings[key] !== undefined && settings[key] !== null) return settings[key]
    return fallback
  }

  // ---- connection state ---------------------------------------------------
  //
  // `bridgeAlive` is the single source of truth for "is the bridge child
  // actually alive?". It is true from the moment the bridge emits its first
  // `conn` line until the child exits. Before Step 1 there were two flags
  // — `bridgeUp` (last `conn` frame) and `bridgeAlive_` (stdin queue empty) —
  // and the two could disagree: the observed bug was the child dying without
  // `onExited` firing, leaving `bridgeUp=true` forever while the queue grew
  // for a child that was no longer there. One property now, driven by what we
  // actually observe (a live `conn` line).

  property bool serverUp: false
  property bool bridgeAlive: false
  property bool connected: false
  property string lastError: ""

  // ---- bridge child (stdio JSONL) -----------------------------------------
  //
  // Spawned ON DEMAND, never at shell startup. `running: true` used to spawn it
  // the moment the shell constructed the service — which, with a `service` kind,
  // is at login — so a node process sat there from boot even when nobody had
  // opened the plugin. `ensureBridge()` is called from the RPC entry points, so
  // the child appears the first time something actually needs the server (the
  // window opening, a store loading) and not before.
  //
  // `command` is a binding on `root.pluginDir`, which depends on `manifest` --
  // and `manifest` is null at createObject time (the shell injects it AFTER
  // createObject returns), so nothing may spawn until it arrives.

  // Set only during a real teardown. The onExited handler does NOT set it —
  // before Step 1 it did, which made a single crash block every reconnect for
  // the rest of the session. Now: a vanished child while the plugin is alive
  // is a recoverable condition, the declarative `running: true` brings it
  // back on its own, and `stopBridge()` is the only path that sets the flag.
  property bool shuttingDown: false

  // The public "bring the connection up" entry point: App.qml calls it when the
  // panel opens. Kept separate from `ensureBridge()` so the intent (a user
  // opened the app) reads differently from the mechanism (spawn if not running).
  function connectNow() {
    // Idempotent: a second openSurface (overlay quick → app window, say) must
    // not retrigger anything. ensureBridge is itself idempotent.
    // wantsBridge drives the reconnect watchdog — without raising it here,
    // a child that dies after connectNow returns will not be respawned.
    wantsBridge = true
    ensureBridge()
  }

  // Single spawn path. Forces a clean cycle so a crashed child that left
  function ensureBridge() {
    if (shuttingDown) return
    if (pluginDir.length === 0) return
    if (bridge.running) {
      // Running claim is no longer proof of life (see the bug Step 1 fixes).
      // If we have a `conn` line from the current child we trust it; otherwise
      // we cycle the process so a zombie child gets replaced.
      if (root.bridgeAlive) return
      bridge.running = false
    }
    bridge.running = true
  }

  function stopBridge() {
    shuttingDown = true
    bridgeRestart.stop()
    bridge.running = false
  }

  Component.onDestruction: stopBridge()

  Process {
    id: bridge
    command: ["node", root.pluginDir + "/bridge/bridge.built.mjs"]
    running: false
    stdinEnabled: true
    stdout: SplitParser { onRead: function(line) { root.onBridgeLine(line) } }
    stderr: SplitParser { onRead: function(line) { console.warn("agent-desktop bridge:", line) } }
    onExited: function(exitCode, exitStatus) {
      // The bridge child died. The declarative `running: true` above, plus the
      // Timer watchdog below, are what bring it back — DO NOT call
      // bridgeRestart.restart() here too, that double-restarts the process.
      //
      // `exitStatus` is `NormalExit` for a clean exit (0) and `CrashExit` for
      // anything else. Both clear liveness; reconnect is unconditional.
      root.serverUp = false
      root.connected = false
      root.bridgeAlive = false
      root.failAllPending("WebSocket disconnected")
      // Clear the queue too — anything queued was destined for the dead child.
      root.writeQueue_ = []
    }
  }

  // Watchdog timer: declarative restart while the plugin is alive. Started
  // (not onExited) so a vanished child that never emitted `onExited` still
  // gets restarted. The Timer is *only* the watchdog — the normal path is the
  // ever-running `bridge.running = true` binding (with its `bridgeAlive` guard).
  Timer {
    id: bridgeRestart
    interval: 2000
    running: root.shuttingDown === false
            && root.wantsBridge === true
            && root.bridgeAlive === false
            && bridge.running === true
    repeat: false
    onTriggered: {
      // The Process's `running` is still true but no `conn` arrived in 2s —
      // cycle it and let the binding bring it back.
      bridge.running = false
      bridge.running = true
    }
  }

  // True once anything has asked for the server this session. The bridge stays
  // running only as long as something wants it: `connectNow` raises it, the
  // IpcHandler `hide` verb lowers it. A transient crash still reconnects
  // because `wantsBridge` only resets when the plugin is genuinely torn down.
  property bool wantsBridge: false

  // ---- RPC ----------------------------------------------------------------

  property int nextRid: 1
  property var pending: ({})     // rid -> { ok: function, err: function }
  property var eventSubs: ({})   // channel -> [ handler ]

  // Returns the rid, so a caller that wants to abandon a reply can cancel it.
  // onOk / onErr are both optional: a fire-and-forget call passes neither and
  // the reply is dropped by the same lookup that routes a real one.
  function invoke(channel, args, onOk, onErr) {
    var rid = nextRid++
    pending[rid] = { ok: onOk, err: onErr }
    // The first caller is what brings the bridge up; queued frames are held by
    // the bridge itself until it authenticates.
    wantsBridge = true
    ensureBridge()
    write_({ op: "invoke", rid: rid, channel: channel, args: args || [] })
    return rid
  }

  function cancel(rid) {
    if (pending[rid] !== undefined) delete pending[rid]
    write_({ op: "cancel", rid: rid })
  }

  // Answer a pi:uiRequest. Written straight through: the bridge does not reshape
  // it and the server's `respond` frame is already the PiUIResponse shape.
  function respond(id, payload) {
    var frame = { op: "respond", id: String(id) }
    if (payload) {
      if (payload.value !== undefined) frame.value = payload.value
      if (payload.confirmed !== undefined) frame.confirmed = payload.confirmed
      if (payload.cancelled !== undefined) frame.cancelled = payload.cancelled
    }
    write_(frame)
  }

  function subscribe(channel, handler) {
    var list = eventSubs[channel]
    if (!list) { list = []; eventSubs[channel] = list }
    if (list.indexOf(handler) === -1) list.push(handler)
  }

  function unsubscribe(channel, handler) {
    var list = eventSubs[channel]
    if (!list) return
    var i = list.indexOf(handler)
    if (i >= 0) list.splice(i, 1)
  }

  // Push-to-talk capture lives in the bridge because it owns a child process.
  // `recStart` is the ONLY thing in this plugin that opens the microphone, and
  // it is reachable from exactly one place: a press on MicButton. Nothing starts
  // capture implicitly, and the bridge is not even running until something has
  // asked the server for something.
  function recStart() { wantsBridge = true; ensureBridge(); write_({ op: "rec.start" }) }
  function recStop() { write_({ op: "rec.stop" }) }
  function recCancel() { write_({ op: "rec.cancel" }) }

  // `error` is non-empty only when the recorder stopped because it FAILED —
  // no capture device, no permission, a node that vanished. Carried on this
  // signal rather than a new one because it is the same fact ("capture is no
  // longer running"), and the bridge's `log` channel is write-only from the
  // UI's point of view: a failure reported there left the mic button lit and
  // nothing on screen.
  signal recordingChanged(bool active, string error)
  signal audioReady(string b64)

  // Frames written before the child has actually started. `bridge.running` flips
  // synchronously but the process — and its stdin — appear a moment later, so a
  // write issued in the same tick as the spawn would be lost. The bridge
  // announces itself with a `conn` line; everything queued before that is
  // flushed then, in order.
  property var writeQueue_: []

  function write_(obj) {
    if (!bridge.running) {
      if (obj.op === "invoke") deliverError_(obj.rid, "WebSocket disconnected")
      return
    }
    if (!root.bridgeAlive) { writeQueue_.push(obj); return }
    bridge.write(JSON.stringify(obj) + "\n")
  }

  function flushWrites_() {
    var queued = writeQueue_
    writeQueue_ = []
    for (var i = 0; i < queued.length; i++) {
      bridge.write(JSON.stringify(queued[i]) + "\n")
    }
  }

  function deliverError_(rid, message) {
    var slot = pending[rid]
    if (slot === undefined) return
    delete pending[rid]
    if (slot.err) slot.err(message)
  }

  function failAllPending(message) {
    var rids = Object.keys(pending)
    var stale = pending
    pending = ({})
    for (var i = 0; i < rids.length; i++) {
      var slot = stale[rids[i]]
      if (slot && slot.err) slot.err(message)
    }
  }
  function onBridgeLine(line) {
    var msg
    try { msg = JSON.parse(line) } catch (e) { return }
    if (!msg || !msg.ev) return

    switch (msg.ev) {
    case "result": {
      var slot = pending[msg.rid]
      if (slot === undefined) return
      delete pending[msg.rid]
      if (msg.error !== undefined && msg.error !== null) {
        if (slot.err) slot.err(String(msg.error))
      } else if (slot.ok) {
        slot.ok(msg.result)
      }
      return
    }
    case "event": {
      var list = eventSubs[msg.channel]
      if (!list) return
      // Copy first: a handler may unsubscribe itself.
      var handlers = list.slice()
      for (var i = 0; i < handlers.length; i++) {
        try { handlers[i](msg.data) } catch (e) {
          console.warn("agent-desktop: handler for", msg.channel, "threw:", e)
        }
      }
      return
    }
    case "conn":
      bridgeAlive = true
      serverUp = msg.server === "up"
      connected = msg.connected === true
      lastError = msg.error ? String(msg.error) : ""
      flushWrites_()
      if (connected) root.onConnected_()
      return
    case "rec":
      recordingChanged(msg.active === true, msg.error ? String(msg.error) : "")
      return
    case "audio":
      audioReady(String(msg.b64 || ""))
      return
    case "log":
      console.warn("agent-desktop bridge:", msg.level, msg.message)
      return
    }
  }

  // Every store reloads here rather than at Component.onCompleted, because the
  // bridge is not authenticated yet when the stores are constructed and the
  // server's token rotates on every restart. Order matters only in that
  // settings must land before anything reads an effective value from it.
  function onConnected_() {
    settingsStoreImpl.load()
    // The conversation list. Without this the sidebar is permanently empty —
    // 14 conversations in the database, nothing on screen — because
    // `ConversationsStore.load()` is the only caller of `conversations:list`
    // and no other code path reaches it.
    conversationsStoreImpl.load()
    mcpStoreImpl.load()
    toolsStoreImpl.load()
    knowledgeStoreImpl.load()
    macrosStoreImpl.load()
    shortcutsStoreImpl.load()
    // Validates the openscad binary; cheap, and the settings page shows it.
    openScadStoreImpl.load()
    // The scheduler page's `attach()` only SUBSCRIBES to scheduler:taskUpdate;
    // nothing fetched the initial list, so the page sat on "Loading…" forever
    // and showed the default background status rather than the real one.
    // Every store's initial fetch belongs here, in one place — a page that
    // loads itself on mount would fire before the bridge authenticates.
    schedulerStoreImpl.load()
  }

  // ---- stores -------------------------------------------------------------
  //
  // Children, so their lifetime is the service's and the panel can be destroyed
  // and rebuilt without losing state. Each owns exactly the state its channels
  // produce and reaches the server only through `rpc`. No store imports
  // Quickshell: a store that did could not be loaded by qmltestrunner, so the
  // few things that need a local command are signals wired below instead.

  // Named `settingsStore`, not `settings`: `settings` is the plugin-local
  // shell-side knob map above, and the shell's own injection convention uses
  // that name too. Two different things, so two names.
  readonly property alias settingsStore: settingsStoreImpl
  SettingsStore { id: settingsStoreImpl; rpc: root }

  readonly property alias conversationsStore: conversationsStoreImpl
  ConversationsStore { id: conversationsStoreImpl; rpc: root }

  readonly property alias chatStore: chatStoreImpl
  ChatStore { id: chatStoreImpl; rpc: root; settingsStore: settingsStoreImpl }

  readonly property alias schedulerStore: schedulerStoreImpl
  SchedulerStore { id: schedulerStoreImpl; rpc: root }

  readonly property alias voiceStore: voiceStoreImpl
  VoiceStore { id: voiceStoreImpl; rpc: root; settingsStore: settingsStoreImpl }

  readonly property alias ttsStore: ttsStoreImpl
  TtsStore { id: ttsStoreImpl; rpc: root }

  readonly property alias mcpStore: mcpStoreImpl
  McpStore { id: mcpStoreImpl; rpc: root }

  readonly property alias toolsStore: toolsStoreImpl
  ToolsStore { id: toolsStoreImpl; rpc: root }

  readonly property alias knowledgeStore: knowledgeStoreImpl
  KnowledgeStore { id: knowledgeStoreImpl; rpc: root }

  readonly property alias macrosStore: macrosStoreImpl
  MacrosStore { id: macrosStoreImpl; rpc: root }

  readonly property alias shortcutsStore: shortcutsStoreImpl
  ShortcutsStore { id: shortcutsStoreImpl; rpc: root }

  // Push-driven: `pi:uiEvent` / `pi:uiRequest` arrive unprompted, so there is
  // nothing to load. Deliberately no `load()` — a lifecycle method that did
  // nothing would only invite someone to call it.
  readonly property alias piUiStore: piUiStoreImpl
  PiUiStore { id: piUiStoreImpl; rpc: root }

  // load(path) restores a notebook, so it is called by whoever opens one, not
  // on connect.
  readonly property alias jupyterStore: jupyterStoreImpl
  JupyterStore { id: jupyterStoreImpl; rpc: root }

  readonly property alias openScadStore: openScadStoreImpl
  OpenScadStore { id: openScadStoreImpl; rpc: root }

  // Both are scoped to a cwd, which comes from the active conversation, so
  // neither loads on connect — the pane sets `cwd` and calls load().
  readonly property alias filesStore: filesStoreImpl
  FilesStore { id: filesStoreImpl; rpc: root }

  readonly property alias gitStore: gitStoreImpl
  GitStore { id: gitStoreImpl; rpc: root }

  // ---- the seams that need a local command --------------------------------
  //
  // Stores raise a signal; the shelling out happens here, once. This is also
  // the only place `notifyWhenHidden` and `notificationConfig` are consulted,
  // so a notification cannot be fired from two different gates.

  function notify_(title, body) {
    Quickshell.execDetached(Notify.commandFor(String(title), String(body)))
  }

  // The SOUND half of notificationConfig. It had no implementation at all:
  // `Notify.shouldNotify` answers only the desktop question, so the settings
  // page's whole Sound column — seven switches, persisted — did nothing.
  // Freedesktop sound ids via `canberra-gtk-play -i` rather than bundled
  // audio, so the chime follows the user's own sound theme.
  function playNotificationSound_(configJson, event) {
    if (!Notify.shouldPlaySound(configJson, event)) return
    Quickshell.execDetached(Notify.soundCommandFor(String(event)))
  }

  // FilesStore raises these instead of spawning anything itself, so a store
  // stays loadable by qmltestrunner (CONTRACTS.md §2). This is the one place
  // that turns them into processes.
  //
  // `xdg-open` for both reveal and open-external: it is what resolves the
  // user's configured file manager and default application respectively, and
  // hardcoding either would override a choice the desktop already knows.
  // `gio trash` rather than `rm`: it moves to the desktop trash, which is
  // recoverable — the FileTree confirm dialog promises exactly that, and `rm`
  // would make that promise false.
  Connections {
    target: filesStoreImpl
    function onRevealRequested(path) {
      if (!path || String(path).length === 0) return
      Quickshell.execDetached(["xdg-open", String(path)])
    }
    function onOpenExternalRequested(path) {
      if (!path || String(path).length === 0) return
      Quickshell.execDetached(["xdg-open", String(path)])
    }
    function onTrashRequested(path) {
      if (!path || String(path).length === 0) return
      Quickshell.execDetached(["gio", "trash", String(path)])
    }
  }

  // Extension chrome belongs to the backend that produced it. `PiUiStore
  // .resetChrome()` existed for exactly this and had no caller, so a status
  // line, widget or header an omp extension set under one backend survived a
  // switch to another that knows nothing about it.
  //
  // Wired on backend switch ONLY, not on turn end. The function's own comment
  // suggests both, but it also clears `title`, `headerNode` and `footerNode` —
  // and `pi:uiEvent setTitle` is how an extension sets a window title it
  // means to persist across turns. Clearing that every turn would break the
  // documented setTitle contract to satisfy a comment.
  property string lastBackend_: ""
  Connections {
    target: settingsStoreImpl
    function onValuesChanged() {
      var next = String(settingsStoreImpl.get("ai_sdkBackend", ""))
      if (next.length === 0) return
      if (root.lastBackend_.length === 0) { root.lastBackend_ = next; return }
      if (next === root.lastBackend_) return
      root.lastBackend_ = next
      piUiStoreImpl.resetChrome()
    }
  }

  Connections {
    target: chatStoreImpl
    function onTurnEnded(summaryText) {
      var cfg = settingsStoreImpl.get("notificationConfig", "")
      // The SOUND half is deliberately NOT gated on the window being hidden:
      // Electron plays it on every turn end the user asked for
      // (src/renderer/stores/chatStore.ts:865), and a chime while you are
      // looking at another window on the same workspace is exactly the point.
      root.playNotificationSound_(cfg, "success")
      if (String(root.setting("notifyWhenHidden", "On")) !== "On") return
      // Only when the user cannot already see the answer.
      if (root.shell && typeof root.shell.isPluginOpen === "function"
          && root.shell.isPluginOpen(root.pluginId) === true) return
      if (!Notify.shouldNotify(cfg, "success")) return
      root.notify_("Agent Desktop", String(summaryText).slice(0, 400))
    }
  }

  Connections {
    target: schedulerStoreImpl
    function onNotifyRequested(title, body, event) {
      var cfg = settingsStoreImpl.get("notificationConfig", "")
      root.playNotificationSound_(cfg, String(event))
      if (!Notify.shouldNotify(cfg, String(event))) return
      root.notify_(title, body)
    }
  }

  // Speak the assistant's answer when the user asked for that.
  //
  // `TtsStore.speakMessage` was implemented and unit-tested with NO production
  // caller, so spoken responses were unreachable: `TtsIndicator` offered a
  // stop handle for a state nothing could enter. The Electron front triggers
  // this per assistant bubble (renderer/stores/ttsStore.ts:13, gated on
  // `tts_responseMode` read at AssistantBubble.tsx:78).
  //
  // Done here rather than in a message delegate for the same reason the
  // notification above is: turn-end side effects that depend on a setting
  // belong in one place, and a per-row trigger would fire once per visible
  // bubble on every re-render.
  //
  // The server decides `full` vs `summary` from the same setting
  // (handlers/tts.ts speakMessage), so this only has to decide whether to
  // speak at all. 'off' is the documented default in the type union
  // ('off' | 'full' | 'summary' | 'auto'), so silence stays the default.
  Connections {
    target: chatStoreImpl
    function onTurnEnded(summaryText) {
      if (String(settingsStoreImpl.get("tts_responseMode", "off")) === "off") return
      var convId = Number(chatStoreImpl.conversationId || 0)
      if (convId <= 0) return
      // speakMessage needs the message identity, which `turnEnded` does not
      // carry — read the last assistant row back off the store.
      var msgs = chatStoreImpl.messages || []
      for (var i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i] && msgs[i].role === "assistant") {
          var text = String(msgs[i].content || summaryText || "")
          if (text.length === 0) return
          ttsStoreImpl.speakMessage(text, convId, Number(msgs[i].id || 0))
          return
        }
      }
    }
  }
  // The active conversation is the sidebar's to choose and the chat store's to
  // load. Keeping the hand-off here means neither store has to know the other.
  //
  // The Files and Git stores are scoped to that conversation's `cwd`, so they
  // are re-scoped from the same place. Doing it here rather than in each pane's
  // `Component.onCompleted` is what makes switching conversations actually move
  // the panes: a mount-time call only ever sees whichever conversation happened
  // to be active when the pane was first shown.
  Connections {
    target: conversationsStoreImpl
    // The auto-generated property-change signal on `property var activeId`
    // carries no argument, so the new value is read back off the store.
    function onActiveIdChanged() {
      var id = Number(conversationsStoreImpl.activeId || 0)
      if (id > 0) chatStoreImpl.load(id)
      root.rescopeCwd_()
    }
    // `cwd` can also change without the id changing — the conversation row is
    // patched in place by conversations:update and by the refresh push.
    function onActiveCwdChanged() { root.rescopeCwd_() }
  }

  function rescopeCwd_() {
    var cwd = String(conversationsStoreImpl.activeCwd || "")
    gitStoreImpl.refresh(cwd)
    filesStoreImpl.load(cwd)
  }

  // ---- IpcHandler: the channel Hyprland binds invoke ----------------------

  IpcHandler {
    target: "agent-desktop"

    function window(): void { root.openSurface("window") }
    function chat(): void { root.openSurface("quick") }
    function voice(): void { root.openSurface("voice") }
    function hide(): void {
      // The plugin's other consumers (the bar widget, settings, scheduled
      // tasks) may still need the connection, and a freshly-spawned bridge
      // is cheap enough that the keep-alive is not worth the surprise of
      // yanking the child when one window is closed.
      if (root.shell) root.shell.hide(root.pluginId)
    }
    function restart(): void { root.restartServer() }
    function status(): string {
      if (!root.bridgeAlive) return "bridge-down"
      if (!root.serverUp) return "server-down"
      if (!root.connected) return "connecting"
      if (root.busy) return "working"
      return "idle"
    }
  }

  // True while any surface reports a turn in flight. The chat store raises it
  // once it exists (Phase 2); until then the bar widget reads "idle".
  property bool busy: false

  function openSurface(mode) {
    if (shell && typeof shell.summon === "function")
      shell.summon(pluginId, JSON.stringify({ mode: mode }))
  }

  function restartServer() {
    Quickshell.execDetached(["systemctl", "--user", "restart",
      "agent-desktop-headless.service"])
  }
}
