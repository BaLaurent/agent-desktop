pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

import "../../lib/settingsRows.js" as SR

// AI / Model category.
//
// The page renders the SETTING_DEFS rows as a single Repeater — every
// visible def becomes one SettingDefRow. Above the Repeater, four
// hand-written controls the defs cannot describe:
//
//   - The model dropdown refreshes against `models:list(backend)` so the
//     user can pick from the live backend list, falling back to the
//     static options from SETTING_DEFS.
//   - Custom models CRUD (ai_customModels JSON string[]).
//   - The skills discovered via `commands:list(...)` are listed so the
//     user can flip them in/out of `ai_disabledSkills`. The defs carry
//     the dropdown for `ai_skills` (the toggle that decides whether
//     skills load at all) and `ai_disabledSkills` (a JSON array), but
//     they cannot render the list of skill names that the array picks
//     from — that needs a hand-rendered list.
//   - The PI extensions list comes from `pi:listExtensions` (Phase 4.3).
//     Same shape problem; rendered below.
Item {
  id: root

  required property var settingsStore
  required property var rpc
  required property var settingDefs
  required property var backendDisplayNames

  // All SETTING_DEFS rows that apply to the active backend. The page
  // computes this with rowsFor(defs, backend) and assigns it here.
  property var visibleDefs: []

  // Live model list fetched from models:list; merged with the static
  // options so a missing key still shows in the dropdown.
  property var fetchedModels: []

  // Skills discovered from commands:list, filtered for source === "skill".
  property var discoveredSkills: []

  // PI extensions discovered from pi:listExtensions.
  property var piExtensions: []

  // ---- helpers -------------------------------------------------------

  function get(key, fallback) {
    return settingsStore ? settingsStore.get(key, fallback === undefined ? "" : fallback) : (fallback || "")
  }

  function setStr(key, value) {
    if (settingsStore) settingsStore.set(key, value)
  }

  function sdkBackend() { return get("ai_sdkBackend", "claude-agent-sdk") }

  function isClaudeBackend() { return sdkBackend() !== "pi" }

  function parseStringArray(raw) {
    if (!raw) return []
    try { var parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : [] }
    catch (e) { return [] }
  }

  function _optionIndex(def, value) { return SR.optionIndexFor(def, value) }

  function _controlKind(def) { return SR.controlKindFor(def) }

  // ---- live data refresh -------------------------------------------

  function refreshModels() {
    root.rpc.invoke("models:list", [sdkBackend()], function (rows) {
      root.fetchedModels = Array.isArray(rows) ? rows : []
    }, function () { root.fetchedModels = [] })
  }

  function refreshModelsForced() {
    root.rpc.invoke("models:refresh", [sdkBackend()], function (rows) {
      root.fetchedModels = Array.isArray(rows) ? rows : []
    }, function () { root.fetchedModels = [] })
  }

  function refreshSkills() {
    if (!isClaudeBackend()) { root.discoveredSkills = []; return }
    var mode = get("ai_skills", "off")
    if (mode === "off") { root.discoveredSkills = []; return }
    root.rpc.invoke("commands:list", [undefined, mode], function (rows) {
      var out = []
      if (Array.isArray(rows)) {
        for (var i = 0; i < rows.length; i++) {
          if (rows[i] && rows[i].source === "skill") out.push(rows[i])
        }
      }
      root.discoveredSkills = out
    }, function () { root.discoveredSkills = [] })
  }

  function refreshPiExtensions() {
    if (isClaudeBackend()) { root.piExtensions = []; return }
    root.rpc.invoke("pi:listExtensions", [], function (rows) {
      root.piExtensions = Array.isArray(rows) ? rows : []
    }, function () { root.piExtensions = [] })
  }

  // Merge the static MODEL_OPTIONS (from SETTING_DEFS) with the live
  // fetched list. The static list goes first so the canonical ordering
  // is preserved.
  function _mergedModelOptions() {
    var out = []
    var seen = ({})
    for (var i = 0; i < root.visibleDefs.length; i++) {
      var def = root.visibleDefs[i]
      if (def && def.key === "ai_model" && Array.isArray(def.options)) {
        for (var j = 0; j < def.options.length; j++) {
          var opt = def.options[j]
          if (!seen[opt.value]) { out.push(opt); seen[opt.value] = true }
        }
      }
    }
    for (var k = 0; k < root.fetchedModels.length; k++) {
      var mo = root.fetchedModels[k]
      if (mo && !seen[mo.value]) { out.push(mo); seen[mo.value] = true }
    }
    return out
  }

  // ---- custom models CRUD ------------------------------------------

  function customModels() { return parseStringArray(get("ai_customModels", "[]")) }

  function addCustomModel(name) {
    var trimmed = String(name || "").trim()
    if (!trimmed) return
    var list = customModels()
    if (list.indexOf(trimmed) >= 0) return
    var presets = _mergedModelOptions()
    var presetValues = ({})
    for (var i = 0; i < presets.length; i++) presetValues[presets[i].value] = true
    if (presetValues[trimmed]) return
    var next = list.slice()
    next.push(trimmed)
    root.setStr("ai_customModels", JSON.stringify(next))
  }

  function removeCustomModel(name) {
    var list = customModels()
    var idx = list.indexOf(name)
    if (idx < 0) return
    var next = list.slice()
    next.splice(idx, 1)
    root.setStr("ai_customModels", JSON.stringify(next))
    if (get("ai_model", "") === name) {
      root.setStr("ai_model", "claude-sonnet-4-6")
      root.setStr("ai_customModel", "")
    }
  }

  // ---- disabled skills (JSON array) ---------------------------------

  function disabledSkills() { return parseStringArray(get("ai_disabledSkills", "[]")) }

  function toggleDisabledSkill(name) {
    var current = disabledSkills()
    var idx = current.indexOf(name)
    var next = current.slice()
    if (idx >= 0) next.splice(idx, 1)
    else next.push(name)
    root.setStr("ai_disabledSkills", JSON.stringify(next))
  }

  // ---- pi extensions disable list -----------------------------------

  function piDisabledExtensions() { return parseStringArray(get("pi_disabledExtensions", "[]")) }

  function toggleDisabledExtension(name) {
    var current = piDisabledExtensions()
    var idx = current.indexOf(name)
    var next = current.slice()
    if (idx >= 0) next.splice(idx, 1)
    else next.push(name)
    root.setStr("pi_disabledExtensions", JSON.stringify(next))
  }

  // ---- model dropdown handler ---------------------------------------

  function _setModel(value) {
    if (value === "custom") root.setStr("ai_model", "custom")
    else { root.setStr("ai_model", value); root.setStr("ai_customModel", "") }
  }

  // ---- binding: skills overhead -------------------------------------

  // Token-cost read-out next to the skills row. `context:getSkillsOverhead`
  // is the channel; an older server that does not have it leaves the
  // value empty.
  property string skillsOverheadText: ""

  function refreshSkillsOverhead() {
    if (!isClaudeBackend()) { root.skillsOverheadText = ""; return }
    root.rpc.invoke("context:getSkillsOverhead", [], function (result) {
      if (result && typeof result === "object") {
        // Best-effort formatting — the server's shape is open to the
        // renderer AISettings.tsx. Show the tokens if present.
        var tokens = result.tokens !== undefined ? Number(result.tokens) : NaN
        if (!isNaN(tokens)) {
          root.skillsOverheadText = " (token overhead: " + tokens + ")"
        } else {
          root.skillsOverheadText = ""
        }
      } else {
        root.skillsOverheadText = ""
      }
    }, function () { root.skillsOverheadText = "" })
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

    PanelSectionHeader { text: "Identity & backend" }

    Repeater {
      model: root.visibleDefs
      delegate: SettingDefRow {
        id: defRow
        required property var modelData
        width: parent.width
        def: modelData
        kind: root._controlKind(modelData)
        currentValue: modelData && modelData.key ? root.get(modelData.key, "") : ""
        locked: modelData && modelData.key && root.settingsStore
          ? root.settingsStore.isLocked(modelData.key) : false
        lockReason: modelData && modelData.key && root.settingsStore
          ? root.settingsStore.lockReason(modelData.key) : ""
        unknownValue: modelData && modelData.type === "select" && modelData.key
          ? root._optionIndex(modelData, root.get(modelData.key, "")) < 0
          : false
        onValueChanged: function (v) { root.setStr(modelData.key, v) }
      }
    }

    // ---- model dropdown (live list + refresh) ----------------------

    PanelSectionHeader { text: "Model" }

    Row {
      width: parent.width
      spacing: Style.spacing.md

      Dropdown {
        id: modelDropdown
        width: parent.width - refreshBtn.width - Style.spacing.md
        options: root._mergedModelOptions()
        value: {
          var arr = root._mergedModelOptions()
          var cur = root.get("ai_model", "")
          for (var i = 0; i < arr.length; i++) if (arr[i].value === cur) return arr[i].value
          return ""
        }
        onChanged: function (v) {
          if (!v) return
          root._setModel(v)
        }
      }

      Button {
        id: refreshBtn
        text: "Refresh"
        bordered: true
        onClicked: root.refreshModelsForced()
      }
    }

    // ---- custom models CRUD ----------------------------------------

    PanelSectionHeader { text: "Custom models" }

    Column {
      width: parent.width
      spacing: Style.spacing.xs

      Repeater {
        model: root.customModels()
        delegate: Row {
          id: customRow
          required property string modelData
          width: parent.width
          spacing: Style.spacing.md

          Text {
            width: parent.width * 0.7
            anchors.verticalCenter: parent.verticalCenter
            text: customRow.modelData
            color: Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.body
          }

          Button {
            text: "Remove"
            bordered: true
            onClicked: root.removeCustomModel(customRow.modelData)
          }
        }
      }

      Row {
        width: parent.width
        spacing: Style.spacing.sm

        TextField {
          id: customInput
          width: parent.width - addBtn.width - Style.spacing.sm
          placeholderText: "Add a custom model id…"
        }

        Button {
          id: addBtn
          text: "Add"
          bordered: true
          onClicked: {
            root.addCustomModel(customInput.text)
            customInput.text = ""
          }
        }
      }
    }

    // ---- skills + extensions (live lists) --------------------------

    PanelSectionHeader {
      text: root.isClaudeBackend() ? "Skills" : "PI extensions"
    }

    Column {
      visible: root.isClaudeBackend()
      width: parent.width
      spacing: Style.spacing.xs

      Repeater {
        model: root.discoveredSkills
        delegate: Row {
          id: skillRow
          required property var modelData
          width: parent.width
          spacing: Style.spacing.md

          Toggle {
            width: parent.width * 0.4
            label: skillRow.modelData ? skillRow.modelData.name : ""
            checked: {
              if (!skillRow.modelData) return false
              return root.disabledSkills().indexOf(skillRow.modelData.name) < 0
            }
            onClicked: {
              if (!skillRow.modelData) return
              root.toggleDisabledSkill(skillRow.modelData.name)
            }
          }

          Text {
            width: parent.width * 0.6
            anchors.verticalCenter: parent.verticalCenter
            text: skillRow.modelData ? (skillRow.modelData.description || "") : ""
            color: Color.muted
            opacity: 0.7
            font.family: Style.font.family
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }
        }
      }

      Text {
        visible: root.discoveredSkills.length === 0
        text: root.get("ai_skills", "off") === "off"
          ? "Skills are off — set a Setting Source above to discover."
          : "No skills discovered for the current scope."
        color: Color.muted
        opacity: 0.7
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
      }

      Text {
        text: root.skillsOverheadText
        color: Color.muted
        opacity: 0.7
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
      }
    }

    Column {
      visible: !root.isClaudeBackend()
      width: parent.width
      spacing: Style.spacing.xs

      Repeater {
        model: root.piExtensions
        delegate: Row {
          id: extRow
          required property var modelData
          width: parent.width
          spacing: Style.spacing.md

          Toggle {
            width: parent.width * 0.4
            label: extRow.modelData ? (extRow.modelData.name || "") : ""
            checked: {
              if (!extRow.modelData) return false
              return root.piDisabledExtensions().indexOf(extRow.modelData.name) < 0
            }
            onClicked: {
              if (!extRow.modelData) return
              root.toggleDisabledExtension(extRow.modelData.name)
            }
          }

          Text {
            width: parent.width * 0.6
            anchors.verticalCenter: parent.verticalCenter
            text: extRow.modelData ? (extRow.modelData.path || "") : ""
            color: Color.muted
            opacity: 0.7
            font.family: Style.font.family
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }
        }
      }

      Text {
        visible: root.piExtensions.length === 0
        text: "No PI extensions discovered."
        color: Color.muted
        opacity: 0.7
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
      }
    }
  }
}