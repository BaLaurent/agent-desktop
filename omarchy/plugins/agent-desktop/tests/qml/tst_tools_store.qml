import QtQuick
import QtTest

// ToolsStore — preset vs custom mode switching, single-toggle flow,
// server-refusal reload. The two-mode invariant the server enforces
// (ai_tools is EITHER the literal 'preset:claude_code' OR a JSON
// string[]) is the regression this test catches.
//
// A single-callback-only fake rpc would let a `tools:setEnabled` call
// accidentally answer a `settings:get` callback from another test. We
// key by channel and resolve one specific call at a time.
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
    Component.onCompleted: setSource("../../stores/ToolsStore.qml", ({ rpc: fakeRpc }))
  }

  TestCase {
    name: "ToolsStore"
    when: windowShown

    property var store: storeLoader.item

    function initTestCase() {
      verify(store !== null, "ToolsStore.qml loaded")
    }

    function init() {
      fakeRpc.reset()
      store.tools = []
      store.loaded = false
      store.loading = false
      store.mode = "preset"
      store.error = ""
    }

    // load() fires both tools:listAvailable and settings:get so the
    // page can render the preset/custom switch correctly on first open.
    function test_load_calls_both_channels() {
      store.load()
      compare(fakeRpc.calls.length, 2)
      compare(fakeRpc.calls[0].channel, "tools:listAvailable")
      compare(fakeRpc.calls[1].channel, "settings:get")
    }

    function test_load_with_preset_value_stays_in_preset_mode() {
      store.load()
      fakeRpc.accept("tools:listAvailable", ([]))
      fakeRpc.accept("settings:get", ({ ai_tools: "preset:claude_code" }))
      compare(store.mode, "preset")
    }

    function test_load_with_json_array_lands_in_custom_mode() {
      store.load()
      fakeRpc.accept("tools:listAvailable", ([]))
      fakeRpc.accept("settings:get", ({ ai_tools: '["Bash","Read"]' }))
      compare(store.mode, "custom")
    }

    // A single toggle OFF flips to "custom" because the stored value
    // now differs from "all on". The wire write is the JSON array
    // form, not the preset string.
    function test_toggle_off_writes_custom_json() {
      store.tools = [
        { name: "Bash", description: "shell", enabled: true },
        { name: "Read", description: "read", enabled: true }
      ]
      store.toggle("Read")
      compare(store.mode, "custom")
      var call = fakeRpc.calls[0]
      compare(call.channel, "tools:setEnabled")
      compare(call.args[0], '["Bash"]')
    }

    // Toggling the LAST enabled tool off does NOT collapse to the preset
    // literal — "everything off" is custom with an empty array, not
    // "everything on". The preset string is reserved for "all on".
    function test_toggle_all_off_stays_custom_with_empty_array() {
      store.tools = [
        { name: "Bash", description: "shell", enabled: true },
        { name: "Read", description: "read", enabled: true }
      ]
      store.mode = "preset"
      store.toggle("Bash")
      store.toggle("Read")
      compare(store.mode, "custom")
      compare(fakeRpc.calls[1].args[0], "[]")
    }

    // Toggling the LAST disabled tool back ON returns to preset and
    // writes the preset literal.
    function test_toggle_last_on_returns_to_preset() {
      store.tools = [{ name: "Read", description: "read", enabled: false }]
      store.mode = "custom"
      store.toggle("Read")
      compare(store.mode, "preset")
      compare(fakeRpc.calls[0].args[0], "preset:claude_code")
    }


    // The optimistic local flip is visible before the server replies.
    function test_toggle_is_visible_immediately() {
      store.tools = [{ name: "Read", description: "read", enabled: true }]
      store.toggle("Read")
      compare(store.tools[0].enabled, false, "local flip happens synchronously")
      compare(fakeRpc.calls.length, 1, "exactly one server call (the write)")
    }

    // Failed write reloads truth from the server.
    function test_toggle_failed_reload() {
      store.tools = [{ name: "Read", description: "read", enabled: true }]
      store.loaded = true
      store.toggle("Read")
      fakeRpc.refuse("tools:setEnabled", "Server failed to write")
      compare(store.error, "Server failed to write")
    }

    // setMode("preset") from "custom" writes the preset literal and
    // mirrors every tool as enabled locally.
    function test_set_mode_preset_writes_preset_string() {
      store.tools = [
        { name: "Bash", description: "shell", enabled: false },
        { name: "Read", description: "read", enabled: false }
      ]
      store.mode = "custom"
      store.setMode("preset")
      compare(store.mode, "preset")
      compare(store.tools[0].enabled, true)
      compare(store.tools[1].enabled, true)
      compare(fakeRpc.calls[0].channel, "tools:setEnabled")
      compare(fakeRpc.calls[0].args[0], "preset:claude_code")
    }

    // setMode("custom") from "preset" writes a JSON array containing
    // every currently-enabled tool.
    function test_set_mode_custom_writes_json_array() {
      store.tools = [
        { name: "Bash", description: "shell", enabled: true },
        { name: "Read", description: "read", enabled: true }
      ]
      store.mode = "preset"
      store.setMode("custom")
      compare(store.mode, "custom")
      var sent = fakeRpc.calls[0].args[0]
      verify(sent.indexOf('"Bash"') >= 0)
      verify(sent.indexOf('"Read"') >= 0)
    }

    // setMode is a no-op when the requested mode is already current —
    // no server call, no flicker.
    function test_set_mode_noop_when_already_in_mode() {
      store.mode = "preset"
      store.setMode("preset")
      compare(fakeRpc.calls.length, 0, "no server call when mode is unchanged")
    }
  }
}