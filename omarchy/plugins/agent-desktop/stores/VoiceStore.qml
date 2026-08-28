import QtQuick

// VoiceStore — push-to-talk capture + STT routing.
//
// Owns exactly the state this surface produces:
//   recording        bridge is currently capturing (recordingChanged(true))
//   transcribing     bridge delivered audio and a transcribe invoke is in flight
//   lastTranscript   most recent successful transcript (handy for "re-paste")
//   error            last failure string, cleared on every successful start
//
// The capture pipeline runs through the bridge (bridge/bridge.mjs spawns
// `pw-record`, prepends a 44-byte RIFF header, emits `{"ev":"rec",...}` and
// `{"ev":"audio",...}`). On `audioReady(b64)` the store picks the transcribe
// channel from the `stt_backend` setting (`'sherpa'` → sherpa:transcribe;
// anything else, including the unset / empty / 'whisper' cases, →
// whisper:transcribe), invokes it with `[{"__b64": b64}]` (the QML-side
// spelling the bridge rewrites to `{"__type":"binary","data":...}` — QML
// cannot build a Uint8Array, so this is the only path), and emits
// `transcriptReady(text)` with the result. The store does NOT decide where the
// transcript goes — `Main` / `ChatView` listens to the signal and honours the
// `voiceAutoSend` plugin setting.
//
// The store does NOT import Quickshell, so it is qmltestrunner-loadable. The
// settingsStore is optional — when absent (testing, or before the bridge
// authenticated) the store falls back to whisper, the documented default.
QtObject {
  id: store

  // Service.qml — owns invoke/subscribe/recStart/recStop/recCancel and the
  // recordingChanged / audioReady signals.
  required property var rpc

  // SettingsStore — reads `stt_backend`. Optional: tests can omit it and
  // whisper becomes the default, matching the server's behaviour when the
  // setting is unset.
  property var settingsStore: null

  property bool recording: false
  // True between `start()` and the bridge's `rec.active=true` reply. A
  // second keystroke before that reply would otherwise call `start()` again
  // because `recording` has not flipped yet — once the bridge accepts the
  // first start the second one is rejected and the user is left with a
  // dead button. The flag short-circuits any further toggle until the
  // connection settles.
  property bool starting: false
  property bool transcribing: false
  property string lastTranscript: ""
  property string error: ""

  // Fired on every successful transcribe. The text is the raw `text` field of
  // the handler's return value — no markdown, no punctuation correction.
  signal transcriptReady(string text)

  Component.onCompleted: {
    // Connect once. recordingChanged is also raised when the user explicitly
    // cancels (`recCancel` → `{"ev":"rec","active":false}`), so a cancel
    // re-clears `recording` without going through transcribing at all.
    rpc.recordingChanged.connect(function(active, failure) {
      var wasActive = recording
      recording = active === true
      if (recording) {
        // Bridge accepted the start — the waiting state is over.
        starting = false
        error = ""
        transcribing = false
        return
      }
      // A recorder that FAILED reports why. Carrying it into `error` is the
      // only thing that puts it on screen: the same fact reached the bridge's
      // `log` channel before, which nothing in the UI reads, so a machine
      // with no capture device lit the mic button and then sat there.
      // `starting` must clear too — a failure before the first byte never
      // set `recording`, so `wasActive` is false and the branch below is
      // skipped, which is exactly the case that used to hang.
      if (failure && String(failure).length > 0) {
        starting = false
        transcribing = false
        error = String(failure)
        restoreAudio_()
        return
      }
      if (wasActive) {
        // Capture ended. `stop()` and `cancel()` already restore, and
        // `voice:restore` is idempotent — but the recorder can also stop on
        // its OWN (child died, duration cap), and then neither ran. Without
        // this the user's volume would stay ducked with nothing recording,
        // and nothing in the UI would explain why.
        restoreAudio_()
      }
    })

    rpc.audioReady.connect(function(b64) {
      // An empty b64 means the bridge aborted (no audio captured, or the user
      // pressed cancel before the recorder produced any PCM). The empty path
      // is the documented "nothing to transcribe" signal — never invoke on
      // it. The bridge already fired `recordingChanged(false)` before this
      // line, so the UI is already in the post-capture state.
      if (!b64 || b64.length === 0) {
        transcribing = false
        error = ""
        return
      }
      transcribe(b64)
    })
  }

  // Pick the channel based on `stt_backend`. `'sherpa'` selects sherpa; ANY
  // other value (including empty, undefined, 'whisper', a typo) selects
  // whisper. This matches the server's own default branch and is what the
  // bridge recorder relies on when the user has not picked a backend yet.
  function transcribeChannel() {
    if (!settingsStore) return "whisper:transcribe"
    var backend = settingsStore.get("stt_backend", "")
    return backend === "sherpa" ? "sherpa:transcribe" : "whisper:transcribe"
  }

  function transcribe(b64) {
    transcribing = true
    error = ""
    // `__b64` is the QML-side spelling for a byte payload. The bridge
    // rewrites it to the server's `{"__type":"binary","data":"..."}` wire
    // form (bridge/bridge.mjs:184-195). QML cannot build a Uint8Array, so
    // never substitute one.
    var args = [{ __b64: b64 }]
    rpc.invoke(transcribeChannel(), args, function(result) {
      transcribing = false
      var text = result && typeof result === "object" && typeof result.text === "string"
        ? result.text
        : ""
      lastTranscript = text
      // A successful transcript clears any prior error so the urgent row
      // disappears as soon as dictation works again.
      error = ""
      // Emit even when empty — the caller wants to know "the turn finished
      // and there was nothing to say", distinct from a failed invocation.
      transcriptReady(text)
    }, function(err) {
      transcribing = false
      error = String(err)
    })
  }

  // ---- push-to-talk actions, called from MicButton.qml ----
  //
  // Two callers: a press-and-release on the mic button (MicButton.qml), and
  // a toggle from the keyboard shortcut (App.qml on `mode:voice`). The
  // toggle short-circuits on `starting` so two quick keystrokes before the
  // bridge has acknowledged the first start cannot both be sent.

  function toggle() {
    if (recording || starting) { stop(); return }
    start()
  }

  // Ducking is part of dictation, not a nicety: without it the mic captures
  // whatever is playing, and the user cannot hear themselves over it. The
  // Electron front does exactly this from voiceInputStore.ts:93 / :112.
  //
  // `voice:duck` and `voice:restore` take no arguments — the server reads the
  // reduction percentage and the pause-media preference out of settings
  // (applyVoiceAudioEffects / clearVoiceAudioEffects, handlers/whisper.ts:19).
  //
  // Failures are swallowed on purpose, matching the old front's
  // `.catch(() => {})`: a machine with no audio backend must still be able to
  // dictate. `VoiceStore.error` is reserved for failures that actually cost
  // the user their transcript.
  function duckAudio_() { rpc.invoke("voice:duck", [], function() {}, function() {}) }
  function restoreAudio_() { rpc.invoke("voice:restore", [], function() {}, function() {}) }

  function start() {
    if (recording || starting) return
    error = ""
    starting = true
    rpc.recStart()
    duckAudio_()
  }

  function stop() {
    if (!recording && !starting) return
    starting = false
    rpc.recStop()
    // Restored as soon as capture ends rather than after transcription, so
    // the user's audio does not stay ducked for the length of a Whisper run.
    restoreAudio_()
  }

  function cancel() {
    // Cancel works whether or not the bridge believes recording is active —
    // a stale UI state must not strand the user mid-capture. Restoring audio
    // unconditionally for the same reason: Escape during a capture must never
    // leave the user's volume ducked with nothing recording.
    starting = false
    rpc.recCancel()
    restoreAudio_()
  }
}