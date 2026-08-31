import QtQuick
import QtTest

// ContinuousVoiceStore — always-listening capture + text-gated voice gate.
//
// The reference behaviour is in src/renderer/services/continuousVoice/ and
// src/renderer/services/voiceGate/. The QML front delegates the gate decision
// to `lib/voiceGate.js` (tested in tests/test_voice_gate.js) and only owns
// the follow-up deadline and classification generation counter. This test
// exercises the STORE: signal wiring, transcribe-channel routing, send/ignore
// emission, generation-counter supersede, and cvStateChanged error path.
//
// Fake-rpc shape mirrors tst_chat_store.qml / tst_voice_store.qml: an Item
// with real signals (.connect() handlers stay alive across tests), an
// `invoke` recorder, and an accept/refuse pair keyed by channel.
Item {
  width: 200
  height: 200

  // ---- minimal SettingsStore stand-in ----------------------------------
  QtObject {
    id: fakeSettings
    property var values: ({})
    function get(key, fallback) {
      if (values && values[key] !== undefined && values[key] !== null
          && values[key] !== "") return values[key]
      return fallback === undefined ? "" : fallback
    }
  }

  // ---- fake rpc --------------------------------------------------------
  Item {
    id: fakeRpc

    property var calls: []
    // cvStart/cvStop/cvPause are recorded verbatim — the store calls them
    // via `rpc.cvStart(...)`, the orchestrator wires these through the
    // bridge. We track the latest config object for assertions.
    property var cvConfigs: []
    property string lastCvOp: ""
    property bool cvPauseArg: false

    // Real signals — the store wires its handlers via .connect() in
    // Component.onCompleted; signals on a QtObject are not connectable,
    // so this MUST be an Item (same trap tst_voice_store.qml calls out).
    signal cvStateChanged(bool active, string error)
    signal utteranceCaptured(string b64, real startedAt, real endedAt)

    function cvStart(config) {
      cvConfigs = cvConfigs.concat([config || {}])
      lastCvOp = "start"
    }
    function cvStop() {
      lastCvOp = "stop"
    }
    function cvPause(paused) {
      cvPauseArg = paused === true
      lastCvOp = "pause"
    }

    function invoke(channel, args, onOk, onErr) {
      calls = calls.concat([{ channel: channel, args: args || [], ok: onOk, err: onErr }])
      return calls.length
    }

    function callFor(channel) {
      for (var i = calls.length - 1; i >= 0; i--) if (calls[i].channel === channel) return calls[i]
      throw new Error("no call to " + channel)
    }
    function accept(channel, result) { callFor(channel).ok(result) }
    function refuse(channel, message) { callFor(channel).err(message) }
    function reset() {
      calls = []
      cvConfigs = []
      lastCvOp = ""
      cvPauseArg = false
    }

    function emitCvStateChanged(active, err) {
      fakeRpc.cvStateChanged(active === true, err === undefined ? "" : String(err))
    }
    function emitUtteranceCaptured(b64, startedAt, endedAt) {
      fakeRpc.utteranceCaptured(String(b64 || ""), Number(startedAt || 0), Number(endedAt || 0))
    }
  }

  Loader {
    id: storeLoader
    Component.onCompleted: setSource("../../stores/ContinuousVoiceStore.qml", ({
      rpc: fakeRpc,
      settingsStore: fakeSettings
    }))
  }

  TestCase {
    name: "ContinuousVoiceStore"
    when: windowShown

    property var store: storeLoader.item

    function initTestCase() {
      verify(store !== null, "ContinuousVoiceStore.qml loaded")
    }

    function init() {
      fakeRpc.reset()
      fakeSettings.values = ({})
      store.active = false
      store.phase = "idle"
      store.error = ""
      store.lastIgnored = ""
      store.armedUntil = 0
      store.classifyGeneration = 0
      store.conversationId = 0
    }

    // ---- start/stop forwarding to the bridge ---------------------------

    function test_start_invokes_cvStart_with_vad_config() {
      fakeSettings.values = ({
        continuousVoice_silenceThreshold: "0.020",
        continuousVoice_silenceDurationMs: "1200",
        continuousVoice_minUtteranceMs: "600",
        continuousVoice_preSpeechPadMs: "300"
      })
      store.start()
      compare(fakeRpc.lastCvOp, "start")
      compare(fakeRpc.cvConfigs.length, 1)
      var cfg = fakeRpc.cvConfigs[0]
      compare(cfg.silenceThreshold, 0.020)
      compare(cfg.silenceDurationMs, 1200)
      compare(cfg.minUtteranceMs, 600)
      compare(cfg.onsetBlocks, 3)
      compare(cfg.preSpeechPadMs, 300)
    }

    function test_start_uses_defaults_when_settings_missing() {
      fakeSettings.values = ({})
      store.start()
      var cfg = fakeRpc.cvConfigs[0]
      compare(cfg.silenceThreshold, 0.012)
      compare(cfg.silenceDurationMs, 900)
      compare(cfg.minUtteranceMs, 400)
      compare(cfg.onsetBlocks, 3)
      compare(cfg.preSpeechPadMs, 200)
    }

    function test_start_while_active_is_noop() {
      fakeRpc.emitCvStateChanged(true)
      fakeRpc.reset()
      store.start()
      compare(fakeRpc.lastCvOp, "",
        "start() while active=true must not call cvStart again")
    }

    function test_stop_invokes_cvStop_and_resets_state() {
      fakeRpc.emitCvStateChanged(true)
      store.stop()
      compare(fakeRpc.lastCvOp, "stop")
      compare(store.phase, "idle")
      compare(store.armedUntil, 0)
    }

    function test_setPaused_forwards_and_does_not_change_active() {
      fakeRpc.emitCvStateChanged(true)
      fakeRpc.reset()
      store.setPaused(true)
      compare(fakeRpc.lastCvOp, "pause")
      compare(fakeRpc.cvPauseArg, true)
      compare(store.active, true,
        "pause is mute, not stop — capture is still running")
    }

    // ---- cvStateChanged wiring ------------------------------------------

    function test_cvStateChanged_true_clears_error_and_sets_listening() {
      store.error = "stale"
      store.phase = "idle"
      fakeRpc.emitCvStateChanged(true)
      compare(store.active, true)
      compare(store.error, "")
      compare(store.phase, "listening")
    }

    function test_cvStateChanged_false_with_error_clears_active() {
      fakeRpc.emitCvStateChanged(true)
      fakeRpc.emitCvStateChanged(false, "stream node 60 error: no target node")
      compare(store.active, false)
      compare(store.error, "stream node 60 error: no target node")
      compare(store.phase, "idle")
    }

    // ---- utterance pipeline: transcribe channel choice ------------------

    function test_utterance_routes_to_whisper_by_default() {
      fakeSettings.values = ({})
      fakeRpc.emitUtteranceCaptured("YWJj", 0, 1000)
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "whisper:transcribe")
      compare(fakeRpc.calls[0].args[0].__b64, "YWJj")
    }

    function test_utterance_routes_to_sherpa_when_setting_is_sherpa() {
      fakeSettings.values = ({ stt_backend: "sherpa" })
      fakeRpc.emitUtteranceCaptured("YWJj", 0, 1000)
      compare(fakeRpc.calls[0].channel, "sherpa:transcribe")
    }

    function test_empty_b64_does_not_invoke_transcribe() {
      fakeRpc.emitUtteranceCaptured("", 0, 0)
      compare(fakeRpc.calls.length, 0,
        "an empty b64 must NOT invoke any transcribe channel")
    }

    // ---- shared helpers (defined here so QML member-function
    // ---- hoisting is not relied upon) ---------------------------------

    function _callsTo(channel) {
      var out = []
      for (var i = 0; i < fakeRpc.calls.length; i++) {
        if (fakeRpc.calls[i].channel === channel) out.push(fakeRpc.calls[i])
      }
      return out
    }


    function test_send_decision_emits_utteranceReady_and_arms() {
      fakeSettings.values = ({ hotword_model: "hey jarvis" })
      fakeRpc.emitCvStateChanged(true)
      var fired = 0
      var gotText = ""
      store.utteranceReady.connect(function(text) { gotText = text; fired++ })

      fakeRpc.emitUtteranceCaptured("YWJj", 0, 1000)
      fakeRpc.accept("whisper:transcribe", { text: "hey jarvis what time is it" })
      compare(fired, 1)
      compare(gotText, "what time is it")
      compare(store.armedUntil > Date.now(), true,
        "a wakeword-mode send arms the follow-up window")
      compare(store.lastIgnored, "")
    }

    function test_ignore_decision_does_not_emit_utteranceReady() {
      // Bare wake phrase → ignore, but arm.
      fakeSettings.values = ({ hotword_model: "hey jarvis" })
      fakeRpc.emitCvStateChanged(true)
      var fired = 0
      store.utteranceReady.connect(function(text) { fired++ })
      fakeRpc.emitUtteranceCaptured("YWJj", 0, 1000)
      fakeRpc.accept("whisper:transcribe", { text: "hey jarvis" })
      compare(fired, 0, "a wakeword-only ignore must NOT emit utteranceReady")
      compare(store.lastIgnored, "wakeword-only")
      compare(store.armedUntil > Date.now(), true,
        "a wakeword-only ignore still arms the window")
    }

    function test_followup_window_short_circuits() {
      // Pre-arm the window, then send a transcript that does NOT start with
      // the wake phrase — the gate must accept it via followup.
      fakeSettings.values = ({
        hotword_model: "hey jarvis",
        continuousVoice_followupWindowMs: "8000"
      })
      fakeRpc.emitCvStateChanged(true)
      store.armedUntil = Date.now() + 8000
      var fired = 0
      var gotText = ""
      store.utteranceReady.connect(function(text) { gotText = text; fired++ })
      fakeRpc.emitUtteranceCaptured("YWJj", 0, 1000)
      fakeRpc.accept("whisper:transcribe", { text: "and what about tomorrow" })
      compare(fired, 1)
      compare(gotText, "and what about tomorrow")
      compare(_callsTo("voice:classifyIntent").length, 0,
        "follow-up window accepts without a classifier call")
    }



    // ---- intent mode: classify branch -----------------------------------

    function test_intent_mode_classify_addressed_emits_utteranceReady() {
      fakeSettings.values = ({
        hotword_model: "hey jarvis",
        continuousVoice_gateMode: "intent",
        continuousVoice_followupWindowMs: "8000"
      })
      fakeRpc.emitCvStateChanged(true)
      store.conversationId = 7
      var fired = 0
      var gotText = ""
      store.utteranceReady.connect(function(text) { gotText = text; fired++ })
      fakeRpc.emitUtteranceCaptured("YWJj", 0, 1000)
      fakeRpc.accept("whisper:transcribe", { text: "what is the capital of France" })
      // classify branch
      compare(_callsTo("voice:classifyIntent").length, 1)
      compare(_callsTo("voice:classifyIntent")[0].args[0], 7)
      compare(_callsTo("voice:classifyIntent")[0].args[1], "what is the capital of France")
      fakeRpc.accept("voice:classifyIntent", { addressed: true })
      compare(fired, 1)
      compare(gotText, "what is the capital of France")
      compare(store.lastIgnored, "")
    }

    function test_intent_mode_classify_refused_is_ignored() {
      fakeSettings.values = ({
        hotword_model: "hey jarvis",
        continuousVoice_gateMode: "intent",
        continuousVoice_followupWindowMs: "8000"
      })
      fakeRpc.emitCvStateChanged(true)
      store.conversationId = 7
      var fired = 0
      store.utteranceReady.connect(function(text) { fired++ })
      fakeRpc.emitUtteranceCaptured("YWJj", 0, 1000)
      fakeRpc.accept("whisper:transcribe", { text: "ugh so tired" })
      fakeRpc.accept("voice:classifyIntent", { addressed: false })
      compare(fired, 0, "not-addressed must NOT send")
      compare(store.lastIgnored, "not-addressed")
    }

    function test_intent_mode_classify_failure_is_fail_closed() {
      fakeSettings.values = ({
        hotword_model: "hey jarvis",
        continuousVoice_gateMode: "intent",
        continuousVoice_followupWindowMs: "8000"
      })
      fakeRpc.emitCvStateChanged(true)
      store.conversationId = 7
      var fired = 0
      store.utteranceReady.connect(function(text) { fired++ })
      fakeRpc.emitUtteranceCaptured("YWJj", 0, 1000)
      fakeRpc.accept("whisper:transcribe", { text: "hello there" })
      fakeRpc.refuse("voice:classifyIntent", "no creds")
      compare(fired, 0, "a failed classifier must NOT send (fail-closed)")
      compare(store.lastIgnored, "classify-error")
    }

    function test_no_conversation_skips_classify_invoke() {
      fakeSettings.values = ({
        hotword_model: "hey jarvis",
        continuousVoice_gateMode: "intent",
        continuousVoice_followupWindowMs: "8000"
      })
      fakeRpc.emitCvStateChanged(true)
      store.conversationId = 0
      var fired = 0
      store.utteranceReady.connect(function(text) { fired++ })
      fakeRpc.emitUtteranceCaptured("YWJj", 0, 1000)
      fakeRpc.accept("whisper:transcribe", { text: "what is the capital of France" })
      compare(_callsTo("voice:classifyIntent").length, 0,
        "conversationId<=0 must NOT call the classifier")
      compare(store.lastIgnored, "no-conversation")
      compare(fired, 0)
    }

    // ---- generation counter drops superseded replies -------------------

    function test_classify_reply_for_superseded_utterance_is_dropped() {
      fakeSettings.values = ({
        hotword_model: "hey jarvis",
        continuousVoice_gateMode: "intent",
        continuousVoice_followupWindowMs: "8000"
      })
      fakeRpc.emitCvStateChanged(true)
      store.conversationId = 7
      var fired = 0
      store.utteranceReady.connect(function(text) { fired++ })

      // First utterance — starts a classify, we do NOT accept yet.
      fakeRpc.emitUtteranceCaptured("YWJj", 0, 1000)
      fakeRpc.accept("whisper:transcribe", { text: "first" })
      compare(_callsTo("voice:classifyIntent").length, 1)

      // Second utterance arrives before the first classify replies — bumps
      // the generation counter, so the late reply must drop.
      fakeRpc.emitUtteranceCaptured("ZGVm", 1500, 2000)
      fakeRpc.accept("whisper:transcribe", { text: "second" })
      compare(_callsTo("voice:classifyIntent").length, 2)

      // Late reply for the FIRST classify (would say addressed:true if it
      // landed fresh). It must NOT emit utteranceReady.
      // The pending first classify is at index 1 (transcribe was index 0,
      // already accepted above). A late reply there must NOT emit.
      fakeRpc.calls[1].ok({ addressed: true })
      compare(fired, 0,
        "the superseded classify reply must NOT send")

      // Accept the second classify (index 3 — second transcribe was index 2,
      // already accepted) — now it sends.
      fakeRpc.calls[3].ok({ addressed: true })
      compare(fired, 1)
    }

    // ---- notifyExchangeComplete -----------------------------------------

    function test_notifyExchangeComplete_opens_followup_window() {
      fakeSettings.values = ({
        hotword_model: "hey jarvis",
        continuousVoice_followupWindowMs: "8000"
      })
      store.notifyExchangeComplete()
      compare(store.armedUntil > Date.now(), true)
      compare(store.armedUntil - Date.now() <= 8001, true,
        "the window should be ~followupWindowMs in the future")
    }

    function test_notifyExchangeComplete_with_zero_window_disables() {
      fakeSettings.values = ({
        hotword_model: "hey jarvis",
        continuousVoice_followupWindowMs: "0"
      })
      store.notifyExchangeComplete()
      compare(store.armedUntil, 0,
        "a 0 follow-up window means the feature is off, not armed forever")
    }

    // ---- wakeword string is the underscored hotword_model ---------------

    function test_wakeword_underscores_become_spaces() {
      fakeSettings.values = ({ hotword_model: "hey_clawd" })
      store.start()
      fakeRpc.emitCvStateChanged(true)
      var fired = 0
      var gotText = ""
      store.utteranceReady.connect(function(text) { gotText = text; fired++ })
      fakeRpc.emitUtteranceCaptured("YWJj", 0, 1000)
      fakeRpc.accept("whisper:transcribe", { text: "hey clawd lights on" })
      compare(fired, 1)
      compare(gotText, "lights on")
    }
  }
}
