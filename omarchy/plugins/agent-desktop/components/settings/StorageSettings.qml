pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

// Storage category — destructive DB wipes. Both channels are
// ELECTRON_ONLY normally but LOCAL_WS_ALLOWED_CHANNELS admits them for
// ws-local (loopback) clients, so a same-host QML front can show its
// own ConfirmDialog and call them. The renderer wraps the same channels
// behind its own modal — we follow that pattern.
//
// "Database location" and "Config path" are read locally from QML
// (CONTRACTS.md §8: "system info — read it locally; there is no channel").
Item {
  id: root

  required property var rpc

  property string purgeResult: ""
  property bool purging: false

  // 0 = none, 1 = conversations, 2 = all.
  //
  // Clearing the cache is NOT in here: it needs no confirmation because it is
  // not destructive. `system:clearCache` empties the server's in-memory log
  // buffer (src/core/handlers/system.ts:35 — `logBuffer.length = 0`) and
  // touches no stored data. The Electron front does the same thing with no
  // dialog either, just a transient acknowledgement.
  property int confirmTarget: 0

  property bool clearing: false
  property bool cleared: false

  function doClearCache() {
    root.clearing = true
    rpc.invoke("system:clearCache", [], function () {
      root.clearing = false
      root.cleared = true
      clearedReset.restart()
    }, function (err) {
      root.clearing = false
      root.purgeResult = "Clear cache failed: " + String(err)
    })
  }

  // Mirrors the old front's 3s acknowledgement. A Timer rather than a
  // setTimeout so it is cancelled with the component.
  Timer {
    id: clearedReset
    interval: 3000
    onTriggered: root.cleared = false
  }

  function doPurgeConversations() {
    root.purging = true
    rpc.invoke("system:purgeConversations", [], function (r) {
      root.purging = false
      root.purgeResult = "Purged conversations: " + JSON.stringify(r)
      root.confirmTarget = 0
    }, function (err) {
      root.purging = false
      root.purgeResult = "Purge failed: " + String(err)
      root.confirmTarget = 0
    })
  }

  function doPurgeAll() {
    root.purging = true
    rpc.invoke("system:purgeAll", [], function (r) {
      root.purging = false
      root.purgeResult = "Purged all: " + JSON.stringify(r)
      root.confirmTarget = 0
    }, function (err) {
      root.purging = false
      root.purgeResult = "Purge failed: " + String(err)
      root.confirmTarget = 0
    })
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

    PanelSectionHeader { text: "Storage" }

    Text {
      width: parent.width
      text: "Default database location (relative to $HOME):"
      color: Color.muted
      opacity: 0.7
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
    }
    TextField {
      width: parent.width
      text: "~/.config/agent-desktop/agent.db"
      readOnly: true
    }

    Text {
      width: parent.width
      text: "Config path:"
      color: Color.muted
      opacity: 0.7
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
    }
    TextField {
      width: parent.width
      text: "~/.config/agent-desktop/"
      readOnly: true
    }

    PanelSectionHeader { text: "Maintenance" }

    Text {
      width: parent.width
      text: "Clears cached data and the server's application logs. "
          + "Conversations, settings and knowledge are untouched."
      color: Color.muted
      opacity: 0.85
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
    }

    Row {
      width: parent.width
      spacing: Style.spacing.md

      Button {
        text: root.clearing ? "Clearing…" : "Clear cache"
        bordered: true
        enabled: !root.clearing
        onClicked: root.doClearCache()
      }
      Text {
        anchors.verticalCenter: parent.verticalCenter
        visible: root.cleared
        text: "Cleared."
        color: Color.foreground
        opacity: 0.8
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
      }
    }

    PanelSectionHeader { text: "Danger zone" }

    Text {
      width: parent.width
      text: root.purgeResult
      visible: root.purgeResult.length > 0
      color: Color.foreground
      opacity: 0.8
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
    }

    Row {
      width: parent.width
      spacing: Style.spacing.md

      Button {
        text: "Purge conversations"
        bordered: true
        onClicked: { root.confirmTarget = 1 }
      }
      Button {
        text: "Purge all (DB reset)"
        bordered: true
        onClicked: { root.confirmTarget = 2 }
      }
    }
  }

  // Confirm dialog (loopback-local channel call).
  ConfirmDialog {
    opened: root.confirmTarget === 1
    message: "Purge conversations?\n\nDeletes every conversation and its messages. This cannot be undone."
    confirmText: "Purge conversations"
    onConfirmed: root.doPurgeConversations()
    onCanceled: root.confirmTarget = 0
  }

  ConfirmDialog {
    opened: root.confirmTarget === 2
    message: "Purge all data?\n\nResets the entire agent.db. This cannot be undone."
    confirmText: "Purge all"
    onConfirmed: root.doPurgeAll()
    onCanceled: root.confirmTarget = 0
  }
}