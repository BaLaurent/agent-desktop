import QtQuick
import QtTest

// SchedulerPage lifecycle + background-toggle integration.
//
// The bug this test pins: the page used to claim "`scheduler:taskUpdate`
// pushes declaratively" but no production code ever called `store.attach()`,
// so the subscription channel was never wired and a row edit on the server
// never reached the page. The fix lives in the page (Component.onCompleted /
// Component.onDestruction pair around store.attach/detach); this test asserts
// the contract holds: mount -> attach is recorded, destroy -> detach is
// recorded, and a real `scheduler:taskUpdate` payload lands on the row.
//
// The second contract pinned here is the new background-scheduler toggle:
// its `checked` binds to `store.background.enabled`, clicking it calls
// `store.setBackground(next)`, and a refused write lands on `store.error`
// so the page can render it.
//
// The page is instantiated via Qt.createComponent(absolutePath) + createObject
// — same pattern as the existing tst_chat_view.qml test. We can't use a Loader
// because the page's Component.onCompleted must run against a fully-resolved
// store reference; the harness's two Loader stages would race.
Item {
  id: harness
  width: 800
  height: 600

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
    function emit(channel, data) {
      for (var i = 0; i < subs.length; i++) {
        if (subs[i].channel === channel) subs[i].handler(data)
      }
    }
    function accept(channel, result) {
      for (var i = calls.length - 1; i >= 0; i--) {
        if (calls[i].channel === channel) { calls[i].ok(result); return }
      }
      throw new Error("no call to " + channel)
    }
    function refuse(channel, message) {
      for (var i = calls.length - 1; i >= 0; i--) {
        if (calls[i].channel === channel) { calls[i].err(message); return }
      }
      throw new Error("no call to " + channel)
    }
    function reset() { calls = []; subs = [] }
    function subscriptionCount(channel) {
      var n = 0
      for (var i = 0; i < subs.length; i++) if (subs[i].channel === channel) n++
      return n
    }
  }

  // Real SchedulerStore — the contract is "the page wires the store's
  // attach/detach on mount/destroy". A fake store would let me lie about
  // what got called.
  property var storeComponent: Qt.createComponent("../../stores/SchedulerStore.qml", Component.PreferSynchronous)
  property var store: null

  // The page itself, recreated per-test so each starts from a clean
  // attach/detach pair.
  property var pageComponent: Qt.createComponent("../../components/SchedulerPage.qml", Component.PreferSynchronous)
  property var page: null

  Component.onCompleted: {
    if (storeComponent.status !== Component.Ready) {
      console.warn("storeComponent error:", storeComponent.errorString())
    }
    if (pageComponent.status !== Component.Ready) {
      console.warn("pageComponent error:", pageComponent.errorString())
    }
    store = storeComponent.createObject(harness, { rpc: fakeRpc })
  }

  function mountPage() {
    page = pageComponent.createObject(harness, { store: store })
    return page
  }

  function unmountPage() {
    if (!page) return
    page.destroy()
    page = null
  }



  TestCase {
    name: "SchedulerPage"
    when: windowShown

    function initTestCase() {
      verify(harness.storeComponent.status === Component.Ready,
        "store component compiles: " + harness.storeComponent.errorString())
      verify(harness.pageComponent.status === Component.Ready,
        "page component compiles: " + harness.pageComponent.errorString())
      verify(harness.store !== null, "SchedulerStore loaded")
    }

    function init() {
      fakeRpc.reset()
      harness.store.tasks = ({})
      harness.store.taskOrder = []
      harness.store.loaded = false
      harness.store.loading = false
      harness.store.error = ""
      harness.store.background = ({ enabled: false, installed: false })
      harness.unmountPage()
    }

    function cleanup() {
      harness.unmountPage()
    }

    // Spin the event loop so any queued destruction (Component.onDestruction,
    // unsubscribes) settles before assertions. QML schedules `destroy()` for
    // the next tick; without this wait a test that immediately checks
    // `fakeRpc.subs` will still see the just-destroyed page's subscriptions.
    function pump() {
      wait(50)
    }

    function test_mount_subscribes_to_taskUpdate() {
      compare(fakeRpc.subscriptionCount("scheduler:taskUpdate"), 0,
        "sanity: no sub before mount")
      harness.mountPage()
      compare(fakeRpc.subscriptionCount("scheduler:taskUpdate"), 1,
        "SchedulerPage must call store.attach() on mount")
    }
    function test_unmount_unsubscribes() {
      harness.mountPage()
      verify(fakeRpc.subscriptionCount("scheduler:taskUpdate") === 1,
        "sanity: one sub after mount")
      harness.unmountPage()
      // page.destroy() is queued; spin the loop so Component.onDestruction
      // fires and detach() is reached before we check the sub count.
      wait(50)
      compare(fakeRpc.subscriptionCount("scheduler:taskUpdate"), 0,
        "SchedulerPage must call store.detach() on destroy")
    }
    function test_null_store_at_mount_does_not_throw() {
      // A fresh page with no store — the null-guard inside Component.onCompleted
      // must short-circuit. attach() is a method on the store; with store===null
      // it must never be called.
      var p = harness.pageComponent.createObject(harness, { store: null })
      verify(p !== null, "page instantiated with null store")
      compare(fakeRpc.subscriptionCount("scheduler:taskUpdate"), 0,
        "null store at mount -> no attach fired")
      p.destroy()
    }

    function test_push_updates_visible_row() {
      // Push channel works end-to-end: a scheduler:taskUpdate with a full
      // ScheduledTask payload lands in the store via the page's subscription.
      harness.mountPage()
      harness.store.load()
      fakeRpc.accept("scheduler:list", [
        { id: 1, name: "first", interval_value: 1, interval_unit: "minutes",
          enabled: true, conversation_id: 1, run_count: 0, max_runs: null,
          next_run_at: null, last_run_at: null, last_status: null }
      ])
      fakeRpc.accept("scheduler:listVariables", ({}))
      fakeRpc.accept("scheduler:backgroundStatus", ({ enabled: false, installed: false }))

      fakeRpc.emit("scheduler:taskUpdate", {
        id: 1, name: "renamed", interval_value: 1, interval_unit: "minutes",
        enabled: false, conversation_id: 1, run_count: 1, max_runs: null,
        next_run_at: null, last_run_at: null, last_status: "success"
      })

      compare(harness.store.tasks[1].name, "renamed",
        "an attached page must receive scheduler:taskUpdate patches")
    }

    // ---- background toggle -------------------------------------------

    function test_background_toggle_initially_reflects_store() {
      harness.store.background = ({ enabled: false, installed: false })
      harness.mountPage()
      var toggle = _findBackgroundToggle()
      verify(toggle !== null, "the background toggle must be reachable in the tree")
      compare(toggle.checked, false)
    }

    function test_background_toggle_click_invokes_setBackground() {
      harness.store.background = ({ enabled: false, installed: false })
      harness.mountPage()
      var toggle = _findBackgroundToggle()
      verify(toggle !== null)
      // Initially false. A user click flips it (handler does `checked = !checked`)
      // and writes the new value to store.setBackground.
      compare(toggle.checked, false, "sanity: starts off")
      toggle.clicked()
      var found = false
      for (var i = 0; i < fakeRpc.calls.length; i++) {
        if (fakeRpc.calls[i].channel === "scheduler:toggleBackground"
            && fakeRpc.calls[i].args[0] === true) {
          found = true
          break
        }
      }
      compare(found, true,
        "clicking the toggle must call store.setBackground(true)")
    }

    function test_background_toggle_refusal_surfaces_error() {
      harness.store.background = ({ enabled: false, installed: false })
      harness.mountPage()
      var toggle = _findBackgroundToggle()
      toggle.checked = true
      toggle.clicked()
      // The store's setBackground writes to error on refusal — the page
      // binds its error Rectangle to store.error.
      fakeRpc.refuse("scheduler:toggleBackground", "Server refused write")
      compare(harness.store.error, "Server refused write",
        "a refused background toggle must surface on store.error")
    }

    // Helper: walk the page's object tree to find the Background Toggle.
    // Doing it here keeps the test honest — if the page refactors the toggle
    // into a sub-component, this finds it the way a user would.
    function _findBackgroundToggle() {
      if (!harness.page) return null
      return _findToggleUnder(harness.page, "Enable background scheduler")
    }
    function _findToggleUnder(obj, label) {
      if (!obj) return null
      // Match by label property — Toggle is a qs.Ui component with a `label`.
      if (obj.label === label && typeof obj.clicked === "function") return obj
      var kids = obj.children || []
      for (var i = 0; i < kids.length; i++) {
        var hit = _findToggleUnder(kids[i], label)
        if (hit) return hit
      }
      return null
    }
}

