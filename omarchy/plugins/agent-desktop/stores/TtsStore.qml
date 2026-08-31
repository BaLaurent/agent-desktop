import QtQuick

// TtsStore — server-side text-to-speech.
//
// The audio plays on the SERVER machine, which here is the same machine, so
// every `tts:speak*` call is audible on this box without any QML-side audio
// work. The store owns only the speaking state and the stop control.
//
//   speaking         true while a speak() / speakMessage() is in flight
//   messageId        the server's id of the message currently being spoken,
//                    when known (drives the indicator and is null between
//                    turns and on plain `tts:speak` text)
//   validating       true while tts:validate is in flight (a UI affordance
//                    the settings page shows as a spinner)
//   players          result of tts:detectPlayers — [{ name, path, available }]
//   voices           result of tts:listSayVoices — [{ name, locale }]
//   validateResult   last tts:validate return, surfaced to the settings page
//   error            last failure string
//
// Subscribed: `tts:stateChange` (`{ speaking: boolean; messageId?: number }`),
// emitted by src/core/handlers/tts.ts:42-44 inside the speak/stop paths.
//
// CHANNELS WE EXPLICITLY DO NOT SUBSCRIBE TO:
//   `tts:audio` (engine.ts:36). That channel exists ONLY to ship base64 audio
//   to a REMOTE browser (src/core/services/tts.ts:37 → broadcast('tts:audio',
//   audio)) so a browser tab on another machine can play the same utterance.
//   The plugin is local to the server, the server already plays it via
//   mpv/ffplay/paplay/aplay/spd-say/piper, so consuming `tts:audio` here
//   would play every utterance twice. Do NOT add a subscribe for it.
QtObject {
  id: store

  required property var rpc

  property bool speaking: false
  property var messageId: null     // number | null — id of the message being read
  property bool validating: false
  property var players: []
  property var voices: []
  property var validateResult: null
  property string error: ""

  Component.onCompleted: {
    // The engine emits `{ speaking, messageId? }`. `messageId` is set by the
    // `speakMessage` path and is null for plain `tts:speak`, for
    // notifications, and for the post-stop idle frame. We mirror both
    // verbatim — no coalescing.
    rpc.subscribe("tts:stateChange", function(data) {
      if (!data || typeof data !== "object") return
      speaking = data.speaking === true
      // The server passes `null` when the id is not known; surface that as
      // null rather than coercing to 0, so the indicator can distinguish
      // "no message" from "message 0".
      if ("messageId" in data) {
        messageId = data.messageId === null || data.messageId === undefined
          ? null
          : data.messageId
      }
    })
  }

  // ---- speak / stop ---------------------------------------------------
  //
  // Every call carries an error sink. Without one a refusal is dropped on the
  // floor: `tts:speakMessage` rejects a non-positive conversationId or
  // messageId ("conversationId must be a positive integer"), and with no
  // handler the button looked like it had worked while nothing was spoken and
  // nothing was reported. `error` is what the settings page and the composer's
  // status row already read.

  function speak(text) {
    if (!text || text.length === 0) return
    store.error = ""
    rpc.invoke("tts:speak", [String(text)],
      function () {},
      function (err) { store.error = String(err) })
  }

  function speakMessage(text, conversationId, messageId) {
    if (!text || text.length === 0) return
    store.error = ""
    rpc.invoke("tts:speakMessage", [
      String(text),
      Number(conversationId),
      Number(messageId)
    ], function () {}, function (err) { store.error = String(err) })
  }

  function stop() {
    rpc.invoke("tts:stop", [], function () {},
      function (err) { store.error = String(err) })
  }

  // ---- settings-side helpers (consumed by VoiceSettings.qml) ----------

  function detectPlayers(onOk, onErr) {
    rpc.invoke("tts:detectPlayers", [], function(result) {
      players = Array.isArray(result) ? result : []
      if (onOk) onOk(players)
    }, function(err) {
      error = String(err)
      if (onErr) onErr(error)
    })
  }

  function listSayVoices(onOk, onErr) {
    rpc.invoke("tts:listSayVoices", [], function(result) {
      voices = Array.isArray(result) ? result : []
      if (onOk) onOk(voices)
    }, function(err) {
      error = String(err)
      if (onErr) onErr(error)
    })
  }

  function validate(onOk, onErr) {
    validating = true
    error = ""
    rpc.invoke("tts:validate", [], function(result) {
      validating = false
      validateResult = (result && typeof result === "object") ? result : null
      if (onOk) onOk(validateResult)
    }, function(err) {
      validating = false
      error = String(err)
      if (onErr) onErr(error)
    })
  }
}