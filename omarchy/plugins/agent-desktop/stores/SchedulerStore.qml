import QtQuick

// The scheduled-task list and the channels that act on it.
//
// State that the page renders lives here: `tasks`, `variables`, `background`.
// One authoritative owner per value: nothing else writes to the task list.
//
// Two push payloads on `scheduler:taskUpdate` and both must be handled because
// the server decides which to send based on whether the row was changed or
// removed:
//
//   1. { id, name, ... }       — a full ScheduledTask; patch in place so the
//                                row does not flash, scroll position survives,
//                                and selection state is preserved.
//   2. { id, deleted: true }   — remove the row from the local list.
//
// The store does NOT emit a desktop notification itself. It exposes a
// `notifyRequested(title, body, event)` signal; Main wires that against
// lib/notify.js so the QML-tested store stays Quickshell-free. A store that
// imports Quickshell cannot be loaded by qmltestrunner (CONTRACTS.md §2).
QtObject {
  id: store

  // Service.qml, which owns invoke/subscribe.
  required property var rpc

  // taskId -> ScheduledTask. An object map keeps the patches O(1) and lets the
  // list view bind straight to a derived array.
  property var tasks: ({})
  // Ordered id list. Server sort order is authoritative — but a delete and a
  // patch through the same channel can race, so the list rebuild is local too.
  property var taskOrder: []
  // Whether the initial list() has answered. Until true, every render shows
  // the empty-state — there is no other signal that the rows really are zero.
  property bool loaded: false
  property bool loading: false
  property string error: ""

  // Variables the resolver can substitute into prompts ({cwd}, {date}, …).
  // Populated by `scheduler:listVariables`; the page does not render them
  // today but the channel exists and is tested headlessly.
  property var variables: ({})

  // Result of the last `scheduler:backgroundStatus` poll. The headless server
  // hard-codes installed:false (no Electron-side platform scheduler to inspect),
  // so what the page reads is exactly { enabled, installed: false }.
  property var background: ({ enabled: false, installed: false })

  // Emitted whenever the page should put a desktop notification up. Wired by
  // Main against lib/notify.js + Quickshell.execDetached; the store never
  // touches Quickshell itself. `event` is one of the seven NotificationEvent
  // keys (success | max_tokens | refusal | error_max_turns | error_max_budget
  // | error_execution | error_js) so the gate can be applied upstream.
  signal notifyRequested(string title, string body, string event)

  // Fired whenever the task set changes — used by the page to invalidate any
  // cached selection. Kept separate from notifyRequested so a UI re-render and
  // a system notification are distinct concerns.
  signal storeChanged()

  // ---- load ------------------------------------------------------------

  function load() {
    loading = true
    rpc.invoke("scheduler:list", [], applyList, function(err) {
      loading = false
      loaded = false
      error = String(err)
    })
    rpc.invoke("scheduler:listVariables", [], function(result) {
      variables = (result && typeof result === "object") ? result : ({})
    }, function() { /* missing channel is fine; the page doesn't render this yet */ })
    rpc.invoke("scheduler:backgroundStatus", [], function(result) {
      background = (result && typeof result === "object") ? result
        : ({ enabled: false, installed: false })
    }, function() { /* older server: keep default */ })
  }

  function applyList(rows) {
    var map = ({})
    var order = []
    if (rows && rows.length) {
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i]
        if (!row || row.id === undefined) continue
        map[row.id] = row
        order.push(row.id)
      }
    }
    tasks = map
    taskOrder = order
    loading = false
    loaded = true
    storeChanged()
  }

  // ---- CRUD ------------------------------------------------------------

  // Each create / update returns the fresh row; update() patches in place
  // without a refetch so the list does not flicker.
  function create(data, onDone, onErr) {
    rpc.invoke("scheduler:create", [data], function(row) {
      if (row && row.id !== undefined) patchRow(row)
      if (onDone) onDone(row)
    }, function(err) {
      error = String(err)
      if (onErr) onErr(err)
    })
  }

  function update(id, data, onDone, onErr) {
    rpc.invoke("scheduler:update", [id, data], function(row) {
      // Some servers send back the patched row; some send null. A refetch
      // would lose scroll, so we either patch in place OR rebuild the row
      // from the merge if it came back.
      if (row && row.id !== undefined) patchRow(row)
      if (onDone) onDone(row)
    }, function(err) {
      error = String(err)
      if (onErr) onErr(err)
    })
  }

  function remove(id) {
    // Drop locally first so the row disappears immediately. If the server
    // pushes the same change back through scheduler:taskUpdate (delete
    // payload) it is a no-op.
    dropRow(id)
    rpc.invoke("scheduler:delete", [id], function() {}, function(err) {
      error = String(err)
      // Reload to recover truth — a delete that fails on the server means
      // the row is still there.
      if (loaded) load()
    })
  }

  function toggle(id, enabled) {
    // Optimistic: flip locally first.
    var existing = tasks[id]
    if (existing) {
      var optimistic = ({})
      for (var k in existing) optimistic[k] = existing[k]
      optimistic.enabled = !!enabled
      patchRow(optimistic)
    }
    rpc.invoke("scheduler:toggle", [id, !!enabled], function() {}, function(err) {
      error = String(err)
      if (loaded) load()
    })
  }

  function conversationTasks(conversationId) {
    var matches = []
    var ids = taskOrder
    for (var i = 0; i < ids.length; i++) {
      var row = tasks[ids[i]]
      if (row && row.conversation_id === conversationId) matches.push(row.id)
    }
    return matches
  }

  function setBackground(enabled) {
    rpc.invoke("scheduler:toggleBackground", [!!enabled], function(result) {
      var fresh = background
      fresh.enabled = !!result
      background = fresh
    }, function(err) { error = String(err) })
  }

  // ---- push handling ---------------------------------------------------

  // Wire this on Component.onCompleted in Main; the test wires it manually
  // so the channel-name and the off-load happen in exactly one place.
  function attach() {
    rpc.subscribe("scheduler:taskUpdate", applyUpdate)
  }

  function detach() {
    rpc.unsubscribe("scheduler:taskUpdate", applyUpdate)
  }

  function applyUpdate(payload) {
    if (!payload || payload.id === undefined) return
    if (payload.deleted === true) {
      dropRow(payload.id)
      return
    }
    patchRow(payload)
  }

  // Patch in place: copy the row, swap into the map. The list view rebinds
  // via Object.values(tasks), and order is preserved. Toggling / patching does
  // not move a row.
  function patchRow(row) {
    var map = ({})
    for (var k in tasks) map[k] = tasks[k]
    map[row.id] = row
    tasks = map
    var order = taskOrder
    if (order.indexOf(row.id) < 0) {
      var next = order.slice()
      next.push(row.id)
      taskOrder = next
    }
    storeChanged()
  }

  function dropRow(id) {
    if (tasks[id] === undefined && taskOrder.indexOf(id) < 0) return
    var map = ({})
    for (var k in tasks) if (k !== String(id) && k !== id) map[k] = tasks[k]
    tasks = map
    var next = []
    var order = taskOrder
    for (var i = 0; i < order.length; i++) if (order[i] !== id) next.push(order[i])
    taskOrder = next
    storeChanged()
  }
}
