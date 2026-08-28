pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

// Allowed Tools category — preset / custom switch + per-tool toggle.
//
// The two modes the server enforces (`ai_tools === "preset:claude_code"`
// vs `ai_tools` as a JSON string[]) are presented as a radio pair.
// `ToolsStore` is the source of truth for the mode and the per-tool
// enabled state. Clicking the radio flips the mode through
// `store.setMode("preset"|"custom")`; the toggles go through
// `store.toggle(name)` which keeps the wire form consistent.
Item {
  id: root

  required property var store

  // The page mounts this in a Loader that sets only `width`, so the Loader
  // adopts this item's implicitHeight. Without it the item is zero-high and the
  // entire body is clipped away — which is what made every settings category
  // render blank.
  implicitHeight: bodyCol.implicitHeight

  Column {
    id: bodyCol
    anchors { left: parent.left; right: parent.right }
    spacing: Style.spacing.md

    PanelSectionHeader { text: "Allowed tools" }

    Row {
      width: parent.width
      spacing: Style.spacing.md

      Button {
        text: "Preset (all)"
        bordered: true
        selected: root.store.mode === "preset"
        onClicked: root.store.setMode("preset")
      }
      Button {
        text: "Custom"
        bordered: true
        selected: root.store.mode === "custom"
        onClicked: root.store.setMode("custom")
      }
    }

    Text {
      text: root.store.mode === "preset"
        ? "All tools are enabled. Switching to Custom writes the current set as a JSON list."
        : "Each tool is toggled individually. Switching to Preset enables all tools."
      color: Color.muted
      opacity: 0.7
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
      width: parent.width
    }

    Repeater {
      model: root.store.tools
      delegate: Row {
        id: toolRow
        required property var modelData
        width: parent.width
        spacing: Style.spacing.md

        Toggle {
          width: parent.width * 0.35
          label: toolRow.modelData ? toolRow.modelData.name : ""
          checked: toolRow.modelData && toolRow.modelData.enabled === true
          onClicked: {
            if (toolRow.modelData) root.store.toggle(toolRow.modelData.name)
          }
        }

        Text {
          width: parent.width * 0.65
          anchors.verticalCenter: parent.verticalCenter
          text: toolRow.modelData ? (toolRow.modelData.description || "") : ""
          color: Color.muted
          opacity: 0.7
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.WordWrap
        }
      }
    }

    Text {
      visible: !root.store.loaded
      text: "Loading…"
      color: Color.muted
      opacity: 0.6
      font.family: Style.font.family
      font.pixelSize: Style.font.body
    }
  }
}