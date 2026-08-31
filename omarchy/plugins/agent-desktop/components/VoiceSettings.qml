pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

import "../generated/settingDefs.js" as SD

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
  //   voiceInput section ALSO reads/writes (continuous voice subsection):
  //     continuousVoice_enabled           bool "true"/"false"
  //     continuousVoice_gateMode          "wakeword" | "intent"
  //     hotword_model                     string (also the wake phrase;
  //                                        underscores → spaces)
  //     continuousVoice_intentModel       string ("": use conversation)
  //     continuousVoice_intentPrompt      string ("": server default)
  //     continuousVoice_followupWindowMs  number ms (UI edits in SECONDS,
  //                                        0..60)
  //     continuousVoice_pauseDuringTts    bool "true"/"false"; default ON
  //                                        (anything but literal "false" is
  //                                        treated as true by the React
  //                                        settings page)
  //     continuousVoice_silenceThreshold  number 0..1, step 0.001
  //     continuousVoice_silenceDurationMs number 100..5000, step 50
  //     continuousVoice_minUtteranceMs    number 0..5000, step 50
  //     continuousVoice_preSpeechPadMs    number 0..2000, step 50
  //
  //   tts section reads/writes:
  //     tts_provider, tts_piperUrl, tts_edgettsVoice, tts_edgettsBinary,
  //     tts_sayVoice, tts_playerPath, tts_maxLength, tts_autoWordLimit,
  //     tts_summaryPrompt, tts_responseMode, tts_summaryModel
  //
  // PLATFORM SUBSTITUTION — wake-word gate is TEXT-based here, not audio:
  //   The Electron/React front runs VAD and openwakeword-js in a Web Worker
  //   over AudioContext frames; this QML front has no equivalent (no DOM,
  //   no AudioContext frames stream, no server channel that accepts raw
  //   audio frames). So in `gateMode == "wakeword"` the wake word is matched
  //   against the TRANSCRIBED text from the selected STT engine, with
  //   underscores read as spaces ("hey_jarvis" → "hey jarvis") and the
  //   matched prefix stripped from the utterance before it is sent. EVERY
  //   OTHER BEHAVIOUR of the gate (the follow-up window, intent
  //   classification, fail-closed on classifier error) is the same as
  //   src/renderer/services/voiceGate/createVoiceGate.ts. See
  //   `stores/ContinuousVoiceStore.qml` for the runtime wiring and
  //   `lib/voiceGate.js` for the pure decision function.
  //
  //   Not writable (no control is offered for these — `settings:set` REFUSES
  //   any key not in src/core/services/settings.ts ALLOWED_SETTING_KEYS, so
  //   a field that "looks writable" would silently revert on save):
  //     continuousVoice_intentBaseUrl, continuousVoice_intentApiKey,
  //     continuousVoice_pauseDuringProcessing, hotword_threshold,
  //     hotword_backend, hotword_modelSource.
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

  // Provider values, NOT labels, are a server contract: `speak()` switches on
  // this exact string (src/core/handlers/tts.ts:272-301) and THROWS
  // "Unknown TTS provider" on anything else. The list here used to offer
  // "auto" (no such case — every utterance threw) and the value "say" under
  // the label "spd-say" (`say` is the macOS binary and refuses to run on
  // Linux). Both looked like a working choice in the dropdown and could not
  // speak a word.
  readonly property var ttsProviders: [
    { value: "off",      label: "Off" },
    { value: "spd-say",  label: "spd-say" },
    { value: "piper",    label: "Piper (HTTP)" },
    { value: "edgetts",  label: "Edge TTS" }
  ]

  // Response modes come from the SERVER's own definition
  // (src/core/types/constants.ts TTS_RESPONSE_OPTIONS, emitted into
  // generated/settingDefs.js), never from a list retyped here.
  //
  // The retyped one offered "off" / "first" / "all", and `speakResponse` has a
  // branch for none of them: it understands off | full | summary | auto. A
  // user who picked "All messages" stored "all", every speak call fell through
  // the chain in silence, and BOTH the per-message Speak button and the
  // automatic response TTS did nothing at all — with no error to see, because
  // the call itself succeeded.
  readonly property var ttsResponseModes: {
    var defs = SD.SETTING_DEFS
    for (var i = 0; i < defs.length; i++) {
      if (defs[i].key === "tts_responseMode") return defs[i].options || []
    }
    return []
  }

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
        // `width: parent.width`, as QuickChatSettings does on every Toggle.
        // Without it the control sits at its implicit width and elides its own
        // label to "Auto-send transcript…" — a switch whose caption you cannot
        // finish reading.
        width: parent.width
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

      // ---- continuous voice (always-listening) -------------------------
      //
      // The wake-word gate here is TEXT-based (see header comment for why):
      // `hotword_model` is the wake phrase, with underscores read as spaces,
      // and is matched against the STT transcript prefix. Intent mode runs a
      // small classifier over each utterance; the base URL / API key are
      // deliberately not exposed (those keys are absent from
      // ALLOWED_SETTING_KEYS in src/core/services/settings.ts and `settings:
      // set` REFUSES them silently — a control would look like it worked and
      // not save).
      PanelSectionHeader { text: "Continuous voice (always-listening)" }

      Toggle {
        width: parent.width
        label: "Enable continuous voice mode"
        // Default OFF. Mirror the React settings' literal compare: "true"
        // is on, anything else (empty, "false", unset) is off.
        checked: root.settingsStore
          ? root.settingsStore.get("continuousVoice_enabled", "false") === "true"
          : false
        onClicked: {
          var next = !checked
          checked = next
          if (root.settingsStore) root.settingsStore.set("continuousVoice_enabled", next ? "true" : "false")
        }
      }

      // Everything below the master toggle is hidden when continuous voice
      // is off (mirrors ContinuousVoiceSettings.tsx).
      Column {
        width: parent.width
        spacing: Style.spacing.sm
        visible: root.settingsStore
          ? root.settingsStore.get("continuousVoice_enabled", "false") === "true"
          : false

        // ---- gate mode -------------------------------------------------
        Dropdown {
          width: parent.width
          label: "Gate"
          // Empty/unset → wakeword (matches the React fallback
          // `gateMode === 'intent' ? 'intent' : 'wakeword'`).
          value: root.settingsStore
            ? root.settingsStore.get("continuousVoice_gateMode", "wakeword")
            : "wakeword"
          options: [
            { value: "wakeword", label: "Wake word" },
            { value: "intent",   label: "Intent detection" }
          ]
          onChanged: function(v) {
            if (root.settingsStore) root.settingsStore.set("continuousVoice_gateMode", v)
          }
        }

        // Plain Text muted hint below the gate dropdown. Text is the one
        // plain-Qt type used here (others are qs.Ui); Color.muted is the
        // standard hint colour and Style.font.caption is the matching size.
        // Word-wrap so a long hint does not push the page width.
        Text {
          width: parent.width
          text: root.settingsStore
              && root.settingsStore.get("continuousVoice_gateMode", "wakeword") === "intent"
            ? "Runs a small AI check on each utterance to decide if you were talking to the assistant. Adds latency and cost per utterance."
            : "Only responds after the wake phrase is detected. In this front the wake phrase is matched against the TRANSCRIBED text (not the audio), so accuracy depends on the STT engine above."
          color: Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          wrapMode: Text.WordWrap
        }

        // ---- wakeword-only fields -------------------------------------
        Column {
          width: parent.width
          spacing: Style.spacing.sm
          visible: root.settingsStore
            ? root.settingsStore.get("continuousVoice_gateMode", "wakeword") !== "intent"
            : true

          TextField {
            width: parent.width
            // Doubles as the WAKE PHRASE — the gate does case- and
            // punctuation-insensitive token-prefix matching on the
            // transcript, with underscores read as spaces
            // (`hey_jarvis` → `hey jarvis`).
            placeholderText: "hey_jarvis"
            text: root.settingsStore ? root.settingsStore.get("hotword_model", "") : ""
            onEditingFinished: {
              if (root.settingsStore) root.settingsStore.set("hotword_model", text)
            }
          }

          Text {
            width: parent.width
            text: "The matched prefix is stripped from the transcript before it is sent, so you hear back the actual question. Underscores read as spaces (\"hey_jarvis\" → \"hey jarvis\")."
            color: Color.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
            wrapMode: Text.WordWrap
          }
        }

        // ---- intent-only fields ---------------------------------------
        Column {
          width: parent.width
          spacing: Style.spacing.sm
          visible: root.settingsStore
            ? root.settingsStore.get("continuousVoice_gateMode", "wakeword") === "intent"
            : false

          TextField {
            width: parent.width
            placeholderText: "Intent model (empty = use conversation's model)"
            text: root.settingsStore ? root.settingsStore.get("continuousVoice_intentModel", "") : ""
            onEditingFinished: {
              if (root.settingsStore) root.settingsStore.set("continuousVoice_intentModel", text)
            }
          }

          TextField {
            width: parent.width
            placeholderText: "Intent prompt (empty = server default)"
            text: root.settingsStore ? root.settingsStore.get("continuousVoice_intentPrompt", "") : ""
            onEditingFinished: {
              if (root.settingsStore) root.settingsStore.set("continuousVoice_intentPrompt", text)
            }
          }

          Text {
            width: parent.width
            text: "The server substitutes {{utterance}} and {{agent_name}} in the prompt. The cheapest and fastest preset is Haiku. Base URL and API key are intentionally NOT exposed — those keys are not in the server's allowed list and would silently fail to save."
            color: Color.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
            wrapMode: Text.WordWrap
          }
        }

        // ---- follow-up window (UI in seconds; setting stored in ms) --
        // React reference: ContinuousVoiceSettings.tsx:312-318 reads ms,
        // divides by 1000 and rounds for the field, and writes back
        // `String(seconds * 1000)`. Keep that contract intact.
        NumberField {
          label: "Follow-up window (seconds)"
          value: Math.round(Number(root.settingsStore
            ? root.settingsStore.get("continuousVoice_followupWindowMs", "8000")
            : "8000") / 1000)
          from: 0
          to: 60
          stepSize: 1
          onModified: function(v) {
            if (!root.settingsStore) return
            // Defensive clamp — write whatever the user typed, but never
            // out of range, mirroring the React `Math.max(0, v) * 1000`.
            var seconds = v < 0 ? 0 : (v > 60 ? 60 : v)
            root.settingsStore.set("continuousVoice_followupWindowMs", String(seconds * 1000))
          }
        }

        Text {
          width: parent.width
          text: "After a reply, the next thing you say is sent within this window without the wake word and without another classifier call. 0 = off."
          color: Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          wrapMode: Text.WordWrap
        }

        // ---- pause during TTS ----------------------------------------
        // The default is ON (true), and the React settings treat ANYTHING
        // BUT the literal string "false" as on (`!== 'false'`). A naive
        // `=== 'true'` here would invert the default: a missing setting
        // would render as OFF.
        Toggle {
          width: parent.width
          label: "Pause listening while the assistant speaks"
          checked: root.settingsStore
            ? root.settingsStore.get("continuousVoice_pauseDuringTts", "true") !== "false"
            : true
          onClicked: {
            var next = !checked
            checked = next
            if (root.settingsStore) root.settingsStore.set("continuousVoice_pauseDuringTts", next ? "true" : "false")
          }
        }

        Text {
          width: parent.width
          text: "Half-duplex: avoids the assistant hearing its own text-to-speech (feedback loop). Recommended."
          color: Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          wrapMode: Text.WordWrap
        }

        // ---- detection tuning (advanced) -----------------------------
        // A plain section header instead of a collapsible — the React
        // settings collapse it under "Voice activity detection (advanced)",
        // but adding a CollapseButton here would mean a new qs.Ui type
        // not already used in this file. Always-visible is fine for the
        // qml-check gate and the assignment's "ONLY the control types
        // already used in this file" rule.
        PanelSectionHeader { text: "Detection tuning" }

        // The existing NumberField only supports INT stepSize (its `value`
        // property is `int`), so silence threshold lives here scaled to
        // 0..1000 internally (real value 0..1) and is written back as the
        // true float to match the React settings and the server.
        NumberField {
          label: "Silence threshold (RMS × 1000)"
          value: Math.round(Number(root.settingsStore
            ? root.settingsStore.get("continuousVoice_silenceThreshold", "0.012")
            : "0.012") * 1000)
          from: 0
          to: 1000
          stepSize: 1
          onModified: function(v) {
            if (!root.settingsStore) return
            var clamped = v < 0 ? 0 : (v > 1000 ? 1000 : v)
            root.settingsStore.set("continuousVoice_silenceThreshold", String(clamped / 1000))
          }
        }

        Text {
          width: parent.width
          text: "Audio RMS below this counts as silence. Shown ×1000 because this control is integer-only: 12 here is the stored 0.012. Higher = stricter end-of-utterance detection (fewer half-spoken captures, but it cuts off quieter voices)."
          color: Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          wrapMode: Text.WordWrap
        }

        NumberField {
          label: "End-of-utterance silence (ms)"
          value: Number(root.settingsStore
            ? root.settingsStore.get("continuousVoice_silenceDurationMs", "900")
            : "900")
          from: 100
          to: 5000
          stepSize: 50
          onModified: function(v) {
            if (root.settingsStore) root.settingsStore.set("continuousVoice_silenceDurationMs", String(v))
          }
        }

        Text {
          width: parent.width
          text: "How long the signal must stay below the silence threshold before the utterance is finalised. Higher = longer pauses tolerated (slower, but fewer chopped sentences)."
          color: Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          wrapMode: Text.WordWrap
        }
        NumberField {
          label: "Minimum utterance (ms)"
          value: Number(root.settingsStore
            ? root.settingsStore.get("continuousVoice_minUtteranceMs", "400")
            : "400")
          from: 0
          to: 5000
          stepSize: 50
          onModified: function(v) {
            if (root.settingsStore) root.settingsStore.set("continuousVoice_minUtteranceMs", String(v))
          }
        }

        Text {
          width: parent.width
          text: "Shorter sounds (coughs, clicks) below this length are ignored. Higher = stricter (fewer accidental triggers, but quick commands may be dropped)."
          color: Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          wrapMode: Text.WordWrap
        }

        NumberField {
          label: "Pre-speech padding (ms)"
          value: Number(root.settingsStore
            ? root.settingsStore.get("continuousVoice_preSpeechPadMs", "200")
            : "200")
          from: 0
          to: 2000
          stepSize: 50
          onModified: function(v) {
            if (root.settingsStore) root.settingsStore.set("continuousVoice_preSpeechPadMs", String(v))
          }
        }

        Text {
          width: parent.width
          text: "Audio kept before the onset so the first word is not clipped. Higher = safer for soft consonants, but a touch more latency on every utterance."
          color: Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          wrapMode: Text.WordWrap
        }
      }
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