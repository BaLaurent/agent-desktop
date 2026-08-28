import QtQuick

// ToolsStore — the tools:listAvailable / toggle / setEnabled surface.
//
// The store mirrors the React ToolList, with one structural concern the
// server enforces that the store must honour: `ai_tools` is EITHER the
// literal string `'preset:claude_code'` (meaning "all of them") OR a JSON
// `string[]` of enabled names. The two forms are not interchangeable, so
// the store tracks which mode the current value is in and rejects writes
// that mix them.
//
// `mode`:
//   "preset"  -> ai_tools == "preset:claude_code" — every tool is on
//   "custom"  -> ai_tools is a JSON string[] — a user-defined subset
//
// The page renders a preset/custom switch that calls `setMode("preset")`
// or `setMode("custom")`; the preset switch serialises the full list
// back to the canonical preset string, the custom switch seeds a JSON
// array from the current enabled set.
QtObject {
  id: store

  // Service.qml, which owns invoke/subscribe.
  required property var rpc

  // The full list of SDK tools, with the server-resolved `enabled` flag.
  property var tools: []           // AllowedTool[]
  property bool loaded: false
  property bool loading: false
  property string error: ""

  // The shape the current ai_tools value is in. Updated on load and on
  // every successful write so the page renders the right switch.
  property string mode: "preset"   // "preset" | "custom"

  // Recompute `mode` from a raw ai_tools string. Helper so load() and
  // every setter share one definition.
  function _computeMode(raw) {
    if (raw === "preset:claude_code") return "preset"
    return "custom"
  }

  function load() {
    loading = true
    rpc.invoke("tools:listAvailable", [], applyList, function(err) {
      loading = false
      loaded = false
      error = String(err)
    })
    // mode tracks ai_tools, which the settings page reads through
    // SettingsStore; refresh both here so the switch reflects truth.
    rpc.invoke("settings:get", [], function(result) {
      mode = _computeMode(result && result.ai_tools ? String(result.ai_tools) : "")
    }, function() { /* missing settings is fine, mode stays default */ })
  }

  function applyList(rows) {
    tools = Array.isArray(rows) ? rows : []
    loading = false
    loaded = true
  }

  // Flip a single tool. Optimistic: the local row updates first, the
  // server is told next. A refused write reloads from the server.
  function toggle(name, onDone, onErr) {
    var target = String(name || "")
    if (!target) return
    var i
    var next = []
    for (i = 0; i < tools.length; i++) {
      var row = tools[i]
      if (!row) continue
      next.push({
        name: row.name,
        description: row.description,
        enabled: row.name === target ? !row.enabled : row.enabled
      })
    }
    tools = next
    // Promote to "custom" the moment the user diverges from "all on".
    // The server writes a JSON string[] in that case; preset:claude_code
    // is reserved for "every tool on".
    var anyOff = false
    for (i = 0; i < next.length; i++) {
      if (!next[i].enabled) { anyOff = true; break }
    }
    mode = anyOff ? "custom" : "preset"
    var valueToWrite = mode === "preset" ? "preset:claude_code"
      : JSON.stringify(next.filter(function (r) { return r.enabled }).map(function (r) { return r.name }))
    rpc.invoke("tools:setEnabled", [valueToWrite], function() {
      if (onDone) onDone()
    }, function(err) {
      error = String(err)
      // Reload to recover truth — the toggle was optimistic and the
      // server rejected the write.
      if (loaded) load()
      if (onErr) onErr(err)
    })
  }

  // Switch the page between the preset and custom views. The page calls
  // this when the user clicks the switch; `setMode("preset")` flips every
  // tool on and writes the preset string.
  function setMode(next, onDone, onErr) {
    if (next !== "preset" && next !== "custom") return
    if (next === mode) return
    var valueToWrite
    if (next === "preset") {
      valueToWrite = "preset:claude_code"
      // Mirror locally: every tool enabled.
      var i
      var nextTools = []
      for (i = 0; i < tools.length; i++) {
        var r = tools[i]
        if (!r) continue
        nextTools.push({ name: r.name, description: r.description, enabled: true })
      }
      tools = nextTools
    } else {
      // Promote to custom by writing the current enabled set as a JSON
      // array. If everything is already on, write the full list so the
      // two views diverge by form, not by content.
      var i2
      var enabledNames = []
      for (i2 = 0; i2 < tools.length; i2++) {
        if (tools[i2].enabled) enabledNames.push(tools[i2].name)
      }
      valueToWrite = JSON.stringify(enabledNames)
    }
    mode = next
    rpc.invoke("tools:setEnabled", [valueToWrite], function() {
      if (onDone) onDone()
    }, function(err) {
      error = String(err)
      if (loaded) load()
      if (onErr) onErr(err)
    })
  }
}