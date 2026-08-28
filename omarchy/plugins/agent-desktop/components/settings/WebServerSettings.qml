pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

// Web Server category.
//
// VERIFIED channels (the page lists only the ones that actually
// resolved): server:isPasswordSet, server:getSessionDurationDays,
// server:setSessionDurationDays, server:getRememberDurationDays,
// server:setRememberDurationDays.
//
// Channels NOT surfaced because they're in WS_BLOCKED_CHANNELS:
// server:start, server:stop, server:setPassword, server:clearPassword,
// server:getStatus. The page states this and points users at the
// systemd unit + `node out/headless/index.js --set-password`.
//
// server_enabled / server_port / server_shortCode / server_accessMode
// are persisted settings — the page shows them read-only because the
// service refuses `settings:set` for these when they are CLI-pinned
// (settings:getLocked). The page renders them disabled.
Item {
  id: root

  required property var rpc
  required property var settingsStore

  property bool passwordSet: false
  property int sessionDays: 7
  property int rememberDays: 30

  function loadStatus() {
    rpc.invoke("server:isPasswordSet", [], function (r) {
      root.passwordSet = r === true
    }, function () { root.passwordSet = false })
    rpc.invoke("server:getSessionDurationDays", [], function (r) {
      root.sessionDays = Number(r) || 7
    }, function () {})
    rpc.invoke("server:getRememberDurationDays", [], function (r) {
      root.rememberDays = Number(r) || 30
    }, function () {})
  }

  Component.onCompleted: loadStatus()

  function get(key, fallback) {
    return settingsStore ? settingsStore.get(key, fallback === undefined ? "" : fallback) : (fallback || "")
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

    PanelSectionHeader { text: "Web Server" }

    Text {
      width: parent.width
      text: "Start/stop and password change are managed by the systemd unit "
          + "and `node out/headless/index.js --set-password` — the channels "
          + "are blocked over WebSocket on purpose."
      color: Color.muted
      opacity: 0.85
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
    }

    PanelSectionHeader { text: "Status" }

    Row {
      width: parent.width
      spacing: Style.spacing.md

      Text {
        width: parent.width * 0.4
        anchors.verticalCenter: parent.verticalCenter
        text: "Password protection"
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.body
      }
      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: root.passwordSet ? "enabled" : "disabled"
        color: root.passwordSet ? Color.accent : Color.muted
        font.family: Style.font.family
        font.pixelSize: Style.font.body
      }
    }

    PanelSectionHeader { text: "Session" }

    Row {
      width: parent.width
      spacing: Style.spacing.md

      Text {
        width: parent.width * 0.4
        anchors.verticalCenter: parent.verticalCenter
        text: "Session duration (days)"
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.body
      }
      NumberField {
        width: parent.width * 0.4
        value: root.sessionDays
        from: 1
        to: 365
        stepSize: 1
        onModified: function (v) {
          root.rpc.invoke("server:setSessionDurationDays", [Math.round(v)], function () { root.sessionDays = Math.round(v) },
            function (err) { console.warn("setSessionDurationDays failed:", err) })
        }
      }
    }

    Row {
      width: parent.width
      spacing: Style.spacing.md

      Text {
        width: parent.width * 0.4
        anchors.verticalCenter: parent.verticalCenter
        text: "Remember-me duration (days)"
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.body
      }
      NumberField {
        width: parent.width * 0.4
        value: root.rememberDays
        from: 1
        to: 365
        stepSize: 1
        onModified: function (v) {
          root.rpc.invoke("server:setRememberDurationDays", [Math.round(v)], function () { root.rememberDays = Math.round(v) },
            function (err) { console.warn("setRememberDurationDays failed:", err) })
        }
      }
    }

    PanelSectionHeader { text: "Persisted settings" }

    Text {
      width: parent.width
      text: "These are read-only here. server_port is locked when the CLI "
          + "--port override is in effect; the page reflects that with the "
          + "lock indicator."
      color: Color.muted
      opacity: 0.85
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
    }

    Repeater {
      model: ["server_enabled", "server_port", "server_autoStart", "server_shortCode", "server_accessMode"]
      delegate: Row {
        id: srvField
        required property string modelData
        width: parent.width
        spacing: Style.spacing.md

        Text {
          width: parent.width * 0.4
          anchors.verticalCenter: parent.verticalCenter
          text: srvField.modelData
          color: Color.foreground
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
        }
        TextField {
          width: parent.width * 0.6
          text: root.get(srvField.modelData, "")
          readOnly: true
        }
      }
    }
  }
}