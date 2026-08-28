pragma ComponentBehavior: Bound

import QtQuick

import qs.Commons
import "../lib/palette.js" as Palette

// Collapsible extended-thinking block. Shown only when the effective
// ai_showThinking setting is "true" — callers gate visibility at the
// message-list level so this component does not need to know the setting.
Item {
  id: root

  required property string content

  property bool expanded: false

  // A parent that mounts this with width only (a Column row, a ListView
  // delegate, a Loader) adopts the item's implicitHeight. Without it the root
  // Item is zero-high and the whole body is invisible — which is how assistant
  // messages vanished from the transcript while the store held them. Ignored
  // when a parent sets an explicit height, so it is safe everywhere.
  implicitHeight: bodyRoot.implicitHeight

  Rectangle {
    id: bodyRoot
    anchors { left: parent.left; right: parent.right }
    color: Util.alpha(Color.foreground, Palette.surfaceAlpha(2))
    border { width: Style.normalBorderWidth; color: Color.muted }
    radius: Style.cornerRadius

    Column {
      id: layout
      anchors {
        left: parent.left
        right: parent.right
        top: parent.top
        margins: Style.spacing.sm
      }
      spacing: Style.spacing.xs

      Row {
        spacing: Style.spacing.sm
        anchors { left: parent.left; right: parent.right }

        MouseArea {
          width: rowToggle.implicitWidth
          height: Style.bar.sizeHorizontal
          cursorShape: Qt.PointingHandCursor
          onClicked: root.expanded = !root.expanded
          Row {
            id: rowToggle
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.spacing.xs
            Text {
              text: root.expanded ? "▼" : "▶"
              font.family: Style.font.family
              font.pixelSize: Style.font.caption
              color: Color.muted
            }
            Text {
              text: "Reasoning"
              font.family: Style.font.family
              font.pixelSize: Style.font.caption
              font.weight: Font.Medium
              color: Color.muted
            }
          }
        }
      }

      MarkdownBlock {
        visible: root.expanded && root.content && root.content.trim().length > 0
        text: root.content || ""
        anchors { left: parent.left; right: parent.right }
      }
    }
  }
}
