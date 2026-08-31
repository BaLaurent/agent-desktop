import QtQuick

// Continuous-voice gate decisions live in lib/voiceGate.js — PURE functions
// (no state), so they are testable in node AND callable from QML.
import "../lib/voiceGate.js" as VG
// ContinuousVoiceStore — always-listening capture pipeline + voice gate.
//
// Owns exactly the state this surface produces:
//   active         bridge is currently capturing (cvStateChanged(true))
//   phase          coarse UI phase: idle / listening / speaking /
//                  transcribing / classifying
//   lastIgnored    most-recent gate-rejection reason, for a transient UI hint
//   error          last failure string from the bridge, cleared on every start
//
// The store does NOT decide WHERE a transcript goes — the orchestrator
// (App.qml) listens to `utteranceReady(text)` and routes it into the active
// conversation, exactly like `transcriptReady` in VoiceStore.qml.
//
// Continuous-voice mode is text-gated in the QML front (the reference
// Electron front detects wake words acoustically in a Web Worker; there is
// no non-DOM equivalent here). All wake/text decisions live in
// `lib/voiceGate.js`; this store's only contribution to the gate is:
//   - reading the live tuning from settingsStore (mode, follow-up window,
//     wake phrase)
//   - keeping the follow-up deadline (`_armedUntil`) and the classification
//     generation counter (`_classifyGen`) — stateful, but small
//
// The store does NOT import Quickshell, so it is qmltestrunner-loadable.
QtObject {
  id: store

  // Service.qml — owns invoke/subscribe and the cvStart/cvStop/cvPause
  // members + cvStateChanged / utteranceCaptured signals the orchestrator
  // is adding. Tests pass a fake that records calls and emits the same
  // signals.
  required property var rpc

  // SettingsStore — reads the ten continuousVoice_* / hotword_model keys
  // documented in the shared contract. Optional: when absent (testing, or
  // before the bridge authenticated) the store uses the documented defaults.
  property var settingsStore: null

  // The conversation a captured utterance is sent INTO. The orchestrator
  // wires this from the active conversation id; an id <= 0 means "no
  // conversation is open" and a would-be classify invocation is rejected
  // with reason 'no-conversation' rather than invoking with a bogus id.
  property int conversationId: 0

  property bool active: false
  property string phase: "idle"
  // "idle" | "listening" | "speaking" | "transcribing" | "classifying"
  property string error: ""
  property string lastIgnored: ""

  // Fired on every gate-approved utterance. The text is what the gate
  // decided to send (wakeword stripped, trimmed). The orchestrator is the
  // sole listener.
  signal utteranceReady(string text)

  // Following the reference, the follow-up deadline is owned by the store.
  // `lib/voiceGate.js` has no state of its own; every decide(…) call
  // receives the current deadline and a clock, so the gate stays pure and
  // the same deadline is the one we update when an exchange completes.
  property real armedUntil: 0

  // Monotonic counter incremented on every NEW classify request. A late
  // reply from a superseded utterance carries a stale generation and is
  // dropped, exactly like `createVoiceGate.ts`'s `generation` counter.
  // Property on the store (not a closure variable) so a test can reset it.
  property int classifyGeneration: 0

  Component.onCompleted: {
    // Bridge → store. `cvStateChanged(active, error)` is the canonical
    // signal the orchestrator wires: `active` flips on cvStart/cvStop
    // ack and on user pause/resume. A non-empty `error` is a HARD
    // failure — the bridge stops itself and reports why; we mirror that
    // and reset to idle so the UI can show the reason.
    rpc.cvStateChanged.connect(function(active, err) {
      var wasActive = store.active
      store.active = active === true
      if (store.active) {
        // Bridge accepted the start. Clear any stale failure.
        error = ""
        if (phase === "idle" || phase === "speaking") phase = "listening"
        return
      }
      // Deactivation. The bridge can stop on user demand (cvStop/cvPause),
      // on its own (child died), or on failure — only the last carries
      // an error string.
      var failure = err === undefined || err === null ? "" : String(err)
      if (failure.length > 0) {
        error = failure
        phase = "idle"
        // A failure that arrived WITHOUT a prior `active:true` is the
        // "bridge refused the start" path — clear classifyGeneration so
        // a queued reply from the PREVIOUS run cannot sneak through.
        classifyGeneration++
        armedUntil = 0
        return
      }
      if (wasActive) {
        // Capture ended cleanly.
        phase = phase === "classifying" ? phase : "idle"
      }
    })

    // An utterance the bridge has finished capturing + VAD-finalizing.
    // `startedAt`/`endedAt` are the bridge's own clock (ms since epoch,
    // same clock the wake-event detector stamps with when present —
    // here they are unused: the text-gate does not correlate audio
    // spans, only the wake phrase). We carry them through for parity
    // with the reference store.
    rpc.utteranceCaptured.connect(function(b64, startedAt, endedAt) {
      onUtteranceCaptured_(b64, startedAt, endedAt)
    })
  }

  // Read the ten continuousVoice_* / hotword_model keys with the documented
  // defaults. Centralised so `start()` and the gate both see the same
  // numbers.
  function _readGateConfig() {
    var s = settingsStore
    var raw = (s && s.get) ? function(k, fb) { return s.get(k, fb) } : function(k, fb) { return fb }

    var mode = raw("continuousVoice_gateMode", "wakeword") === "intent" ? "intent" : "wakeword"
    // The hotword model id doubles as the spoken phrase for cosmetic
    // text-strip: 'hey_jarvis' → 'hey jarvis', custom 'hey_clawd' →
    // 'hey clawd'. The Electron front does the same thing in
    // readGateConfig() (config.ts:73).
    var wakeword = String(raw("hotword_model", "hey jarvis")).replace(/_/g, " ")
    var followupWindowMs = Number(raw("continuousVoice_followupWindowMs", 8000))
    if (!isFinite(followupWindowMs) || followupWindowMs <= 0) followupWindowMs = 0

    return { mode: mode, wakeword: wakeword, followupWindowMs: followupWindowMs }
  }


  function _readVadConfig() {
    var raw = (settingsStore && settingsStore.get)
      ? function(k, fb) { return settingsStore.get(k, fb) }
      : function(k, fb) { return fb }


    var readNum = function(key, fallback) {
      var v = Number(raw(key, fallback))
      return isFinite(v) && String(raw(key, "")) !== "" ? v : fallback
    }

    return {
      silenceThreshold: readNum("continuousVoice_silenceThreshold", 0.012),
      silenceDurationMs: readNum("continuousVoice_silenceDurationMs", 900),
      minUtteranceMs: readNum("continuousVoice_minUtteranceMs", 400),
      onsetBlocks: 3,
      preSpeechPadMs: readNum("continuousVoice_preSpeechPadMs", 200),
    }
  }

  // ---- transcribe dispatch (verbatim VoiceStore.transcribeChannel pattern) --

  // Pick the channel based on `stt_backend`. `'sherpa'` selects sherpa;
  // ANY other value (including empty, undefined, 'whisper', a typo)
  // selects whisper. Matches the server's own default branch and is
  // exactly what VoiceStore.qml::transcribeChannel() does.
  function _transcribeChannel() {
    if (!settingsStore) return "whisper:transcribe"
    var backend = settingsStore.get("stt_backend", "")
    return backend === "sherpa" ? "sherpa:transcribe" : "whisper:transcribe"
  }

  // ---- utterance pipeline ------------------------------------------------

  function onUtteranceCaptured_(b64, startedAt, endedAt) {
    // Defensive: an empty b64 (the bridge aborted before producing any
    // PCM) must not invoke any transcribe channel.
    if (!b64 || b64.length === 0) {
      if (active) phase = "listening"
      return
    }
    phase = "transcribing"
    var args = [{ __b64: b64 }]
    rpc.invoke(_transcribeChannel(), args, function(result) {
      var text = result && typeof result === "object" && typeof result.text === "string"
        ? result.text
        : ""
      _onTranscript(text)
    }, function(err) {
      // A failed transcription clears `phase` back to listening and
      // surfaces the error — the user's transcript is gone, so we
      // owe them an explanation.
      error = String(err)
      phase = active ? "listening" : "idle"
    })
  }

  function _onTranscript(text) {
    // Empty transcript: the user spoke but STT returned nothing (silence,
    // mic-only noise). Drop on the floor; gate's empty-text branch
    // covers it but we can avoid the work entirely.
    if (!text || String(text).trim().length === 0) {
      phase = active ? "listening" : "idle"
      return
    }
    var cfg = _readGateConfig()
    // Decide uses Date.now() by default; pass it explicitly so the same
    // deadline check is reproducible from a test (the test sets a fixed
    // value by stubbing Date.now via `nowMs` — we accept either path
    // because `Date.now` cannot be stubbed in QML, but the test uses
    // `nowMs` via an alternative route: see the test for the
    // `setSystemClock_` shim).
    var decision = VG.decide({
      text: text,
      mode: cfg.mode,
      wakeword: cfg.wakeword,
      armedUntil: armedUntil,
      nowMs: Date.now()
    })


    if (decision.action === "send") {
      // Commit. If the gate armed on this decision (Case 1), extend the
      // window so the user's next utterance (after a pause) is free.
      if (decision.arm) armedUntil = VG.armUntil(Date.now(), cfg.followupWindowMs)
      phase = "listening"
      lastIgnored = ""
      error = ""
      utteranceReady(decision.text)
      return
    }

    if (decision.action === "ignore") {
      // Subtle UI hint. The reason is the same vocabulary the reference
      // uses (`no-wakeword`, `wakeword-only`, `empty`); a wakeword-only
      // ignore is the user's "hey jarvis" pause and arms the next
      // utterance for free.
      if (decision.arm) armedUntil = VG.armUntil(Date.now(), cfg.followupWindowMs)
      phase = "listening"
      lastIgnored = decision.reason
      return
    }

    // classify. Bump the generation so any older pending reply drops.
    // The handler's return shape is { addressed: boolean }; per the
    // reference, anything other than a truthy `addressed` is "not
    // addressed" — including a rejected invoke.
    if (conversationId <= 0) {
      // Fail-closed: don't invoke with a bogus id. The handler returns
      // {addressed:false} for a non-positive id (verified — handler
      // treats it as "no conversation open"), so an invocation would
      // silently look like "not addressed". Surface the no-conversation
      // reason explicitly so the UI can explain it.
      phase = "listening"
      lastIgnored = "no-conversation"
      return
    }
    var myGen = classifyGeneration + 1
    classifyGeneration = myGen
    phase = "classifying"
    rpc.invoke("voice:classifyIntent", [conversationId, text], function(result) {
      // A newer utterance may have arrived while we waited — its reply
      // would carry a higher generation. Drop ours.
      if (myGen !== classifyGeneration) {
        phase = active ? "listening" : "idle"
        return
      }
      var addressed = !!(result && typeof result === "object" && result.addressed === true)
      if (addressed) {
        // Open the follow-up window for the user's next utterance.
        var cfg2 = _readGateConfig()
        armedUntil = VG.armUntil(Date.now(), cfg2.followupWindowMs)
        phase = "listening"
        lastIgnored = ""
        error = ""
        utteranceReady(text)
      } else {
        phase = "listening"
        lastIgnored = "not-addressed"
      }
    }, function(err) {
      // Fail-closed: never send an unverified utterance.
      if (myGen !== classifyGeneration) {
        phase = active ? "listening" : "idle"
        return
      }
      error = String(err)
      phase = active ? "listening" : "idle"
      lastIgnored = "classify-error"
    })
  }

  // ---- public API -------------------------------------------------------

  // The orchestrator wires the bridge members and signals; we reach them
  // through the `rpc` reference.
  function start() {
    if (active) return
    error = ""
    lastIgnored = ""
    var vad = _readVadConfig()
    // Bridge protocol: `{"op":"cv.start","config":{...}}` (see
    // bridge/bridge.mjs). The config is a single object — silence
    // duration, threshold, utterance floor, pre-roll.
    rpc.cvStart({
      silenceThreshold: vad.silenceThreshold,
      silenceDurationMs: vad.silenceDurationMs,
      minUtteranceMs: vad.minUtteranceMs,
      onsetBlocks: vad.onsetBlocks,
      preSpeechPadMs: vad.preSpeechPadMs
    })
    // We optimistically set `phase = "listening"`; if the bridge refuses
    // the start it will fire `cvStateChanged(false, "<reason>")` and
    // the handler above resets to idle.
    phase = "listening"
  }

  function stop() {
    if (!active && phase === "idle") return
    rpc.cvStop()
    phase = "idle"
    lastIgnored = ""
    // Stop invalidates any in-flight classification AND clears the
    // follow-up window. Mirrors `createVoiceGate.ts::dispose`.
    classifyGeneration++
    armedUntil = 0
  }

  // Pause/resume capture WITHOUT changing `active`. Pause here is
  // "muted" — the bridge keeps its mic handle warm so resume is instant,
  // but no utterances reach us. The orchestrator's `pauseDuringTts`
  // setting (default true) drives this while the agent speaks.
  function setPaused(paused) {
    rpc.cvPause(paused === true)
  }

  // Called by the orchestrator when an exchange completes. Opens the
  // follow-up window so the user's next utterance is accepted without
  // a wake word or a (paid) classification.
  function notifyExchangeComplete() {
    // `armUntil` owns the "a window of 0 means the feature is off" rule, so
    // this does NOT re-test it: one formula, one place. Inlining
    // `Date.now() + ms` here (and at the three sites above) is what left that
    // function dead on arrival.
    armedUntil = VG.armUntil(Date.now(), _readGateConfig().followupWindowMs)
  }
}
