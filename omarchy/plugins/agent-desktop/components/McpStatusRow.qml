pragma ComponentBehavior: Bound

import QtQuick

import qs.Commons

import "../lib/palette.js" as Palette
// Read-only row for an mcp_status part. The store's reducer REPLACES the
// latest mcp_status part on every chunk (load-bearing — measured: a part
// arrives mid-turn even with zero MCP servers configured). The UI just
// renders the latest snapshot.
Item {
  id: root

  required property var mcp
  // { type:'mcp_status', servers: [{ name, status, error? }] }

  property bool expanded: false

  function _summary() {
    if (!root.mcp || !root.mcp.servers) return "MCP servers"
    var all = root.mcp.servers.every(function (s) { return s.status === "connected" })
    var errors = root.mcp.servers.some(function (s) { return s.status === "error" })
    if (all) return root.mcp.servers.length + " MCP server"
      + (root.mcp.servers.length > 1 ? "s" : "") + " connected"
    if (errors) return "MCP connection issues"
    return "Connecting to MCP servers..."
  }

  function _dotColor(status) {
    if (status === "connected") return Color.accent
    if (status === "connecting") return Color.muted
    return Color.urgent
  }

  // A parent that mounts this with width only (a Column row, a ListView
  // delegate, a Loader) adopts the item's implicitHeight. Without it the root
  // Item is zero-high and the whole body is invisible — which is how assistant
  // messages vanished from the transcript while the store held them. Ignored
  // when a parent sets an explicit height, so it is safe everywhere.
  implicitHeight: bodyRoot.implicitHeight

  Rectangle {
    id: bodyRoot
    anchors { left: root.left; right: root.right }
    height: layout.implicitHeight + 2 * Style.spacing.sm
    color: Util.alpha(Color.foreground, Palette.surfaceAlpha(1))
    border { width: Style.normalBorderWidth; color: Color.muted }
    radius: Style.cornerRadius

    Column {
      id: layout
      anchors {
        left: parent.left
        right: parent.right
        top: parent.top
        margins: Style.spacing.sm
      }
      spacing: Style.spacing.xs

      MouseArea {
        anchors { left: parent.left; right: parent.right }
        height: row.implicitHeight
        cursorShape: Qt.PointingHandCursor
        onClicked: root.expanded = !root.expanded
        Row {
          id: row
          spacing: Style.spacing.sm
          Text {
            text: root.expanded ? "▼" : "▶"
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
            color: Color.muted
            anchors.verticalCenter: parent.verticalCenter
          }
          Text {
            text: root._summary()
            font.family: Style.font.family
            font.pixelSize: Style.font.bodySmall
            font.weight: Font.Medium
            color: Color.foreground
            anchors.verticalCenter: parent.verticalCenter
          }
        }
      }

      Column {
        visible: root.expanded
        spacing: Style.spacing.xs
        anchors { left: parent.left; right: parent.right }
        Repeater {
          model: root.mcp && root.mcp.servers ? root.mcp.servers : []
          delegate: Row {
            id: mcpRow
            required property var modelData
            spacing: Style.spacing.sm
            anchors { left: mcpRow.parent ? mcpRow.parent.left : undefined; right: mcpRow.parent ? mcpRow.parent.right : undefined }
            Rectangle {
              width: 6
              height: 6
              radius: 3
              color: root._dotColor(mcpRow.modelData.status)
              anchors.verticalCenter: parent.verticalCenter
            }
            Text {
              text: mcpRow.modelData.name || ""
              font.family: Style.font.family
              font.pixelSize: Style.font.bodySmall
              color: Color.foreground
              anchors.verticalCenter: parent.verticalCenter
            }
            Text {
              text: mcpRow.modelData.status || ""
              font.family: Style.font.family
              font.pixelSize: Style.font.caption
              color: Color.muted
              opacity: 0.8
              anchors.verticalCenter: parent.verticalCenter
            }
            Text {
              visible: !!mcpRow.modelData.error
              text: mcpRow.modelData.error || ""
              font.family: Style.font.family
              font.pixelSize: Style.font.caption
              color: Color.urgent
              elide: Text.ElideRight
              anchors.verticalCenter: parent.verticalCenter
            }
          }
        }
      }
    }
  }
}
