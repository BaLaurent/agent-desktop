pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

// Macros category — list + form. Mirrors MacrosSettings.tsx.
//
// Each macro is `{ name, description, messages }`. Editing one must
// invalidate the slash-command cache the chat input holds. The store
// fires `changed()` after every save and delete; Main wires that
// against ChatInput._loadCommands() so the popup reloads without a
// full remount.
//
// The form fields: name (required), description (optional), messages
// (one per line). The save call is `macros:save(name, description,
// messages, oldName?)`; on edit the form passes both name and oldName
// so the server knows it's a rename.
Item {
  id: root

  required property var store

  // The macro currently being edited. Null when adding a new one.
  property var editingMacro: null
  property bool isEdit: false

  // Form fields
  property string formName: ""
  property string formDescription: ""
  property string formMessagesText: ""

  // Macro name pattern (the server enforces `^[a-zA-Z0-9_-]+$`).
  // The form rejects names that don't match before posting.
  function _validName(s) {
    return typeof s === "string" && /^[a-zA-Z0-9_-]+$/.test(s) && s.length > 0 && s.length <= 64
  }

  function _open(macro) {
    editingMacro = macro
    isEdit = macro !== null && macro !== undefined
    if (isEdit) {
      formName = macro.name || ""
      formDescription = macro.description || ""
      formMessagesText = Array.isArray(macro.messages) ? macro.messages.join("\n") : ""
    } else {
      formName = ""
      formDescription = ""
      formMessagesText = ""
    }
  }

  function _close() {
    editingMacro = null
    isEdit = false
    formName = ""
    formDescription = ""
    formMessagesText = ""
  }

  function _save() {
    if (!_validName(formName)) return
    var messages = formMessagesText.split("\n").map(function (s) { return String(s).trim() }).filter(function (s) { return s.length > 0 })
    if (messages.length === 0) return
    var desc = String(formDescription || "").slice(0, 500)
    if (isEdit) {
      root.store.save(formName, desc, messages, editingMacro.name, function () { root._close() })
    } else {
      root.store.save(formName, desc, messages, null, function () { root._close() })
    }
  }

  function _delete(macro) {
    root.store.remove(macro.name)
  }

  // The page mounts this in a Loader that sets only `width`, so the Loader
  // adopts this item's implicitHeight. Without it the item is zero-high and the
  // entire body is clipped away — which is what made every settings category
  // render blank.
  implicitHeight: bodyCol.implicitHeight

  Column {
    id: bodyCol
    anchors { left: parent.left; right: parent.right }
    spacing: Style.spacing.md

    Row {
      width: parent.width
      spacing: Style.spacing.md

      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: "Macros"
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.subtitle
        font.weight: Font.DemiBold
      }

      Item { width: parent.width - addBtn.width - parent.spacing }

      Button {
        id: addBtn
        text: "Add"
        bordered: true
        onClicked: root._open(null)
      }
    }

    Text {
      width: parent.width
      text: "Sequences of messages sent in burst via /name. Stored under ~/.agent-desktop/macros."
      color: Color.muted
      opacity: 0.7
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
    }

    Text {
      visible: !root.store.loaded
      text: "Loading…"
      color: Color.muted
      opacity: 0.6
      font.family: Style.font.family
      font.pixelSize: Style.font.body
    }

    Text {
      visible: root.store.loaded && root.store.macros.length === 0
      text: "No macros yet."
      color: Color.muted
      opacity: 0.7
      font.family: Style.font.family
      font.pixelSize: Style.font.body
    }

    Repeater {
      model: root.store.macros
      delegate: Row {
        id: macroRow
        required property var modelData
        width: parent.width
        spacing: Style.spacing.md

        Column {
          width: parent.width * 0.6
          spacing: 0

          Text {
            width: parent.width
            text: macroRow.modelData ? ("/" + (macroRow.modelData.name || "")) : ""
            color: Color.foreground
            font.family: "monospace"
            font.pixelSize: Style.font.body
            font.weight: Font.Medium
          }
          Text {
            width: parent.width
            text: macroRow.modelData ? (macroRow.modelData.description || "") : ""
            color: Color.muted
            opacity: 0.7
            font.family: Style.font.family
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
            visible: macroRow.modelData && macroRow.modelData.description && macroRow.modelData.description.length > 0
          }
        }

        Item { width: parent.width * 0.05 }

        Row {
          width: parent.width * 0.35
          spacing: Style.spacing.xs

          Button {
            text: "Edit"
            bordered: true
            onClicked: root._open(macroRow.modelData)
          }
          Button {
            text: "Del"
            bordered: true
            onClicked: root._delete(macroRow.modelData)
          }
        }
      }
    }

    // ---- form (inline) --------------------------------------------

    Item {
      visible: root.editingMacro !== null || (root.formName.length > 0 && !root.isEdit)
      width: parent.width
      height: formCol.implicitHeight

      Column {
        id: formCol
        width: parent.width
        spacing: Style.spacing.md

        Text {
          text: root.isEdit ? "Edit Macro" : "Add Macro"
          color: Color.foreground
          font.family: Style.font.family
          font.pixelSize: Style.font.subtitle
          font.weight: Font.DemiBold
        }

        TextField {
          id: nameField
          width: parent.width
          text: root.formName
          placeholderText: "Name (letters, digits, dash, underscore)"
          onEditingFinished: root.formName = text
        }

        TextField {
          id: descField
          width: parent.width
          text: root.formDescription
          placeholderText: "Description (optional)"
          onEditingFinished: root.formDescription = text
        }

        Text {
          text: "Messages (one per line)"
          color: Color.muted
          opacity: 0.7
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
        }

        ScrollView {
          width: parent.width
          height: Style.spacing.controlHeight * 6

          TextArea {
            id: messagesArea
            width: parent.width
            text: root.formMessagesText
            placeholderText: "First line sent immediately; later lines queued."
            onTextChanged: root.formMessagesText = text
            wrapMode: TextArea.Wrap
          }
        }

        Row {
          width: parent.width
          spacing: Style.spacing.md

          Button {
            text: "Save"
            bordered: true
            enabled: root._validName(root.formName)
              && root.formMessagesText.split("\n").some(function (s) { return String(s).trim().length > 0 })
            onClicked: root._save()
          }
          Button {
            text: "Cancel"
            bordered: true
            onClicked: root._close()
          }
        }
      }
    }
  }
}