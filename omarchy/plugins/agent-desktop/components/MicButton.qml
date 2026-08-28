pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons

// MicButton — press-and-hold to record.
//
//   pressed   → VoiceStore.start()    (bridge starts pw-record)
//   released  → VoiceStore.stop()     (bridge stops, emits audioReady)
//   cancel    → VoiceStore.cancel()   (drops the in-flight capture)
//
// Visual state mirrors VoiceStore.recording / VoiceStore.transcribing:
//   idle         standard mic glyph
//   recording    accent ring + recording glyph
//   transcribing muted ring + transcribing glyph
//
// The button owns no state of its own — every value comes from `store`. The
// MouseArea here is "press to record, release to stop" (the documented
// push-to-talk affordance in Phase 8.2). Long-press cancel is an explicit
// second affordance, not a single-button escape hatch.
Rectangle {
  id: root

  // VoiceStore — must expose `recording`, `transcribing`, `start()`, `stop()`
  // and `cancel()`. Passed in rather than reached for, per the store
  // contract.
  required property var store

  // Explicit === coercion so an unset `store` cannot leak `undefined`
  // through to `text:` or colour bindings as truthy. See TtsIndicator.qml
  // header for the full reasoning.
  readonly property bool isRecording: !!store && store.recording === true
  readonly property bool isTranscribing: !!store && store.transcribing === true
  readonly property bool isBusy: isRecording || isTranscribing

  implicitWidth: Style.bar.sizeHorizontal
  implicitHeight: Style.bar.sizeHorizontal
  radius: width / 2
  color: isRecording
    ? Color.accent
    : isTranscribing
      ? Color.muted
      : Color.background
  border.color: isRecording ? Color.accent : Color.foreground
  border.width: isRecording ? 2 : 1
  opacity: holdArea.pressed ? 0.85 : 1.0

  // The hold-to-record affordance. Pressed is the only state that drives
  // start(); released drives stop() unless the cancel timer fired. Qt's
  // MouseArea reports pressed going false on a cancel as well, so the
  // cancelPressed flag is what prevents the released handler from calling
  // stop() after cancel() has already been called.
  property bool cancelPressed: false

  // Pre-build the glyph string and the accessible label so every binding
  // receives a concrete string. `Style.font.iconFamily` does not exist on
  // Omarchy Quattro's Style (the icon glyphs come from the same monospace
  // family as text — see /usr/share/omarchy/shell/Ui/OpticalGlyph.qml:5),
  // and assigning `undefined` to `font.family` is exactly the "Unable to
  // assign [undefined] to QString" class of bug a plain `Style.font.*`
  // binding silently produces.
  readonly property string stateGlyph: root.isRecording
    ? "\u25CF"           // filled circle (recording)
    : root.isTranscribing
      ? "\u2026"          // horizontal ellipsis (working)
      // U+1F3A4 MICROPHONE. It sits above U+FFFF, so it needs a surrogate pair:
      // `\u` consumes exactly four hex digits, and the obvious-looking
      // "\u1F3A4" silently parses as U+1F3A followed by a literal "4" — which
      // is exactly what produced the mojibake glyph in the first screenshot.
      : "\uD83C\uDFA4"

  readonly property string a11yName: root.isRecording
    ? "recording — release to stop, use cancel to abort"
    : root.isTranscribing
      ? "transcribing"
      : "press to record"

  Text {
    anchors.centerIn: parent
    font.family: Style.font.family
    font.pixelSize: Style.font.iconSmall
    color: root.isRecording ? Color.background : Color.foreground
    text: root.stateGlyph
  }

  MouseArea {
    id: holdArea
    anchors.fill: parent
    // Don't steal presses from the chat input below — the button lives in a
    // header row and a drag would otherwise eat text-selection gestures.
    acceptedButtons: Qt.LeftButton
    onPressed: function(mouse) {
      root.cancelPressed = false
      if (root.store) root.store.start()
      mouse.accepted = true
    }
    onReleased: function(mouse) {
      // cancel() resets bridge state and emits rec.active=false; a
      // subsequent stop() would be a no-op, so we suppress it to keep the
      // store's state machine clean.
      if (root.cancelPressed) {
        mouse.accepted = true
        return
      }
      if (root.store) root.store.stop()
      mouse.accepted = true
    }
    onCanceled: {
      // The pointer left the button while still pressed. Treat as a normal
      // release — the user lifted off outside the hit area but the press
      // was real.
      if (root.store && !root.cancelPressed) root.store.stop()
    }
  }

  // Explicit cancel affordance: a separate small target inside the button so
  // the user can abort without releasing as "stop". Long-press on the cancel
  // dot maps to the same cancelPressed guard the hold-to-record uses.
  Rectangle {
    id: cancelDot
    width: parent.height * 0.28
    height: width
    radius: width / 2
    anchors { right: parent.right; top: parent.top; margins: parent.height * 0.08 }
    color: "transparent"
    border.color: Color.foreground
    border.width: 1
    visible: root.isRecording || root.isTranscribing

    Text {
      anchors.centerIn: parent
      font.family: Style.font.family
      font.pixelSize: Style.font.caption
      color: Color.foreground
      text: "\u2715"          // multiplication sign
    }

    MouseArea {
      anchors.fill: parent
      acceptedButtons: Qt.LeftButton
      onPressed: function(mouse) {
        root.cancelPressed = true
        if (root.store) root.store.cancel()
        mouse.accepted = true
      }
    }
  }

  // Accessible label — the visual glyph changes with state, so the
  // announced string must follow.
  Accessible.role: Accessible.Button
  Accessible.name: root.a11yName
}