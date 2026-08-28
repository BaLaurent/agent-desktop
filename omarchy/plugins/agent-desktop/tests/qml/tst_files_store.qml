import QtQuick
import QtTest

// FilesStore exercised in a real QML engine.
//
// The behaviour under test is the store's response to channel calls:
//   load(cwd)                -> files:listTree (cwd, excludePatterns)
//   loadFlat(path)           -> files:listDir (path)
//   read(path)               -> files:readFile (path) -> stored in reads{}
//   write(path, content)     -> files:writeFile
//   parseExcludePatterns()   -> string -> string[]
// and the routes to size-aware preview kinds (text/image/markdown/external).
//
// The fake rpc is the same per-call-capture pattern as tst_settings_store
// / tst_scheduler_store: every invoke lands in `calls`, with channel,
// args, and the success/error handlers; we resolve per-test by channel.
Item {
  width: 400
  height: 400

  QtObject {
    id: fakeRpc
    property var calls: []
    property var subs: ([])

    // The bare minimum the FilesStore reads off rpc. The store never
    // touches these directly except in the excludePatterns refresh, but
    // they have to exist or the Component.onCompleted crashes.
    property var settingsStore: fakeSettings
    property string pluginId: "agent-desktop"
    property string pluginDir: ""

    // Captures every invoke with channel, args, and the success/error
    // handlers. The last-callback-only fake pattern already cost us a
    // regression in another test, so we record every call.
    function invoke(channel, args, onOk, onErr) {
      calls = calls.concat([{ channel: channel, args: args || [],
                              ok: onOk, err: onErr }])
      return calls.length
    }

    function subscribe(channel, handler) {
      subs = subs.concat([{ channel: channel, handler: handler }])
    }
    function unsubscribe(channel, handler) {
      var next = []
      for (var i = 0; i < subs.length; i++) {
        if (subs[i].channel === channel && subs[i].handler !== handler) next.push(subs[i])
      }
      subs = next
    }

    // Drive a single call's success or error. Multiple invocations of
    // the same channel are resolved in arrival order, matching the
    // real RPC behaviour.
    function accept(channel, result) {
      for (var i = 0; i < calls.length; i++) {
        if (calls[i].channel === channel && calls[i].ok) {
          var c = calls[i]
          calls.splice(i, 1)
          c.ok(result)
          return
        }
      }
      throw new Error("no pending call to " + channel)
    }
    function refuse(channel, message) {
      for (var i = 0; i < calls.length; i++) {
        if (calls[i].channel === channel && calls[i].err) {
          var c = calls[i]
          calls.splice(i, 1)
          c.err(message)
          return
        }
      }
      throw new Error("no pending call to " + channel)
    }

    function reset() { calls = []; subs = [] }
    function channelsSoFar() {
      var out = []
      for (var i = 0; i < calls.length; i++) out.push(calls[i].channel)
      return out
    }
  }

  // Minimal settings stand-in. Returns whatever the test seeds.
  QtObject {
    id: fakeSettings
    property var values: ({})
    function get(key, fallback) {
      if (values && values[key] !== undefined && values[key] !== null
          && values[key] !== "") return values[key]
      return fallback === undefined ? "" : fallback
    }
  }

  Loader {
    id: storeLoader
    Component.onCompleted: setSource("../../stores/FilesStore.qml",
      ({ rpc: fakeRpc }))
  }

  TestCase {
    name: "FilesStore"
    when: windowShown

    property var store: storeLoader.item

    // deepEqual is not built into QML's QtTest. JSON-stringify both sides
    // and compare — works for arrays and plain objects, which is every
    // case this test asserts.
    function deepEqual(actual, expected, message) {
      var a = JSON.stringify(actual)
      var e = JSON.stringify(expected)
      compare(a, e, message || "deepEqual mismatch")
    }

    function initTestCase() {
      verify(store !== null, "FilesStore.qml loaded")
    }

    function init() {
      fakeRpc.reset()
      store.tree = []
      store.flat = []
      store.currentPath = ""
      store.reads = ({})
      store.activeReadPath = ""
      store.loading = false
      store.error = ""
      store.excludePatterns = []
      fakeSettings.values = ({})
    }

    // ---- load() ----------------------------------------------------------

    // load(cwd) -> files:listTree (cwd, excludePatterns). Without a cwd,
    // no listTree call is made.
    function test_load_no_cwd_does_not_invoke() {
      store.load("")
      compare(fakeRpc.calls.length, 0,
        "load with empty cwd must NOT call files:listTree")
    }

    function test_load_with_cwd_invokes_list_tree() {
      fakeSettings.values = ({ files_excludePatterns: "node_modules,dist" })
      store.load("/home/me/proj")
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "files:listTree")
      compare(fakeRpc.calls[0].args[0], "/home/me/proj")
      deepEqual(fakeRpc.calls[0].args[1], ["node_modules", "dist"],
        "exclude patterns parsed from setting (comma-separated)")
      compare(store.loading, true)
    }

    function test_load_default_excludes_when_setting_absent() {
      store.load("/home/me/proj")
      deepEqual(fakeRpc.calls[0].args[1], ["node_modules"],
        "default exclude patterns when files_excludePatterns is unset")
    }

    // The listTree reply populates tree and clears loading.
    function test_load_populates_tree() {
      fakeSettings.values = ({ files_excludePatterns: "node_modules" })
      store.load("/home/me/proj")
      fakeRpc.accept("files:listTree", [
        { name: "src", path: "/home/me/proj/src", isDirectory: true,
          children: [
            { name: "main.ts", path: "/home/me/proj/src/main.ts", isDirectory: false }
          ]},
        { name: "package.json", path: "/home/me/proj/package.json", isDirectory: false }
      ])
      compare(store.loading, false)
      compare(store.tree.length, 2)
      compare(store.tree[0].name, "src")
      compare(store.tree[0].children.length, 1)
      compare(store.tree[1].name, "package.json")
      compare(store.currentPath, "/home/me/proj")
      compare(store.error, "")
    }

    // An empty reply still clears loading and leaves tree = []. An
    // undefined reply (server contract quirk) is also handled.
    function test_load_empty_tree_does_not_throw() {
      store.load("/home/me/proj")
      fakeRpc.accept("files:listTree", [])
      compare(store.tree.length, 0)
      compare(store.loading, false)
      compare(store.error, "")
    }

    function test_load_undefined_reply_does_not_throw() {
      store.load("/home/me/proj")
      fakeRpc.accept("files:listTree", undefined)
      compare(store.tree.length, 0)
    }

    // A failure surfaces in error.
    function test_load_failure_surfaces_error() {
      store.load("/home/me/proj")
      fakeRpc.refuse("files:listTree", "Access denied")
      compare(store.loading, false)
      compare(store.tree.length, 0)
      compare(store.error, "Access denied")
    }

    // ---- loadFlat(path) --------------------------------------------------

    function test_load_flat_invokes_list_dir() {
      store.loadFlat("/home/me/proj/src")
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "files:listDir")
      compare(fakeRpc.calls[0].args[0], "/home/me/proj/src")
    }

    function test_load_flat_populates_flat() {
      store.loadFlat("/home/me/proj/src")
      fakeRpc.accept("files:listDir", [
        { name: "main.ts", path: "/home/me/proj/src/main.ts", isDirectory: false },
        { name: "lib", path: "/home/me/proj/src/lib", isDirectory: true }
      ])
      compare(store.flat.length, 2)
      compare(store.flat[0].name, "main.ts")
      compare(store.currentPath, "/home/me/proj/src")
    }

    // ---- read(path) ------------------------------------------------------

    function test_read_invokes_read_file() {
      store.read("/home/me/proj/src/main.ts")
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "files:readFile")
      compare(fakeRpc.calls[0].args[0], "/home/me/proj/src/main.ts")
    }

    function test_read_caches_result_under_path() {
      store.read("/home/me/proj/src/main.ts")
      fakeRpc.accept("files:readFile", {
        content: "console.log('hi')", language: "typescript"
      })
      compare(store.activeReadPath, "/home/me/proj/src/main.ts")
      var r = store.activeRead()
      verify(r !== null, "activeRead returns the cached result")
      compare(r.content, "console.log('hi')")
      compare(r.language, "typescript")
    }

    // Two reads of the same path: the second populates the same slot;
    // activeReadPath tracks the most recent read.
    function test_read_two_paths_tracks_latest() {
      store.read("/a")
      fakeRpc.accept("files:readFile", { content: "AAA", language: "text" })
      store.read("/b")
      fakeRpc.accept("files:readFile", { content: "BBB", language: "text" })
      compare(store.activeReadPath, "/b")
      var r = store.activeRead()
      compare(r.content, "BBB")
      verify(store.reads["/a"] !== undefined,
        "previous read is preserved under its own key")
    }

    function test_read_image_returns_data_url() {
      store.read("/logo.png")
      fakeRpc.accept("files:readFile", {
        content: "data:image/png;base64,AAAA", language: "image"
      })
      var r = store.activeRead()
      compare(r.language, "image")
      compare(r.content.indexOf("data:image/png"), 0)
    }

    function test_read_failure_surfaces_error() {
      store.read("/secret")
      fakeRpc.refuse("files:readFile", "Access denied")
      compare(store.error, "Access denied")
    }

    // ---- write -----------------------------------------------------------

    function test_write_invokes_with_path_and_content() {
      store.write("/a.ts", "new contents", function () {}, function () {})
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "files:writeFile")
      compare(fakeRpc.calls[0].args[0], "/a.ts")
      compare(fakeRpc.calls[0].args[1], "new contents")
    }

    function test_write_calls_onOk_on_success() {
      var okCalled = false
      var errCalled = false
      store.write("/a.ts", "x",
        function () { okCalled = true },
        function () { errCalled = true })
      fakeRpc.accept("files:writeFile", undefined)
      compare(okCalled, true)
      compare(errCalled, false)
    }

    function test_write_calls_onErr_on_failure() {
      var okCalled = false
      var errCalled = false
      store.write("/a.ts", "x",
        function () { okCalled = true },
        function () { errCalled = true })
      fakeRpc.refuse("files:writeFile", "Write access denied")
      compare(okCalled, false)
      compare(errCalled, true)
      compare(store.error, "Write access denied")
    }

    // ---- action channels: rename / duplicate / move / createFile --------

    function test_rename_invokes_with_new_name() {
      store.rename("/old.ts", "new.ts", function () {}, function () {})
      compare(fakeRpc.calls[0].channel, "files:rename")
      compare(fakeRpc.calls[0].args[0], "/old.ts")
      compare(fakeRpc.calls[0].args[1], "new.ts")
    }

    function test_duplicate_invokes() {
      store.duplicate("/a.ts", function () {}, function () {})
      compare(fakeRpc.calls[0].channel, "files:duplicate")
      compare(fakeRpc.calls[0].args[0], "/a.ts")
    }

    function test_move_invokes_with_source_and_dest() {
      store.move("/src/a.ts", "/dest", function () {}, function () {})
      compare(fakeRpc.calls[0].channel, "files:move")
      compare(fakeRpc.calls[0].args[0], "/src/a.ts")
      compare(fakeRpc.calls[0].args[1], "/dest")
    }

    function test_create_file_invokes() {
      store.createFile("/dir", "new.ts", function () {}, function () {})
      compare(fakeRpc.calls[0].channel, "files:createFile")
      compare(fakeRpc.calls[0].args[0], "/dir")
      compare(fakeRpc.calls[0].args[1], "new.ts")
    }

    function test_create_folder_invokes() {
      store.createFolder("/dir", "subdir", function () {}, function () {})
      compare(fakeRpc.calls[0].channel, "files:createFolder")
      compare(fakeRpc.calls[0].args[0], "/dir")
      compare(fakeRpc.calls[0].args[1], "subdir")
    }

    // ---- prepareSession --------------------------------------------------

    // Four args: conversationId, sourcePaths, method, renames?. method
    // is forced to "copy" when not "copy" / "symlink" so a typo can't
    // shoot itself in the foot before the server sees it.
    function test_prepare_session_with_renames() {
      var renames = ({ "/a/old.txt": "renamed.txt" })
      store.prepareSession(7, ["/a/old.txt", "/b/other.txt"], "copy", renames,
        function () {}, function () {})
      compare(fakeRpc.calls[0].channel, "files:prepareSession")
      compare(fakeRpc.calls[0].args[0], 7)
      deepEqual(fakeRpc.calls[0].args[1], ["/a/old.txt", "/b/other.txt"])
      compare(fakeRpc.calls[0].args[2], "copy")
      deepEqual(fakeRpc.calls[0].args[3], renames)
    }

    function test_prepare_session_without_renames() {
      store.prepareSession(7, ["/a"], "symlink",
        undefined, function () {}, function () {})
      compare(fakeRpc.calls[0].args.length, 3,
        "no renames -> 3 args, not 4")
      compare(fakeRpc.calls[0].args[2], "symlink")
    }

    function test_prepare_session_invalid_method_defaults_to_copy() {
      store.prepareSession(7, ["/a"], "rm -rf /",
        undefined, function () {}, function () {})
      compare(fakeRpc.calls[0].args[2], "copy",
        "invalid method is coerced to 'copy' so the server's validator catches it")
    }

    // ---- openTerminalHere ------------------------------------------------

    function test_open_terminal_here_invokes() {
      store.openTerminalHere("/home/me/proj")
      compare(fakeRpc.calls[0].channel, "files:openTerminalHere")
      compare(fakeRpc.calls[0].args[0], "/home/me/proj")
    }

    // ---- parseExcludePatterns --------------------------------------------

    function test_parse_exclude_patterns_basic() {
      deepEqual(store.parseExcludePatterns("a,b,c"), ["a", "b", "c"])
    }

    function test_parse_exclude_patterns_trims_whitespace() {
      deepEqual(store.parseExcludePatterns(" a , b ,c "), ["a", "b", "c"])
    }

    function test_parse_exclude_patterns_empty_inputs() {
      deepEqual(store.parseExcludePatterns(""), [])
      deepEqual(store.parseExcludePatterns(null), [])
      deepEqual(store.parseExcludePatterns(undefined), [])
    }

    // ---- signal emission -------------------------------------------------

    // Local commands emit signals instead of shelling out (CONTRACTS.md §2).
    function test_reveal_emits_signal() {
      var lastReveal = ""
      store.revealRequested.connect(function (p) { lastReveal = p })
      store.revealInFileManager("/some/path")
      compare(lastReveal, "/some/path")
    }

    function test_open_external_emits_signal() {
      var lastOpen = ""
      store.openExternalRequested.connect(function (p) { lastOpen = p })
      store.openExternal("/some/file")
      compare(lastOpen, "/some/file")
    }

    function test_trash_emits_signal() {
      var lastTrash = ""
      store.trashRequested.connect(function (p) { lastTrash = p })
      store.trash("/some/file")
      compare(lastTrash, "/some/file")
    }
  }
}
