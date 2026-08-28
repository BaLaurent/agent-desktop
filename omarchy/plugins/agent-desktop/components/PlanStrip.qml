pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls

import qs.Commons
import "../lib/palette.js" as Palette

// PI-only plan approval strip. Emitted by the bundled extension's
// exit_plan_mode tool. The store answers via `store.approvePlan(...)`:
//   - approve: writes ai_permissionMode='bypassPermissions' into the
//     conversation's ai_overrides and sends a NEW user message — NOT a
//     respondToApproval call (PlanApprovalBlock.tsx).
//   - reject: sends a user message with the typed feedback.
Item {
  id: root

  // PI plan approval object:
  //   { conversationId, plan }
  required property var approval
  required property var store

  property string responded: "" // "" | "approve" | "reject"
  property string feedback: ""

  function _onApprove() {
    if (root.responded) return
    root.responded = "approve"
    root.store.approvePlan(root.approval.conversationId, true, root.feedback)
  }
  function _onReject() {
    if (root.responded) return
    root.responded = "reject"
    var reason = root.feedback && root.feedback.trim().length > 0
      ? root.feedback.trim()
      : "(no specific feedback provided)"
    root.store.approvePlan(root.approval.conversationId, false, reason)
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
        text: "Plan ready — review before leaving plan mode"
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        font.weight: Font.Medium
        color: Color.urgent
      }

      MarkdownBlock {
        visible: !!root.approval && !!root.approval.plan
        text: root.approval && root.approval.plan ? root.approval.plan : ""
        anchors { left: parent.left; right: parent.right }
      }

      TextArea {
        visible: !root.responded
        text: root.feedback
        onTextChanged: root.feedback = text
        placeholderText: "Optional — sent to the agent if you reject the plan"
        wrapMode: TextArea.Wrap
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        color: Color.foreground
        anchors { left: parent.left; right: parent.right }
        height: 60
      }

      Row {
        spacing: Style.spacing.sm
        visible: !root.responded
        Button { text: "Approve & proceed"; onClicked: root._onApprove() }
        Button { text: "Reject & revise"; onClicked: root._onReject() }
      }

      Text {
        visible: root.responded !== ""
        text: root.responded === "approve" ? "Approved" : "Rejected"
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        font.weight: Font.Medium
        color: root.responded === "approve" ? Color.accent : Color.urgent
      }
    }
  }
}
