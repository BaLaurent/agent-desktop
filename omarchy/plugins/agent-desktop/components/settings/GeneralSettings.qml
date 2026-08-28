pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

// General category: sendOnEnter, autoScroll, fontSize, notificationConfig,
// and the reseed built-in guides button. Mirrors GeneralSettings.tsx.
//
// `fontSize` is hand-written (no SettingDef) — the React page has a
// slider. The QML page uses a NumberField clamped to [10, 28] (the
// renderer's documented range).
//
// The notificationConfig grid reads + writes through here; the parent
// SettingsPage passes SettingsStore and we round-trip via
// `settings:set("notificationConfig", json)`.
Item {
  id: root

  required property var settingsStore
  required property var rpc
  required property var notificationsEvents
  required property var defaultNotificationConfig


  // ---- bound helpers -------------------------------------------------

  function get(key, fallback) {
    return settingsStore ? settingsStore.get(key, fallback === undefined ? "" : fallback) : (fallback || "")
  }

  function setBool(key, value) {
    if (settingsStore) settingsStore.set(key, value ? "true" : "false")
  }

  function setStr(key, value) {
    if (settingsStore) settingsStore.set(key, value)
  }

  function notificationConfig() {
    var raw = get("notificationConfig", "")
    if (!raw) return defaultNotificationConfig
    try {
      var parsed = JSON.parse(raw)
      if (parsed && typeof parsed === "object") return parsed
    } catch (e) {}
    return defaultNotificationConfig
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

    PanelSectionHeader { text: "General" }

    Toggle {
      width: parent.width
      label: "Send on Enter (Ctrl+Enter to send when off)"
      checked: root.get("sendOnEnter", "true") === "true"
      onClicked: { root.setBool("sendOnEnter", !checked); checked = !checked }
    }

    Toggle {
      width: parent.width
      label: "Auto-scroll to the latest message"
      checked: root.get("autoScroll", "true") === "true"
      onClicked: { root.setBool("autoScroll", !checked); checked = !checked }
    }

    NumberField {
      width: parent.width
      label: "Font size (px)"
      value: Number(root.get("fontSize", "14"))
      from: 10
      to: 28
      stepSize: 1
      onModified: function (v) { root.setStr("fontSize", String(v)) }
    }

    PanelSectionHeader { text: "Notifications" }

    Text {
      width: parent.width
      text: "Sound and desktop notifications per event. Stored as JSON in the agent.db settings table."
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      color: Color.muted
      opacity: 0.8
      wrapMode: Text.WordWrap
    }

    // `config` is a live binding on the stored value, and `onConfigChanged`
    // writes that value back — which re-evaluates the binding, reassigns
    // `config`, and fires the handler again. Qt reported it as
    // "Binding loop detected for property config" and broke the cycle
    // itself, which is precisely why a toggle could fail to stick.
    //
    // The write is now conditional: once the store already holds this value
    // the echo stops after one evaluation, and a genuine external change
    // still flows in through the binding.
    NotificationConfigGrid {
      id: notifGrid
      width: parent.width
      events: root.notificationsEvents
      defaults: root.defaultNotificationConfig
      config: root.notificationConfig()
      onConfigChanged: {
        var next = JSON.stringify(notifGrid.config)
        if (next === JSON.stringify(root.notificationConfig())) return
        root.setStr("notificationConfig", next)
      }
    }

    PanelSectionHeader { text: "Built-in guides" }

    Row {
      width: parent.width
      spacing: Style.spacing.md

      Button {
        text: "Reseed built-in guides"
        bordered: true
        onClicked: {
          root.rpc.invoke("guides:reseed", [],
            function (result) {
              // The server returns { created } — surface it briefly.
              // A toast-style notification is out of scope here; the
              // status row below tells the user what happened.
              if (result && typeof result.created === "number") {
                reseedStatus.text = "Reseeded: " + result.created + " guide(s) created."
              } else {
                reseedStatus.text = "Reseed complete."
              }
            },
            function (err) { reseedStatus.text = "Reseed failed: " + String(err) })
        }
      }
      Text {
        id: reseedStatus
        anchors.verticalCenter: parent.verticalCenter
        text: ""
        color: Color.muted
        opacity: 0.7
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
      }
    }
  }
}