import QtQuick
import QtTest

// FileTree's context menu, trash confirmation, and inline new-file
// dialog, exercised in a real QML engine.
//
// The behaviour under test is the component's UI contract:
//   - right-click populates the menu, which only offers the items that
//     make sense for the clicked node's kind (file vs directory);
//   - "Move to trash" opens a ConfirmDialog and only fires
//     `trashConfirmed` after the user confirms — a stray right-click
//     cannot delete work;
//   - "New file here…" opens an inline TextField; the OK handler
//     rejects empty / whitespace-only / slash-containing names before
//     touching the store, and accepts via Enter as well as button click;
//   - the four shell-out operations (reveal, open externally, open
//     terminal here, trash) all surface as signals rather than calling
//     Quickshell directly — the component never imports Quickshell.
//
// Menu actions are exposed as named `root._action*` functions so the
// test can invoke them without driving a real popup() (which requires
// a mouse position and a running event loop).
Item {
  width: 600
  height: 600

  QtObject {
    id: fakeStore
    property var tree: []
    property var flat: []
    property bool loading: false
    property string error: ""
    property var rpc: fakeRpc

    // Channel calls captured for assertions.
    property var calls: []

    function invoke(channel, args, onOk, onErr) {
      calls = calls.concat([{ channel: channel, args: args || [],
                              ok: onOk, err: onErr }])
      return calls.length
    }
    function load(cwd) { /* unused */ }
    function loadFlat(path) { /* unused */ }
    function read(path) { /* unused */ }
    function revealInFileManager(path) {
      calls = calls.concat([{ channel: "store.revealInFileManager",
                              args: [String(path || "")] }])
    }
    function openExternal(path) {
      calls = calls.concat([{ channel: "store.openExternal",
                              args: [String(path || "")] }])
    }
    function openTerminalHere(path) {
      calls = calls.concat([{ channel: "store.openTerminalHere",
                              args: [String(path || "")] }])
    }
    function trash(path) {
      calls = calls.concat([{ channel: "store.trash",
                              args: [String(path || "")] }])
    }
    function duplicate(path, onOk, onErr) {
      calls = calls.concat([{ channel: "store.duplicate",
                              args: [String(path || "")], ok: onOk, err: onErr }])
    }
    function rename(path, newName, onOk, onErr) {
      // The component will resolve `this.calls` through the QtObject's
      // metaobject and record the rename exactly as it would for any
      // other channel — we don't need any plumbing for clipboard here.
      calls = calls.concat([{ channel: "store.rename",
                              args: [String(path || ""), String(newName || "")],
                              ok: onOk, err: onErr }])
      // Default-success: invoke the ok callback so the component's
      // post-success path runs (rename() calls _cancelRename() on ok).
      if (onOk) onOk({ ok: true })
    }
    function createFile(dir, name, onOk, onErr) {
      calls = calls.concat([{ channel: "store.createFile",
                              args: [String(dir || ""), String(name || "")],
                              ok: onOk, err: onErr }])
    }
    function subscribe() {}
    function unsubscribe() {}
  }

  QtObject {
    id: fakeRpc
    function invoke() { return 1 }
    function subscribe() {}
    function unsubscribe() {}
  }

  property var treeC: null
  function treeComponent() {
    if (!treeC) {
      treeC = Qt.createComponent("../../components/FileTree.qml",
        Component.PreferSynchronous)
    }
    return treeC
  }

  Item { id: host }

  function makeTree(props) {
    var merged = ({ store: fakeStore })
    if (props) for (var k in props) merged[k] = props[k]
    return treeComponent().createObject(host, merged)
  }

  // Drain captured calls of one channel so tests can match the next
  // call only (the store also takes convenience calls the component
  // never makes; we ignore those).
  function callsFor(channel) {
    var out = []
    for (var i = 0; i < fakeStore.calls.length; i++) {
      if (fakeStore.calls[i].channel === channel) out.push(fakeStore.calls[i])
    }
    return out
  }


  // A second fake store + component loader for the conversation
  // action bar. The store is a top-level QtObject with `function`
  // declarations so QML recognises them as callable methods — same
  // pattern as tst_folder_tree.qml's fakeStore. We keep the bar
  // component loader on a small QtObject so tests can call
  // convHarness.createBar() without restating the createObject args.
  //
  // A plain JS object would have its `selectedIds` accessed as a
  // property accessor (returning the function value), not invoked.
  QtObject {
    id: convStore

    property var colorCalls: []
    property var selectedIdsArr: []

    function selectedIds() { return convStore.selectedIdsArr }
    function clearSelection() {}
    function moveMany() {}
    function deleteMany() {}
    function colorMany(ids, color) {
      convStore.colorCalls = convStore.colorCalls.concat([{
        ids: ids.slice(),
        color: color === undefined ? null : color
      }])
    }
  }

  QtObject {
    id: convHarness
    property var barC: Qt.createComponent("../../components/ConversationActionBar.qml",
      Component.PreferSynchronous)
    function createBar() {
      return barC.createObject(host, { store: convStore })
    }
  }

  TestCase {
    name: "FileTreeContextMenu"
    when: windowShown

    function init() {

      fakeStore.calls = []
      fakeStore.tree = []
      // reset before each colour test, otherwise state leaks across.
      convStore.colorCalls = []
      convStore.selectedIdsArr = []
    }

    function test_component_compiles() {
      verify(treeComponent().status === Component.Ready,
        treeComponent().errorString())
    }

    // ---- signal forwarding --------------------------------------------

    // "Open terminal here" on a directory must emit openTerminalRequested
    // with the directory's path. The fake store's openTerminalHere is a
    // marker — the real wiring (Quickshell.execDetached(["foot", "-d", path]))
    // lives in Main and is not exercised here.
    function test_directory_open_terminal_emits_signal() {
      fakeStore.tree = [
        { name: "src", path: "/home/me/proj/src", isDirectory: true, children: [] }
      ]
      var t = makeTree({})
      var captured = ""
      t.openTerminalRequested.connect(function (p) { captured = String(p) })
      t._openContextMenu("/home/me/proj/src", true)
      t._actionOpenTerminalHere()
      compare(captured, "/home/me/proj/src")
      t.destroy()
    }

    function test_file_open_external_emits_signal() {
      fakeStore.tree = [
        { name: "main.ts", path: "/home/me/proj/main.ts", isDirectory: false }
      ]
      var t = makeTree({})
      var captured = ""
      t.openExternalRequested.connect(function (p) { captured = String(p) })
      t._openContextMenu("/home/me/proj/main.ts", false)
      t._actionOpenExternal()
      compare(captured, "/home/me/proj/main.ts")
      t.destroy()
    }

    function test_reveal_emits_signal_on_any_node() {
      // Reveal must work for both files and directories — the previous
      // behaviour called store.revealInFileManager directly. After the
      // menu refactor it surfaces as `revealRequested`, which Main wires
      // to execDetached.
      fakeStore.tree = [
        { name: "src", path: "/home/me/proj/src", isDirectory: true, children: [] },
        { name: "main.ts", path: "/home/me/proj/main.ts", isDirectory: false }
      ]
      var t = makeTree({})
      var captured = []
      t.revealRequested.connect(function (p) { captured.push(String(p)) })
      t._openContextMenu("/home/me/proj/src", true)
      t._actionReveal()
      t._openContextMenu("/home/me/proj/main.ts", false)
      t._actionReveal()
      compare(captured.length, 2)
      compare(captured[0], "/home/me/proj/src")
      compare(captured[1], "/home/me/proj/main.ts")
      t.destroy()
    }

    function test_duplicate_calls_store() {
      fakeStore.tree = [
        { name: "main.ts", path: "/home/me/proj/main.ts", isDirectory: false }
      ]
      var t = makeTree({})
      t._openContextMenu("/home/me/proj/main.ts", false)
      t._actionDuplicate()
      var dups = callsFor("store.duplicate")
      compare(dups.length, 1)
      compare(dups[0].args[0], "/home/me/proj/main.ts")
      t.destroy()
    }

    // ---- menu visibility by node kind ---------------------------------

    // Right-click on a directory opens the dialog flow that ends with
    // _newFileDialogOpen. The "New file here…" action is only valid for
    // directories; on files the action is a no-op (`_requestNewFileHere`
    // bails when _contextIsDir is false), so even if a stray trigger
    // reaches it the dialog stays closed.
    function test_new_file_here_no_op_on_files() {
      fakeStore.tree = [
        { name: "main.ts", path: "/home/me/proj/main.ts", isDirectory: false }
      ]
      var t = makeTree({})
      t._openContextMenu("/home/me/proj/main.ts", false)
      t._actionNewFileHere()
      compare(t._newFileDialogOpen, false,
        "file context does not open the new-file dialog")
      compare(callsFor("store.createFile").length, 0)
      t.destroy()
    }

    // ---- trash confirmation -------------------------------------------

    // Picking "Move to trash" must NOT shell out by itself — it must
    // open the ConfirmDialog and only fire trashConfirmed on confirm.
    // Otherwise a stray right-click could delete work.
    function test_trash_requires_confirmation() {
      fakeStore.tree = [
        { name: "main.ts", path: "/home/me/proj/main.ts", isDirectory: false }
      ]
      var t = makeTree({})
      var emitted = ""
      t.trashConfirmed.connect(function (p) { emitted = String(p) })
      t._openContextMenu("/home/me/proj/main.ts", false)
      t._actionTrash()
      // Dialog must be open; signal must NOT have fired yet.
      compare(t._pendingTrashPath, "/home/me/proj/main.ts",
        "trash path captured before dialog")
      compare(t.confirmDialog.opened, true, "ConfirmDialog opened")
      compare(emitted, "", "trashConfirmed NOT emitted before confirmation")
      t.destroy()
    }

    function test_trash_cancel_does_not_emit() {
      fakeStore.tree = [
        { name: "main.ts", path: "/home/me/proj/main.ts", isDirectory: false }
      ]
      var t = makeTree({})
      var emitted = 0
      t.trashConfirmed.connect(function () { emitted += 1 })
      t._openContextMenu("/home/me/proj/main.ts", false)
      t._actionTrash()
      // Simulate the user clicking "Cancel" on the dialog.
      t.confirmDialog.canceled()
      compare(emitted, 0, "trashConfirmed NOT emitted on cancel")
      compare(t._pendingTrashPath, "", "pending path cleared on cancel")
      compare(t.confirmDialog.opened, false, "dialog closed on cancel")
      t.destroy()
    }

    function test_trash_confirm_emits_signal_and_clears_state() {
      fakeStore.tree = [
        { name: "main.ts", path: "/home/me/proj/main.ts", isDirectory: false }
      ]
      var t = makeTree({})
      var emitted = ""
      t.trashConfirmed.connect(function (p) { emitted = String(p) })
      t._openContextMenu("/home/me/proj/main.ts", false)
      t._actionTrash()
      // Simulate the user confirming.
      t.confirmDialog.confirmed()
      compare(emitted, "/home/me/proj/main.ts",
        "trashConfirmed emitted with the path Main wires to execDetached")
      compare(t._pendingTrashPath, "", "pending path cleared on confirm")
      compare(t.confirmDialog.opened, false, "dialog closed on confirm")
      t.destroy()
    }

    function test_trash_works_for_directory_too() {
      // A directory right-click should ALSO confirm before trashing;
      // there's no separate confirm path for files vs dirs.
      fakeStore.tree = [
        { name: "src", path: "/home/me/proj/src", isDirectory: true, children: [] }
      ]
      var t = makeTree({})
      var emitted = ""
      t.trashConfirmed.connect(function (p) { emitted = String(p) })
      t._openContextMenu("/home/me/proj/src", true)
      t._actionTrash()
      compare(t.confirmDialog.opened, true)
      t.confirmDialog.confirmed()
      compare(emitted, "/home/me/proj/src",
        "directory trash confirmed emits the directory path")
      t.destroy()
    }

    // ---- new-file name validation --------------------------------------

    function test_new_file_empty_name_rejected() {
      fakeStore.tree = [
        { name: "src", path: "/home/me/proj/src", isDirectory: true, children: [] }
      ]
      var t = makeTree({})
      t._openContextMenu("/home/me/proj/src", true)
      t._actionNewFileHere()
      compare(t._newFileDialogOpen, true, "dialog opened")
      // No name typed — simulate clicking Create with empty text.
      t._newFileName = ""
      t._confirmNewFile()
      compare(t._newFileDialogOpen, true,
        "dialog stays open on empty name")
      compare(t._newFileError.length > 0, true,
        "error message is set")
      compare(callsFor("store.createFile").length, 0,
        "store.createFile NOT called for empty name")
      t.destroy()
    }

    function test_new_file_whitespace_name_rejected() {
      fakeStore.tree = [
        { name: "src", path: "/home/me/proj/src", isDirectory: true, children: [] }
      ]
      var t = makeTree({})
      t._openContextMenu("/home/me/proj/src", true)
      t._actionNewFileHere()
      t._newFileName = "   "
      t._confirmNewFile()
      compare(t._newFileDialogOpen, true, "dialog stays open on whitespace")
      compare(callsFor("store.createFile").length, 0)
      t.destroy()
    }

    function test_new_file_slash_name_rejected() {
      fakeStore.tree = [
        { name: "src", path: "/home/me/proj/src", isDirectory: true, children: [] }
      ]
      var t = makeTree({})
      t._openContextMenu("/home/me/proj/src", true)
      t._actionNewFileHere()
      t._newFileName = "sub/file.ts"
      t._confirmNewFile()
      compare(t._newFileDialogOpen, true,
        "dialog stays open on slash in name")
      compare(t._newFileError.indexOf("/") >= 0, true,
        "error message mentions /")
      compare(callsFor("store.createFile").length, 0,
        "store.createFile NOT called for slash name")
      t.destroy()
    }

    function test_new_file_valid_name_calls_store() {
      fakeStore.tree = [
        { name: "src", path: "/home/me/proj/src", isDirectory: true, children: [] }
      ]
      var t = makeTree({})
      t._openContextMenu("/home/me/proj/src", true)
      t._actionNewFileHere()
      t._newFileName = "hello.ts"
      t._confirmNewFile()
      var creats = callsFor("store.createFile")
      compare(creats.length, 1)
      compare(creats[0].args[0], "/home/me/proj/src")
      compare(creats[0].args[1], "hello.ts")
      compare(t._newFileDialogOpen, false,
        "dialog closes after a successful create")
      t.destroy()
    }

    function test_new_file_trims_whitespace_around_valid_name() {
      fakeStore.tree = [
        { name: "src", path: "/home/me/proj/src", isDirectory: true, children: [] }
      ]
      var t = makeTree({})
      t._openContextMenu("/home/me/proj/src", true)
      t._actionNewFileHere()
      t._newFileName = "  hello.ts  "
      t._confirmNewFile()
      var creats = callsFor("store.createFile")
      compare(creats.length, 1)
      compare(creats[0].args[1], "hello.ts",
        "surrounding whitespace is trimmed")
      t.destroy()
    }

    function test_new_file_cancel_resets_state() {
      fakeStore.tree = [
        { name: "src", path: "/home/me/proj/src", isDirectory: true, children: [] }
      ]
      var t = makeTree({})
      t._openContextMenu("/home/me/proj/src", true)
      t._actionNewFileHere()
      t._newFileName = "draft"
      t._cancelNewFile()
      compare(t._newFileDialogOpen, false, "dialog closed on cancel")
      compare(t._newFileName, "", "name field reset")
      compare(t._newFileError, "", "error reset")
      compare(callsFor("store.createFile").length, 0,
        "store NOT called on cancel")
      t.destroy()
    }

    function test_new_file_validation_helper_direct() {
      // Drive _validateNewFileName directly so the rules are pinned
      // independently of the dialog flow.
      var t = makeTree({})
      compare(t._validateNewFileName(""), "Name cannot be empty")
      compare(t._validateNewFileName("   "), "Name cannot be empty")
      compare(t._validateNewFileName("a/b"), "Name cannot contain /")
      compare(t._validateNewFileName("/leading"), "Name cannot contain /")
      compare(t._validateNewFileName("ok.ts"), "")
      compare(t._validateNewFileName("  ok.ts  "), "",
        "pure trim doesn't trigger an error")
    }

    // ---- rename flow ----------------------------------------------------
    //
    // The Rename menu item surfaces an inline TextField scrim and
    // delegates to store.rename(path, newName, onOk, onErr). The contract
    // pinned here: the rename call carries the file's full path and the
    // trimmed new name; whitespace is trimmed; the scrim closes on a
    // successful ok callback.
    function test_rename_action_reaches_store_with_path_and_new_name() {
      fakeStore.tree = [
        { name: "main.ts", path: "/home/me/proj/main.ts", isDirectory: false }
      ]
      var t = makeTree({})
      t._openContextMenu("/home/me/proj/main.ts", false)
      t._actionRename()
      compare(t._renameDialogOpen, true, "rename scrim opens")
      compare(t._renamePath, "/home/me/proj/main.ts",
        "rename captures the right-clicked path")
      compare(t._renameOriginalName, "main.ts",
        "rename pre-fills the basename")
      t._renameNewName = "renamed.ts"
      t._confirmRename()
      var renames = callsFor("store.rename")
      compare(renames.length, 1, "store.rename called once")
      compare(renames[0].args[0], "/home/me/proj/main.ts",
        "rename passes the absolute path as the first arg")
      compare(renames[0].args[1], "renamed.ts",
        "rename passes the trimmed new name as the second arg")
      compare(t._renameDialogOpen, false,
        "scrim closes after a successful rename")
      t.destroy()
    }

    function test_rename_trims_whitespace_around_name() {
      fakeStore.tree = [
        { name: "main.ts", path: "/home/me/proj/main.ts", isDirectory: false }
      ]
      var t = makeTree({})
      t._openContextMenu("/home/me/proj/main.ts", false)
      t._actionRename()
      t._renameNewName = "  renamed.ts  "
      t._confirmRename()
      var renames = callsFor("store.rename")
      compare(renames.length, 1)
      compare(renames[0].args[1], "renamed.ts",
        "rename trims surrounding whitespace before calling the store")
      t.destroy()
    }

    function test_rename_empty_name_rejected() {
      fakeStore.tree = [
        { name: "main.ts", path: "/home/me/proj/main.ts", isDirectory: false }
      ]
      var t = makeTree({})
      t._openContextMenu("/home/me/proj/main.ts", false)
      t._actionRename()
      t._renameNewName = ""
      t._confirmRename()
      compare(t._renameDialogOpen, true,
        "scrim stays open on empty name")
      compare(callsFor("store.rename").length, 0,
        "store.rename NOT called for empty name")
      t.destroy()
    }

    function test_rename_slash_name_rejected() {
      fakeStore.tree = [
        { name: "main.ts", path: "/home/me/proj/main.ts", isDirectory: false }
      ]
      var t = makeTree({})
      t._openContextMenu("/home/me/proj/main.ts", false)
      t._actionRename()
      t._renameNewName = "sub/file.ts"
      t._confirmRename()
      compare(t._renameDialogOpen, true,
        "scrim stays open on /-containing name")
      compare(callsFor("store.rename").length, 0,
        "store.rename NOT called for slash-containing name")
      t.destroy()
    }

    function test_rename_same_name_is_noop() {
      // "Renaming" to the same name would write a no-op through to the
      // server. The component short-circuits this so we never round-trip
      // when nothing changed.
      fakeStore.tree = [
        { name: "main.ts", path: "/home/me/proj/main.ts", isDirectory: false }
      ]
      var t = makeTree({})
      t._openContextMenu("/home/me/proj/main.ts", false)
      t._actionRename()
      t._renameNewName = "main.ts"
      t._confirmRename()
      compare(callsFor("store.rename").length, 0,
        "renaming to the same name must NOT call store.rename")
      compare(t._renameDialogOpen, false,
        "scrim closes on a same-name submit")
      t.destroy()
    }

    function test_rename_cancel_resets_state() {
      fakeStore.tree = [
        { name: "main.ts", path: "/home/me/proj/main.ts", isDirectory: false }
      ]
      var t = makeTree({})
      t._openContextMenu("/home/me/proj/main.ts", false)
      t._actionRename()
      t._renameNewName = "draft"
      t._cancelRename()
      compare(t._renameDialogOpen, false)
      compare(t._renamePath, "")
      compare(t._renameOriginalName, "")
      compare(t._renameNewName, "")
      compare(callsFor("store.rename").length, 0,
        "store NOT called on cancel")
      t.destroy()
    }

    function test_rename_validation_helper_direct() {
      // Pin the rules independent of the dialog flow.
      var t = makeTree({})
      compare(t._validateRenameName(""), "Name cannot be empty")
      compare(t._validateRenameName("   "), "Name cannot be empty")
      compare(t._validateRenameName("a/b"), "Name cannot contain /")
      compare(t._validateRenameName("/leading"), "Name cannot contain /")
      compare(t._validateRenameName("ok.ts"), "")
      compare(t._validateRenameName("  ok.ts  "), "",
        "pure trim doesn't trigger an error")
      t.destroy()
    }

    // ---- copy path ------------------------------------------------------
    //
    // "Copy path" writes the file's path to the system clipboard via a
    // hidden TextEdit's copy(). The text we send down is the right-clicked
    // path verbatim — no transformation, no leading slash, no decoration.
    function test_copy_path_writes_to_clipboard_sink() {
      fakeStore.tree = [
        { name: "main.ts", path: "/home/me/proj/main.ts", isDirectory: false }
      ]
      var t = makeTree({})
      t._openContextMenu("/home/me/proj/main.ts", false)
      t._actionCopyPath()
      // The hidden TextEdit is the clipboard sink; its text mirrors the
      // path the action copied. We assert via _clipboardText (the property
      // the TextEdit binds to) rather than poking the TextEdit directly.
      compare(t._clipboardText, "/home/me/proj/main.ts",
        "the clipboard sink's text is the right-clicked path")
      t.destroy()
    }

    function test_copy_path_works_for_directory_too() {
      fakeStore.tree = [
        { name: "src", path: "/home/me/proj/src", isDirectory: true, children: [] }
      ]
      var t = makeTree({})
      t._openContextMenu("/home/me/proj/src", true)
      t._actionCopyPath()
      compare(t._clipboardText, "/home/me/proj/src",
        "copying a directory's path works the same as a file's")
      t.destroy()
    }
// ---- ConversationActionBar colour-tag (lives here per assignment) -
    //
    // No test file in this ownership set is a better fit for testing
    // ConversationActionBar — tst_scheduler_page.qml owns the scheduler
    // suite and tst_file_tree.qml owns the file-tree suite. The action
    // bar's colour palette lives here because its test shape (a fake
    // store that records colorMany) mirrors the file-tree fake store
    // already in this file. The component is loaded via the same
    // Two shared tree walkers, so the three colour tests agree on how a
    // control is located. The swatches are a Repeater of Buttons whose
    // `modelData` is the hex; the clear swatch is the one with the × glyph.
    function findByModelData(node, wanted) {
      if (!node) return null
      if (node.modelData && typeof node.modelData === "string"
          && node.modelData.toLowerCase() === String(wanted).toLowerCase()) return node
      var kids = node.children || []
      for (var i = 0; i < kids.length; i++) {
        var hit = findByModelData(kids[i], wanted)
        if (hit) return hit
      }
      return null
    }

    function findByText(node, wanted) {
      if (!node) return null
      if (node.text === wanted) return node
      var kids = node.children || []
      for (var i = 0; i < kids.length; i++) {
        var hit = findByText(kids[i], wanted)
        if (hit) return hit
      }
      return null
    }

    function test_color_swatch_calls_color_many_with_selected_ids() {
      convStore.colorCalls = []
      convStore.selectedIdsArr = [1, 3]
      var bar = convHarness.createBar()
      verify(bar !== null, "bar instantiated")

      var swatch = findByModelData(bar, "#ef4444")
      verify(swatch !== null, "the first swatch (#ef4444) is reachable")

      swatch.clicked()
      compare(convStore.colorCalls.length, 1,
        "one click reaches colorMany exactly once")
      compare(convStore.colorCalls[0].color, "#ef4444",
        "colorMany receives the swatch's own hex")
      compare(convStore.colorCalls[0].ids.join(","), "1,3",
        "and the whole current selection")
      bar.destroy()
    }
    // The clear swatch sends color=null, which is how `colorMany` removes a
    // tag rather than setting one.
    function test_clear_color_swatch_calls_color_many_with_null() {
      convStore.colorCalls = []
      convStore.selectedIdsArr = [5]
      var bar = convHarness.createBar()

      var btn = findByText(bar, "\u00d7")
      verify(btn !== null, "the clear swatch is reachable in the bar tree")

      btn.clicked()
      compare(convStore.colorCalls.length, 1,
        "the clear swatch must reach colorMany exactly once")
      compare(convStore.colorCalls[0].color, null,
        "clearing sends color=null, not a hex")
      compare(convStore.colorCalls[0].ids[0], 5,
        "and it passes the selected id")
      bar.destroy()
    }

    // With nothing selected there is nothing to colour. Two guarantees, and
    // the test wants both: the swatch is DISABLED (what the user sees) and the
    // handler is inert (what protects a programmatic call, and what stops
    // `store.colorMany` throwing while `store` is still null at build time).
    // The `enabled` half alone is not enough — the guard was once deleted
    // outright with the comment "colourMany fires regardless of selection".
    function test_color_swatch_is_inert_with_no_selection() {
      convStore.colorCalls = []
      convStore.selectedIdsArr = []
      var bar = convHarness.createBar()

      var swatch = findByModelData(bar, "#ef4444")
      verify(swatch !== null, "the first swatch is reachable in the bar tree")
      compare(swatch.enabled, false, "no selection -> the swatch is disabled")

      swatch.clicked()
      compare(convStore.colorCalls.length, 0,
        "and its handler must not reach the store either")
      bar.destroy()
    }
  }
}
