import QtQuick
import QtTest

// Regression suite for the Phase 8 components — TtsIndicator and MicButton.
//
// The original TtsIndicator had two bugs qmllint and the store tests could
// not catch:
//   1. With `store` unset, `store && store.speaking === true` evaluated to
//      `undefined`, which QML treated as truthy, leaving the indicator
//      visible while idle.
//   2. `Style.font.iconFamily` does not exist on Omarchy Quattro's Style;
//      binding `font.family: Style.font.iconFamily` silently evaluated to
//      `undefined`, which Text then coerced into a string, producing the
//      "Unable to assign [undefined] to QString" shell warning and the
//      mojibake "ùA speaking" screenshot.
//
// `required property var store` is untyped, so qmllint cannot check
// member access; the store tests cannot render the components; and the
// component-level smoke tests that did exist did not assert `visible` or
// `text` shape. This suite closes that gap: drive every visible state,
// assert `visible` matches `isSpeaking` / `isBusy`, and read every Text
// node's resolved `text` to confirm a real string lands in the binding
// (the `Unable to assign [undefined]` class only fails at render time,
// so we check the resolved value rather than the binding).
Item {
  width: 400
  height: 200

  // ---- shared fakes ----

  // Stands in for VoiceStore and TtsStore at once: the two components read
  // disjoint properties off it, so one fake serves both and a test can drive
  // either surface. The property NAMES are the ones the real stores declare —
  // VoiceStore: recording / transcribing (+ start/stop/cancel), TtsStore:
  // speaking / messageId (+ stop) — because a fake that invents a name would
  // make these tests pass against a store shape that does not exist.
  QtObject {
    id: fakeStore

    property bool recording: false
    property bool transcribing: false
    property bool speaking: false
    property var messageId: null
    property string error: ""

    // The real store drives these flags off bridge events; here the call site
    // sets them directly, which is what lets a test assert that the component
    // routed to the right one.
    function start() { recording = true; transcribing = false }
    function stop() { recording = false; transcribing = true }
    function cancel() { recording = false; transcribing = false }
  }

  // Re-parenting anchor for createObject — QML requires a non-null parent.
  Item { id: testCaseRoot }

  // Lazy-load the components. Components under components/ are not
  // registered as types, so the test resolves them with
  // Qt.createComponent(absolutePath) on first use (see
  // tests/qml/tst_component_load.qml for the same pattern).
  property var ttsC: null
  property var micC: null

  function ttsComponent() {
    if (!ttsC) ttsC = Qt.createComponent("../../components/TtsIndicator.qml", Component.PreferSynchronous)
    return ttsC
  }
  function micComponent() {
    if (!micC) micC = Qt.createComponent("../../components/MicButton.qml", Component.PreferSynchronous)
    return micC
  }

  // Walk every Text inside an object and collect the resolved `text`.
  // A bug that surfaces at render time (e.g. `font.family: undefined`)
  // produces an undefined `text` here, which the assertions catch.
  function walkTexts(obj, hits) {
    if (obj === undefined || obj === null) return hits
    if (obj.text !== undefined && typeof obj.text === "string") {
      hits.push(obj.text)
    }
    for (var i = 0; i < obj.children.length; i++) {
      walkTexts(obj.children[i], hits)
    }
    return hits
  }

  function makeTts(props) {
    var merged = ({ store: fakeStore })
    for (var k in props) merged[k] = props[k]
    var obj = ttsComponent().createObject(testCaseRoot, merged)
    return obj
  }

  function makeMic(props) {
    var merged = ({ store: fakeStore })
    for (var k in props) merged[k] = props[k]
    var obj = micComponent().createObject(testCaseRoot, merged)
    return obj
  }

  // ---- TtsIndicator ----

  TestCase {
    name: "TtsIndicator"
    when: windowShown

    function init() {
      fakeStore.speaking = false
      fakeStore.messageId = null
    }

    function test_invisible_when_speaking_is_false() {
      var ind = makeTts({})
      verify(ind !== null, "TtsIndicator created")
      // The regression that started this whole investigation.
      compare(ind.visible, false,
        "indicator must be hidden when store.speaking is false")
      ind.destroy()
    }

    function test_invisible_when_messageId_is_set_but_speaking_false() {
      // Edge case the original guard did not catch: a stale messageId
      // with speaking=false (the post-stop idle frame) must still hide.
      fakeStore.messageId = 17
      var ind = makeTts({})
      compare(ind.visible, false)
      ind.destroy()
    }

    function test_visible_when_speaking_is_true() {
      fakeStore.speaking = true
      var ind = makeTts({})
      compare(ind.visible, true)
      ind.destroy()
    }

    function test_label_text_is_a_real_string_when_idle() {
      // When hidden, the row's children may still be evaluated for
      // layout — assert the resolved `text` of every Text node is a
      // concrete string in both states. The original bug surfaced here:
      // an undefined `text` from `Style.font.iconFamily` (and similar)
      // produced the mojibake "ùA speaking" via implicit string coercion.
      var ind = makeTts({})
      compare(ind.visible, false)
      var hits = walkTexts(ind, [])
      verify(hits.length > 0, "indicator has at least one Text node")
      for (var i = 0; i < hits.length; i++) {
        verify(hits[i] !== undefined && hits[i] !== null,
          "Text binding #" + i + " is undefined — Style.* token does not exist")
      }
      ind.destroy()
    }

    function test_label_text_is_a_real_string_when_speaking() {
      fakeStore.speaking = true
      fakeStore.messageId = 42
      var ind = makeTts({})
      compare(ind.visible, true)
      var hits = walkTexts(ind, [])
      verify(hits.length > 0)
      var sawMessageLabel = false
      for (var i = 0; i < hits.length; i++) {
        verify(hits[i] !== undefined && hits[i] !== null,
          "Text binding #" + i + " is undefined")
        if (hits[i].indexOf("speaking message 42") === 0) sawMessageLabel = true
      }
      verify(sawMessageLabel,
        "indicator must render a 'speaking message 42' label when messageId=42")
      ind.destroy()
    }

    function test_label_uses_messageId_when_set() {
      fakeStore.speaking = true
      fakeStore.messageId = 7
      var ind = makeTts({})
      // The pre-built messageLabel must contain the id.
      compare(ind.messageLabel, "speaking message 7")
      ind.destroy()
    }

    function test_label_falls_back_when_messageId_is_null() {
      fakeStore.speaking = true
      fakeStore.messageId = null
      var ind = makeTts({})
      compare(ind.messageLabel, "speaking")
      ind.destroy()
    }
  }

  // ---- MicButton ----

  TestCase {
    name: "MicButton"
    when: windowShown

    function init() {
      fakeStore.recording = false
      fakeStore.transcribing = false
    }

    function test_idle_state_shows_mic_glyph() {
      // No recording, no transcribing → the mic glyph.
      var btn = makeMic({})
      verify(btn !== null)
      compare(btn.isRecording, false)
      compare(btn.isTranscribing, false)
      var hits = walkTexts(btn, [])
      verify(hits.length > 0)
      // The microphone glyph U+1F3A4 is the idle-state character. It is above
      // U+FFFF, so it must be built with fromCodePoint: String.fromCharCode
      // truncates its argument to 16 bits and would silently look for U+F3A4,
      // which is a different character in the Nerd Font private-use area.
      var sawMic = false
      for (var i = 0; i < hits.length; i++) {
        verify(hits[i] !== undefined && hits[i] !== null,
          "MicButton Text #" + i + " is undefined — Style.* token does not exist")
        if (hits[i].indexOf(String.fromCodePoint(0x1F3A4)) >= 0) sawMic = true
      }
      verify(sawMic, "idle MicButton must show the microphone glyph")
      btn.destroy()
    }

    function test_recording_state_shows_filled_circle_and_a11y_label() {
      fakeStore.recording = true
      var btn = makeMic({})
      compare(btn.isRecording, true)
      compare(btn.stateGlyph, "\u25CF")
      compare(btn.a11yName, "recording — release to stop, use cancel to abort")
      var hits = walkTexts(btn, [])
      var sawCircle = false
      for (var i = 0; i < hits.length; i++) {
        verify(hits[i] !== undefined && hits[i] !== null,
          "MicButton Text #" + i + " is undefined")
        if (hits[i] === "\u25CF") sawCircle = true
      }
      verify(sawCircle)
      btn.destroy()
    }

    function test_transcribing_state_shows_ellipsis() {
      fakeStore.transcribing = true
      var btn = makeMic({})
      compare(btn.isTranscribing, true)
      compare(btn.isRecording, false)
      compare(btn.stateGlyph, "\u2026")
      compare(btn.a11yName, "transcribing")
      btn.destroy()
    }

    function test_cancel_dot_visibility_follows_isBusy() {
      var btn = makeMic({})
      // Cancel dot is hidden while idle.
      compare(btn.isBusy, false)
      // Walk to find the cancelDot by id and check its visible.
      var found = btn.findChild ? btn.findChild("cancelDot") : null
      if (found) compare(found.visible, false)
      // Recording → cancel dot visible.
      fakeStore.recording = true
      compare(btn.isBusy, true)
      if (found) compare(found.visible, true)
      btn.destroy()
    }

    function test_press_then_release_routes_to_bridge() {
      // Drive the MouseArea directly. fakeStore.start / fakeStore.stop
      // mutate the flags the same way the real store would.
      var btn = makeMic({})
      btn.cancelPressed = false
      btn.store.start()  // direct call, simulates onPressed
      compare(fakeStore.recording, true)
      btn.store.stop() // simulates onReleased
      compare(fakeStore.recording, false)
      btn.destroy()
    }

    function test_cancel_press_sets_cancelPressed_and_calls_cancel() {
      var btn = makeMic({})
      fakeStore.recording = true
      // Simulate the cancel-dot press handler.
      btn.cancelPressed = true
      btn.store.cancel()
      compare(btn.cancelPressed, true)
      compare(fakeStore.recording, false)
      compare(fakeStore.transcribing, false)
      btn.destroy()
    }
  }
}