// Row-level Delete-button coverage. The page renders a SchedulerTaskRow
// per task; this test exercises the row directly so we can pin the
// destructive-gate behaviour without driving a Repeater / ListView.
//
// Why it lives in tst_scheduler_page.qml: the row is part of the
// scheduler UI surface, and the only `store` implementation it talks
// to is SchedulerStore (which the page test already loads). A fake
// store is enough — we only care that the button calls store.remove
// with the right id, not that SchedulerStore then invokes the server.
QtObject {
  id: rowHarness

  // Capture-bag lives ON this QtObject (NOT inside the fake store's
  // `this`). A QtObject's `property var x: ({...})` wraps the inner
  // object in a V4ReferenceObject whose `this` is the Qt metaobject;
  // any method on the inner object reads `this.removedIds` via Qt's
  // metaobject system and never sees arrays we add later. The fix is
  // to keep the arrays as plain QML properties on this QtObject and
  // have the fake store's methods read them by reference.
  property var rowRemovedIds: []
  property var rowToggledIds: []

  // Fake store. Plain JS object — NOT a QtObject — so its method `this`
  // is the literal object the row holds. The methods reach the harness
  // arrays through `rowHarness` (this id) by closure: `_makeFakeStore`
  // is a property on the harness Item, and the row's `store` is
  // whatever value the test passes in. We capture-bag here, never on
  // the store itself.
  function _makeFakeStore() {
    return ({
      remove: function (id) { rowHarness.rowRemovedIds.push(id) },
      toggle: function (id, enabled) { rowHarness.rowToggledIds.push(id) }
    })
  }
  property var fakeStore: rowHarness._makeFakeStore()

  function _resetFakeStore() {
    rowHarness.rowRemovedIds = []
    rowHarness.rowToggledIds = []
    rowHarness.fakeStore = rowHarness._makeFakeStore()
  }

  property var task: ({
    id: 7,
    name: "weekly report",
    interval_value: 1,
    interval_unit: "weeks",
    enabled: true,
    conversation_id: 1,
    run_count: 0,
    max_runs: null,
    next_run_at: null,
    last_run_at: null,
    last_status: null
  })

  property var rowComponent: Qt.createComponent("../../components/SchedulerTaskRow.qml", Component.PreferSynchronous)
  property var row: null

  // Find the row's Delete button by traversing children — the button
  // text is the most stable identifier and changes from "Delete" to
  // "Confirm?" once the row is armed.
  function _findDeleteButton(parent) {
    if (!parent) return null
    if (parent.text === "Delete" || parent.text === "Confirm?") {
      if (typeof parent.clicked === "function") return parent
    }
    var kids = parent.children || []
    for (var i = 0; i < kids.length; i++) {
      var hit = _findDeleteButton(kids[i])
      if (hit) return hit
    }
    return null
  }
}


