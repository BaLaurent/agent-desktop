pragma ComponentBehavior: Bound

import QtQuick

import qs.Commons

import "../lib/palette.js" as Palette
// Read-only row for a background-agent task notification. The store
// appends these into the active conversation's part list mid-stream (when
// streaming) and into a per-conversation map when between turns.
// MessageList renders either source.
Item {
  id: root

  required property var task
  // { type:'task_notification', summary, taskId?, taskStatus?, outputFile? }

  // A parent that mounts this with width only (a Column row, a ListView
  // delegate, a Loader) adopts the item's implicitHeight. Without it the root
  // Item is zero-high and the whole body is invisible — which is how assistant
  // messages vanished from the transcript while the store held them. Ignored
  // when a parent sets an explicit height, so it is safe everywhere.
  implicitHeight: bodyRoot.implicitHeight

  Rectangle {
    id: bodyRoot
    anchors { left: parent.left; right: parent.right }
    height: col.implicitHeight + 2 * Style.spacing.sm
    color: {
      var failed = root.task && root.task.taskStatus === "failed"
      return failed
        ? Util.alpha(Color.urgent, Palette.tintAlpha())
        : Util.alpha(Color.accent, Palette.tintAlpha())
    }
    border { width: Style.normalBorderWidth; color: Color.muted }
    radius: Style.cornerRadius

    Column {
      id: col
      anchors {
        left: parent.left
        right: parent.right
        top: parent.top
        margins: Style.spacing.sm
      }
      spacing: Style.spacing.xs

      Text {
        text: root.task && root.task.taskStatus === "failed"
          ? "Agent task failed"
          : "Agent task completed"
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        font.weight: Font.Medium
        color: Color.foreground
      }

      Text {
        text: root.task && root.task.summary ? root.task.summary : ""
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        color: Color.foreground
        opacity: 0.85
        wrapMode: Text.Wrap
        anchors { left: parent.left; right: parent.right }
      }

      Text {
        visible: !!(root.task && root.task.outputFile)
        text: root.task && root.task.outputFile ? root.task.outputFile : ""
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
        color: Color.muted
        opacity: 0.7
        wrapMode: Text.Wrap
        anchors { left: parent.left; right: parent.right }
      }
    }
  }
}
