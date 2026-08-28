pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons

// TtsIndicator — visible state for `tts:stateChange` and a stop button.
//
// Reads `speaking` and `messageId` from a `TtsStore` and renders a small chip:
//   idle      invisible (the parent layout reserves no space — `visible`
//             toggles)
//   speaking  accent dot, speaker glyph, a "speaking…" label and a stop
//             button on the right
//
// The indicator NEVER touches a player. The audio plays on the server (which
// here is the same machine); all this control does is give the user a stop
// handle. `tts:audio` is intentionally NOT subscribed — see TtsStore.qml for
// the reasoning (it exists for REMOTE browsers; consuming it here would
// double every utterance).
Item {
  id: root

  // TtsStore — must expose `speaking`, `messageId`, and `stop()`.
  required property var store

  // Explicit === coercion so an unset `store` (or `store.speaking ===
  // undefined` mid-transition) cannot leak through as `undefined` into
  // `visible`. QML's truthy coercion treats `undefined` as truthy, which is
  // why the previous `store && store.speaking === true` form rendered the
  // indicator while idle — a class of bug qmllint cannot catch because
  // `required property var store` is untyped.
  readonly property bool isSpeaking: store && store.speaking === true
  readonly property bool hasMessageId: !!store
                                      && store.messageId !== null
                                      && store.messageId !== undefined
  // Pre-build the label string so every consumer reads the same shape and
  // nothing in the chain can accidentally receive `undefined` (the original
  // bug surfaced as a Text binding failing "Unable to assign [undefined] to
  // QString" because `Style.font.iconFamily` was undefined — the
  // String(messageId) coercion here prevents a parallel class of bug for
  // the message-label path).
  readonly property string messageLabel: root.hasMessageId
    ? ("speaking message " + String(root.store.messageId))
    : "speaking"

  implicitHeight: Style.bar.sizeHorizontal
  implicitWidth: row.implicitWidth + Style.spacing.md * 2

  visible: isSpeaking

  Row {
    id: row
    anchors { verticalCenter: parent.verticalCenter; left: parent.left; right: parent.right }
    anchors.leftMargin: Style.spacing.md
    anchors.rightMargin: Style.spacing.md
    spacing: Style.spacing.sm

    Rectangle {
      width: Style.spacing.lg
      height: Style.spacing.lg
      radius: width / 2
      anchors.verticalCenter: parent.verticalCenter
      color: Color.accent
    }

    Text {
      anchors.verticalCenter: parent.verticalCenter
      // `Style.font.iconFamily` does not exist on Omarchy Quattro's Style —
      // the real shell renders glyph fonts through `Style.font.family`
      // (system monospace alias, e.g. JetBrainsMono Nerd Font on this box;
      // see /usr/share/omarchy/shell/Ui/OpticalGlyph.qml:5). The previous
      // binding silently evaluated to `undefined`, which Text coerced to
      // mojibake for the \u1F50A glyph.
      font.family: Style.font.family
      font.pixelSize: Style.font.iconSmall
      color: Color.foreground
      // U+1F50A SPEAKER WITH THREE SOUND WAVES. Above U+FFFF, so it needs a
      // surrogate pair: `\u` consumes exactly four hex digits, and "\u1F50A"
      // silently parses as U+1F50 followed by a literal "A" — which is what
      // rendered as "ùA speaking" in the live window.
      text: "\uD83D\uDD0A"
    }

    Text {
      anchors.verticalCenter: parent.verticalCenter
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      color: Color.foreground
      text: root.messageLabel
    }

    // Stop button. Fire-and-forget — the server will set `speaking: false`
    // via `tts:stateChange` once the in-flight process actually exits
    // (handlers/tts.ts:227-243 deliberately ignores the non-zero exit mpv
    // returns on SIGTERM, so the indicator clears, not flips to an error).
    Rectangle {
      id: stopBtn
      width: Style.spacing.controlHeight
      height: Style.spacing.controlHeight
      radius: Style.cornerRadius
      anchors.verticalCenter: parent.verticalCenter
      color: stopMa.pressed ? Color.foreground : Color.background
      border.color: Color.foreground
      border.width: 1

      Text {
        anchors.centerIn: parent
        font.family: Style.font.family
        font.pixelSize: Style.font.body
        color: stopMa.pressed ? Color.background : Color.foreground
        text: "\u25A0"      // black square (stop)
      }

      MouseArea {
        id: stopMa
        anchors.fill: parent
        acceptedButtons: Qt.LeftButton
        onClicked: function(mouse) {
          if (root.store) root.store.stop()
          mouse.accepted = true
        }
      }
    }
  }

  Accessible.role: Accessible.StaticText
  Accessible.name: root.isSpeaking
    ? (root.hasMessageId
        ? "speaking message " + String(root.store.messageId)
        : "speaking")
    : ""
}