pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import qs.Commons
import qs.Ui

// The file tree side of FilesPane.qml.
//
// A recursive tree over the FileNode[] returned by files:listTree, plus a
// one-level expansion for nodes the recursive tree didn't include (depth
// cap, excluded directory) — those go through files:listDir on click.
//
// Reads `tree` and `flat` from the injected `store`. Emits `nodeActivated`
// for any node the user clicks (a directory or a file). Local-command
// operations (reveal in file manager, open externally, open terminal here,
// trash) are surfaced as signals (`revealRequested`, `openExternalRequested`,
// `openTerminalRequested`, `trashConfirmed`) — Main wires them to
// `Quickshell.execDetached` in one place (CONTRACTS.md §2). Trash passes
// through a ConfirmDialog so a stray right-click cannot delete work.
//
// `pragma ComponentBehavior: Bound` (CONTRACTS.md §6b) is what lets the
// Repeater's delegate resolve `root.*` cleanly through qmllint without
// `Unqualified access` warnings. Without it the linter insists on
// `parent.parent.root` gymnastics.
//
// Note: the delegate's "child list" property is named `_children`, NOT
// `children`, because `QQuickItem` already has a `children` property
// (the list of QML children) and the override would fail `make qml-check`
// with `Property "children" already exists in base type "QQuickItem"`.
Item {
  id: root

  required property var store

  signal nodeActivated(var node)

  // ---- shell-out requests for Main to wire -----------------------------
  //
  // `revealRequested` / `openExternalRequested` / `openTerminalRequested`:
  //   The user asked for an action that needs a host command
  //   (xdg-open, foot -d, dbus-send, etc.). FilesPane forwards them up
  //   to App.qml which calls Quickshell.execDetached.
  //
  // `trashConfirmed`:
  //   The user passed the ConfirmDialog gate for trashing `path`. Main
  //   shells out to `gio trash` here. We emit only after confirmation so
  //   a stray right-click can never delete work.
  // Expose the ConfirmDialog by alias so tests can drive it without
  // poking at internal ids. Without this alias, `id: trashConfirm` is
  // only visible inside the component's own scope.
  property alias confirmDialog: trashConfirm

  signal revealRequested(string path)
  signal openExternalRequested(string path)
  signal openTerminalRequested(string path)
  signal trashConfirmed(string path)

  // Folder paths whose children have been expanded via the on-demand
  // files:listDir. Keyed by path so refreshes are idempotent.
  property var _expandedDirs: ({})

  // The node the context menu / modal popup is currently anchored to.
  // Right-click populates it; the menu and the dialogs read from it.
  property string _contextPath: ""
  property bool _contextIsDir: false

  // Trash confirmation: the path that will be trashed when the user
  // confirms. Set when the menu item is picked; consumed by the
  // ConfirmDialog's onConfirmed.
  property string _pendingTrashPath: ""

  // New-file name input. The dialog stays mounted (hidden) when closed
  // so the TextField's text persists across cancel/resume cycles —
  // a fresh dialog every time would feel jarring.
  property bool _newFileDialogOpen: false
  property string _newFileDir: ""
  property string _newFileName: ""
  property string _newFileError: ""

  // Rename input. Mirrors the new-file dialog state above. We keep it on
  // the component rather than the store because the rename scrim is a
  // UI-only concern; the store just gets the final (path, newName) pair.
  property bool _renameDialogOpen: false
  property string _renamePath: ""
  property string _renameOriginalName: ""
  property string _renameNewName: ""
  property string _renameError: ""

  // Hidden TextEdit used as the clipboard sink for "Copy path".
  // QtQuick.Controls has no portable clipboard helper — TextEdit IS the
  // clipboard mechanism (mirrors components/CodeBlock.qml:57-70).
  // Mounted at all times so the action never has to wait on construction.
  property string _clipboardText: ""

  function _isExpanded(path) { return _expandedDirs[String(path)] === true }
  function _toggleExpanded(path) {
    var next = ({})
    for (var k in _expandedDirs) next[k] = _expandedDirs[k]
    if (next[String(path)] === true) delete next[String(path)]
    else next[String(path)] = true
    _expandedDirs = next
  }

  // Pull the recursive children list off a node. Returns [] when the
  // server did not include children (depth cap, excluded dir, or the
  // node is a one-level entry from files:listDir).
  function _childrenFor(node) {
    if (!node) return []
    if (node.children && node.children.length) return node.children
    return []
  }

  function _openContextMenu(path, isDir) {
    _contextPath = String(path || "")
    _contextIsDir = isDir === true
    contextMenu.popup()
  }

  // Trim and reject empty / whitespace-only / slash-containing names.
  // The server's createFile accepts arbitrary names but a path separator
  // would silently create a file in a parent and the user would never
  // see it under the directory they right-clicked — reject here so the
  // failure is at the input, not at a missing file later.
  function _validateNewFileName(raw) {
    var n = String(raw || "").trim()
    if (n.length === 0) return "Name cannot be empty"
    if (n.indexOf("/") !== -1) return "Name cannot contain /"
    return ""
  }

  // Same rules as createFile for the rename target: trim, reject empty,
  // reject path separators. We do NOT check for collisions here — the
  // server already does that and reports it as a refused onErr; a
  // pre-emptive check would diverge from the server's view of the tree.
  function _validateRenameName(raw) {
    var n = String(raw || "").trim()
    if (n.length === 0) return "Name cannot be empty"
    if (n.indexOf("/") !== -1) return "Name cannot contain /"
    return ""
  }

  // Extract the trailing segment of a path. The store's rename() takes
  // (path, newName), so we hand it the absolute path and the new
  // basename — never a relative path.
  function _basename(p) {
    var s = String(p || "")
    var i = s.lastIndexOf("/")
    return i < 0 ? s : s.substring(i + 1)
  }

  // Named per-item actions. The menu items call these in `onTriggered`;
  // tests call them directly so they don't have to drive a real popup()
  // — popup() requires a real mouse position and an event loop.
  function _actionReveal() { root.revealRequested(_contextPath) }
  function _actionOpenExternal() { root.openExternalRequested(_contextPath) }
  function _actionOpenTerminalHere() { root.openTerminalRequested(_contextPath) }
  function _actionDuplicate() {
    if (root.store) root.store.duplicate(_contextPath,
      function () {}, function () {})
  }
  function _actionNewFileHere() { root._requestNewFileHere() }
  function _actionRename() { root._requestRename() }
  function _actionCopyPath() { root._copyPathToClipboard(_contextPath) }
  function _actionTrash() { root._requestTrash() }

  function _requestNewFileHere() {
    if (!_contextIsDir) return
    _newFileDir = _contextPath
    _newFileName = ""
    _newFileError = ""
    _newFileDialogOpen = true
  }
  function _confirmNewFile() {
    var err = _validateNewFileName(_newFileName)
    if (err.length > 0) {
      _newFileError = err
      return
    }
    var dir = _newFileDir
    var name = String(_newFileName).trim()
    _newFileDialogOpen = false
    _newFileName = ""
    _newFileError = ""
    if (root.store && typeof root.store.createFile === "function") {
      root.store.createFile(dir, name,
        function () {},
        function (e) { _newFileError = String(e) })
    }
  }

  function _cancelNewFile() {
    _newFileDialogOpen = false
    _newFileName = ""
    _newFileError = ""
  }

  function _requestRename() {
    if (_contextPath.length === 0) return
    _renamePath = _contextPath
    _renameOriginalName = root._basename(_contextPath)
    _renameNewName = _renameOriginalName
    _renameError = ""
    _renameDialogOpen = true
  }

  function _confirmRename() {
    var err = root._validateRenameName(_renameNewName)
    if (err.length > 0) {
      _renameError = err
      return
    }
    var path = _renamePath
    var newName = String(_renameNewName).trim()
    // No-op when the user "renamed" to the same name — the server would
    // accept it as a write, but staying on a no-op keeps the local
    // store state stable and avoids a round-trip.
    if (newName === _renameOriginalName) {
      root._cancelRename()
      return
    }
    if (root.store && typeof root.store.rename === "function") {
      root.store.rename(path, newName,
        function () { root._cancelRename() },
        function (e) { _renameError = String(e) })
    } else {
      root._cancelRename()
    }
  }
  function _cancelRename() {
    _renameDialogOpen = false
    _renamePath = ""
    _renameOriginalName = ""
    _renameNewName = ""
    _renameError = ""
  }

  // Write `path` to the system clipboard via the hidden TextEdit. The
  // TextEdit is sized 0x0 with visible:false so it never paints; its
  // sole job is to be a clipboard sink we can selectAll()/copy() on.
  function _copyPathToClipboard(path) {
    if (!path) return
    var p = String(path)
    _clipboardText = p
    // The hidden TextEdit reads _clipboardText; copy() flushes its
    // selection to the OS clipboard. selectAll() before copy() so
    // partial selections never silently truncate the path.
    clipboardSink.selectAll()
    clipboardSink.copy()
  }

  function _requestTrash() {
    _pendingTrashPath = _contextPath
    trashConfirm.opened = true
  }

  function _confirmTrash() {
    var p = _pendingTrashPath
    _pendingTrashPath = ""
    trashConfirm.opened = false
    if (p.length > 0) root.trashConfirmed(p)
  }

  function _cancelTrash() {
    _pendingTrashPath = ""
    trashConfirm.opened = false
  }

  // Drop the store's own duplicate/move/prepareSession openers into the
  // menu only when the store implements them, so a leaner store build
  // doesn't crash the menu.
  function _storeHas(name) {
    return root.store && typeof root.store[name] === "function"
  }

  ListView {
    id: list
    anchors.fill: parent
    clip: true
    model: root.store ? root.store.tree : []
    delegate: fileNodeDelegate
    spacing: 0
    ScrollBar.vertical: ScrollBar { active: true }
  }

  Component {
    id: fileNodeDelegate

    Column {
      id: nodeRoot
      required property var modelData
      width: list.width

      property var node: modelData
      property bool isDir: node && node.isDirectory === true
      property string nodePath: node && node.path ? String(node.path) : ""

      // Local rename: not `children` because QQuickItem owns that name.
      readonly property var _children: root._childrenFor(node)
      readonly property bool expanded: isDir && root._isExpanded(nodePath)

      function activateNode() {
        if (!node) return
        if (isDir) {
          if (!expanded && (!nodeRoot._children || nodeRoot._children.length === 0)) {
            // Recursive tree didn't include children (depth cap, excluded
            // pattern). One-level fetch so the user can see what's inside.
            if (root.store && typeof root.store.loadFlat === "function") {
              root.store.loadFlat(nodePath)
            }
          }
          root._toggleExpanded(nodePath)
          return
        }
        // Files: hand off to the page; the preview pane decides what
        // "open" means based on the kind.
        root.nodeActivated(node)
      }

      Rectangle {
        width: parent.width
        height: Style.bar.sizeHorizontal
        color: nodeRowMouse.containsMouse ? Style.hoverFill : "transparent"
        RowLayout {
          anchors.fill: parent
          anchors.leftMargin: Style.spacing.rowPaddingX + (nodeRoot.isDir ? Style.spacing.md : 0)
          anchors.rightMargin: Style.spacing.rowPaddingX
          spacing: Style.spacing.rowGap

          // Disclosure triangle for directories.
          Text {
            visible: nodeRoot.isDir
            text: nodeRoot.expanded ? "▾" : "▸"
            color: Color.foreground
            font.pixelSize: Style.font.bodySmall
            Layout.preferredWidth: Style.font.bodySmall
          }
          // Icon column: a single-character kind hint.
          Text {
            text: nodeRoot.isDir ? "▣" : "·"
            color: nodeRoot.isDir ? Color.accent : Color.muted
            font.pixelSize: Style.font.body
            Layout.preferredWidth: Style.font.body
            opacity: 0.8
          }

          Text {
            Layout.fillWidth: true
            text: nodeRoot.node && nodeRoot.node.name ? String(nodeRoot.node.name) : ""
            color: Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.body
            elide: Text.ElideRight
          }
        }

        MouseArea {
          id: nodeRowMouse
          anchors.fill: parent
          hoverEnabled: true
          cursorShape: Qt.PointingHandCursor
          acceptedButtons: Qt.LeftButton | Qt.RightButton
          onClicked: function (mouse) {
            if (mouse.button === Qt.RightButton) {
              // Right-click opens a per-node context menu. Each item
              // either calls the store (createFile, duplicate) or fires
              // a signal Main wires (reveal, open external, terminal,
              // trash after confirm).
              root._openContextMenu(nodeRoot.nodePath, nodeRoot.isDir)
              return
            }
            nodeRoot.activateNode()
          }
        }
      }

      // Expanded children. Use a nested ListView with the same delegate.
      ListView {
        visible: nodeRoot.expanded && nodeRoot._children.length > 0
        width: parent.width
        height: visible ? (nodeRoot._children.length * Style.bar.sizeHorizontal) : 0
        clip: true
        model: nodeRoot._children
        delegate: fileNodeDelegate
        spacing: 0
      }
    }
  }

  // ---- per-node context menu -----------------------------------------
  //
  // Each branch is gated on `root._contextIsDir` so a file doesn't show
  // "New file here…" or "Open terminal here" and a directory doesn't
  // show "Open externally" / "Duplicate".
  Menu {
    id: contextMenu

    MenuItem {
      text: "Reveal in file manager"
      onTriggered: root._actionReveal()
    }
    MenuItem {
      text: "Open externally"
      visible: !root._contextIsDir
      onTriggered: root._actionOpenExternal()
    }
    MenuItem {
      text: "Open terminal here"
      visible: root._contextIsDir
      onTriggered: root._actionOpenTerminalHere()
    }
    MenuSeparator {}
    MenuItem {
      text: "Duplicate"
      visible: !root._contextIsDir && root._storeHas("duplicate")
      onTriggered: root._actionDuplicate()
    }
    MenuItem {
      text: "New file here…"
      visible: root._contextIsDir && root._storeHas("createFile")
      onTriggered: root._actionNewFileHere()
    }
    MenuItem {
      text: "Rename…"
      // Available on every node kind — files and directories alike — as
      // long as the store knows how to rename. Visibility is gated on the
      // store function so a leaner store build doesn't crash the menu.
      visible: root._storeHas("rename")
      onTriggered: root._actionRename()
    }
    MenuItem {
      text: "Copy path"
      // Pure clipboard write — needs no store. Every node offers it.
      onTriggered: root._actionCopyPath()
    }
    MenuSeparator {}
    MenuItem {
      text: "Move to trash"
      // Destructive on both files and dirs. ConfirmDialog is mounted
      // unconditionally so the user's "yes" can fire trashConfirmed.
      onTriggered: root._actionTrash()
    }
  }

  // ---- trash confirmation --------------------------------------------
  //
  // Mirrors the `confirmTarget = 1` idiom from StorageSettings.qml: an
  // `opened` flip plus a path captured before the dialog opened so
  // `onConfirmed` knows what to trash. The dialog itself is owned by
  // qs.Ui and renders the platform's scrim / message.
  ConfirmDialog {
    id: trashConfirm
    opened: false
    message: root._pendingTrashPath.length > 0
      ? ("Move to trash?\n\n" + root._pendingTrashPath
         + "\n\nThis sends the item to the system trash. You can restore it from there.")
      : ""
    confirmText: "Move to trash"
    onConfirmed: root._confirmTrash()
    onCanceled: root._cancelTrash()
  }

  // ---- new-file name input --------------------------------------------
  //
  // A small inline scrim with a TextField and OK / Cancel. Lives in the
  // component (not the store) because it is purely a UI concern: the
  // store never knows whether the user is in the middle of typing.
  Item {
    id: newFileScrim
    anchors.fill: parent
    visible: root._newFileDialogOpen
    z: 10

    // The scrim MouseArea is full-area; the inner Rectangle is its own
    // implicit-sized child, so clicks inside the panel land on the
    // panel's own children (Buttons / TextField) and never reach the
    // scrim. Clicks outside the panel close the dialog.
    MouseArea {
      anchors.fill: parent
      onClicked: root._cancelNewFile()
    }

    Rectangle {
      anchors.centerIn: parent
      width: Math.min(parent.width - Style.spacing.md * 2, 360)
      implicitHeight: newFileCol.implicitHeight + Style.spacing.md * 2
      color: Color.popups.background
      border.color: Color.popups.border
      border.width: 1
      radius: 4

      ColumnLayout {
        id: newFileCol
        anchors.fill: parent
        anchors.margins: Style.spacing.md
        spacing: Style.spacing.sm

        Text {
          Layout.fillWidth: true
          text: "New file in " + (root._newFileDir || "")
          color: Color.foreground
          font.family: Style.font.family
          font.pixelSize: Style.font.body
          elide: Text.ElideMiddle
        }

        TextField {
          id: newFileField
          Layout.fillWidth: true
          placeholderText: "file.txt"
          text: root._newFileName
          // Keep the TextField authoritative: writes flow one way, the
          // user's typing never gets clobbered by the component.
          onTextChanged: {
            if (text !== root._newFileName) root._newFileName = text
          }
          // Enter accepts (the validation runs on accept).
          onAccepted: root._confirmNewFile()
          // Esc cancels — local to this dialog, not the global Escape.
          Keys.onEscapePressed: function (e) {
            root._cancelNewFile()
            e.accepted = true
          }
        }

        Text {
          Layout.fillWidth: true
          visible: root._newFileError.length > 0
          text: root._newFileError
          color: Color.urgent
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.WordWrap
        }

        RowLayout {
          Layout.fillWidth: true
          spacing: Style.spacing.sm

          Item { Layout.fillWidth: true }

          Button {
            text: "Cancel"
            onClicked: root._cancelNewFile()
          }
          Button {
            text: "Create"
            onClicked: root._confirmNewFile()
          }
        }
      }
    }

    // Focus the field when the dialog opens — without this the user has
    // to click into the TextField before they can type.
    onVisibleChanged: {
      if (visible) {
        newFileField.forceActiveFocus()
        newFileField.selectAll()
      }
    }
  }

  // Hidden TextEdit used as the clipboard sink for "Copy path".
  // Qt.labs.platform has no portable clipboard helper; TextEdit IS the
  // clipboard mechanism in Qt Quick Controls (mirrors the pattern in
  // components/CodeBlock.qml:57-70). It is sized 0x0 with visible:false
  // so it never paints — the only thing that exists for is to be the
  // target of selectAll() / copy() driven by _copyPathToClipboard.
  TextEdit {
    id: clipboardSink
    visible: false
    width: 0
    height: 0
    text: root._clipboardText
  }

  // ---- rename name input ---------------------------------------------
  //
  // Mirrors the new-file scrim. Same scrim-click-outside-cancels idiom,
  // same TextField-based entry, same OK / Cancel button row. The store
  // receives only the final (path, newName) pair once the user accepts.
  Item {
    id: renameScrim
    anchors.fill: parent
    visible: root._renameDialogOpen
    z: 10

    MouseArea {
      anchors.fill: parent
      onClicked: root._cancelRename()
    }

    Rectangle {
      anchors.centerIn: parent
      width: Math.min(parent.width - Style.spacing.md * 2, 360)
      implicitHeight: renameCol.implicitHeight + Style.spacing.md * 2
      color: Color.popups.background
      border.color: Color.popups.border
      border.width: 1
      radius: 4

      ColumnLayout {
        id: renameCol
        anchors.fill: parent
        anchors.margins: Style.spacing.md
        spacing: Style.spacing.sm

        Text {
          Layout.fillWidth: true
          text: "Rename in " + (root._renamePath || "")
          color: Color.foreground
          font.family: Style.font.family
          font.pixelSize: Style.font.body
          elide: Text.ElideMiddle
        }

        TextField {
          id: renameField
          Layout.fillWidth: true
          placeholderText: "new-name"
          text: root._renameNewName
          onTextChanged: {
            if (text !== root._renameNewName) root._renameNewName = text
          }
          onAccepted: root._confirmRename()
          Keys.onEscapePressed: function (e) {
            root._cancelRename()
            e.accepted = true
          }
        }

        Text {
          Layout.fillWidth: true
          visible: root._renameError.length > 0
          text: root._renameError
          color: Color.urgent
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.WordWrap
        }

        RowLayout {
          Layout.fillWidth: true
          spacing: Style.spacing.sm

          Item { Layout.fillWidth: true }

          Button {
            text: "Cancel"
            onClicked: root._cancelRename()
          }
          Button {
            text: "Rename"
            onClicked: root._confirmRename()
          }
        }
      }
    }

    onVisibleChanged: {
      if (visible) {
        renameField.forceActiveFocus()
        renameField.selectAll()
      }
    }
  }

  // Empty state — shown when the store has loaded but the tree is empty.
  Text {
    anchors.centerIn: parent
    visible: root.store && root.store.tree && root.store.tree.length === 0 && !root.store.loading
    text: root.store && root.store.error
      ? String(root.store.error)
      : "Empty directory"
    color: Color.foreground
    opacity: 0.5
    font.family: Style.font.family
    font.pixelSize: Style.font.bodySmall
  }
}
