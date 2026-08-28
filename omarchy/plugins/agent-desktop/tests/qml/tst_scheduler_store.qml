import QtQuick
import QtTest

// SchedulerStore, exercised in a real QML engine.
//
// The behaviour under test is not arithmetic — it is the store's reaction to
//   - load() (scheduler:list populates `tasks` + `taskOrder`, both
//     scheduler:listVariables and scheduler:backgroundStatus are called in
//     the same round)
//   - a `scheduler:taskUpdate` PUSH with a full ScheduledTask payload
//     (patches in place; does NOT touch `taskOrder`'s position)
//   - a `scheduler:taskUpdate` PUSH with `{id, deleted: true}` (removes
//     the row from `tasks` AND from `taskOrder`)
//   - optimistic CRUD (create/update/remove/toggle: each fires the right
//     channel and updates local state)
//   - failure paths (server refuses: the error string lands on `error`,
//     and the channel-dependent reload fires)
// All of these need a real QML engine because the store's value updates only
// cascade through QML's binding pipeline.
//
// The fake `rpc` is the same per-call-capture pattern as
// tst_settings_store.qml — every invoke lands in `calls`, with a record of
// the channel, args, and the success/error handlers; we resolve per-test by
// channel.
Item {
  width: 400
  height: 400

  QtObject {
    id: fakeRpc
    property var calls: []
    property var subs: []

    function invoke(channel, args, onOk, onErr) {
      calls = calls.concat([{ channel: channel, args: args || [], ok: onOk, err: onErr }])
      return calls.length
    }

    function subscribe(channel, handler) {
      subs = subs.concat([{ channel: channel, handler: handler }])
    }
    function unsubscribe(channel, handler) {
      var next = []
      for (var i = 0; i < subs.length; i++) {
        if (subs[i].channel === channel && subs[i].handler === handler) continue
        next.push(subs[i])
      }
      subs = next
    }

    // Deliver a push event as if it came from the bridge.
    function emit(channel, data) {
      for (var i = 0; i < subs.length; i++) {
        if (subs[i].channel === channel) subs[i].handler(data)
      }
    }

    function accept(channel, result) { callFor(channel).ok(result) }
    function refuse(channel, message) { callFor(channel).err(message) }
    function callFor(channel) {
      for (var i = calls.length - 1; i >= 0; i--) {
        if (calls[i].channel === channel) return calls[i]
      }
      throw new Error("no call to " + channel)
    }

    function reset() { calls = []; subs = [] }
    function channelsSoFar() {
      var out = []
      for (var i = 0; i < calls.length; i++) out.push(calls[i].channel)
      return out
    }
  }

  Loader {
    id: storeLoader
    Component.onCompleted: setSource("../../stores/SchedulerStore.qml", ({ rpc: fakeRpc }))
  }

  TestCase {
    name: "SchedulerStore"
    when: windowShown

    property var store: storeLoader.item

    function initTestCase() {
      verify(store !== null, "SchedulerStore.qml loaded")
    }

    function init() {
      fakeRpc.reset()
      // Reset the store to a clean slate, in case earlier tests left state.
      store.tasks = ({})
      store.taskOrder = []
      store.loaded = false
      store.loading = false
      store.error = ""
      store.background = ({ enabled: false, installed: false })
      store.variables = ({})
    }

    // ---- load --------------------------------------------------------------

    function test_load_requests_the_three_channels() {
      store.load()
      compare(fakeRpc.calls.length, 3,
        "load must call list + listVariables + backgroundStatus")
      var chans = fakeRpc.channelsSoFar()
      compare(chans.indexOf("scheduler:list") >= 0, true)
      compare(chans.indexOf("scheduler:listVariables") >= 0, true)
      compare(chans.indexOf("scheduler:backgroundStatus") >= 0, true)
      compare(store.loading, true)
    }

    function test_load_populates_tasks() {
      store.load()
      fakeRpc.accept("scheduler:list", [
        { id: 1, name: "hourly", interval_value: 1, interval_unit: "hours",
          enabled: true, conversation_id: 7, run_count: 0, max_runs: null,
          next_run_at: null, last_run_at: null, last_status: null },
        { id: 2, name: "daily", interval_value: 1, interval_unit: "days",
          enabled: false, conversation_id: 8, run_count: 3, max_runs: 5,
          next_run_at: null, last_run_at: null, last_status: "success" }
      ])
      fakeRpc.accept("scheduler:listVariables", ({ date: "today", cwd: "." }))
      fakeRpc.accept("scheduler:backgroundStatus", ({ enabled: false, installed: false }))
      compare(store.loaded, true)
      compare(store.loading, false)
      compare(store.taskOrder.length, 2)
      compare(store.taskOrder[0], 1)
      compare(store.taskOrder[1], 2)
      compare(store.tasks[1].name, "hourly")
      compare(store.tasks[2].name, "daily")
      compare(store.variables.date, "today")
      compare(store.background.installed, false)
    }

    function test_load_failure_surfaces_the_error() {
      store.load()
      fakeRpc.refuse("scheduler:list", "WebSocket disconnected")
      compare(store.loaded, false)
      compare(store.loading, false)
      compare(store.error, "WebSocket disconnected")
    }

    // ---- PUSH: full patch ---------------------------------------------------

    function test_push_full_patch_keeps_order() {
      store.load()
      fakeRpc.accept("scheduler:list", [
        { id: 1, name: "first", interval_value: 1, interval_unit: "minutes",
          enabled: true, conversation_id: 1, run_count: 0, max_runs: null,
          next_run_at: null, last_run_at: null, last_status: null }
      ])
      fakeRpc.accept("scheduler:listVariables", ({}))
      fakeRpc.accept("scheduler:backgroundStatus", ({ enabled: false, installed: false }))
      store.attach()

      fakeRpc.emit("scheduler:taskUpdate", {
        id: 1, name: "renamed", interval_value: 1, interval_unit: "minutes",
        enabled: false, conversation_id: 1, run_count: 4, max_runs: null,
        next_run_at: null, last_run_at: "2026-01-15T12:00:00.000Z", last_status: "success"
      })

      compare(store.tasks[1].name, "renamed",
        "full-patch push must update the row's name in place")
      compare(store.tasks[1].enabled, false)
      compare(store.tasks[1].run_count, 4)
      compare(store.taskOrder.length, 1,
        "patching an existing row must NOT add a duplicate to taskOrder")
      compare(store.taskOrder[0], 1)

      store.detach()
    }

    function test_push_full_patch_adds_unknown_id_to_order() {
      store.load()
      fakeRpc.accept("scheduler:list", [])
      fakeRpc.accept("scheduler:listVariables", ({}))
      fakeRpc.accept("scheduler:backgroundStatus", ({ enabled: false, installed: false }))
      store.attach()
      fakeRpc.emit("scheduler:taskUpdate", {
        id: 42, name: "late", interval_value: 15, interval_unit: "minutes",
        enabled: true, conversation_id: 1, run_count: 0, max_runs: null,
        next_run_at: null, last_run_at: null, last_status: null
      })
      compare(store.taskOrder.length, 1)
      compare(store.taskOrder[0], 42)
      compare(store.tasks[42].name, "late")
      store.detach()
    }

    // ---- PUSH: delete -------------------------------------------------------

    function test_push_delete_payload_removes_row() {
      store.load()
      fakeRpc.accept("scheduler:list", [
        { id: 1, name: "a", interval_value: 1, interval_unit: "minutes",
          enabled: true, conversation_id: 1, run_count: 0, max_runs: null,
          next_run_at: null, last_run_at: null, last_status: null },
        { id: 2, name: "b", interval_value: 1, interval_unit: "minutes",
          enabled: true, conversation_id: 1, run_count: 0, max_runs: null,
          next_run_at: null, last_run_at: null, last_status: null },
        { id: 3, name: "c", interval_value: 1, interval_unit: "minutes",
          enabled: true, conversation_id: 1, run_count: 0, max_runs: null,
          next_run_at: null, last_run_at: null, last_status: null }
      ])
      fakeRpc.accept("scheduler:listVariables", ({}))
      fakeRpc.accept("scheduler:backgroundStatus", ({ enabled: false, installed: false }))
      store.attach()

      fakeRpc.emit("scheduler:taskUpdate", ({ id: 2, deleted: true }))

      compare(store.tasks[2], undefined,
        "deleted row must be gone from tasks")
      compare(store.taskOrder.indexOf(2), -1,
        "deleted row must be gone from taskOrder")
      compare(store.taskOrder.length, 2)
      compare(store.taskOrder[0], 1)
      compare(store.taskOrder[1], 3)
      store.detach()
    }

    function test_push_delete_unknown_id_is_noop() {
      store.load()
      fakeRpc.accept("scheduler:list", [])
      fakeRpc.accept("scheduler:listVariables", ({}))
      fakeRpc.accept("scheduler:backgroundStatus", ({ enabled: false, installed: false }))
      store.attach()
      fakeRpc.emit("scheduler:taskUpdate", ({ id: 999, deleted: true }))
      compare(store.taskOrder.length, 0)
      compare(store.tasks[999], undefined)
      store.detach()
    }

    // ---- CRUD --------------------------------------------------------------

    function test_create_invokes_with_payload() {
      store.create({
        name: "new task", prompt: "do a thing",
        interval_value: 15, interval_unit: "minutes",
        catch_up: true, notify_desktop: true, notify_voice: false,
        pre_run_action: "none"
      })
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "scheduler:create")
      compare(fakeRpc.calls[0].args[0].name, "new task")
      compare(fakeRpc.calls[0].args[0].interval_value, 15)
      compare(fakeRpc.calls[0].args[0].interval_unit, "minutes")
    }

    function test_create_patches_returned_row() {
      store.create({ name: "x", prompt: "y", interval_value: 1, interval_unit: "minutes" })
      fakeRpc.accept("scheduler:create", {
        id: 99, name: "x", prompt: "y",
        interval_value: 1, interval_unit: "minutes",
        enabled: true, conversation_id: 1, run_count: 0, max_runs: null,
        next_run_at: null, last_run_at: null, last_status: null
      })
      compare(store.tasks[99].name, "x")
      compare(store.taskOrder.indexOf(99) >= 0, true)
    }

    function test_update_invokes_with_id_and_payload() {
      store.update(7, { name: "renamed" })
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "scheduler:update")
      compare(fakeRpc.calls[0].args[0], 7)
      compare(fakeRpc.calls[0].args[1].name, "renamed")
    }

    function test_update_patches_returned_row() {
      store.tasks = ({ 7: { id: 7, name: "old", interval_value: 1,
                             interval_unit: "minutes", enabled: true,
                             conversation_id: 1 } })
      store.taskOrder = [7]
      store.update(7, { name: "new" })
      fakeRpc.accept("scheduler:update", {
        id: 7, name: "new", interval_value: 1, interval_unit: "minutes",
        enabled: true, conversation_id: 1, run_count: 0, max_runs: null,
        next_run_at: null, last_run_at: null, last_status: null
      })
      compare(store.tasks[7].name, "new")
    }

    function test_remove_invokes_and_drops_locally() {
      store.tasks = ({ 7: { id: 7, name: "x" }, 8: { id: 8, name: "y" } })
      store.taskOrder = [7, 8]
      store.remove(7)
      compare(store.tasks[7], undefined, "row 7 dropped optimistically")
      compare(store.taskOrder.indexOf(7), -1)
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "scheduler:delete")
      compare(fakeRpc.calls[0].args[0], 7)
    }

    // A failed remove: the local copy is gone (optimistic), but the server's
    // error needs to be surfaced, AND the row was never really deleted on the
    // server, so a list reload is required to recover truth.
    function test_remove_failure_triggers_reload() {
      store.tasks = ({ 7: { id: 7, name: "x" } })
      store.taskOrder = [7]
      store.loaded = true
      store.remove(7)
      fakeRpc.refuse("scheduler:delete", "Permission denied")
      compare(store.error, "Permission denied")
      // After refuse, error path runs `load()`, which fires list +
      // listVariables + backgroundStatus. So the SECOND call is the new list.
      var chans = fakeRpc.channelsSoFar()
      compare(chans.indexOf("scheduler:delete") >= 0, true)
      compare(chans.indexOf("scheduler:list") >= 0, true,
        "a failed delete must trigger a list reload")
    }

    function test_toggle_is_optimistic() {
      store.tasks = ({ 7: { id: 7, name: "x", enabled: true } })
      store.taskOrder = [7]
      store.toggle(7, false)
      compare(store.tasks[7].enabled, false)
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "scheduler:toggle")
      compare(fakeRpc.calls[0].args[0], 7)
      compare(fakeRpc.calls[0].args[1], false)
    }

    function test_toggle_failure_triggers_reload() {
      store.tasks = ({ 7: { id: 7, name: "x", enabled: true } })
      store.taskOrder = [7]
      store.loaded = true
      store.toggle(7, false)
      fakeRpc.refuse("scheduler:toggle", "Not allowed")
      compare(store.error, "Not allowed")
      var chans = fakeRpc.channelsSoFar()
      compare(chans.indexOf("scheduler:list") >= 0, true,
        "a failed toggle must trigger a list reload")
    }

    function test_conversationTasks_filters_by_conversation() {
      store.tasks = ({
        1: { id: 1, conversation_id: 5 },
        2: { id: 2, conversation_id: 6 },
        3: { id: 3, conversation_id: 5 }
      })
      store.taskOrder = [1, 2, 3]
      var matches = store.conversationTasks(5)
      compare(matches.length, 2)
      compare(matches.indexOf(1) >= 0, true)
      compare(matches.indexOf(3) >= 0, true)
      compare(matches.indexOf(2), -1)
      compare(store.conversationTasks(99).length, 0)
    }

    function test_setBackground_invokes_and_updates() {
      store.setBackground(true)
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "scheduler:toggleBackground")
      compare(fakeRpc.calls[0].args[0], true)
      fakeRpc.accept("scheduler:toggleBackground", true)
      compare(store.background.enabled, true)
    }
  }
}
