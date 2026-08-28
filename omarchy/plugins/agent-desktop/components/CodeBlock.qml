pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls

import qs.Commons

import "../lib/highlight.js" as HL
import "../lib/palette.js" as Palette

// One fenced code block.
//
// Collapsed when the line count exceeds 10 (matching CodeBlock.tsx's
// defaultCollapsed). A copy button writes the unhighlighted text to the
// system clipboard (Qt.labs.platform has no portable clipboard helper, so
// we use a hidden TextEdit + selectAll/copy — TextEdit IS the clipboard
// mechanism in Qt Quick Controls).
Item {
  id: root

  required property string code
  property string lang: ""
  property bool collapsed: code.split("\n").length > 10
  // Per-class colours for the highlighter. Derived from the active theme
  // accent by hue rotation in lib/palette.js, so a code block belongs to
  // whatever theme is currently active. Both this file and FilePreview.qml
  // share the one derivation rather than each carrying a copy.
  property var _colors: Palette.syntaxColors(
    String(Color.accent), String(Color.urgent), String(Color.muted),
    String(Color.foreground), Style.font.family)

  function _richText() {
    return HL.toRichText(root.code || "", root.lang || "", root._colors)
  }

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
    color: Util.alpha(Color.foreground, Palette.surfaceAlpha(3))
    border { width: Style.normalBorderWidth; color: Color.muted }

    // Hidden TextEdit used as the clipboard sink. Its `copy()` writes the
    // selected text to the system clipboard.
    TextEdit {
      id: clipboard
      visible: false
      width: 0
      height: 0
      text: root.code || ""
    }

    Column {
      id: col
      anchors {
        left: parent.left
        right: parent.right
        top: parent.top
        margins: Style.spacing.sm
      }
      spacing: Style.spacing.xs

      // Header bar — language tag + copy button. The chevron toggles
      // collapse when there is something to collapse.
      Row {
        spacing: Style.spacing.sm
        anchors { left: parent.left; right: parent.right }

        Text {
          text: root.lang && root.lang.length > 0 ? root.lang : "code"
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          color: Color.muted
          opacity: 0.7
        }

        Item { width: 1; height: 1 }

        MouseArea {
          anchors.right: parent.right
          width: copyLabel.implicitWidth + 2 * Style.spacing.sm
          height: Style.bar.sizeHorizontal
          cursorShape: Qt.PointingHandCursor
          onClicked: {
            clipboard.selectAll()
            clipboard.copy()
          }
          Text {
            id: copyLabel
            anchors.centerIn: parent
            text: "copy"
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
            color: Color.accent
          }
        }
      }

      // Collapsed: just the first line so the user knows what is inside.
      // Expanded: the full highlighted block.
      Text {
        visible: root.collapsed
        text: {
          var first = (root.code || "").split("\n")[0] || ""
          return first.length > 80 ? first.slice(0, 80) + "…" : first
        }
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        color: Color.muted
        opacity: 0.8
        wrapMode: Text.NoWrap
        elide: Text.ElideRight
        anchors { left: parent.left; right: parent.right }
      }

      Text {
        visible: !root.collapsed
        textFormat: Text.RichText
        text: root._richText()
        wrapMode: Text.Wrap
        anchors { left: parent.left; right: parent.right }
      }
    }
  }

  // Clicking anywhere on the rectangle (outside the copy button) toggles
  // collapse when there is something to collapse.
  MouseArea {
    anchors.fill: parent
    z: -1
    visible: root.code.split("\n").length > 10
    cursorShape: Qt.PointingHandCursor
    onClicked: root.collapsed = !root.collapsed
  }
}
