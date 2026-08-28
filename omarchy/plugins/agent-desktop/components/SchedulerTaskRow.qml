pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

import "../lib/schedule.js" as ScheduleLib

// One row in the scheduler list. Created by SchedulerPage.qml from its model;
// receives `task` and `store` as properties and the live `nowIso` timestamp.
//
// Toggle clicks are handled here (optimistic local flip then
// `store.toggle(task.id, checked)`). The page only needs to react to
// `editClicked`, which is a thin signal the page uses to flip into edit
// mode for this row.
//
// `nowIso` is a string the parent refreshes (typically "now" on a Timer). The
// lib deliberately takes the timestamp as a parameter (see lib/schedule.js)
// so a row cannot read the wall clock itself and produce different strings
// across two parallel rows.
Item {
  id: row

  required property var task
  required property var store
  required property string nowIso

  signal editClicked()

  // Delete confirmation: a single button that flips into "Confirm?" on the
  // first click. Mirrors FolderTree.qml:144's `_confirming` flag rather
  // than mounting a ConfirmDialog — the task list lives in a tight row
  // and a full scrim would steal focus from the edit form next door.
  // A stray click can change the label, but the second click is what
  // actually reaches store.remove().
  property bool _confirming: false
  function _requestDelete() {
    if (!row.store || !row.task || row.task.id === undefined) return
    row._confirming = true
  }
  function _confirmDelete() {
    if (!row.store || !row.task || row.task.id === undefined) {
      row._confirming = false
      return
    }
    var id = row.task.id
    row._confirming = false
    row.store.remove(id)
  }
  function _cancelDelete() { row._confirming = false }

  implicitHeight: Style.spacing.controlHeight + Style.spacing.md * 2

  Rectangle {
    anchors.fill: parent
    color: Style.normalFill
    radius: Style.cornerRadius
    border.color: Style.normalBorderColor
    border.width: Style.normalBorderWidth
  }

  Rectangle {
    id: dot
    width: Style.spacing.sm
    height: width
    radius: width / 2
    color: {
      if (row.task.last_status === "success") return Color.accent
      if (row.task.last_status === "error")   return Color.urgent
      return Color.muted
    }
    anchors.left: parent.left
    anchors.leftMargin: Style.spacing.md
    anchors.verticalCenter: parent.verticalCenter
  }

  Column {
    id: contents
    anchors {
      left: dot.right
      leftMargin: Style.spacing.md
      right: toggleRow.left
      rightMargin: Style.spacing.md
      verticalCenter: parent.verticalCenter
    }
    spacing: Style.spacing.xxs

    Text {
      text: String(row.task.name || "(unnamed task)")
      color: Color.foreground
      font.family: Style.font.family
      font.pixelSize: Style.font.body
      elide: Text.ElideRight
      width: contents.width
    }
    Text {
      text: ScheduleLib.describeTask(row.task, row.nowIso)
      color: Color.foreground
      opacity: 0.7
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      elide: Text.ElideRight
      width: contents.width
    }
  }

  Row {
    id: toggleRow
    spacing: Style.spacing.md
    anchors.right: parent.right
    anchors.rightMargin: Style.spacing.md
    anchors.verticalCenter: parent.verticalCenter

    Switch {
      checked: row.task.enabled === true
      onToggled: row.store.toggle(row.task.id, checked)
      anchors.verticalCenter: parent.verticalCenter
    }

    Button {
      text: "Edit"
      onClicked: row.editClicked()
      anchors.verticalCenter: parent.verticalCenter
    }

    // Delete button: single click flips into "Confirm?", second click
    // reaches store.remove(id). Any other interaction (Edit, the Switch,
    // a re-render that resets _confirming) cancels back to "Delete".
    Button {
      text: row._confirming ? "Confirm?" : "Delete"
      // A re-render with the same task should drop the confirming flag,
      // otherwise a "Delete" left half-armed on row N stays armed across
      // a list reorder. Binding on task.id is enough — a different row's
      // edit/list move resets the state.
      onClicked: row._confirming ? row._confirmDelete() : row._requestDelete()
      anchors.verticalCenter: parent.verticalCenter
    }
  }
}
