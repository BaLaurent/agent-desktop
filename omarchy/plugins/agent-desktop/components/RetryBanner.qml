pragma ComponentBehavior: Bound

import QtQuick

import qs.Commons

import "../lib/palette.js" as Palette
// A retry banner shown above the streaming indicator when the server
// indicates the agent is retrying the request. The renderer replaces
// any prior retry part with the latest (lib/streamParts.js's `retry`
// reducer rule), so this row reflects the live state.
Item {
  id: root

  required property var retry
  // { type:'retry', message, attempt, maxAttempts }

  // A parent that mounts this with width only (a Column row, a ListView
  // delegate, a Loader) adopts the item's implicitHeight. Without it the root
  // Item is zero-high and the whole body is invisible — which is how assistant
  // messages vanished from the transcript while the store held them. Ignored
  // when a parent sets an explicit height, so it is safe everywhere.
  implicitHeight: bodyRoot.implicitHeight

  Rectangle {
    id: bodyRoot
    anchors { left: parent.left; right: parent.right }
    height: row.implicitHeight + 2 * Style.spacing.sm
    color: Util.alpha(Color.foreground, Palette.surfaceAlpha(2))
    border { width: Style.normalBorderWidth; color: Color.urgent }
    radius: Style.cornerRadius

    Row {
      id: row
      anchors {
        left: parent.left
        right: parent.right
        top: parent.top
        margins: Style.spacing.sm
      }
      spacing: Style.spacing.sm

      Text {
        text: root.retry && root.retry.message
          ? root.retry.message
          : "Retrying..."
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        color: Color.urgent
        wrapMode: Text.Wrap
        anchors.verticalCenter: parent.verticalCenter
      }

      Text {
        visible: root.retry && root.retry.maxAttempts && root.retry.maxAttempts > 0
        text: "(attempt " + (root.retry ? root.retry.attempt : 0)
          + " of " + (root.retry ? root.retry.maxAttempts : 0) + ")"
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
        color: Color.muted
        opacity: 0.8
        anchors.verticalCenter: parent.verticalCenter
      }
    }
  }
}
