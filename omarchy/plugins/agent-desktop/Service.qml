import QtQuick
import Quickshell
import Quickshell.Io
import "stores"
import "lib/notify.js" as Notify
import "lib/quickChat.js" as QC

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

  // Continuous capture. The same child-process argument as push-to-talk above:
  // the bridge owns `pw-record`, so it owns the always-listening loop and the
  // energy VAD that cuts it into utterances. QML never sees a PCM frame — only
  // finished utterances, already framed as WAV.
  //
  // `cvPause` is half-duplex, not a stop: the recorder keeps running and the
  // bridge drops what it hears, so the assistant's own TTS is not transcribed
  // back as the user's next sentence.
  function cvStart(config) { wantsBridge = true; ensureBridge(); write_({ op: "cv.start", config: config || ({}) }) }
  function cvStop() { write_({ op: "cv.stop" }) }
  function cvPause(paused) { write_({ op: "cv.pause", paused: paused === true }) }

  // `error` is non-empty only when the recorder stopped because it FAILED —
  // no capture device, no permission, a node that vanished. Carried on this
  // signal rather than a new one because it is the same fact ("capture is no
  // longer running"), and the bridge's `log` channel is write-only from the
  // UI's point of view: a failure reported there left the mic button lit and
  // nothing on screen.
  signal recordingChanged(bool active, string error)
  signal audioReady(string b64)

  // Continuous capture, mirroring the pair above: one signal for "is it
  // running (and why did it stop)", one for each finished utterance.
  signal cvStateChanged(bool active, string error)
  signal utteranceCaptured(string b64, real startedAt, real endedAt)

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
    case "cv":
      cvStateChanged(msg.active === true, msg.error ? String(msg.error) : "")
      return
    case "utterance":
      utteranceCaptured(String(msg.b64 || ""),
                        Number(msg.startedAt || 0), Number(msg.endedAt || 0))
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

  // Always-listening capture. Separate from VoiceStore on purpose: push-to-talk
  // owns "the user is holding the key", this owns "the room is being listened
  // to and a gate decides what counts". They share the microphone, so the
  // bridge refuses to run both at once.
  readonly property alias continuousVoiceStore: continuousVoiceStoreImpl
  ContinuousVoiceStore {
    id: continuousVoiceStoreImpl
    rpc: root
    settingsStore: settingsStoreImpl
    // The gate's intent classifier is scoped to a conversation, and an
    // utterance is sent to whichever one the chat store is on.
    conversationId: Number(chatStoreImpl.conversationId || 0)
  }

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
      if (root.headlessTurnPending_) {
        root.headlessTurnPending_ = false
        // The answer to a headless dictation is the ONLY output that turn
        // has, so the two gates below are both the wrong question for it:
        // `notifyWhenHidden` asks "notify when the WINDOW is closed?" (there
        // was no window), and `isPluginOpen` can be true for an app window
        // the user opened in the meantime — which would silence the one
        // notification the mode exists to deliver.
        //
        // `quickChat_responseNotification` is the setting that actually
        // governs this ("Show desktop notification for responses"). It had no
        // reader in this front either; this is it.
        if (settingsStoreImpl.get("quickChat_responseNotification", "true") === "true") {
          root.notify_("Agent Desktop", String(summaryText).slice(0, 400))
        }
        return
      }
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

  // ---- continuous voice wiring ---------------------------------------------
  //
  // Three seams, each one concern, matching how the two turn-end handlers above
  // are split rather than merged.

  // 1. An utterance the gate accepted is a message. The store deliberately does
  //    not know about ChatStore — it decides WHETHER to send, not where.
  Connections {
    target: continuousVoiceStoreImpl
    function onUtteranceReady(text) {
      var trimmed = String(text || "").trim()
      if (trimmed.length === 0) return
      chatStoreImpl.send(trimmed, [])
    }
  }

  // 2. A finished exchange opens the follow-up window, so the next thing the
  //    user says needs neither a repeated wake word nor another (paid) intent
  //    classification. This is `createVoiceGate.notifyExchangeComplete()`.
  Connections {
    target: chatStoreImpl
    function onTurnEnded(summaryText) {
      continuousVoiceStoreImpl.notifyExchangeComplete()
    }
  }

  // 3. Half duplex. Without it the assistant's own spoken answer is captured,
  //    transcribed, and handed back to the gate as the user's next sentence —
  //    the loop the Electron front avoids the same way
  //    (useContinuousVoice.ts:134-139). Default ON: only the literal "false"
  //    turns it off, matching `pauseDuringTts` in the renderer's config.ts.
  Connections {
    target: ttsStoreImpl
    function onSpeakingChanged() {
      if (!continuousVoiceStoreImpl.active) return
      if (String(settingsStoreImpl.get("continuousVoice_pauseDuringTts", "true")) === "false") return
      continuousVoiceStoreImpl.setPaused(ttsStoreImpl.speaking === true)
    }
  }

  // Turning the feature off in Settings must also end a session that is already
  // running — otherwise the microphone stays open with no control left on
  // screen to close it.
  Connections {
    target: settingsStoreImpl
    function onValuesChanged() {
      if (!continuousVoiceStoreImpl.active) return
      if (String(settingsStoreImpl.get("continuousVoice_enabled", "false")) === "true") return
      continuousVoiceStoreImpl.stop()
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

  // ---- deferred quick-chat resolution --------------------------------------
  //
  // `ConversationsStore.ensureQuickChat(mode)` reads the pinned conversation id
  // out of the settings map. Called before `settings:get` has landed it reads
  // "" and creates a brand-new "Quick Chat" row — the trail of empty ones in
  // the database is exactly that bug. So the rule is "settings first", and it
  // has ONE implementation here rather than one per caller: App.qml's overlay
  // summon and the headless voice session below both go through this.
  property string pendingQuickChatMode_: ""
  property int quickChatWaitTicks_: 0

  function ensureQuickChatWhenReady(mode) {
    root.pendingQuickChatMode_ = (mode === "voice") ? "voice" : "text"
    root.quickChatWaitTicks_ = 0
    // The settings map only loads once the bridge authenticates, so a summon
    // is also what brings the connection up.
    root.connectNow()
    root.drainQuickChat_()
  }

  function drainQuickChat_() {
    if (root.pendingQuickChatMode_.length === 0) return
    if (settingsStoreImpl.loaded !== true) {
      root.quickChatWaitTicks_ += 1
      // 150 ms x 200 = 30 s. Bounded rather than a forever-spinning timer: a
      // server that never comes up must stop costing ticks, and a pending mode
      // draining half an hour later would create a quick chat nobody asked for.
      if (root.quickChatWaitTicks_ > 200) root.pendingQuickChatMode_ = ""
      return
    }
    var mode = root.pendingQuickChatMode_
    root.pendingQuickChatMode_ = ""
    conversationsStoreImpl.ensureQuickChat(mode)
  }

  Timer {
    id: quickChatDrain
    interval: 150
    repeat: true
    // Self-terminating: draining clears the mode, which stops the timer.
    running: root.pendingQuickChatMode_.length > 0
    onTriggered: root.drainQuickChat_()
  }

  // ---- headless voice ------------------------------------------------------
  //
  // `quickChat_voiceHeadless` promises "notifications only, no overlay". It had
  // NO reader anywhere in this front: the settings page persisted the key and
  // every voice summon still called `shell.summon`, so the toggle produced the
  // ordinary quick-voice overlay and nothing else.
  //
  // A headless capture is a session, not a window, so it lives here and not in
  // App.qml: the panel may not even be instantiated, and nothing about the
  // flow needs a surface.
  //
  //   press 1     arm; capture opens the moment the connection is up
  //   press 2     stop; VoiceStore transcribes and raises transcriptReady
  //   transcript  sent to that conversation
  //   turn end    the answer arrives as a desktop notification
  //
  // Every failure notifies. In a mode with no window, a swallowed error is
  // indistinguishable from a dead keybinding.
  //
  // WHY THE DECISION IS DEFERRED. `openSurface` below does not read
  // `quickChat_voiceHeadless` on the keypress, and that is the whole bug this
  // feature was reported for. A headless summon is ALWAYS the cold path — by
  // definition nothing else has opened the plugin — so at that instant the
  // bridge child does not exist, `settings:get` has not run, and the settings
  // map is EMPTY. Reading the key there returns the "false" fallback, the
  // summon falls through to `shell.summon`, and the user gets the ordinary
  // quick-voice overlay: measured on a freshly restarted shell, press 1 mapped
  // the `agent-desktop-quickchat` layer and only press 2 — with settings now
  // loaded — went headless. "Ça active uniquement le mode quick voice normal",
  // exactly as reported.
  //
  // So a voice summon waits for the settings map, then decides once. By the
  // time `toggleHeadlessVoice` runs, `settingsStore.loaded` is true — which
  // also means the bridge authenticated, so `VoiceStore.start()` reaches a
  // live child and `ensureQuickChat` reads a real pinned id instead of
  // creating a stray "Quick Chat" on every summon.

  property bool headlessVoice: false      // this session owns the live capture
  property string headlessTranscript_: "" // transcribed, waiting for a conversation
  property int headlessSendTicks_: 0
  property bool headlessTurnPending_: false

  function toggleHeadlessVoice() {
    // "Is a capture live" is VOICESTORE's state, and it is read from there
    // rather than mirrored into a second boolean here. A local copy is what
    // desynced the toggle: a start that never reached the bridge left the flag
    // saying "recording", and the next press then "stopped" a capture that had
    // never begun — after which the key did the opposite thing every time.
    if (voiceStoreImpl.recording || voiceStoreImpl.starting) {
      voiceStoreImpl.stop()
      return
    }
    root.headlessVoice = true
    root.headlessTranscript_ = ""
    root.headlessSendTicks_ = 0
    root.ensureQuickChatWhenReady("voice")
    voiceStoreImpl.start()
    // The ONLY feedback this mode can give that the mic is live. Without it
    // the shortcut is indistinguishable from one that does nothing.
    root.notify_("Agent Desktop", "Listening… press the shortcut again to send.")
  }

  function headlessFlush_() {
    if (root.headlessTranscript_.length === 0) return
    if (Number(chatStoreImpl.conversationId || 0) > 0) {
      var text = root.headlessTranscript_
      root.headlessTranscript_ = ""
      root.headlessTurnPending_ = true
      chatStoreImpl.send(text, [])
      return
    }
    root.headlessSendTicks_ += 1
    if (root.headlessSendTicks_ < 40) return
    // 8 s and still no conversation to send to — longer than a cold bridge
    // spawn plus the create round trip. `ChatStore.send` would set an `error`
    // string that no window is rendering, so say it out loud and hand the
    // words back rather than dropping a dictation in silence.
    var lost = root.headlessTranscript_
    root.headlessTranscript_ = ""
    root.notify_("Agent Desktop", "No quick-chat conversation — not sent: " + lost)
  }

  Timer {
    id: headlessFlushTimer
    interval: 200
    repeat: true
    running: root.headlessTranscript_.length > 0
    onTriggered: root.headlessFlush_()
  }

  // The ONE subscriber to voice transcripts.
  //
  // App.qml used to subscribe directly. With a headless session in the picture
  // that would be two subscribers to one signal, and QML does not order signal
  // handlers — a transcript could be consumed by both (double send) or by
  // neither. So the service routes: it keeps a headless transcript and re-emits
  // everything else for whichever surface App has on screen.
  signal voiceTranscriptForSurface(string text)

  Connections {
    target: voiceStoreImpl

    function onTranscriptReady(text) {
      if (!root.headlessVoice) {
        root.voiceTranscriptForSurface(String(text || ""))
        return
      }
      root.headlessVoice = false
      var trimmed = String(text || "").trim()
      if (trimmed.length === 0) {
        // VoiceStore fires this on every successful transcribe including the
        // documented empty "nothing to say" case.
        root.notify_("Agent Desktop", "Nothing was heard — try again.")
        return
      }
      root.headlessTranscript_ = trimmed
      root.headlessSendTicks_ = 0
      root.headlessFlush_()
    }

    // A capture that fails — no capture device, pw-record gone, whisper
    // refusing the audio — sets `VoiceStore.error` and stops there. In the
    // windowed flow ChatInput's status row renders it; headless has no row.
    function onErrorChanged() {
      if (!root.headlessVoice) return
      var e = String(voiceStoreImpl.error || "")
      // Cleared to "" on every successful start and transcribe; only a real
      // failure carries text.
      if (e.length === 0) return
      root.headlessVoice = false
      root.notify_("Agent Desktop", "Voice capture failed: " + e)
    }
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
      // A headless capture has no window, so this string is the only way to
      // observe it — from the bar tooltip, from `omarchy-shell agent-desktop
      // status`, and from a test.
      // "waking" is NOT "listening": a cold voice summon is still waiting for
      // the settings map and the microphone is shut. Reporting the two as one
      // string would make this readout claim a mic that is not open.
      if (root.pendingVoiceSummon_) return "waking"
      if (root.headlessVoice) return "listening"
      if (root.headlessTranscript_.length > 0) return "transcribing"
      if (root.busy) return "working"
      return "idle"
    }
  }

  // True while any surface reports a turn in flight. The chat store raises it
  // once it exists (Phase 2); until then the bar widget reads "idle".
  property bool busy: false

  // A voice summon is pending while we wait for the settings map — see the
  // long note above `headlessVoice` for why the decision cannot be taken on
  // the keypress.
  property bool pendingVoiceSummon_: false
  property int voiceSummonTicks_: 0

  function openSurface(mode) {
    // Only the voice summon consults a setting, so only it has to wait. Every
    // other mode is a straight summon and stays instant.
    if (mode !== "voice") { root.summon_(mode); return }
    if (root.pendingVoiceSummon_) {
      // Pressed again while still waiting for the server: cancel, rather than
      // stack a second summon behind the first.
      root.pendingVoiceSummon_ = false
      return
    }
    root.pendingVoiceSummon_ = true
    root.voiceSummonTicks_ = 0
    root.connectNow()
    root.resolveVoiceSummon_()
  }

  function resolveVoiceSummon_() {
    if (!root.pendingVoiceSummon_) return
    if (settingsStoreImpl.loaded !== true) {
      root.voiceSummonTicks_ += 1
      if (root.voiceSummonTicks_ <= 60) return  // 12 s, longer than a cold spawn
      // The server never came up. Fall back to the OVERLAY rather than to
      // headless: it is the mode with a window, so whatever is broken is at
      // least visible instead of being a shortcut that does nothing.
      root.pendingVoiceSummon_ = false
      root.summon_("voice")
      return
    }
    root.pendingVoiceSummon_ = false
    // The single gate on `quickChat_voiceHeadless`, taken here rather than in
    // App.qml because headless means "no window": the decision must precede
    // anything that summons a panel.
    if (QC.wantsHeadlessVoice("voice", settingsStoreImpl.get("quickChat_voiceHeadless", "false"))) {
      root.toggleHeadlessVoice()
      return
    }
    root.summon_("voice")
  }

  Timer {
    id: voiceSummonWait
    interval: 200
    repeat: true
    // Self-terminating: resolving clears the flag, which stops the timer. Warm
    // (the usual case) it never runs at all — `openSurface` resolves inline.
    running: root.pendingVoiceSummon_
    onTriggered: root.resolveVoiceSummon_()
  }

  function summon_(mode) {
    if (shell && typeof shell.summon === "function")
      shell.summon(pluginId, JSON.stringify({ mode: mode }))
  }

  function restartServer() {
    Quickshell.execDetached(["systemctl", "--user", "restart",
      "agent-desktop-headless.service"])
  }
}
