pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

// The scheduler tab. Two halves:
//   - a list of SchedulerTaskRow that mirrors store.tasks (id-ordered),
//     with status dot, summary, enabled toggle and Edit button per row;
//   - a SchedulerForm on the right, switching between "new" (task === null)
//     and "edit <task>" (task !== null) by changing which task is fed.
//
// Reaches its data and time-anchor through properties, not singletons; so the
// page can be QML-tested with a fake `store` injected by the harness.
//
// `nowIso` is refreshed by a Timer at 1 Hz. A row's "in 4 min" string then
// flips to "in 3 min" the next time the page rebinds without any service
// round-trip.
//
// The two-column body collapses to a single column below 720 px.
//
// `pragma ComponentBehavior: Bound` (CONTRACTS.md §6b) is what makes the
// Repeater's delegate resolve the outer `root` id cleanly through qmllint
// without `Unqualified access` warnings. With this pragma the rows follow
// `scheduler:taskUpdate` pushes — the page subscribes on mount via
// `store.attach()` and unsubscribes on destroy via `store.detach()`, so a
// patch to a row lands live without a refetch.
Item {
  id: root

  required property var store

  signal saved()


  property string nowIso: Qt.formatDateTime(new Date(), "yyyy-MM-ddTHH:mm:ss.000Z")
  Timer {
    interval: 1000
    running: true
    repeat: true
    onTriggered: root.nowIso = Qt.formatDateTime(new Date(), "yyyy-MM-ddTHH:mm:ss.000Z")
  }

  property int editingId: 0

  // Mirror the ChatStore pair: subscribe on mount, unsubscribe on destroy.
  // `scheduler:taskUpdate` is the patch channel that keeps rows live without
  // a refetch — but only while the page is mounted and the subscription is
  // wired. Done here (not in Main) because the page owns the lifecycle: the
  // store outlives the page and would leak subs otherwise.
  Component.onCompleted: {
    if (root.store && typeof root.store.attach === "function") {
      root.store.attach()
    }
  }
  Component.onDestruction: {
    if (root.store && typeof root.store.detach === "function") {
      root.store.detach()
    }
  }
  readonly property var rows: {
    var out = []
    if (root.store && root.store.taskOrder) {
      var ids = root.store.taskOrder
      for (var i = 0; i < ids.length; i++) {
        var row = root.store.tasks[ids[i]]
        if (row) out.push(row)
      }
    }
    return out
  }

  readonly property var editingTask: {
    if (root.editingId <= 0) return null
    if (!root.store) return null
    return root.store.tasks[root.editingId] || null
  }

  readonly property bool wide: root.width > 720

  // Forwarded from the row, translated into a property write on root.
  function editTaskRequested(taskId) {
    root.editingId = taskId
  }

  // A parent that mounts this with width only (a Column row, a ListView
  // delegate, a Loader) adopts the item's implicitHeight. Without it the root
  // Item is zero-high and the whole body is invisible — which is how assistant
  // messages vanished from the transcript while the store held them. Ignored
  // when a parent sets an explicit height, so it is safe everywhere.
  implicitHeight: bodyRoot.implicitHeight

  Column {
    id: bodyRoot
    anchors { fill: parent }
    spacing: Style.spacing.md


    // `text`; using a styled Text matches what `PanelHero` actually renders
    // for a single-line title.
    Text {
      text: "Scheduled tasks"
      color: Color.foreground
      font.family: Style.font.family
      font.pixelSize: Style.font.title
      font.bold: true
    }

    Text {
      text: root.store && root.store.background
        ? ("Background mode: " + (root.store.background.enabled ? "on" : "off")
            + " — platform scheduler: "
            + (root.store.background.installed
                ? "installed"
                : "not installed (headless server reports installed=false by design)"))
        : "Background mode: (loading)…"
      color: Color.foreground
      opacity: 0.7
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
      width: parent.width
    }

    // Reachable switch for `scheduler_background_enabled`. The key is already
    // whitelisted server-side (`src/core/services/settings.ts:137`); without a
    // toggle here the only way to flip the mode was to dig into a JSON dump.
    // The store's `setBackground(enabled)` writes to `background.enabled` on
    // success and to `store.error` on refusal; the visual flip here is the
    // optimistic local state, and the binding to `store.background.enabled`
    // above wins once the server replies (authoritative).
    Toggle {
      width: parent.width
      label: "Enable background scheduler"
      enabled: root.store && typeof root.store.setBackground === "function"
      checked: !!(root.store && root.store.background && root.store.background.enabled)
      onClicked: {
        if (!root.store || typeof root.store.setBackground !== "function") return
        // Optimistic local flip; the server reply overwrites background.enabled
        // synchronously and the binding will re-render if it disagrees.
        checked = !checked
        root.store.setBackground(checked)
        // A refused write leaves the toggle's checked unchanged in the store's
        // `background`, so the binding above will revert us on the next tick.
      }
    }

    // Visible error for the page (mirrors NotebookPane's pattern). The store
    // surfaces refused writes here; the toggle above is silent on success.
    Rectangle {
      width: parent.width
      visible: root.store && root.store.error && root.store.error.length > 0
      color: Color.urgent
      radius: Style.cornerRadius
      implicitHeight: errText.implicitHeight + Style.spacing.md * 2
      Text {
        id: errText
        anchors.fill: parent
        anchors.margins: Style.spacing.md
        text: "Background scheduler: " + (root.store && root.store.error ? root.store.error : "")
        color: Color.foreground
        wrapMode: Text.WordWrap
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
      }
    }

    Item {
      id: body
      width: parent.width
      height: root.wide
        ? Math.max(leftCol.implicitHeight, Style.spacing.controlHeight * 18)
        : leftCol.implicitHeight + formArea.implicitHeight + Style.spacing.md

      Column {
        id: leftCol
        anchors { left: parent.left; top: parent.top; bottom: parent.bottom }
        width: root.wide ? Math.min(parent.width * 0.55, 600) : parent.width
        spacing: Style.spacing.sm

        Row {
          spacing: Style.spacing.md
          Button {
            text: "New task"
            onClicked: root.editingId = 0
          }
        }

        Text {
          visible: root.rows.length === 0
          text: root.store && root.store.loaded
            ? "No scheduled tasks yet."
            : "Loading…"
          color: Color.foreground
          opacity: 0.6
          font.family: Style.font.family
          font.pixelSize: Style.font.body
        }

        // Declarative list. `required property var modelData` makes the
        // delegate's inputs explicit, and `pragma ComponentBehavior: Bound`
        // above lets the delegate reach `root.store` / `root.nowIso` /
        // `root.editTaskRequested` without qmllint warnings.
        Repeater {
          id: rowsRepeater
          model: root.rows

          delegate: SchedulerTaskRow {
            id: taskDelegate
            required property var modelData
            width: leftCol.width
            task: modelData
            store: root.store
            nowIso: root.nowIso
            onEditClicked: root.editTaskRequested(modelData.id)
          }
        }
      }

      PanelSeparator {
        visible: root.wide
        anchors {
          left: leftCol.right
          leftMargin: Style.spacing.md
          top: parent.top
          bottom: parent.bottom
        }
      }

      Column {
        id: formArea
        anchors {
          left: root.wide ? leftCol.right : parent.left
          leftMargin: root.wide ? Style.spacing.lg : 0
          right: parent.right
          top: root.wide ? parent.top : leftCol.bottom
          topMargin: root.wide ? 0 : Style.spacing.md
        }
        spacing: Style.spacing.md

        SchedulerForm {
          id: form
          width: formArea.width
          store: root.store
          task: root.editingTask
          onCancelled: root.editingId = 0
          onSaved: { root.saved(); root.editingId = 0 }
        }
      }
    }
  }
}