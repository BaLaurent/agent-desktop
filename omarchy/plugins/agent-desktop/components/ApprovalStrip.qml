pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls

import qs.Commons
import "../lib/palette.js" as Palette

// A pending tool_approval strip — answers the agent's request for an
// allow/deny decision on a specific tool invocation.
//
// The store already keeps a `pendingApproval` property; the parent
// passes it in here. On Allow or Deny we call `store.approve(...)` and
// the strip's local `responded` flag flips so the buttons disappear and
// the verdict chip shows.
Item {
  id: root

  // Pending approval object shape:
  //   { requestId, toolName, toolInput }
  required property var approval
  // The ChatStore — answers via approve().
  required property var store

  property string responded: "" // "" | "allow" | "deny"

  property bool _isExitPlanMode: root.approval && root.approval.toolName === "ExitPlanMode"

  property string denyReason: ""
  property bool dontAskAgain: false

  function _onAllow() {
    if (root.responded) return
    root.responded = "allow"
    var msg = root.denyReason && root.denyReason.length > 0 ? root.denyReason : ""
    root.store.approve(root.approval.requestId, true, msg, root.dontAskAgain)
    root.denyReason = ""
    root.dontAskAgain = false
  }

  function _onDeny() {
    if (root.responded) return
    root.responded = "deny"
    var msg = root.denyReason && root.denyReason.length > 0 ? root.denyReason : ""
    root.store.approve(root.approval.requestId, false, msg, root.dontAskAgain)
    root.denyReason = ""
    root.dontAskAgain = false
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
    height: layout.implicitHeight + 2 * Style.spacing.md
    color: Util.alpha(Color.foreground, Palette.surfaceAlpha(2))
    border { width: Style.normalBorderWidth; color: Color.urgent }
    radius: Style.cornerRadius

    Column {
      id: layout
      anchors {
        left: parent.left
        right: parent.right
        top: parent.top
        margins: Style.spacing.md
      }
      spacing: Style.spacing.sm

      Text {
        text: root.approval && root.approval.toolName
          ? (root.approval.toolName === "ExitPlanMode"
              ? "Plan ready — review before leaving plan mode"
              : "Tool approval required: " + root.approval.toolName)
          : "Tool approval required"
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        font.weight: Font.Medium
        color: Color.urgent
        wrapMode: Text.Wrap
        anchors { left: parent.left; right: parent.right }
      }

      // ExitPlanMode: show the plan markdown. Other tools: show the input
      // key/value pairs verbatim (matches ToolApprovalBlock.tsx).
      MarkdownBlock {
        visible: root._isExitPlanMode
        text: root.approval && root.approval.toolInput && root.approval.toolInput.plan
          ? String(root.approval.toolInput.plan)
          : ""
        anchors { left: parent.left; right: parent.right }
      }

      Column {
        visible: !root._isExitPlanMode
        spacing: 2
        anchors { left: parent.left; right: parent.right }
        Repeater {
          model: root.approval && root.approval.toolInput
            ? Object.keys(root.approval.toolInput)
            : []
          delegate: Text {
            required property string modelData
            text: modelData + ": " + JSON.stringify(root.approval.toolInput[modelData])
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
            color: Color.muted
            wrapMode: Text.Wrap
            anchors { left: parent.left; right: parent.right }
          }
        }
      }

      // ExitPlanMode deny feedback textarea.
      TextArea {
        visible: root._isExitPlanMode && !root.responded
        text: root.denyReason
        onTextChanged: root.denyReason = text
        placeholderText: "Optional — sent to the agent if you reject the plan"
        wrapMode: TextArea.Wrap
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        color: Color.foreground
        anchors { left: parent.left; right: parent.right }
        height: 60
      }

      // "Don't ask again for this tool" — non-ExitPlanMode only.
      CheckBox {
        visible: !root._isExitPlanMode && !root.responded
        text: "Don't ask again for this tool"
        checked: root.dontAskAgain
        onCheckedChanged: root.dontAskAgain = checked
      }

      // Buttons OR a settled verdict chip.
      Row {
        spacing: Style.spacing.sm
        anchors { left: parent.left; right: parent.right }

        Button {
          visible: !root.responded
          text: root._isExitPlanMode ? "Approve & proceed" : "Allow"
          onClicked: root._onAllow()
        }
        Button {
          visible: !root.responded
          text: root._isExitPlanMode ? "Reject & revise" : "Deny"
          onClicked: root._onDeny()
        }

        Text {
          visible: root.responded !== ""
          text: root.responded === "allow" ? "Approved" : "Denied"
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
          font.weight: Font.Medium
          color: root.responded === "allow" ? Color.accent : Color.urgent
        }
      }
    }
  }
}
