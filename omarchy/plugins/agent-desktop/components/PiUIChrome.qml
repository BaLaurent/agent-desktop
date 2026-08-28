pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

import "../lib/palette.js" as Palette

// The non-modal chrome painted by pi:uiEvent pushes.
//
// Owns:
//   - toasts: the `notify` event queue, rendered top-right with autoDismiss
//   - statusChips: one chip per setStatus key, in a Row
//   - widgetsAboveEditor / widgetsBelowEditor: setWidget text blocks
//   - workingMessage: passed through to the streaming indicator label
//   - title: passed up via signal — the caller (App.qml) decides what
//     window title gets re-rendered
//   - header / footer: PiUINode trees rendered through PiUINode.qml
//
// The chrome never answers — that is the modal's job (PiUIModal.qml).
// It only renders the fire-and-forget stream.
//
// Repeater delegates carry an `id` so nested children qualify their
// `modelData` reads through the delegate id (e.g. `toastRow.modelData`).
// qmllint's `Unqualified access` warning fires when a delegate's nested
// child reads `modelData` bare, because the lookup goes through the
// outer scope rather than the delegate root. Pragma
// ComponentBehavior: Bound plus the qualified reach is the supported
// Qt 6 answer.
Item {
  id: root

  required property var store   // PiUiStore

  // Carried upward to App.qml so it can re-write the window title.
  signal titleRequested(string title)

  // ---- toasts (top-right) -------------------------------------------------

  Column {
    id: toastColumn
    anchors { top: parent.top; right: parent.right; margins: Style.spacing.md }
    spacing: Style.spacing.sm
    width: Math.min(360, parent.width * 0.4)

    Repeater {
      // The chrome mounts before the service wires the store in — every
      // top-level binding has to survive `store === null`. See headerArea
      // below for the full rationale and accepted guard forms.
      model: root.store ? root.store.toasts : []
      delegate: Rectangle {
        id: toastRow
        required property var modelData
        radius: Style.cornerRadius
        color: {
          switch (toastRow.modelData.level) {
            case "error":   return Color.urgent
            case "warning": return Palette.warningColor(String(Color.accent), String(Color.urgent))
            default:        return Color.background
          }
        }
        border.width: 1
        border.color: Color.muted
        opacity: 0.95
        width: toastColumn.width
        implicitHeight: toastText.implicitHeight + Style.spacing.md * 2

        Text {
          id: toastText
          anchors {
            left: parent.left; right: parent.right
            verticalCenter: parent.verticalCenter
            margins: Style.spacing.md
          }
          text: toastRow.modelData.message
          color: Color.foreground
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.WordWrap
        }

        MouseArea {
          anchors.fill: parent
          onClicked: root.store.dismissToast(toastRow.modelData.id)
        }

        // Auto-dismiss after 4 seconds — long enough to read the message,
        // short enough that an extension spamming notifications does not
        // pile them up forever.
        Timer {
          interval: 4000
          running: true
          repeat: false
          onTriggered: root.store.dismissToast(toastRow.modelData.id)
        }
      }
    }
  }

  // ---- status chips -------------------------------------------------------

  Row {
    id: statusRow
    anchors { top: parent.top; left: parent.left; margins: Style.spacing.md }
    spacing: Style.spacing.sm
    visible: root.store && root.store.statuses ? Object.keys(root.store.statuses).length > 0 : false

    Repeater {
      model: {
        if (!root.store || !root.store.statuses) return []
        var keys = []
        for (var k in root.store.statuses) keys.push(k)
        return keys.map(function (k) { return ({ key: k, text: root.store.statuses[k] }) })
      }
      delegate: Rectangle {
        id: chipRow
        required property var modelData
        radius: Style.cornerRadius
        color: Color.background
        border.width: 1
        border.color: Color.accent
        opacity: 0.9
        implicitWidth: chipText.implicitWidth + Style.spacing.md * 2
        implicitHeight: chipText.implicitHeight + Style.spacing.xs * 2

        Text {
          id: chipText
          anchors.centerIn: parent
          text: chipRow.modelData.key + ": " + chipRow.modelData.text
          color: Color.foreground
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
        }
      }
    }
  }

  // ---- widgetsAboveEditor / widgetsBelowEditor ---------------------------

  // These render below the chat status line. The pane that mounts this
  // chrome is responsible for placing it correctly; we just emit the
  // blocks.
  Column {
    id: widgetsAbove
    anchors { top: statusRow.bottom; left: parent.left; right: parent.right }
    anchors.topMargin: Style.spacing.md
    spacing: Style.spacing.xs
    visible: root.store && root.store.widgets ? Object.keys(root.store.widgets).length > 0 : false

    Repeater {
      model: {
        if (!root.store || !root.store.widgets) return []
        var arr = []
        for (var k in root.store.widgets) {
          if (root.store.widgets[k].placement === "aboveEditor") arr.push(root.store.widgets[k])
        }
        return arr
      }
      delegate: Rectangle {
        id: aboveRow
        required property var modelData
        width: parent.width
        color: Qt.rgba(0, 0, 0, 0)
        border.width: 1
        border.color: Color.muted
        radius: Style.cornerRadius
        implicitHeight: aboveText.implicitHeight + Style.spacing.md * 2

        Text {
          id: aboveText
          anchors {
            left: parent.left; right: parent.right
            top: parent.top; margins: Style.spacing.md
          }
          text: aboveRow.modelData.content.join("\n")
          color: Color.foreground
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.WordWrap
        }
      }
    }
  }

  Column {
    id: widgetsBelow
    anchors { bottom: parent.bottom; left: parent.left; right: parent.right }
    anchors.bottomMargin: Style.spacing.md
    spacing: Style.spacing.xs
    visible: root.store && root.store.widgets ? Object.keys(root.store.widgets).length > 0 : false

    Repeater {
      model: {
        if (!root.store || !root.store.widgets) return []
        var arr = []
        for (var k in root.store.widgets) {
          if (root.store.widgets[k].placement === "belowEditor") arr.push(root.store.widgets[k])
        }
        return arr
      }
      delegate: Rectangle {
        id: belowRow
        required property var modelData
        width: parent.width
        color: Qt.rgba(0, 0, 0, 0)
        border.width: 1
        border.color: Color.muted
        radius: Style.cornerRadius
        implicitHeight: belowText.implicitHeight + Style.spacing.md * 2

        Text {
          id: belowText
          anchors {
            left: parent.left; right: parent.right
            top: parent.top; margins: Style.spacing.md
          }
          text: belowRow.modelData.content.join("\n")
          color: Color.foreground
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.WordWrap
        }
      }
    }
  }

  // ---- header / footer ----------------------------------------------------

// Header sits above the editor (top of the chat pane); footer below.
// Both render through PiUINode.qml, which handles the eight node types.
// `root.store` is null until Main wires the service — App.qml passes
// `root.service ? root.service.piUiStore : null`. Every top-level binding
// on this chrome (Repeater.model, the Row.visible chips, headerArea /
// footerArea) evaluates at CONSTRUCTION, before that assignment lands,
// so the bare `root.store.X` threw on every plugin load:
//
//   PiUIChrome.qml[232]: TypeError: Cannot read property 'headerNode' of null
//   PiUIChrome.qml[249]: TypeError: Cannot read property 'footerNode' of null
//
// Caught only by reading the shell's own log after a real plugin reload —
// the offscreen suite instantiates this component WITH a store, and static
// linting cannot see a null dereference. (Do not open a comment line with
// the linter's own name: it parses `// <lintername> …` as a directive and
// reports every following word as an unknown category.) The bare
// `root.store.X` uses INSIDE the Repeater delegates only run once the
// Repeater has been told there is data, which is why those stayed safe.
  Item {
    id: headerArea
    anchors { top: widgetsAbove.bottom; left: parent.left; right: parent.right }
    anchors.topMargin: Style.spacing.md
    visible: !!root.store && root.store.headerNode !== null
    height: root.store && root.store.headerNode
      ? headerNodeItem.implicitHeight + Style.spacing.md * 2
      : 0

    PiUINode {
      id: headerNodeItem
      anchors {
        left: parent.left; right: parent.right
        top: parent.top; margins: Style.spacing.md
      }
      node: root.store ? root.store.headerNode : null
    }
  }

  Item {
    id: footerArea
    anchors { bottom: widgetsBelow.top; left: parent.left; right: parent.right }
    anchors.bottomMargin: Style.spacing.md
    visible: !!root.store && root.store.footerNode !== null
    height: root.store && root.store.footerNode
      ? footerNodeItem.implicitHeight + Style.spacing.md * 2
      : 0

    PiUINode {
      id: footerNodeItem
      anchors {
        left: parent.left; right: parent.right
        bottom: parent.bottom; margins: Style.spacing.md
      }
      node: root.store ? root.store.footerNode : null
    }
  }

  // ---- working message ----------------------------------------------------

  // Just expose it as a binding for whoever owns the streaming label.
  readonly property string workingMessage: root.store ? root.store.workingMessage : ""

  // ---- title --------------------------------------------------------------

  // Re-emit whenever the store's title changes, so App.qml can re-write
  // the FloatingWindow title. Connections is the right primitive — the
  // property itself doesn't have a `Changed` signal we can hook.
  Connections {
    target: root.store
    function onTitleChanged() {
      if (root.store && root.store.title) root.titleRequested(root.store.title)
    }
  }
}