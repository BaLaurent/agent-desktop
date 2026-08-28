import QtQuick
import QtTest

// SettingsStore's optimistic write, exercised in a real QML engine.
//
// The behaviour under test is not arithmetic — it is a property that must be
// visible to bindings at three points in time: immediately after set(), after
// the server accepts, and after the server refuses. A node test on a plain
// object cannot observe a QML binding, and `settings:set` throws for any key
// absent from ALLOWED_SETTING_KEYS, so a silently-kept local value would make
// every control in the settings page lie about what the agent will do.
Item {
  width: 200
  height: 200

  // Stands in for Service.qml. Captures each invoke and lets the test decide,
  // per call, whether the server accepted — which is the only way to reach the
  // revert branch deterministically.
  QtObject {
    id: fakeRpc
    property var calls: []

    function invoke(channel, args, onOk, onErr) {
      calls = calls.concat([{ channel: channel, args: args, ok: onOk, err: onErr }])
      return calls.length
    }

    // Answer a specific call by channel, so a test that drives settings:get is
    // not silently driving settings:getLocked's callback instead.
    function accept(channel, result) { callFor(channel).ok(result) }
    function refuse(channel, message) { callFor(channel).err(message) }

    function callFor(channel) {
      for (var i = calls.length - 1; i >= 0; i--) if (calls[i].channel === channel) return calls[i]
      throw new Error("no call to " + channel)
    }

    function reset() { calls = [] }
  }

  Loader {
    id: storeLoader
    Component.onCompleted: setSource("../../stores/SettingsStore.qml", ({ rpc: fakeRpc }))
  }

  TestCase {
    name: "SettingsStore"
    when: windowShown

    property var store: storeLoader.item

    function initTestCase() {
      verify(store !== null, "SettingsStore.qml loaded")
    }

    function init() {
      fakeRpc.reset()
      store.values = ({})
      store.locked = ({})
      store.loaded = false
      store.error = ""
    }

    // load() asks for both maps, because a control has to know it is disabled
    // before it renders, not after the first rejected write.
    function test_load_requests_values_and_locked() {
      store.load()
      compare(fakeRpc.calls.length, 2)
      compare(fakeRpc.calls[0].channel, "settings:get")
      compare(fakeRpc.calls[1].channel, "settings:getLocked")
      compare(store.loading, true)
    }

    function test_load_populates_values() {
      store.load()
      fakeRpc.accept("settings:get", ({ dark: "true", ai_model: "sonnet" }))
      fakeRpc.accept("settings:getLocked", ["server_port"])
      compare(store.get("dark", ""), "true")
      compare(store.get("ai_model", ""), "sonnet")
      compare(store.loaded, true)
      compare(store.loading, false)
      compare(store.isLocked("server_port"), true)
    }

    // A load that fails clears `loading` and surfaces the reason, or the window
    // sits on "waiting for the headless server…" with nothing to explain it.
    function test_load_failure_surfaces_the_error() {
      store.load()
      fakeRpc.refuse("settings:get", "WebSocket disconnected")
      compare(store.loading, false)
      compare(store.loaded, false)
      compare(store.error, "WebSocket disconnected")
    }

    // A get() on an absent or empty key falls through to the caller's default.
    // Empty means inherited everywhere else in this system, so it must here too.
    function test_get_treats_empty_as_absent() {
      store.values = ({ a: "", b: "set" })
      compare(store.get("a", "fallback"), "fallback")
      compare(store.get("b", "fallback"), "set")
      compare(store.get("missing", "fallback"), "fallback")
      compare(store.get("missing"), "")
    }

    // The optimistic write is visible before the server has answered at all.
    function test_set_is_visible_immediately() {
      store.values = ({ ai_model: "old" })
      store.set("ai_model", "new")
      compare(store.get("ai_model", ""), "new")
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "settings:set")
      compare(fakeRpc.calls[0].args[0], "ai_model")
      compare(fakeRpc.calls[0].args[1], "new")
    }

    function test_set_accepted_keeps_the_value() {
      store.values = ({ ai_model: "old" })
      store.set("ai_model", "new")
      fakeRpc.accept("settings:set", undefined)
      compare(store.get("ai_model", ""), "new")
      compare(store.error, "")
    }

    // The branch that matters: a refused write must not be kept.
    function test_set_refused_reverts_and_surfaces_the_error() {
      store.values = ({ ai_model: "old" })
      store.set("ai_model", "new")
      fakeRpc.refuse("settings:set", "Unknown setting key: ai_model")
      compare(store.get("ai_model", ""), "old")
      compare(store.error, "Unknown setting key: ai_model")
    }

    // A refused write to a key that was absent must leave it absent, not
    // present-and-empty — those are different things to the cascade.
    function test_set_refused_on_new_key_removes_it() {
      store.values = ({ other: "x" })
      store.set("bogus_key", "v")
      compare(store.get("bogus_key", "none"), "v")
      fakeRpc.refuse("settings:set", "Unknown setting key: bogus_key")
      compare(store.get("bogus_key", "none"), "none")
      compare(store.values.hasOwnProperty("bogus_key"), false)
      compare(store.get("other", ""), "x")
    }

    // Conversation > Folder > Global, mirroring cascade.ts:42-54.
    function test_cascade_precedence() {
      store.values = ({ ai_model: "global" })
      compare(store.effective(null, null, "ai_model"), "global")
      compare(store.effective(null, ({ ai_model: "folder" }), "ai_model"), "folder")
      compare(store.effective(({ ai_model: "conv" }), ({ ai_model: "folder" }), "ai_model"), "conv")
    }

    // An empty string at a level is inherited, not "set to empty".
    function test_cascade_treats_empty_as_inherited() {
      store.values = ({ ai_model: "global" })
      compare(store.effective(({ ai_model: "" }), null, "ai_model"), "global")
      compare(store.effective(({ ai_model: "" }), ({ ai_model: "folder" }), "ai_model"), "folder")
      compare(store.effective(null, ({ ai_model: "" }), "ai_model"), "global")
    }

    function test_cascade_missing_everywhere_is_empty() {
      compare(store.effective(null, null, "never_set"), "")
    }

    // A CLI-pinned key renders disabled with its reason, which the React UI
    // never did — so this is the only place the reason is surfaced at all.
    // `settings:getLocked` returns a string ARRAY of key names, not a
    // key->reason map (src/core/services/settings.ts:184). Asserting the array
    // shape here is what stops a future "obvious" rewrite to a map from
    // silently making every pinned row editable again.
    function test_locked_keys() {
      store.locked = ["server_accessMode", "server_port"]
      compare(store.isLocked("server_port"), true)
      compare(store.isLocked("server_accessMode"), true)
      verify(store.lockReason("server_port").length > 0,
        "a locked key must explain itself")
      compare(store.isLocked("ai_model"), false)
      compare(store.lockReason("ai_model"), "")
    }

    // A map (the wrong shape) must not read as locked.
    function test_locked_rejects_a_map() {
      store.locked = ({ server_port: "pinned" })
      compare(store.isLocked("server_port"), false,
        "an object is not the wire shape and must not be trusted")
    }

    function test_load_populates_locked_from_an_array() {
      store.load()
      fakeRpc.accept("settings:get", ({}))
      fakeRpc.accept("settings:getLocked", ["server_port"])
      compare(store.isLocked("server_port"), true)
    }

    // ai_overrides arrives as a JSON string on both Conversation and Folder.
    function test_parse_overrides() {
      compare(store.parseOverrides('{"ai_model":"x"}').ai_model, "x")
      compare(Object.keys(store.parseOverrides(null)).length, 0)
      compare(Object.keys(store.parseOverrides("")).length, 0)
      compare(Object.keys(store.parseOverrides("not json")).length, 0)
      compare(Object.keys(store.parseOverrides("[1,2]")).length, 2)
    }
  }
}
