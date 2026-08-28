pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

// OpenSCAD category — placeholder.
//
// The OpenSCAD editor is owned by Phase9 (a separate OpenScadPage
// component rendered in the main panel, not under the settings page).
// The settings category is rendered by this note so the sidebar's
// "OpenSCAD" entry does not 404; once Phase9's page is mounted in
// App.qml, this category can be wired to a one-click "open in panel"
// button.
Item {
  id: root

  // The page mounts this in a Loader that sets only `width`, so the Loader
  // adopts this item's implicitHeight. Without it the item is zero-high and the
  // entire body is clipped away — which is what made every settings category
  // render blank.
  implicitHeight: bodyCol.implicitHeight

  Column {
    id: bodyCol
    anchors { left: parent.left; right: parent.right }
    spacing: Style.spacing.md

    PanelSectionHeader { text: "OpenSCAD" }

    Text {
      width: parent.width
      text: "OpenSCAD configuration is in the main panel. The editor and the "
          + "export-to-STL controls live there; this settings category is a "
          + "placeholder until the panel page is wired into App.qml."
      color: Color.muted
      opacity: 0.85
      font.family: Style.font.family
      font.pixelSize: Style.font.body
      wrapMode: Text.WordWrap
    }
  }
}