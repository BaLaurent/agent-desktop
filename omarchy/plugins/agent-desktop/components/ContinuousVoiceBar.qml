pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import qs.Ui

// The start/stop control for an always-listening session, plus the one line of
// state a windowless capture would otherwise never show.
//
// Mirrors `src/renderer/components/chat/ContinuousVoiceControl.tsx`, including
// its phase vocabulary: the two fronts describe the same session, and a user who
// reads "Listening…" in one and something else in the other has to learn the
// feature twice.
//
// Body-only and store-driven: it owns NO session state. `ContinuousVoiceStore`
// is the single author of `active` / `phase` / `error`, so mounting this bar in
// two surfaces at once (the app window and the quick overlay both host a
// ChatView) cannot produce two sessions — the button just reflects the one
// session the service holds.
Item {
  id: root

  // ContinuousVoiceStore, injected by ChatView. Nullable: the QML test harness
  // and any surface constructed before the service exists must still build.
  property var store: null

  // SettingsStore — read for `continuousVoice_enabled`, which decides whether
  // this row exists at all. The React front gates the same way
  // (pages/ChatView.tsx:238).
  property var settingsStore: null

  // NOT named `enabled`: that is `Item.enabled`, the input-acceptance flag, and
  // redeclaring it shadows the base property — the row would stop taking clicks
  // for reasons no reader of this file could see.
  readonly property bool featureOn: settingsStore
    ? settingsStore.get("continuousVoice_enabled", "false") === "true"
    : false

  readonly property bool active: store ? store.active === true : false

  // The reference's PHASE_LABEL, one string per store phase. An unknown phase
  // falls back to "Listening…" rather than rendering the raw enum.
  function phaseLabel(phase) {
    if (phase === "idle") return "Starting…"
    if (phase === "listening") return "Listening…"
    if (phase === "speaking") return "You're speaking…"
    if (phase === "transcribing") return "Transcribing…"
    if (phase === "classifying") return "Checking if you're talking to me…"
    return "Listening…"
  }

  // A row that is not shown must take no space: this sits inside a
  // ColumnLayout whose `Layout.preferredHeight` reads implicitHeight, so a
  // hidden bar with a non-zero implicitHeight would leave a gap above the
  // transcript.
  visible: root.featureOn
  implicitHeight: root.featureOn ? bodyRow.implicitHeight : 0

  Row {
    id: bodyRow
    anchors { left: parent.left; right: parent.right }
    spacing: Style.spacing.md

    Button {
      id: toggleButton
      anchors.verticalCenter: parent.verticalCenter
      bordered: true
      selected: root.active
      text: root.active ? "■ Stop continuous voice" : "● Start continuous voice"
      onClicked: {
        if (!root.store) return
        if (root.active) root.store.stop()
        else root.store.start()
      }
    }

    Text {
      anchors.verticalCenter: parent.verticalCenter
      visible: root.active || text.length > 0
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      // An error outranks the phase: a session that failed to open the
      // microphone still reports `phase` from before the failure, and showing
      // "Listening…" over a dead capture is the exact lie this row exists to
      // prevent.
      color: root.store && String(root.store.error || "").length > 0
        ? Color.urgent : Color.muted
      opacity: 0.85
      text: {
        if (!root.store) return ""
        var err = String(root.store.error || "")
        if (err.length > 0) return err
        if (!root.active) return ""
        var ignored = String(root.store.lastIgnored || "")
        // Why an utterance was dropped is the single most confusing thing about
        // a gated always-on mic ("I spoke and nothing happened"), so it is on
        // screen rather than in a log.
        if (ignored === "no-wakeword") return root.phaseLabel(root.store.phase) + " (last one had no wake phrase)"
        if (ignored === "not-addressed") return root.phaseLabel(root.store.phase) + " (last one was not addressed to me)"
        if (ignored === "classify-error") return root.phaseLabel(root.store.phase) + " (intent check failed — not sent)"
        if (ignored === "no-conversation") return root.phaseLabel(root.store.phase) + " (no conversation to send to)"
        return root.phaseLabel(root.store.phase)
      }
    }
  }
}
