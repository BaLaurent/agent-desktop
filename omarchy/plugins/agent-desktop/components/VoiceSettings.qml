pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

// VoiceSettings — hand-written controls for STT (whisper / sherpa) and TTS.
//
// Composed of two clearly separated sections selected by the `section`
// property. The settings-page shell mounts this component twice (once with
// `section: "voiceInput"` for the `Voice Input` category, once with
// `section: "tts"` for the `Text-to-Speech` category), which keeps this file
// focused while still avoiding any cross-section layout coupling.
//
// SECTION API
//   section: "voiceInput" | "tts"   (required; any other value hides the body)
//
//   Both sections require:
//     store          — TtsStore (VoiceSettings only consumes TtsStore for the
//                      Validate button on the TTS side; STT is server-only)
//     settingsStore  — SettingsStore, the same one Service.qml exposes
//     rpc            — Service.qml (the same `rpc` passed to the stores)
//
//   voiceInput section reads/writes:
//     stt_backend              ("whisper" | "sherpa")
//     whisper_binaryPath, whisper_modelPath, whisper_advancedParams,
//     whisper_autoSend
//     sherpa_modelPath, sherpa_hotwordsSensitivity,
//     sherpa_hotwordsScoreOverride
//
//   tts section reads/writes:
//     tts_provider, tts_piperUrl, tts_edgettsVoice, tts_edgettsBinary,
//     tts_sayVoice, tts_playerPath, tts_maxLength, tts_autoWordLimit,
//     tts_summaryPrompt, tts_responseMode, tts_summaryModel
//
// NOT BUILT (per Phase 8.3):
//   continuousVoice_*  and hotword_* settings — VAD, openwakeword-js and the
//   wake/intent gate run in a Web Worker on AudioContext frames; there is no
//   non-DOM equivalent and no server channel that accepts a raw frame
//   stream. Filed as a separate GitHub issue (see the report below).
Item {
  id: root

  required property string section
  required property var store
  required property var settingsStore
  required property var rpc

  // ---- backend option lists ---------------------------------------------
  //
  // The literal `'sherpa'` selects sherpa; anything else (whisper, unset,
  // any future typo) falls through to whisper — the same rule VoiceStore
  // applies at runtime. Keep this list in lockstep with the transcribe
  // channel selector in VoiceStore.transcribeChannel().
  readonly property var sttBackends: [
    { value: "whisper", label: "Whisper" },
    { value: "sherpa",  label: "sherpa-onnx" }
  ]

  readonly property var ttsProviders: [
    { value: "auto",      label: "Auto (detect)" },
    { value: "say",       label: "spd-say" },
    { value: "piper",     label: "Piper (HTTP)" },
    { value: "edgetts",   label: "Edge TTS" }
  ]

  readonly property var ttsResponseModes: [
    { value: "off",         label: "Off" },
    { value: "first",       label: "First message" },
    { value: "all",         label: "All messages" }
  ]

  // ---- body layout -------------------------------------------------------

  // A parent that mounts this with width only (a Column row, a ListView
  // delegate, a Loader) adopts the item's implicitHeight. Without it the root
  // Item is zero-high and the whole body is invisible — which is how assistant
  // messages vanished from the transcript while the store held them. Ignored
  // when a parent sets an explicit height, so it is safe everywhere.
  implicitHeight: bodyRoot.implicitHeight

  Column {
    id: bodyRoot
    anchors.fill: parent
    spacing: Style.spacing.md
    visible: root.section === "voiceInput" || root.section === "tts"

    // Section title is the parent's responsibility — the settings page
    // already has its own header. VoiceSettings is body-only.

    // ---- voiceInput body ------------------------------------------------
    Column {
      visible: root.section === "voiceInput"
      width: parent.width
      spacing: Style.spacing.md

      PanelSectionHeader { text: "Speech-to-text" }

      Dropdown {
        width: parent.width
        label: "Backend"
        // Empty/unset → whisper. Match the runtime fallback so a user who
        // picks "Whisper" and then clears the field sees whisper, not an
        // unknown transcribe channel.
        value: root.settingsStore ? root.settingsStore.get("stt_backend", "whisper") : "whisper"
        options: root.sttBackends
        onChanged: function(v) {
          if (root.settingsStore) root.settingsStore.set("stt_backend", v)
        }
      }

      // ---- whisper group ------------------------------------------------
      PanelSectionHeader { text: "Whisper" }

      TextField {
        width: parent.width
        placeholderText: "/usr/local/bin/whisper-cli"
        text: root.settingsStore ? root.settingsStore.get("whisper_binaryPath", "") : ""
        onEditingFinished: {
          if (root.settingsStore) root.settingsStore.set("whisper_binaryPath", text)
        }
      }

      TextField {
        width: parent.width
        placeholderText: "/path/to/ggml-tiny.en.bin"
        text: root.settingsStore ? root.settingsStore.get("whisper_modelPath", "") : ""
        onEditingFinished: {
          if (root.settingsStore) root.settingsStore.set("whisper_modelPath", text)
        }
      }

      Button {
        text: "Validate whisper config"
        bordered: true
        onClicked: root.rpc.invoke("whisper:validateConfig", [],
          function(result) { /* success — caller reads via logs */ },
          function(err) { if (root.store) root.store.error = String(err) })
      }

      Toggle {
        label: "Auto-send transcripts to chat"
        checked: root.settingsStore
          ? root.settingsStore.get("whisper_autoSend", "false") === "true"
          : false
        onClicked: {
          var next = !checked
          checked = next
          if (root.settingsStore) root.settingsStore.set("whisper_autoSend", next ? "true" : "false")
        }
      }

      // ---- sherpa group -------------------------------------------------
      PanelSectionHeader { text: "sherpa-onnx" }

      TextField {
        width: parent.width
        placeholderText: "Model folder (read-only — set by download)"
        text: root.settingsStore ? root.settingsStore.get("sherpa_modelPath", "") : ""
        readOnly: true
      }

      // Sherpa preset list — fetched from sherpa:listInstalledModels. The
      // store exposes the result via a fetch helper; call it lazily so the
      // settings page does not hammer the channel on every mount.
      Item {
        width: parent.width
        height: sherpaRow.implicitHeight

        Row {
          id: sherpaRow
          spacing: Style.spacing.sm

          Dropdown {
            width: Math.max(160, parent.width * 0.55)
            label: "Installed model"
            value: ""
            options: root.installedSherpa
            onChanged: function(v) {
              if (!v) return
              root.rpc.invoke("sherpa:downloadModel", [String(v)],
                function(result) {
                  if (result && result.modelPath && root.settingsStore) {
                    root.settingsStore.set("sherpa_modelPath", String(result.modelPath))
                  }
                },
                function(err) { if (root.store) root.store.error = String(err) })
            }
          }

          Button {
            text: "Refresh installed"
            bordered: true
            onClicked: root.refreshSherpaPresets()
          }
        }
      }

      Button {
        text: "Validate sherpa config"
        bordered: true
        onClicked: root.rpc.invoke("sherpa:validateConfig", [],
          function(result) { /* success — caller reads via logs */ },
          function(err) { if (root.store) root.store.error = String(err) })
      }

      NumberField {
        label: "Hotwords sensitivity"
        value: Number(root.settingsStore
          ? root.settingsStore.get("sherpa_hotwordsSensitivity", "0")
          : "0")
        from: 0
        to: 100
        stepSize: 1
        onModified: function(v) {
          if (root.settingsStore) root.settingsStore.set("sherpa_hotwordsSensitivity", String(v))
        }
      }

      NumberField {
        label: "Hotwords boost score"
        value: Number(root.settingsStore
          ? root.settingsStore.get("sherpa_hotwordsScoreOverride", "2.0")
          : "2.0")
        from: 0
        to: 10
        stepSize: 1
        onModified: function(v) {
          if (root.settingsStore) root.settingsStore.set("sherpa_hotwordsScoreOverride", String(v))
        }
      }

      // ---- continuous voice / hotword intentionally omitted -----------
      //
      // Phase 8.3: no controls for continuousVoice_* or hotword_* — those
      // run in a Web Worker on AudioContext frames (VAD + openwakeword-js),
      // and there is no server channel that accepts a raw frame stream.
      // hotwordTrain:* is Electron-only IPC. Filed as a separate GitHub
      // issue. See VoiceSettings header comment.
    }

    // ---- tts body --------------------------------------------------------
    Column {
      visible: root.section === "tts"
      width: parent.width
      spacing: Style.spacing.md

      PanelSectionHeader { text: "Text-to-speech" }

      Dropdown {
        width: parent.width
        label: "Provider"
        value: root.settingsStore ? root.settingsStore.get("tts_provider", "auto") : "auto"
        options: root.ttsProviders
        onChanged: function(v) {
          if (root.settingsStore) root.settingsStore.set("tts_provider", v)
        }
      }

      TextField {
        width: parent.width
        placeholderText: "Piper HTTP URL (when provider = piper)"
        text: root.settingsStore ? root.settingsStore.get("tts_piperUrl", "") : ""
        onEditingFinished: {
          if (root.settingsStore) root.settingsStore.set("tts_piperUrl", text)
        }
      }

      TextField {
        width: parent.width
        placeholderText: "Edge TTS voice (e.g. en-US-AriaNeural)"
        text: root.settingsStore ? root.settingsStore.get("tts_edgettsVoice", "") : ""
        onEditingFinished: {
          if (root.settingsStore) root.settingsStore.set("tts_edgettsVoice", text)
        }
      }

      TextField {
        width: parent.width
        placeholderText: "Edge TTS binary path"
        text: root.settingsStore ? root.settingsStore.get("tts_edgettsBinary", "") : ""
        onEditingFinished: {
          if (root.settingsStore) root.settingsStore.set("tts_edgettsBinary", text)
        }
      }

      // `spd-say` voices and audio players are DISCOVERABLE — the store has
      // `listSayVoices()` and `detectPlayers()`, both unit-tested and, until
      // now, called by nothing. So these were free-text fields where the user
      // had to already know the answer, while the Electron front populates the
      // same two from the same channels (settings/TTSSettings.tsx:36-38).
      //
      // Kept as a text field PLUS a discovery dropdown rather than replaced by
      // one: the server accepts values these probes cannot enumerate (a voice
      // from a provider that is not `say`, a player not on PATH), and a
      // dropdown alone would make those unreachable.
      Row {
        width: parent.width
        spacing: Style.spacing.md

        TextField {
          width: (parent.width - Style.spacing.md) / 2
          placeholderText: "spd-say voice name (when provider = say)"
          text: root.settingsStore ? root.settingsStore.get("tts_sayVoice", "") : ""
          onEditingFinished: {
            if (root.settingsStore) root.settingsStore.set("tts_sayVoice", text)
          }
        }
        Button {
          text: root.sayVoices.length > 0
            ? ("Voices: " + root.sayVoices.length)
            : "Detect voices"
          bordered: true
          onClicked: root.refreshSayVoices()
        }
      }

      Dropdown {
        width: parent.width
        label: "Detected voices"
        visible: root.sayVoices.length > 0
        value: root.settingsStore ? root.settingsStore.get("tts_sayVoice", "") : ""
        options: root.sayVoices
        onChanged: function (v) {
          if (root.settingsStore) root.settingsStore.set("tts_sayVoice", String(v))
        }
      }

      Row {
        width: parent.width
        spacing: Style.spacing.md

        TextField {
          width: (parent.width - Style.spacing.md) / 2
          placeholderText: "Audio player binary path (optional)"
          text: root.settingsStore ? root.settingsStore.get("tts_playerPath", "") : ""
          onEditingFinished: {
            if (root.settingsStore) root.settingsStore.set("tts_playerPath", text)
          }
        }
        Button {
          text: root.ttsPlayers.length > 0
            ? ("Players: " + root.ttsPlayers.length)
            : "Detect players"
          bordered: true
          onClicked: root.refreshTtsPlayers()
        }
      }

      Dropdown {
        width: parent.width
        label: "Detected players"
        visible: root.ttsPlayers.length > 0
        value: root.settingsStore ? root.settingsStore.get("tts_playerPath", "") : ""
        options: root.ttsPlayers
        onChanged: function (v) {
          if (root.settingsStore) root.settingsStore.set("tts_playerPath", String(v))
        }
      }

      Dropdown {
        width: parent.width
        label: "Response mode"
        value: root.settingsStore ? root.settingsStore.get("tts_responseMode", "off") : "off"
        options: root.ttsResponseModes
        onChanged: function(v) {
          if (root.settingsStore) root.settingsStore.set("tts_responseMode", v)
        }
      }

      NumberField {
        label: "Max characters"
        value: Number(root.settingsStore ? root.settingsStore.get("tts_maxLength", "0") : "0")
        from: 0
        to: 100000
        stepSize: 100
        onModified: function(v) {
          if (root.settingsStore) root.settingsStore.set("tts_maxLength", String(v))
        }
      }

      NumberField {
        label: "Auto-summarize over N words"
        value: Number(root.settingsStore ? root.settingsStore.get("tts_autoWordLimit", "0") : "0")
        from: 0
        to: 100000
        stepSize: 50
        onModified: function(v) {
          if (root.settingsStore) root.settingsStore.set("tts_autoWordLimit", String(v))
        }
      }

      TextField {
        width: parent.width
        placeholderText: "Summary prompt (optional)"
        text: root.settingsStore ? root.settingsStore.get("tts_summaryPrompt", "") : ""
        onEditingFinished: {
          if (root.settingsStore) root.settingsStore.set("tts_summaryPrompt", text)
        }
      }

      TextField {
        width: parent.width
        placeholderText: "Summary model"
        text: root.settingsStore ? root.settingsStore.get("tts_summaryModel", "") : ""
        onEditingFinished: {
          if (root.settingsStore) root.settingsStore.set("tts_summaryModel", text)
        }
      }

      Row {
        width: parent.width
        spacing: Style.spacing.md

        Button {
          text: root.store && root.store.validating ? "Validating…" : "Validate TTS config"
          bordered: true
          enabled: !(root.store && root.store.validating)
          onClicked: {
            if (root.store) root.store.validate()
          }
        }

        // `TtsStore.speak` had no production caller, so there was no way to
        // hear whether the configuration above actually works — Validate only
        // reports what the server can find, not whether audio comes out. The
        // Electron front pairs the same two (settings/tts/ResponseModeSection
        // .tsx:45 speaks a fixed probe sentence right after validating).
        Button {
          text: "Speak a test phrase"
          bordered: true
          onClicked: {
            if (root.store) root.store.speak("This is a test of the text to speech system.")
          }
        }
      }
    }
  }

  // ---- sherpa preset list state (voiceInput section) --------------------
  //
  // `installedSherpa` is refreshed on demand from `sherpa:listInstalledModels`
  // and shapes into the Dropdown's `[{value,label}]` form. The preset id is
  // the value (it's what `sherpa:downloadModel` accepts and the only thing
  // the server knows how to look up in SHERPA_MODEL_PRESETS).
  // ---- TTS discovery lists (tts section) --------------------------------
  //
  // `TtsStore.listSayVoices()` and `detectPlayers()` were implemented and
  // unit-tested with no production caller, so the voice and player fields were
  // free text the user had to already know the answer for. Shaped here into
  // the Dropdown's `[{value,label}]` form.
  //
  // Refreshed on demand rather than on mount: both probes shell out on the
  // server (spd-say voice enumeration, a PATH walk for players), and paying
  // for that every time the settings page opens is rude for a field most
  // users set once.
  property var sayVoices: []
  property var ttsPlayers: []

  function refreshSayVoices() {
    if (!root.store) return
    root.store.listSayVoices(function (list) {
      var out = []
      for (var i = 0; i < list.length; i++) {
        var v = list[i]
        // The channel does not pin its element shape, so accept a bare string
        // OR an object, rather than rendering "[object Object]" if the server
        // returns the richer form.
        var name = (v && typeof v === "object") ? String(v.name || v.value || "") : String(v)
        if (name.length > 0) out.push({ value: name, label: name })
      }
      root.sayVoices = out
    })
  }

  function refreshTtsPlayers() {
    if (!root.store) return
    root.store.detectPlayers(function (list) {
      var out = []
      for (var i = 0; i < list.length; i++) {
        var p = list[i]
        var name = (p && typeof p === "object") ? String(p.path || p.name || "") : String(p)
        if (name.length > 0) out.push({ value: name, label: name })
      }
      root.ttsPlayers = out
    })
  }

  property var installedSherpa: []
  property var installedSherpaRaw: []

  function refreshSherpaPresets() {
    if (!root.rpc) return
    root.rpc.invoke("sherpa:listInstalledModels", [], function(result) {
      var list = Array.isArray(result) ? result : []
      installedSherpaRaw = list
      var opts = []
      for (var i = 0; i < list.length; i++) {
        var p = list[i]
        // Server shape is { id, dir }. Drop into Dropdown options.
        if (p && typeof p === "object" && p.id) {
          opts.push({ value: String(p.id), label: String(p.id) + " (installed)" })
        }
      }
      installedSherpa = opts
    }, function(err) {
      if (root.store) root.store.error = String(err)
    })
  }

  Component.onCompleted: {
    // Lazy: don't fire the list on mount. The settings page mounts this
    // component twice (voiceInput + tts); each instance would otherwise
    // make one round-trip on first paint. The user pulls a fresh list via
    // the Refresh button, or the settings page can call refreshSherpaPresets()
    // from its onSectionChanged hook.
  }
}