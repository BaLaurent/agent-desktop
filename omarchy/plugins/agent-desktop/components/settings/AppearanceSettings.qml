pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

// Appearance category.
//
// Shrunk to what QML can honour: a font-scale control writing `fontSize`
// (ALLOWED_SETTING_KEYS confirmed) plus a read-only note that the
// palette follows the active Omarchy theme.
//
// `activeTheme`, `showTitlebar`, `windowTitle`, `chatLayout`,
// `panelButtonRadius`, `panelButtonAlwaysVisible` are DOM/Electron
// concepts and are intentionally not surfaced.
Item {
  id: root

  required property var settingsStore

  function get(key, fallback) {
    return settingsStore ? settingsStore.get(key, fallback === undefined ? "" : fallback) : (fallback || "")
  }

  function setStr(key, value) {
    if (settingsStore) settingsStore.set(key, value)
  }

  // The page mounts this in a Loader that sets only `width`, so the Loader
  // adopts this item's implicitHeight. Without it the item is zero-high and the
  // entire body is clipped away — which is what made every settings category
  // render blank.
  implicitHeight: bodyCol.implicitHeight

  Column {
    id: bodyCol
    anchors { left: parent.left; right: parent.right }
    spacing: Style.spacing.md

    PanelSectionHeader { text: "Typography" }

    NumberField {
      width: parent.width
      label: "Font size (px)"
      value: Number(root.get("fontSize", "14"))
      from: 10
      to: 28
      stepSize: 1
      onModified: function (v) { root.setStr("fontSize", String(v)) }
    }

    PanelSectionHeader { text: "Palette" }

    Text {
      width: parent.width
      text: "The palette follows the active Omarchy theme. The plugin reads "
          + "Color.* / Style.* from qs.Commons; no per-plugin palette is "
          + "rendered."
      color: Color.muted
      opacity: 0.85
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
    }
  }
}