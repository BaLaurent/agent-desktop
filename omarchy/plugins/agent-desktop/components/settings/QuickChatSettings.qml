pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

// Quick Chat category — all keys are ALLOWED_SETTING_KEYS, no generator
// needed.
//
// `quickChat:purge` is ELECTRON_ONLY (electron-only window control) and
// the plugin does not surface it; the renderer exposes it through the
// Electron main process only. CONTRACTS.md §9 leaves quickChat:* in
// ELECTRON_ONLY_CHANNELS, so a loopback ws-local client still gets
// OriginDeniedError. We omit the button.
Item {
  id: root

  required property var settingsStore

  function get(key, fallback) {
    return settingsStore ? settingsStore.get(key, fallback === undefined ? "" : fallback) : (fallback || "")
  }

  function setBool(key, value) {
    if (settingsStore) settingsStore.set(key, value ? "true" : "false")
  }

  // Stub PanelSlider has no `integer`/`minimum`/`maximum`; the slider
  // emits fractional values. Round to a step of 5 to match the
  // renderer's "voice_volumeDuck" range (0..100).
  function _onSliderMove(v) {
    if (!settingsStore) return
    settingsStore.set("voice_volumeDuck", String(Math.round(v / 5) * 5))
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

    PanelSectionHeader { text: "Quick chat" }

    Text {
      width: parent.width
      text: "Quick Chat lets you invoke the agent from anywhere on your "
          + "desktop using global keyboard shortcuts. Configure shortcuts "
          + "in the Shortcuts category."
      color: Color.muted
      opacity: 0.85
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
    }

    PanelSectionHeader { text: "Response display" }

    Toggle {
      width: parent.width
      label: "Show desktop notification for responses"
      checked: root.get("quickChat_responseNotification", "true") === "true"
      onClicked: { var next = !checked; checked = next; root.setBool("quickChat_responseNotification", next) }
    }

    Toggle {
      width: parent.width
      label: "Show response bubble (voice mode)"
      checked: root.get("quickChat_responseBubble", "true") === "true"
      onClicked: { var next = !checked; checked = next; root.setBool("quickChat_responseBubble", next) }
    }

    Toggle {
      width: parent.width
      label: "Headless voice mode (notifications only, no overlay)"
      checked: root.get("quickChat_voiceHeadless", "false") === "true"
      onClicked: { var next = !checked; checked = next; root.setBool("quickChat_voiceHeadless", next) }
    }

    PanelSectionHeader { text: "Voice volume" }

    Row {
      width: parent.width
      spacing: Style.spacing.md

      Slider {
        id: duckSlider
        width: parent.width - pctLabel.width - Style.spacing.md
        from: 0
        to: 100
        stepSize: 5
        value: Number(root.get("voice_volumeDuck", "0"))
        onMoved: function () { root._onSliderMove(value) }
      }
      Text {
        id: pctLabel
        width: 40
        anchors.verticalCenter: parent.verticalCenter
        text: Math.round(Number(root.get("voice_volumeDuck", "0"))) + "%"
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.body
      }
    }



    Text {
      width: parent.width
      text: "Reduces system volume by this percentage during voice recording. 0 = disabled."
      color: Color.muted
      opacity: 0.7
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
    }

    Toggle {
      width: parent.width
      label: "Pause media players during voice recording"
      checked: root.get("voice_pauseMediaPlayers", "true") === "true"
      onClicked: { var next = !checked; checked = next; root.setBool("voice_pauseMediaPlayers", next) }
    }

    PanelSectionHeader { text: "Conversations" }

    Toggle {
      width: parent.width
      label: "Resume last user conversation (text)"
      checked: root.get("quickChat_resumeLastConversationText", "false") === "true"
      onClicked: { var next = !checked; checked = next; root.setBool("quickChat_resumeLastConversationText", next) }
    }

    Toggle {
      width: parent.width
      label: "Resume last user conversation (voice)"
      checked: root.get("quickChat_resumeLastConversationVoice", "false") === "true"
      onClicked: { var next = !checked; checked = next; root.setBool("quickChat_resumeLastConversationVoice", next) }
    }

    Toggle {
      width: parent.width
      label: "Prefer last opened conversation"
      checked: root.get("quickChat_resumePreferLastOpened", "false") === "true"
      onClicked: { var next = !checked; checked = next; root.setBool("quickChat_resumePreferLastOpened", next) }
    }

    Toggle {
      width: parent.width
      label: "Separate conversations for text and voice"
      checked: root.get("quickChat_separateVoiceConversation", "false") === "true"
      onClicked: { var next = !checked; checked = next; root.setBool("quickChat_separateVoiceConversation", next) }
    }
  }
}