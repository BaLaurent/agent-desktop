import QtQuick
import QtTest

// VoiceStore — push-to-talk capture + STT routing, exercised in a real QML
// engine.
//
// The behaviour under test is a state machine + a channel-selector, both of
// which need real QML signals and real invoke/subscribe plumbing. A node
// test on a plain JS object cannot drive `rpc.recordingChanged(...)`, so the
// fake here is an Item that:
//   - records every invoke call (channel, args, ok-cb, err-cb)
//   - exposes an accept/refuse pair keyed by channel
//   - exposes real Qt signals (`recordingChanged`, `audioReady`) that
//     .connect()-based subscriptions land on, exactly like the real
//     Service.qml — a last-callback-only fake (the trap already bitten in
//     the previous wave) cannot do that.
//
// The bridge is responsible for actual capture; this test does NOT exercise
// `pw-record` — it only proves the store routes correctly and resets state
// at every transition.
Item {
  width: 200
  height: 200

  // Fake rpc — must be an Item so its signals retain handlers attached via
  // .connect(). The store uses Component.onCompleted to wire its handlers;
  // we only need to drive them with the same emit() call.
  Item {
    id: fakeRpc
    property var calls: []
    property string recOp: ""

    // Real signals the store connects to. Emit with `emitRecordingChanged`
    // and `emitAudioReady` (which call the QObject emit() for these).
    // `recordingChanged`'s second argument is the recorder's own failure
    // reason, non-empty only when capture stopped because it broke — it MUST
    // stay in this fake's signature or the store's handler silently receives
    // `undefined` and the failure path goes untested.
    signal recordingChanged(bool active, string error)
    signal audioReady(string b64)

    function recStart() { recOp = "start" }
    function recStop()  { recOp = "stop" }
    function recCancel(){ recOp = "cancel" }

    function invoke(channel, args, onOk, onErr) {
      calls = calls.concat([{ channel: channel, args: args, ok: onOk, err: onErr }])
      return calls.length
    }

    function callFor(channel) {
      // Walk newest-first so a test driving transcribe then validate still
      // gets the right callback for each.
      for (var i = calls.length - 1; i >= 0; i--) if (calls[i].channel === channel) return calls[i]
      throw new Error("no call to " + channel)
    }

    function accept(channel, result) { callFor(channel).ok(result) }
    function refuse(channel, message) { callFor(channel).err(message) }

    function reset() { calls = []; recOp = "" }

    function emitRecordingChanged(active) { fakeRpc.recordingChanged(active === true, "") }
    function emitRecorderFailed(reason)   { fakeRpc.recordingChanged(false, String(reason)) }
    function emitAudioReady(b64)         { fakeRpc.audioReady(String(b64 || "")) }
  }

  // Fake settings store. The real one is heavier than we need; this is just
  // the `get(key, fallback)` shape VoiceStore reads.
  QtObject {
    id: fakeSettings
    property var values: ({})
    function get(key, fallback) {
      if (values && values[key] !== undefined && values[key] !== null) return values[key]
      return fallback === undefined ? "" : fallback
    }
  }

  Loader {
    id: storeLoader
    Component.onCompleted: setSource("../../stores/VoiceStore.qml", ({
      rpc: fakeRpc,
      settingsStore: fakeSettings
    }))
  }

  TestCase {
    name: "VoiceStore"
    when: windowShown

    property var store: storeLoader.item

    function initTestCase() {
      verify(store !== null, "VoiceStore.qml loaded")
    }

    function init() {
      fakeRpc.reset()
      fakeSettings.values = ({})
      store.recording = false
      store.transcribing = false
      store.lastTranscript = ""
      store.error = ""
      store.starting = false
    }

    // start() must write through to the bridge via rpc.recStart().
    function test_start_invokes_bridge_rec_start() {
      verify(fakeRpc.recOp === "")
      store.start()
      compare(fakeRpc.recOp, "start")
    }
    function test_stop_invokes_bridge_rec_stop() {
      store.recording = true
      store.stop()
      compare(fakeRpc.recOp, "stop")
    }

    function test_cancel_invokes_bridge_rec_cancel() {
      store.cancel()
      compare(fakeRpc.recOp, "cancel")
    }

    // --- toggle() semantics ----------------------------------------------

    function test_toggle_from_idle_emits_rec_start() {
      // The keyboard shortcut path: a single press with no prior capture.
      store.toggle()
      compare(fakeRpc.recOp, "start")
      compare(store.starting, true)
    }

    function test_toggle_again_before_bridge_reply_emits_rec_stop() {
      // Two rapid presses before the bridge's `rec.active=true` reply.
      // Without the starting guard both would call start(); with it, the
      // second toggle sees `starting=true` and calls stop() so the user's
      // double-tap aborts cleanly instead of leaving a phantom record.
      store.toggle()
      compare(fakeRpc.recOp, "start")
      store.toggle()
      // recStop is the second op written, but recOp only tracks the latest
      // call name — so after both toggles, the bridge was last told to stop.
      compare(fakeRpc.recOp, "stop")
      compare(store.starting, false)
    }

    function test_toggle_while_recording_emits_rec_stop() {
      // MicButton path or a single press after the bridge acknowledged.
      store.recording = true
      store.toggle()
      compare(fakeRpc.recOp, "stop")
    }

    function test_recordingChanged_true_clears_starting() {
      store.toggle()           // sets starting=true and calls recStart
      compare(store.starting, true)
      fakeRpc.emitRecordingChanged(true)
      compare(store.starting, false)
      compare(store.recording, true)
    }

    function test_cancel_clears_starting() {
      store.toggle()           // starting=true, recStart called
      store.cancel()           // starting=false, recCancel called
      compare(store.starting, false)
      compare(fakeRpc.recOp, "cancel")
    }

    function test_start_is_noop_when_starting() {
      store.toggle()           // starting=true
      fakeRpc.reset()
      store.start()            // second start before the bridge replied
      compare(fakeRpc.recOp, "")
    }

    function test_stop_is_noop_when_idle() {
      // No recording, no starting — the keyboard handler sometimes calls
      // stop() defensively (Escape); must not crash the bridge.
      store.stop()
      compare(fakeRpc.recOp, "")
    }

    function test_audioReady_with_empty_b64_does_not_invoke() {
      // Drive: recordingChanged(true) → audioReady("") (the cancel path
      // emits rec.active=false first, then no audio at all; the store
      // must clear transcribing and NOT call any transcribe channel).
      store.transcribing = false
      fakeRpc.emitRecordingChanged(true)
      fakeRpc.emitRecordingChanged(false)
      fakeRpc.emitAudioReady("")
      compare(store.recording, false)
      compare(store.transcribing, false)
      // Asserts the INTENT — no transcription was attempted — rather than
      // "no calls at all". End-of-capture legitimately emits `voice:restore`
      // to un-duck the user's audio, so a bare `calls.length === 0` was a
      // proxy that broke the moment ducking was wired in.
      // Counted rather than fetched: the fake's callFor() throws when a
      // channel was never called, which is the case being asserted.
      var seen = []
      for (var i = 0; i < fakeRpc.calls.length; i++) seen.push(fakeRpc.calls[i].channel)
      compare(seen.indexOf("whisper:transcribe"), -1,
        "an empty capture must not invoke whisper")
      compare(seen.indexOf("sherpa:transcribe"), -1,
        "an empty capture must not invoke sherpa")
    }

    function test_audioReady_routes_to_whisper_by_default() {
      fakeSettings.values = ({})
      store.transcribing = false
      fakeRpc.emitAudioReady("YWJj")
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "whisper:transcribe")
    }

    function test_audioReady_routes_to_sherpa_when_setting_is_sherpa() {
      fakeSettings.values = ({ stt_backend: "sherpa" })
      fakeRpc.emitAudioReady("YWJj")
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "sherpa:transcribe")
    }

    function test_audioReady_routes_to_whisper_for_anything_else() {
      // Typo / empty / 'whisper' explicit / arbitrary string all → whisper.
      fakeSettings.values = ({ stt_backend: "WHISPER" })
      fakeRpc.emitAudioReady("YWJj")
      compare(fakeRpc.calls[0].channel, "whisper:transcribe")
      fakeRpc.reset()
      fakeSettings.values = ({ stt_backend: "" })
      fakeRpc.emitAudioReady("YWJj")
      compare(fakeRpc.calls[0].channel, "whisper:transcribe")
      fakeRpc.reset()
      fakeSettings.values = ({ stt_backend: "whisper" })
      fakeRpc.emitAudioReady("YWJj")
      compare(fakeRpc.calls[0].channel, "whisper:transcribe")
    }

    function test_audioReady_args_are_exactly_the_b64_marker() {
      fakeRpc.emitAudioReady("YWJjMTIz")
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].args.length, 1)
      // Exactly the __b64 spelling. QML cannot build a Uint8Array; the
      // bridge rewrites this to the server's binary wire form.
      compare(fakeRpc.calls[0].args[0].__b64, "YWJjMTIz")
      // No other keys.
      var keys = Object.keys(fakeRpc.calls[0].args[0])
      compare(keys.length, 1)
      compare(keys[0], "__b64")
    }

    function test_transcribe_success_emits_transcriptReady() {
      var got = ""
      var fired = 0
      store.transcriptReady.connect(function(text) { got = text; fired++ })
      fakeRpc.emitAudioReady("YWJj")
      fakeRpc.accept("whisper:transcribe", { text: "hello world" })
      compare(fired, 1)
      compare(got, "hello world")
      compare(store.lastTranscript, "hello world")
      compare(store.transcribing, false)
      compare(store.error, "")
    }

    function test_transcribe_empty_text_still_emits_signal() {
      var got = "sentinel"
      var fired = 0
      store.transcriptReady.connect(function(text) { got = text; fired++ })
      fakeRpc.emitAudioReady("YWJj")
      fakeRpc.accept("whisper:transcribe", { text: "" })
      compare(fired, 1)
      compare(got, "")
      compare(store.lastTranscript, "")
      compare(store.transcribing, false)
    }

    function test_transcribe_failure_surfaces_error_and_clears_state() {
      var fired = 0
      store.transcriptReady.connect(function(text) { fired++ })
      fakeRpc.emitAudioReady("YWJj")
      fakeRpc.refuse("whisper:transcribe", "whisper binary not found")
      compare(fired, 0)
      compare(store.transcribing, false)
      compare(store.error, "whisper binary not found")
    }

    function test_recordingChanged_true_clears_error_and_transcribing() {
      store.error = "stale"
      store.transcribing = true
      store.recording = false
      fakeRpc.emitRecordingChanged(true)
      compare(store.recording, true)
      compare(store.transcribing, false)
      compare(store.error, "")
    }

    function test_recordingChanged_false_drops_recording() {
      store.recording = true
      fakeRpc.emitRecordingChanged(false)
      compare(store.recording, false)
    }

    // A failed transcribe then a successful one must clear the error
    // string — otherwise a stale "whisper binary not found" message stays
    // on screen even after the user fixes the config and re-dictates.
    function test_transcribe_failure_then_success_clears_error() {
      store.error = "stale: should be cleared by next success"
      fakeRpc.emitAudioReady("YWJj")
      fakeRpc.refuse("whisper:transcribe", "whisper binary not found")
      compare(store.error, "whisper binary not found")
      fakeRpc.emitAudioReady("YWJj")
      fakeRpc.accept("whisper:transcribe", { text: "hi" })
      compare(store.error, "")
    }

    // --- audio ducking -----------------------------------------------------
    //
    // The old front ducks system volume for the duration of a capture
    // (voiceInputStore.ts:93 / :112). Without it the mic records whatever is
    // playing and the user cannot hear themselves. The failure that matters
    // most here is a LEAK: ducked audio with nothing recording, which the UI
    // gives the user no way to notice or undo.

    function _channels() {
      var out = []
      for (var i = 0; i < fakeRpc.calls.length; i++) out.push(fakeRpc.calls[i].channel)
      return out
    }

    function test_start_ducks_audio() {
      store.start()
      verify(_channels().indexOf("voice:duck") >= 0, "starting a capture ducks system audio")
    }

    function test_stop_restores_audio() {
      store.start()
      fakeRpc.emitRecordingChanged(true)
      fakeRpc.calls = []
      store.stop()
      verify(_channels().indexOf("voice:restore") >= 0, "stopping restores audio")
    }

    function test_cancel_restores_audio() {
      store.start()
      fakeRpc.emitRecordingChanged(true)
      fakeRpc.calls = []
      store.cancel()
      verify(_channels().indexOf("voice:restore") >= 0,
        "Escape during a capture must not leave the volume ducked")
    }

    // The leak path: the recorder stops on its own, so neither stop() nor
    // cancel() ran. Nothing else would ever restore the volume.
    function test_recorder_stopping_by_itself_restores_audio() {
      store.start()
      fakeRpc.emitRecordingChanged(true)
      fakeRpc.calls = []
      fakeRpc.emitRecordingChanged(false)
      verify(_channels().indexOf("voice:restore") >= 0,
        "a capture that ends on its own still restores audio")
    }

    // Guard against restoring on an event that is not an end-of-capture:
    // a stray `active:false` while nothing was recording must stay silent,
    // or every idle bridge frame would fight the user's volume.
    function test_no_restore_when_nothing_was_recording() {
      fakeRpc.calls = []
      fakeRpc.emitRecordingChanged(false)
      compare(_channels().indexOf("voice:restore"), -1,
        "no capture was running, so there is nothing to restore")
    }

    // Ducking must not depend on the audio backend existing.
    function test_duck_failure_does_not_surface_as_voice_error() {
      store.start()
      fakeRpc.refuse("voice:duck", "no audio backend")
      compare(store.error, "", "a duck failure must not cost the user their dictation")
    }

    // ---- recorder death is VISIBLE ------------------------------------
    // Measured on this machine: with no capture source, pw-record writes
    // "no target node available" and exits. The bridge had already sent
    // `rec active:true` and reported the failure only through its `log`
    // channel, which nothing in the UI reads — so the mic button stayed lit
    // and the screen said nothing at all.

    function test_recorder_failure_before_first_byte_surfaces() {
      store.start()
      compare(store.starting, true, "start() waits on the bridge")
      // Failure arrives without any preceding `active:true`.
      fakeRpc.emitRecorderFailed("stream node 60 error: no target node available")
      compare(store.error, "stream node 60 error: no target node available",
        "the recorder's own reason must reach the UI")
      compare(store.starting, false, "a failed start must not stay pending")
      compare(store.recording, false, "nothing is recording")
      compare(store.transcribing, false, "nothing to transcribe")
    }

    function test_recorder_failure_mid_capture_surfaces() {
      store.start()
      fakeRpc.emitRecordingChanged(true)
      compare(store.recording, true, "capture running")
      fakeRpc.emitRecorderFailed("pw-record exited unexpectedly (code 1)")
      compare(store.recording, false, "capture is over")
      compare(store.error, "pw-record exited unexpectedly (code 1)",
        "a mid-capture death must explain itself")
    }

    function test_recorder_failure_unducks_the_user() {
      store.start()
      fakeRpc.emitRecordingChanged(true)
      fakeRpc.reset()
      fakeRpc.emitRecorderFailed("device disappeared")
      var seen = []
      for (var i = 0; i < fakeRpc.calls.length; i++) seen.push(fakeRpc.calls[i].channel)
      verify(seen.indexOf("voice:restore") !== -1,
        "a failure must not leave the user's volume ducked forever")
    }

    function test_a_clean_stop_carries_no_error() {
      store.start()
      fakeRpc.emitRecordingChanged(true)
      store.stop()
      fakeRpc.emitRecordingChanged(false)
      compare(store.error, "", "an ordinary stop is not a failure")
    }
  }
}