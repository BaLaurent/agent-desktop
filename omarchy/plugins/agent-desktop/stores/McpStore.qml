import QtQuick

// McpStore — the mcp:listServers / addServer / updateServer / removeServer
// / toggleServer / testConnection surface.
//
// The server stores `args`, `env`, and `headers` as JSON strings in
// mcp_servers and exposes them as strings through the wire. The store
// parses on read into JS arrays / objects so the form renders rows,
// and stringifies on write. Every row carries a parsed shape the page
// binds to:
//
//   args:     string[]                       (was JSON string)
//   env:      Array<{key, value}>            (was JSON string of object)
//   headers:  Array<{key, value}>            (was JSON string of object)
//
// `mcp:testConnection` takes a PERSISTED server id (CONTRACTS.md §9);
// a new server must be saved with `mcp:addServer(config)` first, then
// tested by the returned id. The store handles that by saving the
// current draft before testing when the form has unsaved changes.
//
// `testResults` is keyed by server id and carries `{ loading, success,
// output }` so the page can render a per-row spinner and the resulting
// `{ success, output }` block from the server.
QtObject {
  id: store

  // Service.qml, which owns invoke/subscribe.
  required property var rpc

  property var servers: []        // McpServer[] with parsed args/env/headers
  property bool loaded: false
  property bool loading: false
  property string error: ""

  // id -> { loading: bool, success?: bool, output?: string }. A row's
  // test button sets `loading: true` synchronously and the server reply
  // replaces the entry; the page watches this and renders accordingly.
  property var testResults: ({})
  // The id currently being tested. The page renders the Test button as
  // "Testing…" while this matches the row.
  property int testingId: -1

  // ---- helpers (shared by load + add/update path) --------------------

  function _parseJsonField(raw, fallback) {
    if (raw === undefined || raw === null || raw === "") return fallback
    try {
      var parsed = JSON.parse(String(raw))
      if (Array.isArray(fallback)) {
        return Array.isArray(parsed) ? parsed : fallback
      }
      return (parsed && typeof parsed === "object") ? parsed : fallback
    } catch (e) {
      return fallback
    }
  }

  function _parseEnvRows(raw) {
    var obj = _parseJsonField(raw, {})
    if (!obj || typeof obj !== "object") return []
    var out = []
    var keys = Object.keys(obj)
    for (var i = 0; i < keys.length; i++) {
      out.push({ key: keys[i], value: String(obj[keys[i]]) })
    }
    return out
  }

  function _envRowsToObject(rows) {
    var obj = {}
    if (!Array.isArray(rows)) return obj
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i]
      if (!r || !r.key) continue
      obj[String(r.key)] = String(r.value === undefined ? "" : r.value)
    }
    return obj
  }

  // Convert a raw row from mcp:listServers into the parsed shape the
  // page binds to. Defensive against missing fields.
  function _parseRow(row) {
    if (!row) return null
    var out = {}
    for (var k in row) out[k] = row[k]
    out.args = _parseJsonField(row.args, [])
    out.env = _parseEnvRows(row.env)
    out.headers = _parseEnvRows(row.headers)
    if (!out.type) out.type = "stdio"
    if (!out.status) out.status = out.enabled ? "configured" : "disabled"
    return out
  }

  // ---- load ----------------------------------------------------------

  function load() {
    loading = true
    rpc.invoke("mcp:listServers", [], applyList, function(err) {
      loading = false
      loaded = false
      error = String(err)
    })
  }

  function applyList(rows) {
    var next = []
    if (Array.isArray(rows)) {
      for (var i = 0; i < rows.length; i++) {
        var parsed = _parseRow(rows[i])
        if (parsed) next.push(parsed)
      }
    }
    servers = next
    loading = false
    loaded = true
  }

  // ---- CRUD ----------------------------------------------------------

  // `config` is a McpServerConfig: { name, type?, command?, args?, env?,
  // url?, headers? }. Arrays and objects are already in their JS shape;
  // the store stringifies them for the wire.
  function addServer(config, onDone, onErr) {
    var wire = _toWireConfig(config)
    rpc.invoke("mcp:addServer", [wire], function(row) {
      // Re-fetch to keep the list server-authoritative.
      load()
      if (onDone) onDone(row)
    }, function(err) {
      error = String(err)
      if (onErr) onErr(err)
    })
  }

  function updateServer(id, config, onDone, onErr) {
    var wire = _toWireConfig(config)
    rpc.invoke("mcp:updateServer", [Number(id), wire], function() {
      load()
      if (onDone) onDone()
    }, function(err) {
      error = String(err)
      if (onErr) onErr(err)
    })
  }

  function removeServer(id, onDone, onErr) {
    var target = Number(id)
    // Drop locally for an instant delete; the server reply is the truth.
    var next = []
    for (var i = 0; i < servers.length; i++) {
      if (servers[i].id !== target) next.push(servers[i])
    }
    servers = next
    rpc.invoke("mcp:removeServer", [target], function() {
      if (onDone) onDone()
    }, function(err) {
      error = String(err)
      if (loaded) load()
      if (onErr) onErr(err)
    })
  }

  function toggleServer(id, onDone, onErr) {
    var target = Number(id)
    // Optimistic local flip.
    var next = []
    var i
    for (i = 0; i < servers.length; i++) {
      var row = servers[i]
      if (row.id !== target) next.push(row)
      else {
        var patched = {}
        for (var k in row) patched[k] = row[k]
        patched.enabled = row.enabled === 1 || row.enabled === true ? 0 : 1
        patched.status = patched.enabled ? "configured" : "disabled"
        next.push(patched)
      }
    }
    servers = next
    rpc.invoke("mcp:toggleServer", [target], function() {
      if (onDone) onDone()
    }, function(err) {
      error = String(err)
      if (loaded) load()
      if (onErr) onErr(err)
    })
  }

  // Run a connection test against a PERSISTED id. The store rejects a
  // non-positive id because the server does (CONTRACTS.md §9).
  function testConnection(id, onDone, onErr) {
    var target = Number(id)
    if (!target || target <= 0) {
      var err = "Cannot test an unsaved server — save first."
      if (onErr) onErr(err)
      return
    }
    // Mark loading state immediately so the page can disable the
    // button and render a spinner without waiting for the round-trip.
    setTestState(target, { loading: true })
    testingId = target
    rpc.invoke("mcp:testConnection", [target], function(result) {
      var entry = {
        loading: false,
        success: !!(result && result.success === true),
        output: result && result.output !== undefined ? String(result.output) : ""
      }
      setTestState(target, entry)
      testingId = -1
      if (onDone) onDone(entry)
    }, function(err) {
      setTestState(target, {
        loading: false,
        success: false,
        output: String(err)
      })
      testingId = -1
      error = String(err)
      if (onErr) onErr(err)
    })
  }

  function clearTestResult(id) {
    var target = Number(id)
    var map = testResults
    if (map[target] === undefined && !(target in map)) return
    var next = {}
    for (var k in map) {
      if (Number(k) !== target) next[k] = map[k]
    }
    testResults = next
  }

  function setTestState(id, entry) {
    var next = {}
    for (var k in testResults) next[k] = testResults[k]
    next[String(id)] = entry
    testResults = next
  }

  // Convert the page's parsed form into the wire shape the server's
  // McpService expects: { name, type?, command?, args?: string[],
  // env?: object, url?, headers?: object }.
  function _toWireConfig(config) {
    if (!config) return {}
    var out = {}
    if (config.name !== undefined) out.name = String(config.name)
    if (config.type !== undefined) out.type = String(config.type)
    if (config.command !== undefined) out.command = String(config.command)
    if (config.url !== undefined) out.url = String(config.url)
    if (Array.isArray(config.args)) {
      var argsOut = []
      for (var i = 0; i < config.args.length; i++) {
        argsOut.push(String(config.args[i]))
      }
      out.args = argsOut
    }
    out.env = _envRowsToObject(config.env)
    out.headers = _envRowsToObject(config.headers)
    return out
  }
}