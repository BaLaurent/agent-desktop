pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

// Discord category — three reachable channels: discord:connect,
// discord:disconnect, discord:status. The bot token is the
// `discord_botToken` setting (the renderer stores it that way); the
// page reads/writes it through SettingsStore and triggers a reconnect
// by toggling the bot through connect/disconnect.
//
// Channels NOT ported (per the plan): channel bindings
// (discord:channelBindings), user whitelist management beyond the
// `discord_userWhitelist` setting key. The bot accepts a JSON list of
// allowed user IDs and channel bindings as settings; the page surfaces
// them as raw JSON text fields for editing.
Item {
  id: root

  required property var rpc
  required property var settingsStore

  property var status: ({ connected: false })
  property string statusText: "loading…"

  function refreshStatus() {
    root.rpc.invoke("discord:status", [], function (s) {
      root.status = s && typeof s === "object" ? s : ({ connected: false })
      if (root.status.connected) {
        root.statusText = "connected as " + (root.status.username || "?")
          + " · " + (root.status.guildCount || 0) + " guilds"
      } else {
        root.statusText = "disconnected"
      }
    }, function () { root.status = ({ connected: false }); root.statusText = "error" })
  }

  Component.onCompleted: refreshStatus()

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

    PanelSectionHeader { text: "Discord bot" }

    Text {
      text: root.statusText
      color: root.status.connected ? Color.accent : Color.muted
      font.family: Style.font.family
      font.pixelSize: Style.font.body
    }

    Text {
      width: parent.width
      text: "Bot token:"
      color: Color.muted
      opacity: 0.7
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
    }

    TextField {
      id: tokenInput
      width: parent.width
      text: root.get("discord_botToken", "")
      echoMode: TextInput.Password
      onEditingFinished: root.setStr("discord_botToken", text)
    }

    PanelSectionHeader { text: "Controls" }

    Row {
      width: parent.width
      spacing: Style.spacing.md

      Button {
        text: "Connect"
        bordered: true
        onClicked: {
          root.rpc.invoke("discord:connect", [], function () { root.refreshStatus() },
            function (err) { console.warn("discord:connect failed:", err) })
        }
      }
      Button {
        text: "Disconnect"
        bordered: true
        onClicked: {
          root.rpc.invoke("discord:disconnect", [], function () { root.refreshStatus() },
            function (err) { console.warn("discord:disconnect failed:", err) })
        }
      }
    }

    PanelSectionHeader { text: "Whitelist & bindings" }

    Text {
      width: parent.width
      text: "Whitelist (JSON array of user IDs):"
      color: Color.muted
      opacity: 0.7
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
    }
    TextField {
      id: whitelistInput
      width: parent.width
      text: root.get("discord_userWhitelist", "[]")
      onEditingFinished: root.setStr("discord_userWhitelist", text)
    }

    Text {
      width: parent.width
      text: "Channel bindings (JSON object):"
      color: Color.muted
      opacity: 0.7
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
    }
    TextField {
      id: bindingsInput
      width: parent.width
      text: root.get("discord_channelBindings", "{}")
      onEditingFinished: root.setStr("discord_channelBindings", text)
    }

    Toggle {
      width: parent.width
      label: "Discord bot enabled"
      checked: root.get("discord_enabled", "false") === "true"
      onClicked: {
        var next = !checked
        checked = next
        root.setStr("discord_enabled", next ? "true" : "false")
      }
    }
  }
}