pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

// MCP Servers category — list + form.
//
// One row per server: name, transport badge, status dot, command/url
// preview, Test / On-Off / Edit / Del buttons. Clicking Edit opens an
// inline form below the list (the renderer uses a modal — we use an
// inline pane because the QML layout already has a sidebar rail and an
// inline form keeps the page on one screen).
//
// The form fields follow McpServerConfig: name, type, then either
// stdio (command + args + env) or http/sse (url + headers). Args comes
// in as a parsed array from the store; env/headers come as
// `Array<{key,value}>` rows.
//
// Test button calls mcp:testConnection(id) (CONTRACTS.md §9: id
// required, not config). The store sets the loading state on click
// and the result lands in `testResults[id]` as `{success, output}`.
//
// IMPORTANT: when the form is in "add" mode (no id), the Test button
// is disabled with a hint to save first.
Item {
  id: root

  required property var store

  // Form state — owned here, not in the store, because the store's
  // shape is the persisted server and this form is mid-edit.
  property bool formOpen: false
  property var editingServer: null
  property bool isEdit: false

  // Form fields
  property string formName: ""
  property string formType: "stdio"
  property string formCommand: ""
  property var formArgs: []
  property string formArgInput: ""
  property var formEnv: []
  property string formUrl: ""
  property var formHeaders: []

  property string formStatus: ""

  // ---- form helpers -------------------------------------------------

  function _open(server) {
    editingServer = server
    isEdit = server !== null && server !== undefined
    if (isEdit) {
      formName = server.name || ""
      formType = server.type || "stdio"
      formCommand = server.command || ""
      formArgs = Array.isArray(server.args) ? server.args.slice() : []
      formEnv = Array.isArray(server.env) ? server.env.slice() : []
      formUrl = server.url || ""
      formHeaders = Array.isArray(server.headers) ? server.headers.slice() : []
    } else {
      formName = ""
      formType = "stdio"
      formCommand = ""
      formArgs = []
      formEnv = []
      formUrl = ""
      formHeaders = []
    }
    formArgInput = ""
    formStatus = ""
    formOpen = true
  }

  function _close() {
    formOpen = false
    editingServer = null
    isEdit = false
    formStatus = ""
  }

  function _buildConfig() {
    var cfg = {
      name: formName.trim(),
      type: formType
    }
    if (formType === "stdio") {
      cfg.command = formCommand.trim()
      // args come from `formArgs` directly (one item per row).
      cfg.args = []
      for (var i = 0; i < formArgs.length; i++) cfg.args.push(String(formArgs[i]))
      var envObj = {}
      for (var j = 0; j < formEnv.length; j++) {
        var row = formEnv[j]
        if (row && row.key) envObj[String(row.key)] = String(row.value || "")
      }
      cfg.env = envObj
    } else {
      cfg.url = formUrl.trim()
      var headersObj = {}
      for (var k = 0; k < formHeaders.length; k++) {
        var hrow = formHeaders[k]
        if (hrow && hrow.key) headersObj[String(hrow.key)] = String(hrow.value || "")
      }
      cfg.headers = headersObj
    }
    return cfg
  }

  function _save() {
    if (!formName.trim()) { formStatus = "Name is required."; return }
    if (formType === "stdio" && !formCommand.trim()) { formStatus = "Command is required."; return }
    if (formType !== "stdio" && !formUrl.trim()) { formStatus = "URL is required."; return }
    var cfg = _buildConfig()
    if (isEdit) {
      root.store.updateServer(editingServer.id, cfg, function () { root._close() },
        function (err) { root.formStatus = "Save failed: " + String(err) })
    } else {
      root.store.addServer(cfg, function () { root._close() },
        function (err) { root.formStatus = "Save failed: " + String(err) })
    }
  }

  function _test() {
    // CONTRACTS.md §9: testConnection takes a persisted id. Save first
    // if the form is a draft.
    if (!isEdit) {
      formStatus = "Save the server before testing."
      return
    }
    root.store.testConnection(editingServer.id, null,
      function (err) { formStatus = "Test failed: " + String(err) })
  }

  function _addArg() {
    var v = String(formArgInput || "").trim()
    if (!v) return
    var next = formArgs.slice()
    next.push(v)
    formArgs = next
    formArgInput = ""
  }

  function _removeArg(index) {
    var next = formArgs.slice()
    if (index < 0 || index >= next.length) return
    next.splice(index, 1)
    formArgs = next
  }

  function _addEnv() { formEnv = formEnv.concat([{ key: "", value: "" }]) }
  function _removeEnv(index) {
    var next = formEnv.slice()
    next.splice(index, 1)
    formEnv = next
  }

  function _addHeader() { formHeaders = formHeaders.concat([{ key: "", value: "" }]) }
  function _removeHeader(index) {
    var next = formHeaders.slice()
    next.splice(index, 1)
    formHeaders = next
  }

  // ---- list rendering ----------------------------------------------

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
        text: "MCP Servers"
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.subtitle
        font.weight: Font.DemiBold
      }

      Item { width: parent.width - addBtn.width - parent.spacing }

      Button {
        id: addBtn
        text: "Add Server"
        bordered: true
        onClicked: root._open(null)
      }
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
      visible: root.store.loaded && root.store.servers.length === 0
      text: "No servers configured."
      color: Color.muted
      opacity: 0.7
      font.family: Style.font.family
      font.pixelSize: Style.font.body
    }

    Repeater {
      model: root.store.servers
      delegate: Item {
        id: rowItem
        required property var modelData
        width: parent.width
        height: rowLayout.implicitHeight + Style.spacing.sm

        Column {
          id: rowLayout
          width: parent.width
          spacing: Style.spacing.sm

          Row {
            width: parent.width
            spacing: Style.spacing.md

            Rectangle {
              width: Style.spacing.sm
              height: Style.spacing.sm
              radius: width / 2
              anchors.verticalCenter: parent.verticalCenter
              color: {
                if (!rowItem.modelData) return Color.muted
                var s = rowItem.modelData.status
                if (s === "configured") return Color.accent
                if (s === "error") return Color.urgent
                return Color.muted
              }
            }

            Column {
              anchors.verticalCenter: parent.verticalCenter
              width: parent.width * 0.45
              spacing: 0

              Text {
                width: parent.width
                text: rowItem.modelData ? (rowItem.modelData.name || "") : ""
                color: Color.foreground
                font.family: Style.font.family
                font.pixelSize: Style.font.body
                font.weight: Font.Medium
                elide: Text.ElideRight
              }
              Text {
                width: parent.width
                text: {
                  if (!rowItem.modelData) return ""
                  var t = rowItem.modelData.type || "stdio"
                  if (t === "stdio") return (rowItem.modelData.command || "")
                  return (rowItem.modelData.url || "")
                }
                color: Color.muted
                opacity: 0.7
                font.family: Style.font.family
                font.pixelSize: Style.font.bodySmall
                elide: Text.ElideRight
              }
            }

            Item { width: parent.width * 0.05 }

            Row {
              width: parent.width * 0.45
              spacing: Style.spacing.xs

              Button {
                text: root.store.testingId === (rowItem.modelData ? rowItem.modelData.id : -1)
                  ? "Testing…" : "Test"
                bordered: true
                onClicked: root.store.testConnection(rowItem.modelData.id)
              }
              Button {
                text: rowItem.modelData && rowItem.modelData.enabled === 1 ? "On" : "Off"
                bordered: true
                onClicked: root.store.toggleServer(rowItem.modelData.id)
              }
              Button {
                text: "Edit"
                bordered: true
                onClicked: root._open(rowItem.modelData)
              }
              Button {
                text: "Del"
                bordered: true
                onClicked: root.store.removeServer(rowItem.modelData.id)
              }
            }
          }

          // Test result panel
          Item {
            width: parent.width
            height: resultCol.implicitHeight
            visible: rowItem.modelData && root.store.testResults[String(rowItem.modelData.id)] !== undefined

            Column {
              id: resultCol
              width: parent.width
              spacing: Style.spacing.xs

              Row {
                width: parent.width
                spacing: Style.spacing.md

                Text {
                  width: parent.width - dismissBtn.width - Style.spacing.md
                  text: {
                    if (!rowItem.modelData) return ""
                    var r = root.store.testResults[String(rowItem.modelData.id)]
                    if (!r || r.loading) return ""
                    return r.success ? "Connection OK" : "Connection Failed"
                  }
                  color: {
                    if (!rowItem.modelData) return Color.foreground
                    var r = root.store.testResults[String(rowItem.modelData.id)]
                    if (!r || r.loading) return Color.foreground
                    return r.success ? Color.accent : Color.urgent
                  }
                  font.family: Style.font.family
                  font.pixelSize: Style.font.bodySmall
                  font.weight: Font.DemiBold
                }
                Button {
                  id: dismissBtn
                  text: "Dismiss"
                  bordered: true
                  onClicked: root.store.clearTestResult(rowItem.modelData.id)
                }
              }

              Text {
                visible: rowItem.modelData && root.store.testResults[String(rowItem.modelData.id)]
                  && !root.store.testResults[String(rowItem.modelData.id)].loading
                width: parent.width
                text: rowItem.modelData && root.store.testResults[String(rowItem.modelData.id)]
                  ? (root.store.testResults[String(rowItem.modelData.id)].output || "")
                  : ""
                color: Color.muted
                opacity: 0.85
                font.family: "monospace"
                font.pixelSize: Style.font.bodySmall
                wrapMode: Text.WrapAnywhere
              }
            }
          }
        }
      }
    }

    // ---- form (inline) --------------------------------------------

    Item {
      visible: root.formOpen
      width: parent.width
      height: formCol.implicitHeight

      Column {
        id: formCol
        width: parent.width
        spacing: Style.spacing.md

        Text {
          text: root.isEdit ? "Edit Server" : "Add Server"
          color: Color.foreground
          font.family: Style.font.family
          font.pixelSize: Style.font.subtitle
          font.weight: Font.DemiBold
        }

        TextField {
          width: parent.width
          text: root.formName
          placeholderText: "Name (e.g. github-mcp)"
          onEditingFinished: root.formName = text
        }

        Row {
          width: parent.width
          spacing: Style.spacing.md

          Repeater {
            model: [{ value: "stdio", label: "stdio" }, { value: "http", label: "HTTP" }, { value: "sse", label: "SSE" }]
            delegate: Button {
              id: typeBtn
              required property var modelData
              text: modelData ? modelData.label : ""
              bordered: true
              selected: root.formType === (modelData ? modelData.value : "")
              onClicked: { if (modelData) root.formType = modelData.value }
            }
          }
        }

        // stdio fields
        Column {
          visible: root.formType === "stdio"
          width: parent.width
          spacing: Style.spacing.xs

          TextField {
            width: parent.width
            text: root.formCommand
            placeholderText: "Command (e.g. node)"
            onEditingFinished: root.formCommand = text
          }

          Text { text: "Arguments"; color: Color.muted; opacity: 0.7; font.family: Style.font.family; font.pixelSize: Style.font.bodySmall }
          Repeater {
            model: root.formArgs
            delegate: Row {
              id: argRow
              required property var modelData
              required property int index
              width: parent.width
              spacing: Style.spacing.xs

              Text {
                width: argRow.width - removeBtn.width - Style.spacing.sm
                text: argRow.modelData
                color: Color.foreground
                font.family: "monospace"
                font.pixelSize: Style.font.bodySmall
                anchors.verticalCenter: parent.verticalCenter
              }
              Button {
                id: removeBtn
                text: "x"
                bordered: true
                onClicked: root._removeArg(argRow.index)
              }
            }
          }
          Row {
            width: parent.width
            spacing: Style.spacing.xs

            TextField {
              id: argInput
              width: parent.width - addArgBtn.width - Style.spacing.xs
              text: root.formArgInput
              placeholderText: "One argument per line / push"
              onEditingFinished: root.formArgInput = text
              onAccepted: root._addArg()
            }
            Button {
              id: addArgBtn
              text: "+"
              bordered: true
              onClicked: root._addArg()
            }
          }

          Text { text: "Environment variables"; color: Color.muted; opacity: 0.7; font.family: Style.font.family; font.pixelSize: Style.font.bodySmall }
          Repeater {
            model: root.formEnv
            delegate: Row {
              id: envRow
              required property var modelData
              required property int index
              width: parent.width
              spacing: Style.spacing.xs

              TextField {
                width: envRow.width * 0.4
                text: envRow.modelData ? envRow.modelData.key : ""
                placeholderText: "KEY"
                onEditingFinished: {
                  var next = root.formEnv.slice()
                  if (next[envRow.index]) next[envRow.index] = { key: text, value: next[envRow.index].value }
                  root.formEnv = next
                }
              }
              TextField {
                width: envRow.width * 0.5
                text: envRow.modelData ? envRow.modelData.value : ""
                placeholderText: "value"
                onEditingFinished: {
                  var next = root.formEnv.slice()
                  if (next[envRow.index]) next[envRow.index] = { key: next[envRow.index].key, value: text }
                  root.formEnv = next
                }
              }
              Button {
                text: "x"
                bordered: true
                onClicked: root._removeEnv(envRow.index)
              }
            }
          }
          Button {
            text: "+ Add env"
            bordered: true
            onClicked: root._addEnv()
          }
        }

        // http/sse fields
        Column {
          visible: root.formType !== "stdio"
          width: parent.width
          spacing: Style.spacing.xs

          TextField {
            width: parent.width
            text: root.formUrl
            placeholderText: "URL (https://…)"
            onEditingFinished: root.formUrl = text
          }

          Text { text: "Headers"; color: Color.muted; opacity: 0.7; font.family: Style.font.family; font.pixelSize: Style.font.bodySmall }
          Repeater {
            model: root.formHeaders
            delegate: Row {
              id: headerRow
              required property var modelData
              required property int index
              width: parent.width
              spacing: Style.spacing.xs

              TextField {
                width: headerRow.width * 0.4
                text: headerRow.modelData ? headerRow.modelData.key : ""
                placeholderText: "Header"
                onEditingFinished: {
                  var next = root.formHeaders.slice()
                  if (next[headerRow.index]) next[headerRow.index] = { key: text, value: next[headerRow.index].value }
                  root.formHeaders = next
                }
              }
              TextField {
                width: headerRow.width * 0.5
                text: headerRow.modelData ? headerRow.modelData.value : ""
                placeholderText: "value"
                onEditingFinished: {
                  var next = root.formHeaders.slice()
                  if (next[headerRow.index]) next[headerRow.index] = { key: next[headerRow.index].key, value: text }
                  root.formHeaders = next
                }
              }
              Button {
                text: "x"
                bordered: true
                onClicked: root._removeHeader(headerRow.index)
              }
            }
          }
          Button {
            text: "+ Add header"
            bordered: true
            onClicked: root._addHeader()
          }
        }

        Text {
          visible: root.formStatus.length > 0
          text: root.formStatus
          color: Color.urgent
          opacity: 0.85
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
        }

        Row {
          width: parent.width
          spacing: Style.spacing.md

          Button {
            text: "Save"
            bordered: true
            onClicked: root._save()
          }
          Button {
            text: "Test"
            bordered: true
            onClicked: root._test()
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