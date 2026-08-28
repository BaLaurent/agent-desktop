pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

import qs.Commons
import qs.Ui

// Recursive folder + conversation tree.
//
// One path through the data, one source of truth: the tree comes from
// `store.tree()` — which is `lib/conversationSort.js` — so the sidebar's
// visible order matches the keyboard navigation order. Folders are
// collapsible; selecting a conversation activates it and clears any
// multi-selection unless Ctrl/Shift is held, matching the renderer's
// `handleSelect`.
//
// Drag-and-drop reorder goes through `folders:reorder` and
// `conversations:moveMany`. We don't claim to mirror the renderer's
// dnd-kit plumbing in detail; the contract is simple — drop a folder on
// another to reparent, drop a conversation on a folder to move, drop on
// the root area to leave in place.
Item {
  id: root

  property var store: null
  // Lets children render a drop hint without threading a callback.
  property var dragHoverFolderId: null

  // `conversationActivated` used to live here and was emitted with no
  // listener anywhere: activation already happens directly, at
  // ConversationRow.qml:146 (`store.setActiveId(...)`), so the signal was a
  // second notification of something already done. Removed rather than wired.
  signal exportRequested(var conversationId, string format)

  // Drives the recursive tree.
  readonly property var _tree: store ? store.tree() : ({ groups: [], flat: [] })

  // Map by parent_id to a list of child folder ids, for the expand toggles.
  readonly property var _childrenByParent: {
    var m = {}
    if (!store) return m
    var fs = store.folders || []
    for (var i = 0; i < fs.length; i++) {
      var p = fs[i].parent_id === undefined ? null : fs[i].parent_id
      if (!m[p]) m[p] = []
      m[p].push(fs[i].id)
    }
    return m
  }

  // Map by id for parent lookups.
  readonly property var _folderById: {
    var m = {}
    if (!store) return m
    for (var i = 0; i < (store.folders || []).length; i++) {
      m[(store.folders[i]).id] = store.folders[i]
    }
    return m
  }

  // Local UI state: which folders are expanded. Reassigned on every
  // toggle so change signals fire.
  property var _expanded: ({})

  function _isExpanded(folderId) { return _expanded[String(folderId)] === true }
  function _toggleExpanded(folderId) {
    var next = {}
    for (var k in _expanded) next[k] = _expanded[k]
    if (next[String(folderId)] === true) delete next[String(folderId)]
    else next[String(folderId)] = true
    _expanded = next
  }

  ListView {
    id: list
    anchors.fill: parent
    clip: true
    model: root._tree.groups
    delegate: folderGroupDelegate
    spacing: 0
    ScrollBar.vertical: ScrollBar { active: true }
  }

  // ---- delegates ----

  // Folder group wrapper. The qml-testrunner-friendly form of the tree: a
  // Repeater delegates by id so each row is its own QML object.
  Component {
    id: folderGroupDelegate

    Column {
      id: groupRoot
      required property var modelData
      required property int index

      // `modelData` is the {folder, conversations} group entry.
      property var group: modelData
      width: list.width

      // ---- folder header (hidden for the uncategorized group) ----

      // Folder header. Each instance owns its rename TextField, its context
      // menu, and the ConfirmDialog gating destructive actions — mirroring
      // ConversationRow's pattern (Menu / MenuItem / right-click + double-
      // click) so row affordances match across the sidebar.
      //
      // Reorder is honest: no drag-and-drop framework in this plugin, so we
      // expose Move up / Move down that swap consecutive siblings in the
      // store's current order and call `reorderFolders`. The server writes
      // new positions and the next list reload picks them up.
      Rectangle {
        id: header
        width: parent.width
        height: Style.bar.sizeHorizontal
        color: "transparent"
        visible: groupRoot.group.folder !== null

        // Hoist the folder record so functions, MenuItems and tests can reach
        // it without threading `modelData` everywhere.
        property var folder: groupRoot.group.folder

        // Index inside the parent_id's sibling list, recomputed on every
        // siblings change. -1 means "I have no recorded position" — used
        // by the menu item enables.
        property int _siblingIndex: {
          if (!root.store || !folder) return -1
          var parentKey = folder.parent_id === undefined ? null : folder.parent_id
          var siblings = root._childrenByParent[parentKey] || []
          for (var i = 0; i < siblings.length; i++) {
            if (Number(siblings[i]) === Number(folder.id)) return i
          }
          return -1
        }
        property int _siblingCount: {
          if (!root.store || !folder) return 0
          var parentKey = folder.parent_id === undefined ? null : folder.parent_id
          var siblings = root._childrenByParent[parentKey] || []
          return siblings.length
        }

        property bool _renaming: false
        property bool _confirming: false
        property string _confirmMessage: ""

        function _startRename() {
          if (!folder) return
          header._renaming = true
          renameField.forceActiveFocus()
          renameField.selectAll()
        }

        function _commitRename(text) {
          if (!folder) return false
          var trimmed = String(text || "").trim()
          if (trimmed.length === 0) return false
          if (root.store) {
            // Whitespace changes only are rejected: an editor that lets an
            // unmodified name through unconditionally is no improvement over
            // not having one.
            if (trimmed !== String(folder.name || "")) {
              root.store.updateFolder(folder.id, { name: trimmed })
            }
          }
          header._renaming = false
          return true
        }

        // Compose the new order from current `store.folders`, swap the
        // target with its neighbour, and ask the store to persist. The
        // server reload is owned by the store (it calls `store.load()` on
        // success), so a follow-up `folders:refresh` is unnecessary here.
        function _moveBy(delta) {
          if (!root.store || !folder) return
          var i = header._siblingIndex
          var j = i + delta
          var fs = root.store.folders || []
          // Build sibling list in current order, swap, and submit as ids.
          var parentKey = folder.parent_id === undefined ? null : folder.parent_id
          var siblings = (root._childrenByParent[parentKey] || []).slice()
          if (i < 0 || j < 0 || j >= siblings.length) return
          var tmp = siblings[i]
          siblings[i] = siblings[j]
          siblings[j] = tmp
          // Preserve order of siblings from OTHER parents unchanged: the
          // server accepts a single parent's ordering via a sweep that
          // walks the input list. Other ids (not in `siblings`) keep
          // their existing positions.
          var fullOrder = []
          var seen = {}
          for (var k = 0; k < siblings.length; k++) {
            fullOrder.push(Number(siblings[k]))
            seen[Number(siblings[k])] = true
          }
          // Append any folders whose parent differs in their existing order
          // — the server `folders:reorder` re-positions everything in the
          // input array; non-input rows keep whatever the server gave them.
          for (var m2 = 0; m2 < fs.length; m2++) {
            var fid = Number(fs[m2].id)
            if (!seen[fid]) fullOrder.push(fid)
          }
          root.store.reorderFolders(fullOrder)
        }

        // Stated ACCURATELY per src/core/services/folders.ts:74 — by default
        // (no mode), conversations are reassigned to the default folder; the
        // folder and any children are unparented but not deleted. The store's
        // `deleteFolder(id)` omits mode, which is the safe default.
        function _requestDelete() {
          if (!folder || !root.store) return
          var count = (groupRoot.group.conversations || []).length
          var msg = "Delete folder \"" + String(folder.name || "") + "\"?\n\n"
            + "Its conversations will move to the default folder; "
            + "any subfolders will be unparented. This cannot be undone."
          if (count > 0) {
            msg += "\n\n" + String(count) + " conversation"
              + (count === 1 ? "" : "s") + " inside will be reassigned."
          }
          header._confirmMessage = msg
          header._confirming = true
        }

        function _confirmDelete() {
          if (!folder || !root.store) return
          root.store.deleteFolder(folder.id)
          header._confirming = false
        }

        RowLayout {
          anchors.fill: parent
          anchors.leftMargin: Style.spacing.rowPaddingX
          anchors.rightMargin: Style.spacing.rowPaddingX
          spacing: Style.spacing.rowGap

          Text {
            text: root._isExpanded(groupRoot.group.folder ? groupRoot.group.folder.id : 0) ? "▾" : "▸"
            color: Color.foreground
            font.pixelSize: Style.font.bodySmall
            Layout.preferredWidth: Style.font.bodySmall
            MouseArea {
              anchors.fill: parent
              onClicked: { if (groupRoot.group.folder) root._toggleExpanded(groupRoot.group.folder.id) }
            }
          }

          // Rename TextField shown only while editing. Sits in the same
          // layout slot as the label so the row doesn't reflow.
          TextField {
            id: renameField
            visible: header._renaming
            Layout.fillWidth: true
            text: header.folder ? String(header.folder.name || "") : ""
            // Block nothing else while validating; we always re-focus the
            // editor on an empty submit until the user supplies a
            // non-whitespace name or cancels via Escape.
            onAccepted: {
              var ok = header._commitRename(text)
              if (!ok) {
                forceActiveFocus()
                renameField.selectAll()
              }
            }
            onVisibleChanged: if (visible) Qt.callLater(renameField.forceActiveFocus)
            Keys.onEscapePressed: function (e) {
              header._renaming = false
              e.accepted = true
            }
          }

          Text {
            visible: !header._renaming
            Layout.fillWidth: true
            text: header.folder ? String(header.folder.name || "") : ""
            color: Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.body
            elide: Text.ElideRight

            MouseArea {
              anchors.fill: parent
              onClicked: { if (groupRoot.group.folder) root._toggleExpanded(groupRoot.group.folder.id) }
            }
          }

          Text {
            text: String(groupRoot.group.conversations.length)
            color: Color.muted
            font.family: Style.font.family
            font.pixelSize: Style.font.bodySmall
          }
        }

        // Right-click + double-click layer, above the chevron/name
        // MouseAreas.
        //
        // A composed event (clicked/doubleClicked) propagates to the item
        // below ONLY when the handler sets `accepted = false`. Leaving it
        // untouched means accepted — so this layer swallowed every left
        // click and NO folder could be expanded: 11 of 14 conversations
        // were unreachable, on a chevron that redrew as if nothing happened.
        MouseArea {
          anchors.fill: parent
          acceptedButtons: Qt.LeftButton | Qt.RightButton
          propagateComposedEvents: true
          z: 1
          onClicked: function (m) {
            if (m.button === Qt.RightButton && header.folder) {
              contextMenu.popup()
              m.accepted = true
              return
            }
            m.accepted = false
          }
          onDoubleClicked: function (m) {
            if (m.button === Qt.LeftButton && header.folder) {
              header._startRename()
              m.accepted = true
            }
          }
        }

        DropArea {
          anchors.fill: parent
          z: 0
          onEntered: function (drag) { root.dragHoverFolderId = header.folder ? header.folder.id : null }
          onExited: { root.dragHoverFolderId = null }
          onDropped: function (drop) {
            root.dragHoverFolderId = null
            if (!root.store) return
            var ids = drop.source && drop.source.conversationIds
            if (!ids || ids.length === 0) return
            var fid = header.folder ? header.folder.id : null
            root.store.moveMany(ids, fid)
            drop.acceptProposedAction()
          }
        }

        Menu {
          id: contextMenu
          MenuItem {
            text: "Rename folder"
            onTriggered: header._startRename()
          }
          MenuItem {
            text: "Move up"
            enabled: header._siblingIndex > 0
            onTriggered: header._moveBy(-1)
          }
          MenuItem {
            text: "Move down"
            enabled: header._siblingIndex >= 0
                   && header._siblingIndex < header._siblingCount - 1
            onTriggered: header._moveBy(1)
          }
          MenuSeparator {}
          MenuItem {
            text: "Delete folder…"
            onTriggered: header._requestDelete()
          }
        }

        ConfirmDialog {
          opened: header._confirming
          message: header._confirmMessage
          confirmText: "Delete folder"
          onConfirmed: header._confirmDelete()
          onCanceled: { header._confirming = false }
        }
      }

      // "Uncategorized" header — static, non-clickable.
      Rectangle {
        width: parent.width
        height: Style.bar.sizeHorizontal
        color: "transparent"
        visible: groupRoot.group.folder === null

        Text {
          anchors.left: parent.left
          anchors.leftMargin: Style.spacing.rowPaddingX
          anchors.verticalCenter: parent.verticalCenter
          text: "Uncategorized"
          color: Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
          opacity: 0.7
        }
      }

      // Conversation rows. Always shown for search results (the tree
      // collapses all groups to a flat list under `search.length > 0`);
      // otherwise only when the folder is expanded.
      Repeater {
        model: (groupRoot.group.folder === null)
          || root._isExpanded(groupRoot.group.folder ? groupRoot.group.folder.id : 0)
          ? groupRoot.group.conversations
          : []

        delegate: ConversationRow {
          required property var modelData
          required property int index
          width: groupRoot.width
          store: root.store
          conversation: modelData
          // ConversationRow's "Export as markdown" / "as json" menu entries
          // emitted `exportRequested(format)` and nothing anywhere in the
          // chain handled it, so both entries were dead. Forwarded with the
          // row's own id because per-row export is the whole point — the
          // Sidebar overflow menu can only export the ACTIVE conversation.
          onExportRequested: function (format) {
            root.exportRequested(modelData.id, String(format))
          }
        }
      }
    }
  }
}
