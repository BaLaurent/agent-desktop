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
    //
    // This needs ACTIVE focus, and a declarative `focus: true` does not give it
    // here. `focus` only nominates the item within its own FocusScope; the
    // window's active focus belongs to whoever last claimed it, and App.qml
    // claims it explicitly for `windowBody` in `_tryFocus()`. MEASURED in the
    // real shell: with only the binding, Record correctly flips to "Cancel" and
    // then every keystroke goes nowhere — the exact symptom of the original bug,
    // from a different cause.
    //
    // No offscreen test can see this. There is no App.qml competing for active
    // focus in the harness, so the binding alone passes there and passed here
    // while the page was broken live. That is why the grab is verified by a live
    // A/B (record a shortcut, read the DB) and not by the suite.
    //
    // Both edges are imperative on purpose. `forceActiveFocus()` writes `focus`,
    // which destroys any binding on it — so a binding for the "on" edge plus an
    // imperative "on" write would leave nothing to hand the keyboard BACK when
    // recording ends, and this 1px item would keep it for good.
    Item {
      id: captureField
      width: parent.width
      height: 1

      readonly property bool recording: root.store !== null
                                        && root.store !== undefined
                                        && root.store.recordingId >= 0

      onRecordingChanged: {
        if (!captureField.recording) { captureField.focus = false; return }
        // Twice, and both are needed. Now, so a keystroke that arrives in the
        // same event-loop pass as the state change is not dropped. And again on
        // the next pass, because the click that started the recording is still
        // being delivered and whatever the click path touches can take active
        // focus back after this returns. forceActiveFocus() is idempotent, so
        // the second call costs nothing when the first already stuck.
        captureField.grab()
        Qt.callLater(captureField.grab)
      }

      // Re-checks `recording` because the deferred call may land after the user
      // has already pressed Cancel.
      function grab() {
        if (captureField.recording) captureField.forceActiveFocus()
      }


      Keys.onPressed: function (event) {
        if (!root.store || root.store.recordingId < 0) return
        // A QML KeyEvent carries an integer Qt.Key_* code, so Escape is
        // Qt.Key_Escape — comparing against the string "Escape" (the DOM
        // spelling) is never true and left Escape unable to cancel.
        if (event.key === Qt.Key_Escape) {
          root.store.stopRecording()
          root.captured = ""
          root.conflictId = -1
          event.accepted = true
          return
        }
        var accel = root.store.formatKeybinding(event)
        // "" means the press is not a committable combination yet — a bare
        // modifier, or a key this front has no spelling for. Swallow it and
        // keep listening rather than committing a placeholder.
        if (!accel) {
          event.accepted = true
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

        // Reserve room for the Record button with a FIXED fraction. Deriving
        // the text budget from `recordButton.implicitWidth` — a sibling's
        // implicit size, inside a Row whose own implicitWidth is computed FROM
        // its children — spun the shell at 98% CPU from startup. Qt printed no
        // binding-loop warning and the offscreen suite could not see it,
        // because the test stub's implicitWidth is a constant while the real
        // qs.Ui Button derives it from its content row.
        readonly property real textBudget: width * 0.78

        Text {
          width: rowItem.textBudget * 0.5
          anchors.verticalCenter: parent.verticalCenter
          elide: Text.ElideRight
          text: rowItem.modelData ? root._actionLabel(rowItem.modelData.action) : ""
          color: Color.foreground
          font.family: Style.font.family
          font.pixelSize: Style.font.body
        }

        // Live capture / current value
        Column {
          width: rowItem.textBudget * 0.5

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
          id: recordButton
          anchors.verticalCenter: parent.verticalCenter
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