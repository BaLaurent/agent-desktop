pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import qs.Commons
import qs.Ui

import "../lib/gitGraph.js" as GG

// The git tab of the right sidebar. Mirrors src/renderer/components/panel/git:
//   GitStatus  — top, current branch + file status
//   GitGraph   — middle, log graph with lane-coloured edges
//   GitBranches— branches list (local + remote)
//   GitStash   — stash list
//
// Lane assignment lives in lib/gitGraph.js so the algorithm is testable
// without a QML engine. QML keeps the paint and the input handling.
//
// `pragma ComponentBehavior: Bound` is required (CONTRACTS.md §6b) so the
// Repeater/ListView delegates resolve `root.*` cleanly through qmllint.
// All delegates declare `required property var modelData` (and any
// additional outer-state dependencies) so qmllint treats them as
// explicit-input scopes rather than reaching outward.
//
// The per-row delegate components live inside this Item's scope so the
// pragma ComponentBehavior binding lets them reach `root._statusColor`
// and `GG.classifyRef` cleanly. Each declares `required property var
// modelData` plus any closure-state it needs (`statusColorFn`,
// `remoteNames`, `store`) as required properties.
Item {
  id: root

  required property var store

  // Same seam as FilesPane: this pane's empty state literally says "Set cwd
  // to a repo", but nothing in the plugin could do that, so the instruction
  // was unfollowable. App.qml owns the folder picker and the row write.
  signal changeCwdRequested()


  // stashSave(message) with an empty message must use the 1-arg form
  // (cwd only); the store's git:stashSave handler treats the second arg as
  // the message verbatim, so sending `""` would write an empty stash
  // subject instead of an auto-generated one.
  property string stashInputText: ""

  // Stash pop is destructive enough to deserve a confirm. -1 = closed.
  // Bound by StashRow's Pop button; the shared ConfirmDialog reads it.
  property int stashPopTarget: -1

  readonly property var _layout: GG.layout(store ? store.commits : [])
  // The renderer caps ref badges by what is in store.branches[].isRemote.
  // We mirror that lookup so the badge colour is consistent.
  readonly property var _remoteNames: {
    var m = ({})
    if (!store || !store.branches) return m
    for (var i = 0; i < store.branches.length; i++) {
      var b = store.branches[i]
      if (b && b.isRemote && b.name) m[String(b.name)] = true
    }
    return m
  }

  // ---- helpers --------------------------------------------------------

  // Map a single-char status code onto a Color. The renderer's GitStatus
  // uses semantic tokens; we mirror the same single-char mapping
  // ("."|"M"|"A"|"D"|"R"|"C"|"?", per src/shared/git-types.ts:1-6).
  function _statusColor(ch) {
    switch (String(ch || "")) {
    case "M": return Color.foreground
    case "A": return Color.accent
    case "D": return Color.urgent
    case "R":
    case "C": return Color.accent
    case "?": return Color.muted
    default: return Color.foreground
    }
  }

  // ---- header ---------------------------------------------------------

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
        text: {
          if (!root.store) return "Git"
          if (!root.store.isRepo) return "Not a git repo"
          var s = root.store.status
          if (!s) return "Loading…"
          var branch = s.detached ? "(detached)" : (s.branch || "(no branch)")
          var ahead = s.ahead || 0
          var behind = s.behind || 0
          var arrow = (ahead > 0 || behind > 0) ? (" ↑" + ahead + " ↓" + behind) : ""
          return branch + arrow
        }
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.subtitle
      }

      Button {
        text: "Set folder…"
        tooltipText: "Point this conversation at a working directory"
        onClicked: root.changeCwdRequested()
      }

      // git:fetch has no on-screen equivalent in the renderer — the renderer
      // has a sync-on-pull hook. The pane gets a manual button so a "behind"
      // counter can be cleared without leaving the conversation. Gated on
      // cwd: behind/without-a-repo there is nothing to fetch from.
      Button {
        text: "Fetch"
        enabled: !!root.store && root.store.cwd.length > 0
        onClicked: { if (root.store) root.store.fetch() }
      }

      Button {
        text: "Refresh"
        enabled: !!root.store && root.store.cwd.length > 0
        onClicked: { if (root.store) root.store.refresh() }
      }
    }
  }

  PanelSeparator {
    anchors { top: header.bottom; left: parent.left; right: parent.right }
  }

  // ---- not-a-repo state ----------------------------------------------

  Text {
    anchors.centerIn: parent
    visible: root.store && root.store.cwd.length > 0 && root.store.isRepo === false
    text: "Not a git repository.\nSet cwd to a repo to use this pane."
    color: Color.foreground
    opacity: 0.5
    font.family: Style.font.family
    font.pixelSize: Style.font.bodySmall
    horizontalAlignment: Text.AlignHCenter
  }

  // ---- main body (status / graph / branches / stash) -----------------

  Item {
    anchors {
      top: header.bottom
      topMargin: Style.spacing.md
      left: parent.left
      right: parent.right
      bottom: parent.bottom
    }
    anchors.margins: Style.spacing.md
    visible: !root.store || root.store.isRepo !== false

    ColumnLayout {
      anchors.fill: parent
      spacing: Style.spacing.md

      // ---- status list --------------------------------------------
      PanelSectionHeader { text: "Status" }

      ColumnLayout {
        Layout.fillWidth: true
        Layout.preferredHeight: implicitHeight
        spacing: 0

        Text {
          Layout.fillWidth: true
          visible: !root.store || !root.store.status || root.store.status.clean
          text: root.store && root.store.status && root.store.status.clean
            ? "Working tree clean."
            : "Loading…"
          color: Color.foreground
          opacity: 0.6
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
        }

        ListView {
          Layout.fillWidth: true
          Layout.preferredHeight: Math.min(
            Style.spacing.popupRowHeight * 6,
            count * Style.spacing.popupRowHeight
          )
          clip: true
          visible: !(!root.store || !root.store.status || root.store.status.clean)
          model: root.store && root.store.status && root.store.status.files
            ? root.store.status.files
            : []
          spacing: 0
          ScrollBar.vertical: ScrollBar { active: true }

          delegate: StatusRow {
            // No `required property` redeclaration: the `component` already
            // declares modelData/statusColorFn, and repeating a base type's
            // required property on an instance shadows it — the delegate then
            // fails to build and the list renders empty.
            width: ListView.view.width
            statusColorFn: root._statusColor
          }
        }
      }

      // ---- graph ----------------------------------------------------
      PanelSectionHeader { text: "History" }

      ListView {
        Layout.fillWidth: true
        Layout.fillHeight: true
        Layout.minimumHeight: Style.spacing.popupRowHeight * 4
        clip: true
        model: root._layout.nodes
        spacing: 0
        ScrollBar.vertical: ScrollBar { active: true }

        delegate: GraphRow {
          // See StatusRow above: no redeclaration.
          width: ListView.view.width
          remoteNames: root._remoteNames
          store: root.store
        }
      }

      // ---- branches -------------------------------------------------
      PanelSectionHeader { text: "Branches" }

      ColumnLayout {
        Layout.fillWidth: true
        Layout.preferredHeight: implicitHeight
        spacing: 0

        Repeater {
          model: root.store ? root.store.branches : []

          delegate: BranchRow {
            // See StatusRow above: no redeclaration.
            width: parent.width
            store: root.store
          }
        }
      }

      // ---- stash ----------------------------------------------------
      PanelSectionHeader { text: "Stash" }

      ColumnLayout {
        Layout.fillWidth: true
        Layout.preferredHeight: implicitHeight
        spacing: 0

        Text {
          Layout.fillWidth: true
          visible: !root.store || !root.store.stashes || root.store.stashes.length === 0
          text: "No stash entries."
          color: Color.foreground
          opacity: 0.55
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
        }
        // Save input. In-pane on purpose: the renderer pops a modal text
        // prompt for the message, but a modal just to type a one-liner is
        // out of proportion here, and an inline row lives next to the
        // stashes it produces.
        RowLayout {
          Layout.fillWidth: true
          spacing: Style.spacing.sm

          TextField {
            id: stashInput
            Layout.fillWidth: true
            // Empty text is the user's intent: take the 1-arg stashSave()
            // branch so the backend auto-generates the subject.
            placeholderText: "Stash message (optional)"
            text: root.stashInputText
            onTextChanged: root.stashInputText = text
          }

          Button {
            text: "Stash"
            enabled: !!root.store && root.store.cwd.length > 0
            onClicked: {
              if (!root.store) return
              var msg = root.stashInputText
              // Pinned by tests/qml/tst_git_store.qml:348-359: stashSave()
              // with no message uses cwd-only args; passing "" would write
              // an empty subject instead.
              if (msg && msg.length > 0) {
                root.store.stashSave(msg)
              } else {
                root.store.stashSave()
              }
              root.stashInputText = ""
            }
          }
        }

        Repeater {
          model: root.store ? root.store.stashes : []

          delegate: StashRow {
            // See StatusRow above: no redeclaration.
            width: parent.width
            store: root.store
            onPopRequested: function (index) { root.stashPopTarget = index }
          }
        }
      }
    }
  }
  // ---- stash-pop confirm -------------------------------------------
  //
  // Pattern mirrors components/settings/StorageSettings.qml: a single
  // dialog driven by a target id. The StashRow delegate routes through
  // the `popRequested` signal, which the Repeater wires to set
  // `stashPopTarget`; the dialog watches that property and triggers the
  // destructive call only on confirmation. `-1` is closed.
  ConfirmDialog {
    opened: root.stashPopTarget >= 0
    message: "Pop stash entry?\n\nApplies the stash on top of the working tree. " +
      "If the working tree has conflicting changes, the pop fails and the " +
      "stash is preserved."
    confirmText: "Pop stash"
    onConfirmed: {
      if (!root.store) { root.stashPopTarget = -1; return }
      var idx = root.stashPopTarget
      root.stashPopTarget = -1
      root.store.stashPop(idx)
    }
    onCanceled: root.stashPopTarget = -1
  }

  // ---- per-row delegate components ----------------------------------
  //
  // Inline `component` declarations. With `pragma ComponentBehavior:
  // Bound` on the outer Item, qmllint accepts these as separate types
  // and resolves `root._statusColor` (and `GG.classifyRef`) cleanly
  // because they're in the same scope.

  component StatusRow: Rectangle {
    id: statusRow
    required property var modelData
    required property var statusColorFn
    height: Style.spacing.popupRowHeight
    color: "transparent"

    RowLayout {
      anchors.fill: parent
      anchors.leftMargin: Style.spacing.rowPaddingX
      anchors.rightMargin: Style.spacing.rowPaddingX
      spacing: Style.spacing.sm

      Text {
        text: statusRow.modelData && statusRow.modelData.index
            && statusRow.modelData.index !== "."
          ? String(statusRow.modelData.index) : " "
        color: statusRow.statusColorFn(statusRow.modelData && statusRow.modelData.index)
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        Layout.preferredWidth: Style.font.bodySmall
        horizontalAlignment: Text.AlignHCenter
      }

      Text {
        text: statusRow.modelData && statusRow.modelData.worktree
            && statusRow.modelData.worktree !== "."
          ? String(statusRow.modelData.worktree) : " "
        color: statusRow.statusColorFn(statusRow.modelData && statusRow.modelData.worktree)
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        Layout.preferredWidth: Style.font.bodySmall
        horizontalAlignment: Text.AlignHCenter
      }

      Text {
        Layout.fillWidth: true
        text: statusRow.modelData ? String(statusRow.modelData.path || "") : ""
        color: Color.foreground
        opacity: 0.85
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        elide: Text.ElideMiddle
      }
    }
  }

  component GraphRow: Item {
    id: graphRow
    required property var modelData
    required property var remoteNames
    required property var store
    height: Style.bar.sizeHorizontal

    readonly property var commit: graphRow.modelData && graphRow.modelData.commit
      ? graphRow.modelData.commit : null

    RowLayout {
      anchors.fill: parent
      anchors.leftMargin: Style.spacing.rowPaddingX
      anchors.rightMargin: Style.spacing.rowPaddingX
      spacing: Style.spacing.sm

      Rectangle {
        Layout.preferredWidth: Style.spacing.sm
        Layout.preferredHeight: Style.spacing.sm
        radius: width / 2
        color: graphRow.modelData && graphRow.modelData.color
          ? String(graphRow.modelData.color) : Color.accent
        Layout.alignment: Qt.AlignVCenter
      }

      Text {
        text: graphRow.commit
          ? String(graphRow.commit.shortSha || graphRow.commit.sha || "") : ""
        color: Color.muted
        opacity: 0.7
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
        Layout.preferredWidth: Style.spacing.xxl
      }

      Text {
        Layout.fillWidth: true
        text: graphRow.commit ? String(graphRow.commit.subject || "") : ""
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        elide: Text.ElideRight
      }

      Text {
        text: {
          if (!graphRow.commit || !graphRow.commit.refs
              || graphRow.commit.refs.length === 0) return ""
          var refs = graphRow.commit.refs
          for (var i = 0; i < refs.length; i++) {
            var klass = GG.classifyRef(refs[i], graphRow.remoteNames)
            if (klass) return klass.label
          }
          return ""
        }
        color: Color.accent
        opacity: 0.7
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
      }
    }

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: {
        if (!graphRow.store || !graphRow.commit) return
        graphRow.store.fetchCommitDetail(graphRow.commit.sha)
      }
    }
  }

  component BranchRow: Rectangle {
    id: branchRow
    required property var modelData
    required property var store
    height: Style.spacing.popupRowHeight
    color: "transparent"

    RowLayout {
      anchors.fill: parent
      anchors.leftMargin: Style.spacing.rowPaddingX
      anchors.rightMargin: Style.spacing.rowPaddingX
      spacing: Style.spacing.sm

      Text {
        text: branchRow.modelData && branchRow.modelData.isCurrent ? "●" : " "
        color: Color.accent
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        Layout.preferredWidth: Style.font.bodySmall
        horizontalAlignment: Text.AlignHCenter
      }

      Text {
        Layout.fillWidth: true
        text: branchRow.modelData ? String(branchRow.modelData.name || "") : ""
        color: branchRow.modelData && branchRow.modelData.isCurrent
          ? Color.foreground : Color.muted
        opacity: branchRow.modelData && branchRow.modelData.isCurrent ? 1.0 : 0.7
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        elide: Text.ElideRight
      }

      Text {
        visible: !!(branchRow.modelData && branchRow.modelData.upstream)
        text: branchRow.modelData && branchRow.modelData.upstream
          ? ("↑" + (branchRow.modelData.ahead || 0)
              + " ↓" + (branchRow.modelData.behind || 0))
          : ""
        color: Color.muted
        opacity: 0.7
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
      }
    }

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: branchRow.modelData && branchRow.modelData.isCurrent
        ? Qt.ArrowCursor : Qt.PointingHandCursor
      enabled: !(branchRow.modelData && branchRow.modelData.isCurrent)
      onClicked: {
        if (!branchRow.store || !branchRow.modelData) return
        branchRow.store.checkout(branchRow.modelData.name)
      }
    }
  }

  component StashRow: Rectangle {
    id: stashRow
    required property var modelData
    required property var store
    height: Style.spacing.popupRowHeight
    color: "transparent"

    // Defer the destructive call to the ConfirmDialog on the outer Item.
    // A signal (rather than an outward assignment) keeps the delegate from
    // mutating outer scope directly, which `pragma ComponentBehavior:
    // Bound` discourages. The Repeater wires this back to root.stashPopTarget.
    signal popRequested(int index)

    RowLayout {
      anchors.fill: parent
      anchors.leftMargin: Style.spacing.rowPaddingX
      anchors.rightMargin: Style.spacing.rowPaddingX
      spacing: Style.spacing.sm

      Text {
        text: stashRow.modelData ? ("#" + String(stashRow.modelData.index)) : ""
        color: Color.muted
        opacity: 0.7
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
        Layout.preferredWidth: Style.spacing.xxl
      }

      Text {
        Layout.fillWidth: true
        text: stashRow.modelData ? String(stashRow.modelData.message || "") : ""
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        elide: Text.ElideRight
      }

      Button {
        text: "Pop"
        onClicked: {
          if (!stashRow.modelData) return
          // Destructive: a working tree that lost a stash pop is silent.
          stashRow.popRequested(stashRow.modelData.index)
        }
      }
    }
  }
}
