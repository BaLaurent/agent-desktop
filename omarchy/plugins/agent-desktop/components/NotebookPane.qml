pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import qs.Commons
import qs.Ui

// Jupyter notebook pane.
//
// Owns:
//   - the active notebook (cells + outputs), through a JupyterStore
//   - one Run button per code cell that calls store.executeCell(idx, code)
//
// File picking is NOT done here. It was, with a `Qt.labs.platform` FileDialog,
// and that dialog SEGFAULTS the whole Quickshell process (see
// components/FilePicker.qml for the measured backtrace). The pane raises
// `openRequested()` and App.qml — which owns every host-facing action — runs
// the out-of-process picker and calls `store.load(path)`. Keeping Quickshell
// out of this file is also what lets the offscreen suites load it at all.
//
// Image outputs (`data: { 'image/png': base64, ... }`) render through an
// Image with a `data:` source. Text outputs render as Text. Errors render
// with the urgent colour.
//
// The pane itself does NOT speak to the kernel directly — every action
// goes through the store's channel calls. The store owns the lifecycle
// and the chunk reducer.
//
// Null-store survival: App.qml mounts this with `store: root.service ? root.service.jupyterStore : null`,
// and the shell injects `service` AFTER the item is created. Every binding
// therefore has to evaluate at least once with store === null. The
// `tst_null_store_construction.qml` gate turns any binding TypeError into
// a test failure; each binding below guards on `!!root.store` (or `root.store ? ... : ...`)
// before reading a sub-property. The store itself declares safe defaults
// for every property the pane touches (`filePath: ""`, `kernelStatus: { state: "", language: "" }`,
// `error: ""`, `notebook: { cells: [] }`), so a one-level guard suffices.
Item {
  id: root

  required property var store   // JupyterStore

  // Raised by the "Open notebook…" button. App.qml runs the picker and calls
  // `store.load(path)`; a leaf pane may not spawn a host dialog
  // (CONTRACTS.md §2), and the dialog it used to own crashed the shell.
  signal openRequested()


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
        text: root.store && root.store.filePath.length > 0
          ? root.store.filePath.split("/").slice(-1)[0]
          : "No notebook loaded"
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.title
        font.bold: true
      }

      Text {
        visible: !!root.store && root.store.kernelStatus.state.length > 0
        text: root.store
            ? ("kernel: " + root.store.kernelStatus.state
                + (root.store.kernelStatus.language.length > 0
                    ? " (" + root.store.kernelStatus.language + ")"
                    : ""))
            : ""
        color: Color.foreground
        opacity: 0.7
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
      }

      Button {
        text: "Open…"
        onClicked: root.openRequested()
      }

      Button {
        text: "Interrupt"
        enabled: !!root.store && root.store.kernelStatus.state === "busy"
        onClicked: root.store.rpc.invoke("jupyter:interruptKernel", [root.store.filePath],
                                          function () {}, function () {})
      }

      Button {
        text: "Restart"
        enabled: !!root.store && root.store.kernelStatus.state !== ""
        onClicked: root.store.rpc.invoke("jupyter:restartKernel", [root.store.filePath],
                                          function () {}, function () {})
      }

      Button {
        text: "Shutdown"
        enabled: !!root.store && root.store.kernelStatus.state !== ""
        onClicked: root.store.rpc.invoke("jupyter:shutdownKernel", [root.store.filePath],
                                          function () {}, function () {})
      }
    }

    // ---- error banner ----

    Rectangle {
      Layout.fillWidth: true
      visible: !!root.store && root.store.error.length > 0
      color: Color.urgent
      radius: Style.cornerRadius
      implicitHeight: errText.implicitHeight + Style.spacing.md * 2
      Text {
        id: errText
        anchors {
          left: parent.left; right: parent.right
          top: parent.top; margins: Style.spacing.md
        }
        text: root.store ? root.store.error : ""
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        wrapMode: Text.WordWrap
      }
    }

    // ---- cells ----

    ScrollView {
      Layout.fillWidth: true
      Layout.fillHeight: true

      Column {
        width: parent.width
        spacing: Style.spacing.md

        Repeater {
          model: root.store && root.store.notebook ? root.store.notebook.cells : []
          delegate: cellDelegate
        }
      }
    }
  }

  // ---- per-cell delegate --------------------------------------------------

  Component {
    id: cellDelegate

    // Wrapped in a Column so each cell's outputs render below the source.
    Column {
      id: cellItem
      required property int index
      required property var modelData

      width: cellItem.parent ? cellItem.parent.width : 0
      spacing: Style.spacing.xs

      Rectangle {
        width: cellItem.width
        color: Qt.rgba(0, 0, 0, 0)
        border.width: 1
        border.color: cellItem.modelData.kind === "code"
          ? Color.accent : Color.muted
        radius: Style.cornerRadius
        implicitHeight: cellContent.implicitHeight + Style.spacing.md * 2

        Column {
          id: cellContent
          anchors {
            left: parent.left; right: parent.right
            top: parent.top; margins: Style.spacing.md
          }
          spacing: Style.spacing.xs

          // Cell label: "In [3] code" or "Markdown"
          Text {
            text: cellItem.modelData.kind === "code"
              ? ("In ["
                  + (root.store.executionCount[String(cellItem.index)]
                      ? root.store.executionCount[String(cellItem.index)]
                      : "*")
                  + "] code")
              : "Markdown"
            color: Color.foreground
            opacity: 0.6
            font.family: Style.font.family
            font.pixelSize: Style.font.caption
          }

          // Source. We render code as monospace Text, markdown as
          // markdown Text.
          Text {
            width: cellContent.width
            text: cellItem.modelData.source
            color: Color.foreground
            font.family: cellItem.modelData.kind === "code" ? "monospace" : Style.font.family
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.Wrap
            textFormat: cellItem.modelData.kind === "markdown"
              ? Text.MarkdownText : Text.PlainText
          }

          // Run button (code cells only).
          Row {
            visible: cellItem.modelData.kind === "code"
            spacing: Style.spacing.sm

            Button {
              text: "Run"
              onClicked: root.store.executeCell(cellItem.index, cellItem.modelData.source)
            }

            Text {
              text: "["
                  + (root.store.executionCount[String(cellItem.index)]
                      ? root.store.executionCount[String(cellItem.index)]
                      : " ")
                  + "]"
              color: Color.foreground
              opacity: 0.5
              font.family: "monospace"
              font.pixelSize: Style.font.caption
            }
          }
        }
      }

      // Outputs (code cells only).
      Column {
        width: cellItem.width
        spacing: Style.spacing.xs
        visible: cellItem.modelData.kind === "code"
            && root.store.cellOutputs[String(cellItem.index)]
            && root.store.cellOutputs[String(cellItem.index)].length > 0

        Repeater {
          model: root.store.cellOutputs[String(cellItem.index)] || []
          delegate: outputDelegate
        }
      }
    }
  }

  // ---- output delegate ----------------------------------------------------

  Component {
    id: outputDelegate
    Column {
      id: outputCol
      required property var modelData
      width: parent ? parent.width : 0
      spacing: Style.spacing.xs

      Rectangle {
        id: streamBox
        width: parent.width
        visible: outputCol.modelData.type === "stream" || outputCol.modelData.type === "error"
        color: Qt.rgba(0, 0, 0, 0)
        border.width: 1
        border.color: outputCol.modelData.type === "error" ? Color.urgent : Color.muted
        radius: Style.cornerRadius
        implicitHeight: outText.implicitHeight + Style.spacing.sm * 2

        Text {
          id: outText
          anchors {
            left: parent.left; right: parent.right
            top: parent.top; margins: Style.spacing.sm
          }
          text: outputCol.modelData.type === "error"
            ? (outputCol.modelData.ename + ": " + outputCol.modelData.evalue
                + (Array.isArray(outputCol.modelData.traceback) && outputCol.modelData.traceback.length > 0
                    ? "\n" + outputCol.modelData.traceback.join("\n")
                    : ""))
            : (outputCol.modelData.text || "")
          color: outputCol.modelData.type === "error" ? Color.urgent : Color.foreground
        }
      }

      // execute_result / display_data: image outputs.
      Item {
        id: imageItem
        width: parent.width
        implicitHeight: imageItem.imageOutput ? 240 : 0
        visible: (outputCol.modelData.type === "execute_result" || outputCol.modelData.type === "display_data")

        property string pngData: {
          if (!outputCol.modelData || !outputCol.modelData.data) return ""
          if (typeof outputCol.modelData.data["image/png"] === "string") {
            return "data:image/png;base64," + outputCol.modelData.data["image/png"]
          }
          return ""
        }
        property bool imageOutput: pngData.length > 0

        Image {
          anchors { left: parent.left; top: parent.top }
          source: imageItem.pngData
          fillMode: Image.PreserveAspectFit
          width: parent.width
          height: 240
          visible: imageItem.imageOutput
        }

        Text {
          visible: !imageItem.imageOutput
          anchors { left: parent.left; top: parent.top }
          text: JSON.stringify(outputCol.modelData.data || {})
          color: Color.foreground
          opacity: 0.6
          font.family: "monospace"
          font.pixelSize: Style.font.caption
          wrapMode: Text.Wrap
          width: parent.width
        }

      // status / ready: kernel state chip.
      Text {
        visible: outputCol.modelData.type === "status" || outputCol.modelData.type === "ready"
        text: "kernel: " + (outputCol.modelData.state || "")
        color: Color.foreground
        opacity: 0.5
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
      }

      // unknown: show the JSON so the chunk shape is visible.
      Text {
        visible: outputCol.modelData.type === "unknown"
        text: typeof outputCol.modelData.raw === "string" ? outputCol.modelData.raw : JSON.stringify(outputCol.modelData)
        color: Color.urgent
        opacity: 0.7
        font.family: "monospace"
        font.pixelSize: Style.font.caption
        wrapMode: Text.Wrap
        width: parent.width
      }
    }
  }
  }
}
