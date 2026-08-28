pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import qs.Commons
import qs.Ui
import "../lib/piUi.js" as PiUi


// The modal dialog for pi:uiRequest pushes.
//
// In practice ONLY method:'editor' is emitted today — ompApprovalBridge.ts:306
// is the sole emitPIUIRequest call site, and the only method it passes is
// 'editor'. 'select' and 'confirm' map to tool_approval / ask_user stream
// chunks instead (ompApprovalBridge.ts:243-298). So this modal builds
// 'editor' FIRST and gets it right, then handles 'select'/'confirm'/'input'
// for completeness in case the server ever starts emitting them.
//
// A dismissed modal ALWAYS sends {cancelled: true} via the store's
// dismissCurrent() — see PiUiStore.qml. Otherwise the omp responder would
// hang the turn until cancelPendingPIUI.
//
// Mounted by App.qml on a top-level item that sits ABOVE both the
// FloatingWindow and the PanelWindow content, so the modal can appear
// over either surface.
Item {
  id: root

  required property var store   // PiUiStore

  // Scrim + dialog card. Hidden when no request is active.
  visible: root.store && root.store.activeRequest !== null

  // Block input on the rest of the window. Clicks on the scrim dismiss;
  // clicks inside the card do nothing (so typing in the editor doesn't
  // dismiss by accident).
  MouseArea {
    anchors.fill: parent
    onClicked: root.store.dismissCurrent()
  }

  BorderSurface {
    id: card
    anchors.centerIn: parent
    width: Math.min(720, parent.width * 0.8)
    height: cardLayout.implicitHeight + Style.spacing.lg * 2
    radius: Style.cornerRadius
    color: Color.popups.background
    borderSpec: Border.flat(Color.popups.border, 2)

    // Absorb clicks inside the card so the scrim's onClicked doesn't fire.
    MouseArea { anchors.fill: parent }

    ColumnLayout {
      id: cardLayout
      anchors {
        left: parent.left; right: parent.right
        top: parent.top; margins: Style.spacing.lg
      }
      spacing: Style.spacing.md

      // ---- title row ----

      Text {
        Layout.fillWidth: true
        text: root._described().title || ""
        color: Color.popups.text
        font.family: Style.font.family
        font.pixelSize: Style.font.title
        font.bold: true
      }

      // ---- method body ----

      // editor: multi-line input prefilled with `prefill`.
      Loader {
        id: editorAreaLoader
        Layout.fillWidth: true
        Layout.preferredHeight: 280
        active: root._described().kind === "editor"
        sourceComponent: editorBody
      }

      // select: one button per option.
      Loader {
        Layout.fillWidth: true
        active: root._described().kind === "select"
        sourceComponent: selectBody
      }

      // confirm: yes / no buttons.
      Loader {
        Layout.fillWidth: true
        active: root._described().kind === "confirm"
        sourceComponent: confirmBody
      }

      Loader {
        id: inputFieldLoader
        Layout.fillWidth: true
        active: root._described().kind === "input"
        sourceComponent: inputBody
      }

      // custom: a PiUINode tree rendered through PiUINode.qml.
      Loader {
        Layout.fillWidth: true
        Layout.preferredHeight: 220
        active: root._described().kind === "custom"
        sourceComponent: customBody
      }

      // unknown / custom_tui: show a JSON dump so the bug is visible.
      // custom_tui is intentionally not rendered (no emitter), but if it
      // does somehow arrive, we degrade gracefully.
      Loader {
        Layout.fillWidth: true
        active: root._described().kind === "unknown"
        sourceComponent: unknownBody
      }

      // ---- action row ----

      Row {
        Layout.fillWidth: true
        spacing: Style.spacing.md

        Item { Layout.fillWidth: true }

        Button {
          text: "Cancel"
          onClicked: root.store.dismissCurrent()
        }

        // The "submit" button is the only one that varies by method —
        // editor / input / custom call it Save / Submit, confirm is OK,
        // select does not need it (each option is its own button).
        Button {
          text: root._submitLabel()
          visible: {
            var k = root._described().kind
            return k === "editor" || k === "input" || k === "custom"
          }
          onClicked: root._submit()
        }
      }
    }
  }
  // ---- described payload helpers -----------------------------------------

  // Recompute the lib/piUi.describeRequest output. Called as a function
  // from bindings so the activeRequest property change triggers a fresh
  // evaluation. Bindings cache `activeRequest`; the function call ensures
  // a stale snapshot is never displayed.
  function _described() {
    if (!root.store || !root.store.activeRequest) {
      return { kind: "unknown", title: "", prefill: "", options: [], message: "", placeholder: "", node: null }
    }
    return PiUi.describeRequest(root.store.activeRequest)
  }

  function _submitLabel() {
    var k = root._described().kind
    if (k === "input") return "Submit"
    return "Save"
  }
  function _editorText() {
    var l = editorAreaLoader.item
    return l && l.currentText !== undefined ? l.currentText : ""
  }
  function _inputText() {
    var l = inputFieldLoader.item
    return l && l.currentText !== undefined ? l.currentText : ""
  }
  function _submit() {
    var k = root._described().kind
    if (k === "editor") {
      root.store.answerCurrent({ submitted: true, value: root._editorText() })
    } else if (k === "input") {
      root.store.answerCurrent({ submitted: true, value: root._inputText() })
    } else if (k === "custom") {
      // custom dialogs: the PiUINode may itself have a button that
      // signals back via PiUIChrome's buttonClicked; for the simple
      // case we forward an empty value. If an extension needs richer
      // answers it can use editor / input instead.
      root.store.answerCurrent({ submitted: true, value: "" })
    } else {
      root.store.dismissCurrent()
    }
  }

  // ---- bodies -------------------------------------------------------------

  Component {
    id: editorBody
    Rectangle {
      id: editorBox
      color: Color.background
      border.width: 1
      border.color: Color.muted
      radius: Style.cornerRadius
      // Exposed so the outer _submit() can read the current value
      // without traversing into the ScrollView (qmllint would flag any
      // unqualified id reach into this Component's scope).
      property string currentText: ""
      ScrollView {
        anchors.fill: parent
        anchors.margins: Style.spacing.sm

        TextArea {
          id: editorArea
          text: root._described().prefill || ""
          color: Color.foreground
          font.family: "monospace"
          font.pixelSize: Style.font.body
          wrapMode: TextEdit.NoWrap
          selectByMouse: true
          onTextChanged: editorBox.currentText = text
        }
      }
    }
  }

  Component {
    id: selectBody
    ColumnLayout {
      spacing: Style.spacing.sm
      width: parent ? parent.width : 0
      Repeater {
        model: root._described().options || []
        delegate: Button {
          required property string modelData
          Layout.fillWidth: true
          text: modelData
          onClicked: root.store.answerCurrent({ submitted: true, value: modelData })
        }
      }
    }
  }

  Component {
    id: confirmBody
    Column {
      spacing: Style.spacing.sm
      Text {
        text: root._described().message || ""
        color: Color.popups.text
        font.family: Style.font.family
        font.pixelSize: Style.font.body
        wrapMode: Text.WordWrap
      }
      Row {
        spacing: Style.spacing.md
        Button {
          text: "No"
          onClicked: root.store.answerCurrent({ submitted: false })
        }
        Button {
          text: "Yes"
          onClicked: root.store.answerCurrent({ submitted: true })
        }
      }
    }
  }

  Component {
    id: inputBody
    Item {
      id: inputBox
      property string currentText: ""
      implicitWidth: inputField.implicitWidth
      implicitHeight: inputField.implicitHeight
      TextField {
        id: inputField
        placeholderText: root._described().placeholder || ""
        width: inputBox.width
        onTextChanged: inputBox.currentText = text
      }
    }
  }

  Component {
    id: customBody
    PiUINode {
      node: root._described().node
    }
  }

  Component {
    id: unknownBody
    Text {
      text: "Unsupported dialog: " + JSON.stringify(root.store ? root.store.activeRequest || {} : {})
      color: Color.urgent
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
    }
  }
}