TestCase {
  name: "SchedulerTaskRowDelete"
  when: windowShown

  function initTestCase() {
    verify(rowHarness.rowComponent.status === Component.Ready,
      "row component compiles: " + rowHarness.rowComponent.errorString())
  }
  function init() {
    rowHarness._resetFakeStore()
    if (rowHarness.row) { rowHarness.row.destroy(); rowHarness.row = null }
  }

  function cleanup() {
    if (rowHarness.row) { rowHarness.row.destroy(); rowHarness.row = null }
  }

  function _mountRow() {
    rowHarness.row = rowHarness.rowComponent.createObject(harness,
      { task: rowHarness.task, store: rowHarness.fakeStore, nowIso: "2026-08-28T10:00:00Z" })
    verify(rowHarness.row !== null, "row instantiated")
    return rowHarness.row
  }

  // The Delete button must exist on the row and read "Delete" before
  // any click. A row whose only "destructive" affordance is hidden is
  // the same bug as the missing Delete button we just shipped against.
  function test_delete_button_is_present_and_unarmed() {
    var row = _mountRow()
    var btn = rowHarness._findDeleteButton(row)
    verify(btn !== null, "the row must expose a Delete button")
    compare(btn.text, "Delete", "starts in unarmed state")
    compare(rowHarness.rowRemovedIds.length, 0,
      "no remove() call before the user clicks")
  }

  // The first click is just an arm — it must change the label but not
  // call store.remove(). A delete that fires on first click would
  // erase the task on a stray mis-click; the whole point of the gate
  // is that a single click is harmless.
  function test_first_click_arms_does_not_remove() {
    var row = _mountRow()
    var btn = rowHarness._findDeleteButton(row)
    verify(btn !== null)
    btn.clicked()
    compare(btn.text, "Confirm?", "first click arms the button")
    compare(rowHarness.rowRemovedIds.length, 0,
      "armed click MUST NOT call store.remove()")
  }

  // The second click on the same armed button is the one that
  // reaches store.remove(id). This is the contract the Electron parity
  // gap asked for: the store function exists; this is the only path
  // from a click to a row removal.
  function test_second_click_invokes_store_remove() {
    var row = _mountRow()
    var btn = rowHarness._findDeleteButton(row)
    btn.clicked()  // arm
    btn.clicked()  // confirm
    compare(rowHarness.rowRemovedIds.length, 1,
      "second click on the armed Delete button must call store.remove(id) once")
    compare(rowHarness.rowRemovedIds[0], 7,
      "remove() called with the row's task id")
    compare(btn.text, "Delete",
      "button disarms after the destructive action fires")
  }

  // The store is what tells us the task is gone — there is no separate
  // "removed" signal. The row just hands the id off; the store drops
  // the row from its own map and asks the server to confirm.
  function test_remove_handles_missing_task_id_gracefully() {
    rowHarness.row = rowHarness.rowComponent.createObject(harness,
      { task: ({ name: "no-id" }), store: rowHarness.fakeStore, nowIso: "2026-08-28T10:00:00Z" })
    verify(rowHarness.row !== null, "row mounted with task lacking id")
    var btn = rowHarness._findDeleteButton(rowHarness.row)
    btn.clicked()
    btn.clicked()
    compare(rowHarness.rowRemovedIds.length, 0,
      "no remove() call when task has no id — defensive guard")
  }
}

}
