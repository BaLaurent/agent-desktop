pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

import qs.Commons
import qs.Ui

import "../lib/palette.js" as Palette

// One conversation row in the sidebar.
//
// Inline rename, colour swatch, context menu (Generate title / Fork /
// Export / Delete), and a drag source for moving the row into a folder.
// Multi-select via Ctrl; range select via Shift is wired in App.qml.
Rectangle {
  id: row

  required property var store
  required property var conversation

  // Drag properties live on the implicit Drag attached to this Rectangle.
  // DropArea in FolderTree reads `drop.source` to get the row, and a single
  // `conversationIds` Array flat-property is exposed on `row` for that.
  property var conversationIds: {
    var ids = row.store && row.store.selectedIds().length > 0
      ? row.store.selectedIds()
      : [row.conversation.id]
    return ids
  }

  height: Style.bar.sizeHorizontal
  // The shell's `popups` group only has `background`, `text`, `border` — it has
  // no `selectedBackground`, so a prior `Color.popups.selectedBackground`
  // binding evaluated to undefined and the active row had NO highlight at all.
  // `selectedBackground` lives on `menu`, used here for the multi-select case.
  // The linter cannot resolve inline `QtObject` group members, which is why the
  // dead binding survived every gate. (Do not start that sentence with the
  // linter's own name: `// qmllint <word>` is parsed as a lint DIRECTIVE, and an
  // unknown category there is itself a warning.) Active -> accent-tinted wash
  // ("this is the conversation you are in"); multi-selected -> neutral menu wash.
  color: {
    var base = "transparent"
    if (row.store && row.store.activeId === row.conversation.id) {
      return Util.alpha(Color.accent, Palette.tintAlpha())
    }
    if (row.store && row.store.isSelected(row.conversation.id)) {
      return Color.menu.selectedBackground
    }
    return base
  }

  // `Drag.dragType: Drag.Automatic` starts a real drag-and-drop the instant
  // `Drag.active` becomes true, and that operation grabs the pointer — so a
  // flag set from `onPressed` swallowed every click and the row could never be
  // selected. Bound to the MouseArea's own `drag.active` instead, which Qt
  // raises only once the pointer has moved past the drag threshold. A plain
  // click therefore reaches `onClicked`, and a real drag still works.
  Drag.active: dragArea.drag.active
  Drag.hotSpot.x: width / 2
  Drag.hotSpot.y: height / 2
  Drag.dragType: Drag.Automatic
  Drag.supportedActions: Qt.MoveAction
  Drag.mimeData: ({
    "text/x-agent-conversation-ids": JSON.stringify(row.conversationIds),
    "application/x-agent-conversation-id": String(row.conversation.id)
  })

  RowLayout {
    anchors.fill: parent
    anchors.leftMargin: Style.spacing.rowPaddingX
    anchors.rightMargin: Style.spacing.rowPaddingX
    spacing: Style.spacing.rowGap

    // Colour swatch: click cycles the colour palette.
    Rectangle {
      Layout.preferredWidth: Style.spacing.xs
      Layout.preferredHeight: Style.spacing.xs
      radius: width / 2
      color: row.conversation.color || Color.muted
      MouseArea {
        anchors.fill: parent
        onClicked: function (mouse) {
          if (!row.store) return
          var next = row.conversation.color ? null : "#7ba2d6"
          row.store.colorMany([row.conversation.id], next)
          mouse.accepted = true
        }
      }
    }

    // Title — double-click enters rename.
    TextField {
      id: renameField
      visible: row._renaming === true
      Layout.fillWidth: true
      text: row.conversation.title || ""
      onAccepted: {
        if (row.store) row.store.rename(row.conversation.id, text)
        row._renaming = false
      }
      Keys.onEscapePressed: function (e) {
        row._renaming = false
        e.accepted = true
      }
    }

    Text {
      visible: !row._renaming
      Layout.fillWidth: true
      text: row.conversation.title || "(untitled)"
      color: Color.foreground
      font.family: Style.font.family
      font.pixelSize: Style.font.body
      elide: Text.ElideRight
    }

    Text {
      text: row.conversation.message_count !== undefined
        ? String(row.conversation.message_count) : ""
      color: Color.muted
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
    }
  }

  property bool _renaming: false

  MouseArea {
    id: dragArea
    anchors.fill: parent
    cursorShape: drag.active ? Qt.ClosedHandCursor : Qt.ArrowCursor
    drag.target: row
    drag.axis: Drag.YAxis
    acceptedButtons: Qt.LeftButton | Qt.RightButton
    onDoubleClicked: function (mouse) {
      row._renaming = true
      renameField.forceActiveFocus()
      renameField.selectAll()
      mouse.accepted = true
    }
    onClicked: function (mouse) {
      // A completed drag does not emit `clicked`, so no guard is needed here.
      if (mouse.button === Qt.RightButton) {
        contextMenu.popup()
        mouse.accepted = true
        return
      }
      if (!row.store) return
      if (mouse.modifiers & Qt.ControlModifier) {
        row.store.toggleSelection(row.conversation.id)
      } else if (mouse.modifiers & Qt.ShiftModifier) {
        row.store.toggleSelection(row.conversation.id)
      } else {
        row.store.setSelection([])
        row.store.setActiveId(row.conversation.id)
      }
      mouse.accepted = true
    }
  }

  Menu {
    id: contextMenu
    MenuItem {
      text: "Generate title"
      onTriggered: { if (row.store) row.store.generateTitle(row.conversation.id) }
    }
    MenuItem {
      text: "Fork conversation…"
      onTriggered: {
        if (!row.store) return
        var msgs = row.conversation.message_count || 0
        var at = msgs > 0 ? msgs : 1
        row.store.fork(row.conversation.id, at)
      }
    }
    MenuItem {
      text: "Export (Markdown)…"
      onTriggered: row.exportRequested("markdown")
    }
    MenuItem {
      text: "Export (JSON)…"
      onTriggered: row.exportRequested("json")
    }
    MenuSeparator {}
    MenuItem {
      text: "Delete conversation"
      onTriggered: { if (row.store) row.store.deleteConversation(row.conversation.id) }
    }
  }

  // No `activated()` signal: activation is done directly above
  // (`store.setActiveId(...)` on click), so a signal announcing it was a
  // second notification of an already-completed action, and FolderTree only
  // re-emitted it upward to nobody.
  signal exportRequested(string format)
}
