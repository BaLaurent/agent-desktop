pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

// The category rail on the left of the settings page. One button per
// category in display order; the active one is rendered in the accent
// colour. The page owns the activeCategory state and the page is also
// the router — this component is pure presentation.
Item {
  id: root

  // The categories the rail renders, top-to-bottom. The page passes the
  // same list as SettingsPage.tsx:26-43.
  required property var categories

  // Active category key (must match a value in `categories`).
  required property string activeKey

  // Click handler. The page navigates on its own state machine.
  signal selected(string key)

  Column {
    id: bodyCol
    anchors { fill: parent }
    anchors.margins: Style.spacing.md
    spacing: Style.spacing.xs

    Text {
      text: "Settings"
      font.family: Style.font.family
      font.pixelSize: Style.font.subtitle
      color: Color.foreground
      font.weight: Font.DemiBold
      width: parent.width
    }

    Item { width: parent.width; height: Style.spacing.sm }

    Repeater {
      model: root.categories
      delegate: Rectangle {
        id: navBtn
        required property string modelData
        required property int index
        width: parent.width
        height: Style.spacing.controlHeight
        radius: Style.cornerRadius
        // The active-row tint lives in the FILL's alpha, not in the item's
        // `opacity`. `opacity` cascades to children, so `opacity: 0.0` on an
        // inactive row made its label invisible too — which is why the rail
        // showed only the selected category and looked like a one-item list.
        color: navBtn.modelData === root.activeKey
          ? Util.alpha(Color.foreground, 0.1)
          : "transparent"

        Text {
          anchors { left: navBtn.left; leftMargin: Style.spacing.md; right: navBtn.right; rightMargin: Style.spacing.md; verticalCenter: navBtn.verticalCenter }
          text: navBtn.modelData
          font.family: Style.font.family
          font.pixelSize: Style.font.body
          font.weight: navBtn.modelData === root.activeKey ? Font.DemiBold : Font.Normal
          color: navBtn.modelData === root.activeKey ? Color.accent : Color.foreground
          elide: Text.ElideRight
        }

        MouseArea {
          anchors.fill: navBtn
          cursorShape: Qt.PointingHandCursor
          onClicked: root.selected(navBtn.modelData)
        }
      }
    }

    Item { width: parent.width; height: parent.height - y }
  }
}