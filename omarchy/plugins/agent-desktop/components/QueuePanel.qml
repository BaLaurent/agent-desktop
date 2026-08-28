pragma ComponentBehavior: Bound

import QtQuick

import qs.Commons
import qs.Ui

import "../lib/palette.js" as Palette
// The message queue panel — shown above the composer whenever messages
// are queued behind a streaming turn.
//
// Parity with Electron's src/renderer/components/chat/QueuePanel.tsx:
// header with count, Pause/Resume and Clear; per-row edit + remove + drag
// to reorder. Drag-and-drop is not reproduced here (QtQuick has no native
// mouse-based reorder primitive; a future ticket can wire one), but the
// store's reorderQueue() function is already exposed for it. Up/down
// arrow buttons drive reorderQueue() in this build.
//
// `property var store` is nullable — the integration owner mounts this
// inside a Loader that flips the store in after construction (the same
// path that bit PiUIChrome and NotebookPane). Every binding that reads
// from `store` therefore has to guard `store === null` or the engine
// throws a binding TypeError on first build, which tst_null_store_
// construction.qml turns into a test failure.
Item {
  id: root

  // Nullable — see header comment. tst_null_store_construction.qml
  // builds this with `store: null` to prove every binding survives.
  property var store: null

  // Effective queue length. Coerced through `(store && store.queue) || []`
  // because the panel may be built before `store` is wired in.
  readonly property var queueList: (store && store.queue) ? store.queue : []
  readonly property int queueLen: queueList.length
  readonly property bool queuePaused: !!(store && store.queuePaused)

  // Visible only when there is something queued, matching the renderer's
  // `if (messages.length === 0) return null` early-out (QueuePanel.tsx:51).
  visible: queueLen > 0

  // Header + rows contribute to the implicit height of this Item so a
  // Column parent (the chat surface) reserves room for it. Without this
  // the root is zero-high and the panel disappears while the queue holds
  // items — the same failure mode AskUserStrip already paid for.
  implicitHeight: layout.implicitHeight + 2 * Style.spacing.sm

  Rectangle {
    id: bodyRoot
    anchors { left: root.left; right: root.right; top: root.top }
    height: layout.implicitHeight + 2 * Style.spacing.sm
    color: Util.alpha(Color.foreground, Palette.surfaceAlpha(1))
    border { width: Style.normalBorderWidth; color: Color.muted }
    radius: Style.cornerRadius

    Column {
      id: layout
      anchors {
        left: parent.left
        right: parent.right
        top: parent.top
        margins: Style.spacing.sm
      }
      spacing: Style.spacing.xs

      // ---- header ----------------------------------------------
      //
      // The count label sits at the left; the action buttons stack at
      // the right. QtQuick's `Row` does not allow `anchors.left` /
      // `anchors.right` on its children (its QWARN is the only thing
      // that surfaces here), so we wrap the layout in an Item that
      // accepts the anchors and lay the Row out at full width with
      // `anchors.fill`.
      Item {
        id: headerRow
        anchors { left: parent.left; right: parent.right }
        implicitHeight: headerLayout.implicitHeight

        Row {
          id: headerLayout
          anchors.fill: parent
          spacing: Style.spacing.sm

          Text {
            id: countLabel
            text: "Queue (" + root.queueLen + ")"
              + (root.queuePaused ? " — Paused" : "")
            font.family: Style.font.family
            font.pixelSize: Style.font.bodySmall
            font.weight: Font.Medium
            color: Color.muted
            anchors.verticalCenter: parent.verticalCenter
          }

          Item {
            // Spacer between the count label and the action buttons.
            // Sized to fill remaining horizontal space; the action
            // buttons trail it on the right.
            height: 1
            width: Math.max(0, headerLayout.width
              - countLabel.implicitWidth
              - pauseBtn.implicitWidth
              - resumeBtn.implicitWidth
              - clearBtn.implicitWidth
              - 3 * Style.spacing.sm)
          }

          // Pause and Resume are one control in two states. Only Resume
          // shipped, so `queuePaused` could never become true from the UI and
          // `ChatStore.pauseQueue()` had no caller at all — the plugin's own
          // reachability gate (tests/test_reachable.js) is what caught it.
          // Resume was therefore dead too: nothing could enter the state it
          // exits.
          Button {
            id: pauseBtn
            text: "Pause"
            tooltipText: "Hold the queue; the current turn still finishes"
            visible: !root.queuePaused
            anchors.verticalCenter: parent.verticalCenter
            onClicked: if (root.store) root.store.pauseQueue()
          }

          Button {
            id: resumeBtn
            text: "Resume"
            tooltipText: "Send the queued messages again"
            visible: root.queuePaused
            anchors.verticalCenter: parent.verticalCenter
            onClicked: if (root.store) root.store.resumeQueue()
          }

          Button {
            id: clearBtn
            text: "Clear"
            anchors.verticalCenter: parent.verticalCenter
            onClicked: if (root.store) root.store.clearQueue()
          }
        }
      }

      // ---- per-row list --------------------------------------------
      // Bound to `root.queueList`, which is itself bound to `store.queue`
      // — a binding change on `store.queue` (remove, edit, reorder,
      // clear, drain) re-evaluates `queueList` and rebuilds the Repeater.
      Repeater {
        model: root.queueList
        delegate: Item {
          id: itemRow
          required property var modelData
          required property int index
          anchors { left: parent.left; right: parent.right }
          implicitHeight: rowLayout.implicitHeight

          // Per-row edit state. It MUST live on `itemRow`, not on the inner
          // Row: every reference below reads `itemRow.editing` /
          // `itemRow._toggleEdit()`, and while these were declared one level
          // down qmllint reported `Member "editing" not found on type "Item"`
          // — the Edit button did nothing and the TextField never appeared.
          property bool editing: false

          function _toggleEdit() {
            if (itemRow.editing) {
              // Save path: forward the field text to the store, then hide.
              // An empty field is not saved, so a blanked-out row cannot
              // produce an empty turn.
              if (editField.text.length > 0 && root.store) {
                root.store.editQueued(itemRow.index, editField.text)
              }
              itemRow.editing = false
              return
            }
            itemRow.editing = true
            editField.text = String(itemRow.modelData && itemRow.modelData.content
              ? itemRow.modelData.content : "")
            editField.forceActiveFocus()
          }

          Row {
            id: rowLayout
            anchors.fill: parent
            spacing: Style.spacing.xs

            // Display text. Elide the right so a long message does not
            // push the row buttons off the right edge — the full text is
            // recovered on edit (TextField below).
            Text {
              id: contentLabel
              text: String(itemRow.modelData && itemRow.modelData.content
                ? itemRow.modelData.content : "")
              elide: Text.ElideRight
              font.family: Style.font.family
              font.pixelSize: Style.font.bodySmall
              color: Color.foreground
              anchors.verticalCenter: parent.verticalCenter
              width: rowLayout.width
                - removeBtn.implicitWidth
                - editBtn.implicitWidth
                - upBtn.implicitWidth
                - downBtn.implicitWidth
                - editField.implicitWidth
                - 5 * Style.spacing.xs
              wrapMode: Text.NoWrap
            }

            // Up arrow — moves the row earlier in the queue. Disabled on
            // row 0. Bound to `root.store.reorderQueue(index, index - 1)`.
            Button {
              id: upBtn
              text: "↑"
              enabled: itemRow.index > 0
              anchors.verticalCenter: parent.verticalCenter
              onClicked: if (root.store) root.store.reorderQueue(itemRow.index, itemRow.index - 1)
            }

            // Down arrow — moves the row later in the queue.
            Button {
              id: downBtn
              text: "↓"
              enabled: itemRow.index < root.queueLen - 1
              anchors.verticalCenter: parent.verticalCenter
              onClicked: if (root.store) root.store.reorderQueue(itemRow.index, itemRow.index + 1)
            }

            // Inline edit. The TextField appears alongside the label
            // when editing is on; the `Edit`/`Save` button toggles.
            TextField {
              id: editField
              visible: itemRow.editing
              text: String(itemRow.modelData && itemRow.modelData.content
                ? itemRow.modelData.content : "")
              anchors.verticalCenter: parent.verticalCenter
              width: contentLabel.width
              onAccepted: {
                if (root.store) root.store.editQueued(itemRow.index, text)
                itemRow.editing = false
              }
            }

            Button {
              id: editBtn
              text: itemRow.editing ? "Save" : "Edit"
              anchors.verticalCenter: parent.verticalCenter
              onClicked: if (root.store) itemRow._toggleEdit()
            }

            // Remove — calls `removeFromQueue(index)` and the binding
            // rebuilds the Repeater without this row.
            Button {
              id: removeBtn
              text: "×"
              anchors.verticalCenter: parent.verticalCenter
              onClicked: if (root.store) root.store.removeFromQueue(itemRow.index)
            }
          }
        }
      }
    }
  }
}
