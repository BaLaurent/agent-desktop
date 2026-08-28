import QtQuick
import QtTest

// TtsStore — server-side TTS, exercised in a real QML engine.
//
// The behaviour under test:
//   - speak/speakMessage/stop/validate forward the right channels + args
//   - tts:stateChange drives `speaking` and `messageId`
//   - detectPlayers/listSayVoices populate their state arrays
//   - tts:audio is NEVER subscribed (consuming it would double every
//     utterance — see TtsStore.qml header)
Item {
  width: 200
  height: 200

  // Item so its signals retain handlers — Component.onCompleted in
  // TtsStore.qml calls rpc.subscribe('tts:stateChange', handler); the
  // handler is stored in a plain JS map and invoked from `emit`.
  Item {
    id: fakeRpc
    property var calls: []
    property var subs: ({})     // channel -> [handler]

    // Required by every store that takes rpc.
    signal recordingChanged(bool active)
    signal audioReady(string b64)
    function recStart() {}
    function recStop() {}
    function recCancel() {}

    function invoke(channel, args, onOk, onErr) {
      calls = calls.concat([{ channel: channel, args: args, ok: onOk, err: onErr }])
      return calls.length
    }

    function subscribe(channel, handler) {
      var list = subs[channel]
      if (!list) { list = []; subs[channel] = list }
      if (list.indexOf(handler) === -1) list.push(handler)
    }

    function emit(channel, data) {
      var list = subs[channel]
      if (!list) return
      var copy = list.slice()
      for (var i = 0; i < copy.length; i++) {
        try { copy[i](data) } catch (e) { console.warn("emit", channel, e) }
      }
    }

    function callFor(channel) {
      for (var i = calls.length - 1; i >= 0; i--) if (calls[i].channel === channel) return calls[i]
      throw new Error("no call to " + channel)
    }

    function accept(channel, result) { callFor(channel).ok(result) }
    function refuse(channel, message) { callFor(channel).err(message) }

    function reset() {
      calls = []
      subs = ({})
    }
  }

  Loader {
    id: storeLoader
    Component.onCompleted: setSource("../../stores/TtsStore.qml", ({ rpc: fakeRpc }))
  }

  TestCase {
    name: "TtsStore"
    when: windowShown

    property var store: storeLoader.item

    function initTestCase() {
      verify(store !== null, "TtsStore.qml loaded")
    }

    function init() {
      fakeRpc.calls = []
      // NOTE: do not clear fakeRpc.subs — Loader.setSource only runs
      // Component.onCompleted once, so the tts:stateChange subscription
      // is registered at construction and must survive across tests.
      store.speaking = false
      store.messageId = null
      store.validating = false
      store.players = []
      store.voices = []
      store.validateResult = null
      store.error = ""
    }

    // TtsStore.Component.onCompleted subscribes to tts:stateChange.
    // Confirm it did, and that no tts:audio subscription was registered.
    function test_subscribes_to_state_change_only() {
      var keys = []
      for (var k in fakeRpc.subs) keys.push(k)
      compare(keys.length, 1)
      compare(keys[0], "tts:stateChange")
      // The two capture channels belong to VoiceStore; TtsStore must NOT
      // touch them.
      verify(fakeRpc.subs["tts:audio"] === undefined)
    }

    function test_speak_invokes_tts_speak_with_text() {
      store.speak("hello")
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "tts:speak")
      compare(fakeRpc.calls[0].args.length, 1)
      compare(fakeRpc.calls[0].args[0], "hello")
    }

    function test_speakMessage_coerces_ids_and_text() {
      store.speakMessage("body", 7, 42)
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "tts:speakMessage")
      compare(fakeRpc.calls[0].args[0], "body")
      compare(fakeRpc.calls[0].args[1], 7)
      compare(fakeRpc.calls[0].args[2], 42)
    }

    function test_speak_with_empty_text_is_a_no_op() {
      store.speak("")
      store.speak(null)
      compare(fakeRpc.calls.length, 0)
    }

    function test_stop_invokes_tts_stop() {
      store.stop()
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "tts:stop")
    }

    function test_stateChange_true_drives_speaking_and_messageId() {
      fakeRpc.emit("tts:stateChange", { speaking: true, messageId: 17 })
      compare(store.speaking, true)
      compare(store.messageId, 17)
    }

    function test_stateChange_false_clears_speaking_and_messageId() {
      // First set speaking so we can observe the transition.
      fakeRpc.emit("tts:stateChange", { speaking: true, messageId: 9 })
      compare(store.speaking, true)
      fakeRpc.emit("tts:stateChange", { speaking: false, messageId: null })
      compare(store.speaking, false)
      // messageId is null after a clean stop (matches handlers/tts.ts).
      compare(store.messageId, null)
    }

    function test_stateChange_without_messageId_leaves_it_null() {
      // Plain tts:speak (no messageId in the payload) — the store must not
      // coerce null/undefined into 0.
      fakeRpc.emit("tts:stateChange", { speaking: true })
      compare(store.speaking, true)
      compare(store.messageId, null)
    }

    function test_validate_round_trip() {
      var called = 0
      store.validate(function(result) { called++ }, function() {})
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "tts:validate")
      compare(store.validating, true)
      fakeRpc.accept("tts:validate", { provider: "say", providerFound: true, playerFound: true, playerPath: "/usr/bin/spd-say" })
      compare(store.validating, false)
      compare(called, 1)
      compare(store.validateResult.provider, "say")
      compare(store.error, "")
    }

    function test_validate_failure_surfaces_error() {
      store.validate(function() {}, function() {})
      fakeRpc.refuse("tts:validate", "no provider found")
      compare(store.validating, false)
      compare(store.error, "no provider found")
    }

    function test_detect_players_populates_state() {
      store.detectPlayers(function() {})
      fakeRpc.accept("tts:detectPlayers", [
        { name: "mpv", path: "/usr/bin/mpv", available: true },
        { name: "ffplay", path: "/usr/bin/ffplay", available: false }
      ])
      compare(store.players.length, 2)
      compare(store.players[0].name, "mpv")
      compare(store.players[1].available, false)
    }

    function test_list_say_voices_populates_state() {
      store.listSayVoices(function() {})
      fakeRpc.accept("tts:listSayVoices", [
        { name: "english", locale: "en" },
        { name: "french",  locale: "fr" }
      ])
      compare(store.voices.length, 2)
      compare(store.voices[1].locale, "fr")
    }
  }
}