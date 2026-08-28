import QtQuick

// MacrosStore — the macros:list / save / delete / load surface.
//
// Macros live on disk as JSON files under ~/.agent-desktop/macros (the server
// owns the directory); the store owns the in-memory list and the CRUD
// channels. Every write that touches a macro goes through here so the page
// can reload from a single source of truth and the `changed()` signal fires
// exactly once per write.
//
// The signal is the contract the chat input relies on: when a user saves,
// renames, or deletes a macro through the settings page, `ChatInput.qml`
// must invalidate its slash-command cache and re-run `commands:list`. The
// renderer equivalent is a `macros-changed` window event; the QML front
// uses a signal on this store instead, wired by Main.
//
// `macros:save(name, description, messages, oldName?)` accepts an optional
// fourth argument for renames. The store forwards all four as-is.
//
// One authoritative owner per value: nothing else writes to `macros`.
// `items` is an array of `{ name, description, messages }` (the messages
// list is hidden in the UI but kept so a future editor pane has it).
QtObject {
  id: store

  // Service.qml, which owns invoke/subscribe.
  required property var rpc

  property var macros: []         // Macro[] from macros:list
  property bool loaded: false
  property bool loading: false
  property string error: ""

  // Emitted after every successful write that mutates the macro set
  // (save / delete). Main wires this against ChatInput._loadCommands() so
  // the slash popup reloads without a full remount.
  signal changed()

  function load() {
    loading = true
    rpc.invoke("macros:list", [], applyList, function(err) {
      loading = false
      loaded = false
      error = String(err)
    })
  }

  function applyList(rows) {
    macros = Array.isArray(rows) ? rows : []
    loading = false
    loaded = true
  }

  // `messages` must be a non-empty array of non-empty strings (the server
  // enforces both). `oldName` is optional and is only set during a rename.
  function save(name, description, messages, oldName, onDone, onErr) {
    var args = [String(name || ""), String(description || "")]
    var msgArr = Array.isArray(messages) ? messages : []
    // args are positional and the server expects messages as a JS array;
    // JSON.stringify the args array so the bridge ships a real array.
    args.push(JSON.stringify(msgArr))
    if (oldName) args.push(String(oldName))
    rpc.invoke("macros:save", args, function(row) {
      // Re-fetch the list rather than patching in place; the server may
      // have renormalised (renamed file, dropped an empty description),
      // and the page binds to the array directly.
      load()
      changed()
      if (onDone) onDone(row)
    }, function(err) {
      error = String(err)
      if (onErr) onErr(err)
    })
  }

  function remove(name, onDone, onErr) {
    var dropped = String(name || "")
    rpc.invoke("macros:delete", [dropped], function() {
      // Drop locally so the row disappears immediately.
      var next = []
      var i
      for (i = 0; i < macros.length; i++) {
        if (macros[i].name !== dropped) next.push(macros[i])
      }
      macros = next
      changed()
      if (onDone) onDone()
    }, function(err) {
      error = String(err)
      if (onErr) onErr(err)
    })
  }
}