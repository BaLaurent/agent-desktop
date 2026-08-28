import QtQuick

// The global settings map from agent.db, plus the Conversation > Folder > Global
// cascade every AI-facing control reads through.
//
// One authoritative owner: `values` is the only copy of the server's settings in
// the front end. A write is optimistic so a control snaps immediately, but a
// rejected write is reverted — `settings:set` refuses any key absent from
// ALLOWED_SETTING_KEYS, and a silently-kept local value would make the UI lie
// about what the agent will actually do.
QtObject {
  id: store

  // Service.qml, which owns invoke/subscribe.
  required property var rpc

  property var values: ({})       // Record<string,string> from settings:get
  // `settings:getLocked` returns a sorted string[] of key NAMES — see
  // SettingsService.getLockedKeys() (src/core/services/settings.ts:184). It
  // carries no per-key reason, so `lockReason()` states the only reason there
  // is. Treating it as a key->reason map (which it looks like it should be)
  // makes every lookup undefined and silently renders every pinned row as
  // editable; verified live, the array is e.g. ["server_accessMode","server_port"].
  property var locked: []
  property bool loading: false
  property bool loaded: false
  property string error: ""

  signal changed(string key, string value)

  function load() {
    loading = true
    rpc.invoke("settings:get", [], function(result) {
      loading = false
      loaded = true
      error = ""
      values = (result && typeof result === "object") ? result : ({})
    }, function(err) {
      loading = false
      error = String(err)
    })
    rpc.invoke("settings:getLocked", [], function(result) {
      locked = Array.isArray(result) ? result : []
    }, function() { /* an older server has no locked keys; not an error */ })
  }
  function get(key, fallback) {
    if (values && values[key] !== undefined && values[key] !== null && values[key] !== "")
      return values[key]
    return fallback === undefined ? "" : fallback
  }

  function isLocked(key) {
    return Array.isArray(locked) && locked.indexOf(String(key)) >= 0
  }

  function lockReason(key) {
    return isLocked(key)
      ? "Pinned by a command-line override on the server; edit the systemd unit to change it."
      : ""
  }

  // Optimistic: write locally, then revert if the server refuses. Callers bind
  // to `values`, so the revert is visible without any extra plumbing.
  function set(key, value) {
    var previous = values[key]
    var next = ({})
    for (var k in values) next[k] = values[k]
    next[key] = String(value)
    values = next
    error = ""
    changed(key, String(value))

    rpc.invoke("settings:set", [String(key), String(value)], function() {
      // Committed; nothing to do — the optimistic value is now the truth.
    }, function(err) {
      var reverted = ({})
      for (var j in values) reverted[j] = values[j]
      if (previous === undefined) delete reverted[key]
      else reverted[key] = previous
      values = reverted
      error = String(err)
      changed(key, previous === undefined ? "" : String(previous))
    })
  }

  // Conversation > Folder > Global, mirroring cascade.ts:42-54. An empty string
  // at a level means "inherited", not "set to empty" — the same rule the server
  // applies, so the front and the agent agree on what is in effect.
  function effective(convOverrides, folderOverrides, key) {
    if (convOverrides && convOverrides[key] !== undefined
        && convOverrides[key] !== null && convOverrides[key] !== "")
      return String(convOverrides[key])
    if (folderOverrides && folderOverrides[key] !== undefined
        && folderOverrides[key] !== null && folderOverrides[key] !== "")
      return String(folderOverrides[key])
    return get(key, "")
  }

  // `ai_overrides` arrives as a JSON string on both Conversation and Folder.
  function parseOverrides(raw) {
    if (!raw) return ({})
    try {
      var parsed = JSON.parse(String(raw))
      return (parsed && typeof parsed === "object") ? parsed : ({})
    } catch (e) {
      return ({})
    }
  }
}

