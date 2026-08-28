pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls

import qs.Commons
import qs.Ui

import "../lib/palette.js" as Palette
import "../generated/settingDefs.js" as SettingDefs

// The chip row above the chat input — model picker, permission mode,
// MCP servers, KB collections, context token readout. Mirrors
// ChatStatusLine.tsx in the renderer.
//
// Each control writes through the per-conversation cascade:
//   - models:            settings:set         (global default)
//   - permission mode:   settings:set         (global default)
//   - MCP toggle:        conversations:update -> ai_mcpDisabled
//   - KB toggle:         conversations:update -> ai_knowledgeFolders
//   - context readout:   read-only (from context:getBreakdown)
//
// Backend choice is a global setting; this widget does NOT expose it.
//
// Implementation note: qs.Ui's `PopupCard` is a layer-shell PopupWindow
// (it lives outside the FloatingWindow's content tree and cannot be
// anchored against in-window ids), so the four menus use the in-window
// `Dropdown` / `SearchableDropdown` / `MultiSelect` primitives that ship
// with the kit. Those primitives own their own popups and the click-
// outside dismissal that goes with them.
Item {
  id: root

  required property var store           // ChatStore
  required property var settingsStore   // SettingsStore
  required property var conversationsStore  // Phase 3 store; passed in via Main

  // Effective AI settings — read via the cascade (Conversation > Folder > Global).
  //
  // Guarded because these three evaluate at CONSTRUCTION, and App.qml passes
  // `settingsStore: service ? service.settingsStore : null` — the shell injects
  // `service` after the item exists, so the first pass always sees null. The
  // fallbacks repeat each `get()` default so the displayed value is the same
  // one the store would have returned, rather than an empty chip.
  property string effectiveModel: root.settingsStore
    ? root.settingsStore.get("ai_model", "") : ""
  property string effectivePermission: root.settingsStore
    ? root.settingsStore.get("ai_permissionMode", "default") : "default"
  property string effectiveBackend: root.settingsStore
    ? root.settingsStore.get("ai_sdkBackend", "claude-agent-sdk") : "claude-agent-sdk"

  // Context tokens (read-only).
  property var contextTokens: null  // { used, total }

  // Live data — refreshed by Main through the public loaders below.
  property var _models: []
  property var _mcpServers: []
  property var _kbCollections: []
  property bool _loaded: false

  // Per-conversation AI overrides — written by Main when active conversation changes.
  property var convOverrides: ({})

  // Refresh the model list / mcp / kb / context for the current conversation.
  function load() {
    if (!store || !store.rpc) return
    store.rpc.invoke("models:list", [effectiveBackend],
      function (result) {
        root._models = Array.isArray(result) ? result : []
        // Merge the user's custom models from the global setting.
        try {
          var custom = JSON.parse(settingsStore.get("customModels", "[]"))
          if (Array.isArray(custom)) {
            for (var i = 0; i < custom.length; i++) {
              root._models = root._models.concat([{ id: custom[i], name: custom[i] }])
            }
          }
        } catch (e) { /* ignore */ }
      }, function () {})
    store.rpc.invoke("mcp:listServers", [], function (result) {
      root._mcpServers = Array.isArray(result) ? result : []
    }, function () {})
    store.rpc.invoke("kb:listCollections", [], function (result) {
      root._kbCollections = Array.isArray(result) ? result : []
    }, function () {})
    if (store.contextDisplay && store.contextDisplay.breakdown) {
      contextTokens = store.contextDisplay.breakdown
    }
    root._loaded = true
  }

  // Cascade read of an override key: conversation, then its folder, then the
  // global setting. Two things were wrong here and both were silent.
  //
  //   1. `folderOverrides` was hardcoded to `{}`, so the FOLDER tier of the
  //      cascade could never contribute. A user setting an override on a
  //      folder saw no effect and nothing said why. `Folder.ai_overrides`
  //      exists (src/core/types/types.ts:87) and is already loaded into
  //      `conversationsStore.folders`.
  //   2. The conversation's JSON was parsed inline, duplicating
  //      `SettingsStore.parseOverrides` — which is the tested parser and had
  //      no production caller at all. Two copies of one decision, only one of
  //      them covered.
  function _effectiveOverride(key) {
    // Guarded because this is reached from bindings that evaluate at
    // CONSTRUCTION, and App.qml passes every store as
    // `service ? service.<x>Store : null` — the shell injects `service` after
    // the item exists, so all three are null on the first pass.
    if (!root.store || !root.settingsStore) return ""

    var activeId = root.store.conversationId
    var conv = null
    if (activeId && root.conversationsStore && root.conversationsStore.findById) {
      conv = root.conversationsStore.findById(activeId)
    }

    var convOverrides = root.settingsStore.parseOverrides(conv ? conv.ai_overrides : null)

    // Walk to the conversation's folder. Only the DIRECT parent folder is
    // consulted, matching `SettingsStore.effective`'s two-tier signature —
    // inventing a recursive walk up `parent_id` here would change the
    // documented cascade without the store agreeing to it.
    var folderOverrides = ({})
    var folderId = conv && conv.folder_id !== undefined && conv.folder_id !== null
      ? Number(conv.folder_id)
      : 0
    if (folderId > 0 && conversationsStore && conversationsStore.folders) {
      var all = conversationsStore.folders
      for (var i = 0; i < all.length; i++) {
        if (all[i] && Number(all[i].id) === folderId) {
          folderOverrides = settingsStore.parseOverrides(all[i].ai_overrides)
          break
        }
      }
    }

    return settingsStore.effective(convOverrides, folderOverrides, key)
  }

  // ---- callbacks ----

  function _setModel(modelId) {
    settingsStore.set("ai_model", modelId)
  }
  function _setPermission(mode) {
    settingsStore.set("ai_permissionMode", mode)
  }
  function _toggleMcp(name, checked) {
    if (!root.store || !root.store.conversationId) return
    var current = root._effectiveOverride("ai_mcpDisabled")
    var arr
    try { arr = current ? JSON.parse(current) : [] } catch (e) { arr = [] }
    var idx = arr.indexOf(name)
    if (checked) {
      if (idx >= 0) arr.splice(idx, 1)
    } else {
      if (idx < 0) arr.push(name)
    }
    var raw = ""
    if (conversationsStore && conversationsStore.findById) {
      var conv = conversationsStore.findById(root.store.conversationId)
      if (conv) raw = conv.ai_overrides || ""
    }
    var overrides = {}
    try { overrides = raw ? JSON.parse(raw) : {} } catch (e) { overrides = {} }
    overrides.ai_mcpDisabled = JSON.stringify(arr)
    root.store.rpc.invoke(
      "conversations:update",
      [root.store.conversationId, { ai_overrides: JSON.stringify(overrides) }],
      function () { /* Conversation reload happens via the event */ },
      function (err) { root.store.error = String(err) }
    )
  }
  function _toggleKb(name, checked) {
    if (!root.store || !root.store.conversationId) return
    var current = root._effectiveOverride("ai_knowledgeFolders")
    var arr
    try { arr = current ? JSON.parse(current) : [] } catch (e) { arr = [] }
    var idx = -1
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].folder === name) { idx = i; break }
    }
    if (checked) {
      if (idx >= 0) arr.splice(idx, 1)
    } else {
      if (idx < 0) arr.push({ folder: name, access: "read" })
    }
    var raw = ""
    if (conversationsStore && conversationsStore.findById) {
      var conv = conversationsStore.findById(root.store.conversationId)
      if (conv) raw = conv.ai_overrides || ""
    }
    var overrides = {}
    try { overrides = raw ? JSON.parse(raw) : {} } catch (e) { overrides = {} }
    overrides.ai_knowledgeFolders = JSON.stringify(arr)
    root.store.rpc.invoke(
      "conversations:update",
      [root.store.conversationId, { ai_overrides: JSON.stringify(overrides) }],
      function () {},
      function (err) { root.store.error = String(err) }
    )
  }

  // ---- context token formatter ----

  function _formatTokens(n) {
    if (n === null || n === undefined) return "?"
    if (n < 1000) return String(n)
    var k = n / 1000
    if (k >= 100) return Math.round(k) + "k"
    return k.toFixed(1) + "k"
  }

  function _contextPct() {
    if (!root.contextTokens || !root.contextTokens.total || !root.contextTokens.used) return null
    return Math.min(100, Math.round((root.contextTokens.used / root.contextTokens.total) * 100))
  }
  // Three theme-derived steps: accent (< 50%) -> derived warning (50–80%) -> urgent (>= 80%).
  function _contextColor(pct) {
    if (pct < 50) return Color.accent
    if (pct < 80) return Palette.warningColor(String(Color.accent), String(Color.urgent))
    return Color.urgent
  }

  // Permission-mode label lookup from the generated defs.
  function _permissionLabel(value) {
    var opts = SettingDefs.PERMISSION_OPTIONS || []
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].value === value) return opts[i].label
    }
    return value
  }

  // A parent that mounts this with width only (a Column row, a ListView
  // delegate, a Loader) adopts the item's implicitHeight. Without it the root
  // Item is zero-high and the whole body is invisible — which is how assistant
  // messages vanished from the transcript while the store held them. Ignored
  // when a parent sets an explicit height, so it is safe everywhere.
  implicitHeight: bodyRoot.implicitHeight

  Row {
    id: bodyRoot
    spacing: Style.spacing.sm
    anchors { left: parent.left; right: parent.right }

    // Model picker — SearchableDropdown is the natural fit for the
    // model list (it has a filter field built in).
    SearchableDropdown {
      width: 260
      value: root.effectiveModel
      options: root._models.map(function (m) {
        return { value: m.id || m.name, label: m.name || m.id || "" }
      })
      placeholderText: "Model"
      onChanged: function (v) { root._setModel(v) }
    }

    Text { text: "·"; color: Color.muted; opacity: 0.5; anchors.verticalCenter: parent.verticalCenter }

    // Permission mode picker — a single-select Dropdown is enough here.
    Dropdown {
      width: 200
      value: root.effectivePermission
      options: SettingDefs.PERMISSION_OPTIONS || []
      onChanged: function (v) { root._setPermission(v) }
    }

    Text {
      visible: root._mcpServers.length > 0
      text: "·"
      color: Color.muted
      opacity: 0.5
      anchors.verticalCenter: parent.verticalCenter
    }

    // MCP server toggle — MultiSelect is the qs.Ui primitive for
    // multi-toggle popup lists.
    MultiSelect {
      visible: root._mcpServers.length > 0
      width: 240
      options: root._mcpServers.map(function (s) {
        return { value: s.name, label: s.name || ("server-" + s.id) }
      })
      values: {
        var raw = root._effectiveOverride("ai_mcpDisabled")
        var arr
        try { arr = raw ? JSON.parse(raw) : [] } catch (e) { arr = [] }
        var out = []
        for (var i = 0; i < root._mcpServers.length; i++) {
          if (arr.indexOf(root._mcpServers[i].name) < 0) out.push(root._mcpServers[i].name)
        }
        return out
      }
      onChanged: function (vals) {
        if (!Array.isArray(vals)) return
        for (var i = 0; i < root._mcpServers.length; i++) {
          var name = root._mcpServers[i].name
          var checked = vals.indexOf(name) >= 0
          // MultiSelect emits the full values array on every change; only
          // call _toggleMcp when the per-row checked state changed to
          // avoid an infinite cycle.
          var wasChecked = (function () {
            var raw = root._effectiveOverride("ai_mcpDisabled")
            var arr
            try { arr = raw ? JSON.parse(raw) : [] } catch (e) { arr = [] }
            return arr.indexOf(name) < 0
          })()
          if (wasChecked !== checked) root._toggleMcp(name, checked)
        }
      }
    }

    Text {
      visible: root._kbCollections.length > 0
      text: "·"
      color: Color.muted
      opacity: 0.5
      anchors.verticalCenter: parent.verticalCenter
    }

    // KB collection toggle — same shape as MCP.
    MultiSelect {
      visible: root._kbCollections.length > 0
      width: 280
      options: root._kbCollections.map(function (c) {
        return { value: c.name, label: c.name || ("col-" + c.fileCount) }
      })
      values: {
        var raw = root._effectiveOverride("ai_knowledgeFolders")
        var arr
        try { arr = raw ? JSON.parse(raw) : [] } catch (e) { arr = [] }
        var out = []
        for (var i = 0; i < root._kbCollections.length; i++) {
          var n = root._kbCollections[i].name
          for (var j = 0; j < arr.length; j++) {
            if (arr[j].folder === n) { out.push(n); break }
          }
        }
        return out
      }
      onChanged: function (vals) {
        if (!Array.isArray(vals)) return
        for (var i = 0; i < root._kbCollections.length; i++) {
          var name = root._kbCollections[i].name
          var checked = vals.indexOf(name) >= 0
          var wasChecked = (function () {
            var raw = root._effectiveOverride("ai_knowledgeFolders")
            var arr
            try { arr = raw ? JSON.parse(raw) : [] } catch (e) { arr = [] }
            for (var j = 0; j < arr.length; j++) {
              if (arr[j].folder === name) return true
            }
            return false
          })()
          if (wasChecked !== checked) root._toggleKb(name, checked)
        }
      }
    }

    Text {
      visible: !!root.contextTokens
      text: "·"
      color: Color.muted
      opacity: 0.5
      anchors.verticalCenter: parent.verticalCenter
    }
    Item {
      visible: !!root.contextTokens && root.contextTokens.used !== undefined
      width: ctxRow.implicitWidth + 12
      height: Style.bar.sizeHorizontal
      Row {
        id: ctxRow
        anchors.fill: parent
        spacing: Style.spacing.xs

        Text {
          text: root._formatTokens(root.contextTokens && root.contextTokens.used ? root.contextTokens.used : 0)
            + "/"
            + root._formatTokens(root.contextTokens && root.contextTokens.total ? root.contextTokens.total : 0)
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          color: {
            var p = root._contextPct()
            return p === null ? Color.foreground : root._contextColor(p)
          }
          anchors.verticalCenter: parent.verticalCenter
        }
        Rectangle {
          width: 32
          height: 4
          radius: 2
          color: Util.alpha(Color.foreground, Palette.surfaceAlpha(3))
          anchors.verticalCenter: parent.verticalCenter
          Rectangle {
            width: parent.width * (root._contextPct() || 0) / 100
            height: parent.height
            radius: parent.radius
            color: {
              var p = root._contextPct()
              return p === null ? Color.foreground : root._contextColor(p)
            }
          }
        }
      }
    }
  }
}
