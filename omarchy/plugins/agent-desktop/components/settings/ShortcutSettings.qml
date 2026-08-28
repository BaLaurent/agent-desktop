pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

// Shortcuts category — keybinding table.
//
// Each row's "Record" button toggles a key-capture focus on that row.
// The capture field is implemented by listening to Keys.onPressed on
// the row's capturing Item; the store formats the event into the
// canonical "Ctrl+Shift+…" string and forwards it to shortcuts:update.
//
// The conflict check is rendered as a chip: when the user captures a
// combination that another row already has, the store returns the
// conflict name and the row shows it inline. The page keeps the
// "Cancel" affordance (Escape or clicking the same Record button again).
Item {
  id: root

  required property var store

  // Render the row in one of three states: idle (showing current
  // keybinding), recording (showing the captured combination live),
  // conflict (showing both the live capture and the conflicting action).
  function _actionLabel(action) {
    if (!action) return ""
    var parts = String(action).split("_")
    var out = []
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i]
      if (!p) continue
      out.push(p.charAt(0).toUpperCase() + p.slice(1))
    }
    return out.join(" ")
  }

  // ---- conflict detection ------------------------------------------

  function _findConflict(accel, currentId) {
    if (!accel) return null
    var rows = root.store ? root.store.shortcuts : []
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i]
      if (!row) continue
      if (row.id === currentId) continue
      if (row.keybinding === accel) return row
    }
    return null
  }

  // Local recording state — the field captures into this string. The
  // store's recordingId is also kept in sync so other UI can show the
  // recording row.
  property string captured: ""
  property int conflictId: -1

  // The page mounts this in a Loader that sets only `width`, so the Loader
  // adopts this item's implicitHeight. Without it the item is zero-high and the
  // entire body is clipped away — which is what made every settings category
  // render blank.
  implicitHeight: bodyCol.implicitHeight

  Column {
    id: bodyCol
    anchors { left: parent.left; right: parent.right }
    spacing: Style.spacing.md

    PanelSectionHeader { text: "In-app shortcuts" }

    Text {
      width: parent.width
      text: "These are in-app shortcuts — global shortcuts are configured "
          + "in ~/.config/hypr/bindings.lua and are out of scope here. "
          + "Click Record and press the combination you want to bind."
      color: Color.muted
      opacity: 0.85
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
    }

    // Capture focus — receives keys while at least one row is recording.
    Item {
      width: parent.width
      height: 1
      focus: root.store && root.store.recordingId >= 0
      Keys.onPressed: function (event) {
        if (!root.store || root.store.recordingId < 0) return
        var accel = root.store.formatKeybinding(event)
        if (!accel) {
          // Escape: cancel recording without committing.
          if (event.key === "Escape") {
            root.store.stopRecording()
            root.captured = ""
            root.conflictId = -1
            event.accepted = true
          }
          return
        }
        // Update the live capture and detect a conflict.
        root.captured = accel
        var conflict = root._findConflict(accel, root.store.recordingId)
        root.conflictId = conflict ? conflict.id : -1
        if (!conflict) {
          // No conflict — commit immediately.
          root.store.update(root.store.recordingId, accel)
          root.captured = ""
          root.conflictId = -1
        }
        event.accepted = true
      }
    }

    Repeater {
      model: root.store ? root.store.shortcuts : []
      delegate: Row {
        id: rowItem
        required property var modelData
        width: parent.width
        spacing: Style.spacing.md

        Text {
          width: parent.width * 0.4
          anchors.verticalCenter: parent.verticalCenter
          text: rowItem.modelData ? root._actionLabel(rowItem.modelData.action) : ""
          color: Color.foreground
          font.family: Style.font.family
          font.pixelSize: Style.font.body
        }

        // Live capture / current value
        Column {
          width: parent.width * 0.4

          Text {
            text: {
              if (!rowItem.modelData) return ""
              if (root.store.recordingId === rowItem.modelData.id && root.captured.length > 0) {
                return root.captured
              }
              return rowItem.modelData.keybinding || ""
            }
            color: root.store.recordingId === rowItem.modelData.id
              ? Color.accent
              : Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.bodySmall
            font.weight: Font.Medium
          }

          Text {
            visible: root.store.recordingId === rowItem.modelData.id && root.conflictId >= 0
            text: {
              if (root.conflictId < 0) return ""
              var rows = root.store.shortcuts
              for (var i = 0; i < rows.length; i++) {
                if (rows[i].id === root.conflictId) return "Conflicts with: " + root._actionLabel(rows[i].action)
              }
              return ""
            }
            color: Color.urgent
            opacity: 0.85
            font.family: Style.font.family
            font.pixelSize: Style.font.bodySmall
          }
        }

        Button {
          text: root.store && root.store.recordingId === rowItem.modelData.id ? "Cancel" : "Record"
          bordered: true
          onClicked: {
            if (root.store.recordingId === rowItem.modelData.id) {
              root.store.stopRecording()
              root.captured = ""
              root.conflictId = -1
            } else {
              root.store.startRecording(rowItem.modelData.id)
              root.captured = ""
              root.conflictId = -1
            }
          }
        }
      }
    }

    // No rows at all (store not loaded yet).
    Text {
      visible: !root.store || !root.store.loaded
      text: "Loading shortcuts…"
      color: Color.muted
      opacity: 0.6
      font.family: Style.font.family
      font.pixelSize: Style.font.body
    }
  }
}