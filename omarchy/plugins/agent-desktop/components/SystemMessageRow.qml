pragma ComponentBehavior: Bound

import QtQuick

import qs.Commons

import "../lib/palette.js" as Palette
// Read-only row for a system_message part. System messages are emitted by
// hooks (`SessionStart`, etc.) and never carry user/assistant text. The
// renderer renders them in muted, monospaced text (chatStore.ts + bubble/).
Item {
  id: root

  required property var system
  // { type:'system_message', content, hookName?, hookEvent? }

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
    color: Util.alpha(Color.foreground, Palette.surfaceAlpha(1))
    border { width: Style.normalBorderWidth; color: Color.muted }
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
        text: root.system && root.system.hookName
          ? "[" + root.system.hookName + "]"
          : "[system]"
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
        color: Color.muted
        opacity: 0.7
        anchors.verticalCenter: parent.verticalCenter
      }

      Text {
        text: root.system && root.system.content ? root.system.content : ""
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        color: Color.muted
        opacity: 0.8
        wrapMode: Text.Wrap
        anchors { left: parent.left; right: parent.right }
      }
    }
  }
}
