pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

import qs.Commons
import qs.Ui

// Multi-select action bar — pinned to the bottom of the sidebar while any
// conversation is selected.
//
// Three documented channels: `conversations:deleteMany(ids)`,
// `conversations:moveMany(ids, folderId|null)`, and
// `conversations:colorMany(ids, color|null)`. The renderer's action bar
// also adds Clear (collapses the selection), "Move to folder…" (a
// dropdown listing all folders), and the eight-colour swatch palette;
// we mirror all four. The swatches match the renderer's `PRESET_COLORS`
// (src/renderer/components/shared/ColorPicker.tsx:4) exactly so the
// front end and the shell agree on the available tints.
Item {
  id: root

  property var store: null

  signal requestMovePicker()

  readonly property var _ids: root.store ? root.store.selectedIds() : []
  readonly property int _count: _ids.length

  // A parent that mounts this with width only (a Column row, a ListView
  // delegate, a Loader) adopts the item's implicitHeight. Without it the root
  // Item is zero-high and the whole body is invisible — which is how assistant
  // messages vanished from the transcript while the store held them. Ignored
  // when a parent sets an explicit height, so it is safe everywhere.
  implicitHeight: bodyRoot.implicitHeight

  Rectangle {
    id: bodyRoot
    anchors.fill: parent
    color: Color.popups.background
    radius: Style.cornerRadius

    RowLayout {
      anchors.fill: parent
      anchors.margins: Style.spacing.controlPaddingY
      spacing: Style.spacing.controlGap

      Text {
        text: root._count + " selected"
        color: Color.popups.text
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        Layout.preferredWidth: 90
      }

      Item { Layout.fillWidth: true }

      // Eight-swatch colour palette, identical to the renderer's
      // ColorSwatches component (src/renderer/components/shared/ColorPicker.tsx:4)
      // so the front end and the QML shell agree on the available tints.
      // Each swatch is a small Rectangle the user clicks to colour-tag the
      // whole selection; the "clear" swatch is the dash-bordered dot on the
      // far right and calls colorMany with null.
      Row {
        spacing: Style.spacing.xs

        // Swatch is a clickable dot — the same presentation as the per-row
        // ConversationRow.qml colour chip so a user can read both surfaces
        // the same way. A pointer MouseArea is what gives it hover state
        // and click reach; we don't need a full Button.
        Repeater {
          model: [
            "#ef4444", "#f97316", "#eab308", "#22c55e",
            "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"
          ]
          delegate: Button {
            id: swatch
            required property string modelData
            implicitWidth: Style.spacing.md
            implicitHeight: Style.spacing.md
            enabled: root._count > 0
            // `background` on qs.Ui.Button is `property color`, NOT an Item.
            // Assigning a Rectangle is "Cannot assign object of type Rectangle
            // to QColor" and the swatch showed no colour at all — the palette
            // was eight identical transparent dots.
            background: swatch.modelData
            opacity: swatch.enabled ? 1.0 : 0.4
            // `enabled` is the user-facing gate; this guard is the same
            // belt-and-braces every other button in this file carries
            // (Move/Unfiled/Delete/Clear, and the clear swatch below). It also
            // stops `root.store.colorMany` from throwing when `store` is null,
            // which is the state the bar is built in before Main wires it.
            onClicked: {
              if (!root.store || root._count === 0) return
              root.store.colorMany(root._ids, swatch.modelData)
            }
          }
        }

        // Clear-color swatch — dashed border, only meaningful when there IS
        // a colour to clear. Mirrors ColorSwatches' "×" button.
        Button {
          id: clearSwatch
          implicitWidth: Style.spacing.md
          implicitHeight: Style.spacing.md
          enabled: root._count > 0
          // Same type error as the preset swatches: `background` is a colour.
          // `bordered` is the Button's own outline, which is what the dashed
          // Rectangle was trying to imitate.
          bordered: true
          opacity: clearSwatch.enabled ? 1.0 : 0.4
          text: "\u00d7"
          // A button's default label styling is sufficient for the
          // muted glyph — no custom contentItem needed.
          onClicked: {
            if (!root.store || root._count === 0) return
            root.store.colorMany(root._ids, null)
          }
        }
      }

      Button {
        text: "Move…"
        enabled: root._count > 0
        tooltipText: "Move selected conversations into a folder"
        onClicked: root.requestMovePicker()
      }

      Button {
        text: "Unfiled"
        enabled: root._count > 0
        tooltipText: "Move selected conversations out of any folder"
        onClicked: {
          if (!root.store || root._count === 0) return
          root.store.moveMany(root._ids, null)
        }
      }

      Button {
        text: "Delete"
        enabled: root._count > 0
        tooltipText: "Delete the selected conversations"
        onClicked: {
          if (!root.store || root._count === 0) return
          root.store.deleteMany(root._ids)
        }
      }

      Button {
        text: "Clear"
        tooltipText: "Clear the selection"
        onClicked: { if (root.store) root.store.clearSelection() }
      }
    }
  }
}