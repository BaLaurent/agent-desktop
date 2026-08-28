pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import qs.Commons
import qs.Ui

// OpenSCAD page — validation, compile-preview, and STL export.
//
// Mounted by App.qml. Takes an OpenScadStore through `store`.
//
// The save dialog is here because the exportStl handler takes an
// EXPLICIT destination path (Phase 4.5 contract); the page picks the
// destination with a Qt.labs.platform FileDialog and hands it to the
// store. The handler does not know about UI.
Item {
  id: root

  required property var store   // OpenScadStore

  // Two host dialogs used to live here as `Qt.labs.platform` FileDialogs, and
  // that dialog SEGFAULTS the whole Quickshell process — see
  // components/FilePicker.qml for the measured backtrace. The pane raises
  // these instead; App.qml owns every host-facing action (CONTRACTS.md §2)
  // and calls `store.setScadPath(path)` / `store.exportStl(src, dest)`.
  // Keeping Quickshell out of this file also keeps it loadable offscreen.
  signal openScadRequested()
  signal exportStlRequested()

  // A parent that mounts this with width only (a Column row, a ListView
  // delegate, a Loader) adopts the item's implicitHeight. Without it the root
  // Item is zero-high and the whole body is invisible — which is how assistant
  // messages vanished from the transcript while the store held them. Ignored
  // when a parent sets an explicit height, so it is safe everywhere.
  implicitHeight: bodyRoot.implicitHeight

  ColumnLayout {
    id: bodyRoot
    anchors { fill: parent }
    spacing: Style.spacing.md

    // ---- header ----

    RowLayout {
      Layout.fillWidth: true
      spacing: Style.spacing.md

      Text {
        Layout.fillWidth: true
        text: !root.store || root.store.scadPath.length === 0
          ? "No .scad file selected"
          : root.store.scadPath.split("/").slice(-1)[0]
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.title
        font.bold: true
      }

      Button {
        text: "Open .scad…"
        onClicked: root.openScadRequested()
      }

      Button {
        text: "Compile"
        enabled: !!root.store && root.store.scadPath.length > 0 && !root.store.compiling
        onClicked: root.store.compile()
      }

      Button {
        text: "Export STL…"
        enabled: !!root.store && root.store.scadPath.length > 0 && !root.store.exporting
        onClicked: root.exportStlRequested()
      }

      Button {
        text: "Revalidate"
        enabled: !!root.store && !root.store.validating
        onClicked: root.store.validate()
      }
    }

    // ---- validation row ----

    Rectangle {
      Layout.fillWidth: true
      visible: !!root.store
        && (root.store.validationResult.binaryFound || root.store.validationError.length > 0)
      color: root.store && root.store.validationResult.binaryFound
        ? Color.background
        : Color.urgent
      radius: Style.cornerRadius
      implicitHeight: valText.implicitHeight + Style.spacing.md * 2

      Text {
        id: valText
        anchors {
          left: parent.left; right: parent.right
          top: parent.top; margins: Style.spacing.md
        }
        text: {
          if (!root.store) return ""
          if (root.store.validationError.length > 0) {
            return "Validation failed: " + root.store.validationError
          }
          var v = root.store.validationResult
          return "Binary: " + (v.binaryPath || "(none)")
              + "\nVersion: " + (v.version || "(unknown)")
              + (v.binaryFound ? "" : "\nNot found — install openscad or set openscad_binaryPath")
        }
        color: Color.foreground
        font.family: "monospace"
        font.pixelSize: Style.font.bodySmall
        wrapMode: Text.Wrap
      }
    }

    // ---- errors ----

    Rectangle {
      Layout.fillWidth: true
      visible: !!root.store && (root.store.compileError.length > 0 || root.store.exportError.length > 0)
      color: Color.urgent
      radius: Style.cornerRadius
      implicitHeight: errText.implicitHeight + Style.spacing.md * 2

      Text {
        id: errText
        anchors {
          left: parent.left; right: parent.right
          top: parent.top; margins: Style.spacing.md
        }
        text: root.store ? (root.store.compileError || root.store.exportError) : ""
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        wrapMode: Text.Wrap
      }
    }

    // ---- preview ----

    Rectangle {
      Layout.fillWidth: true
      Layout.fillHeight: true
      color: Color.background
      border.width: 1
      border.color: Color.muted
      radius: Style.cornerRadius

      Image {
        anchors.fill: parent
        anchors.margins: Style.spacing.md
        source: root.store && root.store.lastCompileResult && root.store.lastCompileResult.data
          ? "data:model/3mf;base64," + root.store.lastCompileResult.data
          : ""
        fillMode: Image.PreserveAspectFit
        visible: source.toString().length > 0
        asynchronous: true
      }

      Text {
        anchors.centerIn: parent
        visible: !root.store || !root.store.lastCompileResult
        text: !root.store || !root.store.compiling
          ? "Compile to see the preview"
          : "Compiling…"
        color: Color.foreground
        opacity: 0.6
        font.family: Style.font.family
        font.pixelSize: Style.font.body
      }
    }

    // ---- warnings ----

    Text {
      Layout.fillWidth: true
      visible: !!(root.store
        && root.store.lastCompileResult
        && root.store.lastCompileResult.warnings
        && root.store.lastCompileResult.warnings.length > 0)
      text: root.store && root.store.lastCompileResult
        ? root.store.lastCompileResult.warnings
        : ""
      color: Color.foreground
      opacity: 0.7
      font.family: "monospace"
      font.pixelSize: Style.font.caption
      wrapMode: Text.Wrap
    }

    Text {
      Layout.fillWidth: true
      visible: !!(root.store && root.store.lastExportPath.length > 0)
      text: root.store && root.store.lastExportPath.length > 0
        ? "Last export: " + root.store.lastExportPath
        : ""
      color: Color.foreground
      opacity: 0.6
      font.family: Style.font.family
      font.pixelSize: Style.font.caption
      wrapMode: Text.Wrap
    }
  }
}
