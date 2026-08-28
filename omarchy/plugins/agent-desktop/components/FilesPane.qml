pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import qs.Commons
import qs.Ui

// The composed "files" surface: a tree on the left, a preview on the
// right. Both sides take their state from the same store so a click in
// the tree flows into a read on the preview without any cross-component
// wiring.
//
// `cwd` is the active conversation's working directory (Main wires it).
// When cwd changes, the tree refetches via store.load(cwd); the preview
// clears its active path so the empty state shows until the user clicks
// something.
//
// `gitStore` is optional — when present, a header strip shows the active
// git branch for the same cwd. Without it, the pane is purely a file
// browser.
Item {
  id: root

  required property var store
  property var gitStore: null
  property string cwd: ""

  // Emitted when the user asks to (re)point this conversation at a folder.
  // The pane cannot own the folder picker: Qt.labs.platform is a Quickshell-
  // adjacent import a leaf component may not take (CONTRACTS.md §2), so
  // App.qml shows the dialog and writes the conversation row.
  signal changeCwdRequested()

  // Per-node shell-out requests forwarded from FileTree's context menu.
  // The pane does not own Quickshell (CONTRACTS.md §2): App.qml wires
  // these to Quickshell.execDetached. `trashConfirmed` only fires
  // after FileTree's ConfirmDialog accepts — Main can shell out
  // unconditionally.
  signal revealRequested(string path)
  signal openExternalRequested(string path)
  signal openTerminalRequested(string path)
  signal trashConfirmed(string path)

  // The path the preview is showing. Set by the tree's nodeActivated
  // signal; reset when cwd changes so the empty state shows.
  property string previewPath: ""

  onCwdChanged: {
    previewPath = ""
    if (root.store && typeof root.store.load === "function" && root.cwd.length > 0) {
      root.store.load(root.cwd)
    }
    if (root.gitStore && typeof root.gitStore.refresh === "function" && root.cwd.length > 0) {
      root.gitStore.refresh(root.cwd)
    }
  }

  Component.onCompleted: {
    if (root.cwd.length > 0) {
      if (root.store && typeof root.store.load === "function") root.store.load(root.cwd)
      if (root.gitStore && typeof root.gitStore.refresh === "function") root.gitStore.refresh(root.cwd)
    }
  }

  // ---- header strip ---------------------------------------------------

  Item {
    id: header
    anchors { top: parent.top; left: parent.left; right: parent.right }
    height: Style.bar.sizeHorizontal + Style.spacing.md * 2

    RowLayout {
      anchors.fill: parent
      anchors.margins: Style.spacing.md
      spacing: Style.spacing.md

      Text {
        Layout.fillWidth: true
        text: root.cwd.length > 0 ? String(root.cwd) : "No cwd"
        color: Color.foreground
        opacity: 0.9
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        elide: Text.ElideMiddle
      }

      // Without this the pane is permanently inert: nothing else in the
      // plugin could set a conversation's cwd, so "No cwd" was a dead end.
      Button {
        text: root.cwd.length > 0 ? "Change folder…" : "Set folder…"
        tooltipText: "Point this conversation at a working directory"
        onClicked: root.changeCwdRequested()
      }

      // Active git branch badge when gitStore is wired and the cwd is
      // a repo. Mirrors GitPane's header but as a compact chip.
      Text {
        visible: root.gitStore
          && root.gitStore.isRepo
          && root.gitStore.status
          && root.gitStore.status.branch
        text: {
          if (!root.gitStore || !root.gitStore.status) return ""
          var s = root.gitStore.status
          if (s.detached) return "(detached)"
          return String(s.branch || "")
        }
        color: Color.accent
        opacity: 0.8
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
      }
    }
  }

  PanelSeparator {
    anchors { top: header.bottom; left: parent.left; right: parent.right }
  }

  // ---- body: tree | preview ------------------------------------------

  SplitView {
    anchors {
      top: header.bottom
      left: parent.left
      right: parent.right
      bottom: parent.bottom
    }
    anchors.topMargin: Style.spacing.md
    orientation: Qt.Horizontal

    // Left: file tree.
    Item {
      SplitView.preferredWidth: parent.width * 0.4
      SplitView.minimumWidth: Style.spacing.dropdownWidth

      FileTree {
        anchors.fill: parent
        anchors.margins: Style.spacing.md
        store: root.store
        onNodeActivated: function (node) {
          if (!node) return
          // Directories don't change the preview — they're expanded
          // in place. Files trigger a read.
          if (node.isDirectory === true) return
          root.previewPath = String(node.path || "")
          if (root.store && typeof root.store.read === "function") {
            root.store.read(root.previewPath)
          }
        }
        onRevealRequested: function (path) { root.revealRequested(path) }
        onOpenExternalRequested: function (path) { root.openExternalRequested(path) }
        onOpenTerminalRequested: function (path) { root.openTerminalRequested(path) }
        onTrashConfirmed: function (path) { root.trashConfirmed(path) }
      }
    }

    // Vertical separator.
    PanelSeparator {
      SplitView.preferredWidth: 1
      SplitView.minimumWidth: 1
    }

    // Right: preview.
    Item {
      SplitView.fillWidth: true
      SplitView.minimumWidth: Style.spacing.dropdownWidth

      FilePreview {
        anchors.fill: parent
        anchors.margins: Style.spacing.md
        store: root.store
        path: root.previewPath
      }
    }
  }
}
