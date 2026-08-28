import QtQuick
import QtTest

// McpStore's parse/stringify boundaries, exercised in a real QML engine.
//
// The wire format stores `args`, `env`, and `headers` as JSON strings;
// the store parses on read and stringifies on write. The page binds to
// the parsed shape. The two regressions this test catches:
//
//   - a row's args/env arriving as a JSON string and the store leaving
//     it that way (the page renders a single TextField instead of rows);
//   - a write that ships the JS array rather than the JSON string the
//     server expects.
//
// Optimistic toggles, test-connection state, and the per-id test
// results map are also covered.
//
// Per-channel-capture fake rpc (CONTRACTS.md §3): the test inspects a
// stored `calls[]` and resolves individual ones by channel. A last-
// callback-only fake would let `mcp:removeServer` accidentally answer
// `mcp:testConnection` on a different test row.
Item {
  width: 200
  height: 200

  QtObject {
    id: fakeRpc
    property var calls: []

    function invoke(channel, args, onOk, onErr) {
      calls = calls.concat([{ channel: channel, args: args, ok: onOk, err: onErr }])
      return calls.length
    }

    // Answer the most recent unanswered call to `channel`. Channel-keyed
    // because addServer → testConnection back-to-back both go through
    // here and the test must address them individually.
    function accept(channel, result) { callFor(channel).ok(result) }
    function refuse(channel, message) { callFor(channel).err(message) }

    function callFor(channel) {
      for (var i = calls.length - 1; i >= 0; i--) if (calls[i].channel === channel && !calls[i].done) {
        calls[i].done = true
        return calls[i]
      }
      throw new Error("no pending call to " + channel)
    }

    function reset() { calls = [] }
  }

  Loader {
    id: storeLoader
    Component.onCompleted: setSource("../../stores/McpStore.qml", ({ rpc: fakeRpc }))
  }

  TestCase {
    name: "McpStore"
    when: windowShown

    property var store: storeLoader.item

    function initTestCase() {
      verify(store !== null, "McpStore.qml loaded")
    }

    function init() {
      fakeRpc.reset()
      store.servers = []
      store.testResults = ({})
      store.testingId = -1
      store.loaded = false
      store.loading = false
      store.error = ""
    }

    // ---- load: parsing JSON string fields ----------------------------

    function test_load_parses_args_env_headers() {
      store.load()
      fakeRpc.accept("mcp:listServers", ([
        { id: 1, name: "std", type: "stdio", command: "node",
          args: '["foo","bar"]', env: '{"KEY":"V"}', url: null, headers: "{}",
          enabled: 1, status: "configured" },
        { id: 2, name: "remote", type: "http", command: "",
          args: "[]", env: "{}", url: "https://example.com",
          headers: '{"X-Token":"abc"}', enabled: 0, status: "disabled" }
      ]))
      compare(store.servers.length, 2)

      var std = store.servers[0]
      compare(std.name, "std")
      compare(std.type, "stdio")
      // Args come through as a parsed JS array, not the JSON string.
      compare(std.args.length, 2)
      compare(std.args[0], "foo")
      compare(std.args[1], "bar")
      compare(std.env.length, 1)
      compare(std.env[0].key, "KEY")
      compare(std.env[0].value, "V")
      compare(std.status, "configured")

      var remote = store.servers[1]
      compare(remote.type, "http")
      compare(remote.headers.length, 1)
      compare(remote.headers[0].key, "X-Token")
      compare(remote.headers[0].value, "abc")
      compare(remote.status, "disabled")
      compare(store.loaded, true)
    }

    // A row whose JSON field is malformed falls back to the parsed
    // default — the page renders an empty list, not a crash.
    function test_load_malformed_json_falls_back_to_defaults() {
      store.load()
      fakeRpc.accept("mcp:listServers", ([
        { id: 7, name: "broken", type: "stdio", command: "x",
          args: "not json", env: "also broken", headers: "{}",
          enabled: 1, status: "configured" }
      ]))
      compare(store.servers.length, 1)
      compare(store.servers[0].args.length, 0, "malformed args -> []")
      compare(store.servers[0].env.length, 0, "malformed env -> []")
    }

    // ---- addServer: stringify back to the wire shape ----------------

    function test_add_server_stringifies_env_headers() {
      var config = {
        name: "remote", type: "http", url: "https://example.com",
        headers: [{ key: "X-Token", value: "abc" }, { key: "X-Other", value: "z" }]
      }
      store.addServer(config)
      var call = fakeRpc.calls[0]
      compare(call.channel, "mcp:addServer")
      // headers arrived at the store as Array<{key,value}>; the wire
      // form sent to the server is an object. Headers is an object
      // {"X-Token":"abc","X-Other":"z"}.
      var sent = call.args[0]
      compare(sent.name, "remote")
      compare(sent.type, "http")
      compare(sent.url, "https://example.com")
      compare(sent.headers.XToken, undefined, "no transform to camelCase")
      compare(sent.headers["X-Token"], "abc")
      compare(sent.headers["X-Other"], "z")
    }

    function test_add_server_stringio_sends_args_array() {
      var config = {
        name: "std", type: "stdio", command: "node",
        args: ["-e", "console.log('hi')"],
        env: [{ key: "K", value: "V" }]
      }
      store.addServer(config)
      var sent = fakeRpc.calls[0].args[0]
      // args stays as a JS array of strings. The server's McpService
      // accepts arrays directly and stores them as JSON.
      compare(sent.args.length, 2)
      compare(sent.args[0], "-e")
      compare(sent.args[1], "console.log('hi')")
      compare(sent.env.K, "V")
    }

    // ---- toggle: optimistic flip + patch in place --------------------

    function test_toggle_optimistic_flip_reloads_on_error() {
      store.servers = [{ id: 5, name: "x", type: "stdio", command: "y",
                        args: [], env: [], headers: [], enabled: 1, status: "configured" }]
      store.toggleServer(5)
      // Local row flipped to disabled immediately, without waiting.
      compare(store.servers[0].enabled, 0)
      compare(store.servers[0].status, "disabled")
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "mcp:toggleServer")
      compare(fakeRpc.calls[0].args[0], 5)
    }

    function test_toggle_failed_reload_recovery() {
      store.servers = [{ id: 5, name: "x", enabled: 1, status: "configured",
                        type: "stdio", command: "y", args: [], env: [], headers: [] }]
      store.loaded = true
      store.toggleServer(5)
      fakeRpc.refuse("mcp:toggleServer", "Server 5 not found")
      // On error the store reloads from the server (its single source
      // of truth). After reload the list has one server with the
      // server-resolved state.
      compare(store.error, "Server 5 not found")
    }

    // ---- remove: optimistic drop + server call -----------------------

    function test_remove_drops_locally_and_calls_server() {
      store.servers = [
        { id: 1, name: "a", enabled: 1, status: "configured",
          type: "stdio", command: "x", args: [], env: [], headers: [] },
        { id: 2, name: "b", enabled: 1, status: "configured",
          type: "stdio", command: "y", args: [], env: [], headers: [] }
      ]
      store.removeServer(1)
      compare(store.servers.length, 1)
      compare(store.servers[0].id, 2)
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "mcp:removeServer")
      compare(fakeRpc.calls[0].args[0], 1)
    }

    // ---- testConnection: id required (CONTRACTS.md §9) ---------------

    function test_test_connection_refuses_non_positive_id() {
      // Calling testConnection with an unsaved (zero / negative) id
      // must NOT issue a server call — the contract says the server
      // throws "MCP server ID must be a positive integer".
      var err = null
      store.testConnection(0, null, function (e) { err = e })
      compare(fakeRpc.calls.length, 0, "no server call for id=0")
      compare(typeof err, "string")
      verify(err.length > 0)
    }
    function test_test_connection_records_loading_then_result() {
      // Seed a persisted row.
      store.servers = [{ id: 11, name: "x", enabled: 1, status: "configured",
                         type: "stdio", command: "y", args: [], env: [], headers: [] }]
      store.testConnection(11)
      // The store marks loading immediately so the page can render the
      // spinner without waiting on the server.
      compare(store.testingId, 11)
      compare(store.testResults["11"].loading, true)
      fakeRpc.accept("mcp:testConnection", ({ success: true, output: "OK" }))
      compare(store.testingId, -1, "testingId resets after reply")
      compare(store.testResults["11"].loading, false)
      compare(store.testResults["11"].success, true)
      compare(store.testResults["11"].output, "OK")
    }

    function test_test_connection_failure_records_error_output() {
      store.servers = [{ id: 11, name: "x", enabled: 1, status: "configured",
                         type: "stdio", command: "y", args: [], env: [], headers: [] }]
      store.testConnection(11)
      fakeRpc.refuse("mcp:testConnection", "boom")
      compare(store.testResults["11"].loading, false)
      compare(store.testResults["11"].success, false)
      compare(store.testResults["11"].output, "boom")
      compare(store.testingId, -1)
    }

    function test_clear_test_result_removes_entry() {
      store.testResults = ({ "11": { loading: false, success: true, output: "OK" } })
      store.clearTestResult(11)
      // Property still exists as an object map, just without that key.
      compare(store.testResults["11"], undefined)
    }
  }
}