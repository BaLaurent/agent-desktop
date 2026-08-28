import QtQuick
import QtTest

// Offscreen component tests for GitPane.qml.
//
// GitPane surfaces three store actions the renderer calls from its stash and
// panel-chrome widgets: stashSave (with the 1-arg vs 2-arg distinction pinned
// by tests/qml/tst_git_store.qml:348-359), stashPop (now confirmed), and
// fetch. This suite drives every visible state of those three controls and
// asserts what reaches the store. It runs offscreen with the same stubs
// tests/qml/imports carries for the rest of the suite.
//
// The fake store exposes the properties the PANE reads (cwd / isRepo / status
// / commits / branches / stashes / commitDetail) and captures every action
// call as { kind, args }. The pane routes through those actions — the test
// does not need a real channel.
//
Item {
  width: 600
  height: 800

  // ---- shared fakes ----

  // Records action calls. The pane reaches store.stashSave / store.stashPop /
  // store.fetch by name, so a single fake with those methods covers every
  // surface this test cares about.
  QtObject {
    id: fakeStore

    property string cwd: ""
    property bool isRepo: true
    property var status: ({ branch: "main", ahead: 0, behind: 0, detached: false, clean: true, files: [] })
    property var commits: []
    property var branches: []
    property var stashes: []
    property var commitDetail: null
    property string error: ""

    property var calls: []
    property var stashSaveMessages: []
    property var stashPopIndexes: []
    property int fetchCalls: 0
    property int refreshCalls: 0

    function stashSave(message) {
      calls = calls.concat([{ kind: "stashSave", args: Array.prototype.slice.call(arguments) }])
      // Mirror the real store's arg shaping so the test can assert wire
      // shape directly. If message is undefined/null/empty, real GitStore
      // sends the 1-arg form (calls[0].args.length === 1); the test pins
      // both forms.
      if (message !== undefined && message !== null && String(message).length > 0) {
        stashSaveMessages = stashSaveMessages.concat([String(message)])
      }
      return "ok"
    }
    function stashPop(index) {
      calls = calls.concat([{ kind: "stashPop", args: Array.prototype.slice.call(arguments) }])
      stashPopIndexes = stashPopIndexes.concat([Number(index)])
      return "ok"
    }
    function fetch(remote) {
      calls = calls.concat([{ kind: "fetch", args: Array.prototype.slice.call(arguments) }])
      fetchCalls = fetchCalls + 1
      return "ok"
    }
    function refresh() {
      refreshCalls = refreshCalls + 1
      return "ok"
    }
    function checkout() { return "ok" }
    function fetchCommitDetail() { return "ok" }

    function reset() {
      calls = []
      stashSaveMessages = []
      stashPopIndexes = []
      fetchCalls = 0
      refreshCalls = 0
      cwd = ""
      stashes = []
    }
  }

  Item { id: testCaseRoot }

  property var paneC: null
  function paneComponent() {
    if (!paneC) paneC = Qt.createComponent("../../components/GitPane.qml", Component.PreferSynchronous)
    return paneC
  }

  function makePane(opts) {
    var merged = ({ store: fakeStore })
    if (opts) {
      for (var k in opts) merged[k] = opts[k]
    }
    var p = paneComponent().createObject(testCaseRoot, merged)
    return p
  }

  // Walk children to find a Button by its text label. The pane has many
  // buttons, but only the ones we added (Fetch, Stash, Pop) are looked up
  // here, so a small linear scan is fine.
  function findButton(parent, label) {
    if (!parent) return null
    if (parent.text === label && typeof parent.clicked === "function") {
      return parent
    }
    var children = parent.children || []
    for (var i = 0; i < children.length; i++) {
      var hit = findButton(children[i], label)
      if (hit) return hit
    }
    return null
  }

  function findTextField(parent) {
    if (!parent) return null
    // The TextField stub exposes the standard QtQuick.Controls TextField API:
    // `text`, `placeholderText`, etc.
    if (parent.placeholderText !== undefined && parent.text !== undefined
        && typeof parent.text === "string"
        && parent.cursorVisible === undefined) {
      return parent
    }
    var children = parent.children || []
    for (var i = 0; i < children.length; i++) {
      var hit = findTextField(children[i])
      if (hit) return hit
    }
    return null
  }

  // ---- Fetch button gating ----

  TestCase {
    name: "GitPane.fetchButton"
    when: windowShown

    function init() { fakeStore.reset() }

    function test_fetch_inert_without_cwd() {
      // No cwd -> enabled must be false. An enabled Fetch with no cwd would
      // be a lie: git:fetch has nothing to act on, and the store's own
      // gating is the caller's responsibility (the store trusts it).
      fakeStore.cwd = ""
      var p = makePane()
      verify(p !== null, "GitPane created")
      var btn = findButton(p, "Fetch")
      verify(btn !== null, "Fetch button present")
      compare(btn.enabled, false,
        "Fetch must be disabled when there is no cwd")
      p.destroy()
    }

    function test_fetch_with_cwd_invokes_store() {
      fakeStore.cwd = "/home/me/proj"
      var p = makePane()
      var btn = findButton(p, "Fetch")
      verify(btn !== null)
      compare(btn.enabled, true, "Fetch must be enabled with a cwd")
      btn.clicked()
      compare(fakeStore.fetchCalls, 1, "Fetch click routes to store.fetch()")
      // store.fetch() takes an OPTIONAL remote; the pane calls it with no
      // args, so args.length is 0 at the call site but the 1-arg-form test
      // in tst_git_store.qml covers the wire side. Here we just confirm
      // the click reached the function.
      p.destroy()
    }
  }

  // ---- Stash save: message vs no-message, and gating ----

  TestCase {
    name: "GitPane.stashSave"
    when: windowShown

    function init() { fakeStore.reset() }

    function test_stash_save_button_inert_without_cwd() {
      // No cwd -> disabled. Same reason as Fetch: an enabled Stash button
      // on the "Not a git repository" pane would be unreachable and lying.
      fakeStore.cwd = ""
      var p = makePane()
      var btn = findButton(p, "Stash")
      verify(btn !== null, "Stash button present")
      compare(btn.enabled, false,
        "Stash must be disabled without a cwd")
      p.destroy()
    }

    function test_stash_save_with_message_uses_2arg_form() {
      fakeStore.cwd = "/home/me/proj"
      var p = makePane()
      // The pane exposes a property stashInputText the TextField mirrors.
      p.stashInputText = "WIP on main"
      var btn = findButton(p, "Stash")
      verify(btn !== null)
      compare(btn.enabled, true)
      btn.clicked()
      compare(fakeStore.calls.length, 1)
      compare(fakeStore.calls[0].kind, "stashSave")
      compare(fakeStore.calls[0].args.length, 1,
        "with a non-empty message, store.stashSave is called with exactly the message")
      compare(fakeStore.calls[0].args[0], "WIP on main")
      compare(p.stashInputText, "",
        "input must be cleared after a successful stash save")
      p.destroy()
    }

    function test_stash_save_with_empty_message_uses_1arg_form() {
      // Pinned by tests/qml/tst_git_store.qml:348-359: empty message ->
      // 1-arg stashSave() so the backend can auto-generate the subject.
      fakeStore.cwd = "/home/me/proj"
      var p = makePane()
      // Default stashInputText is "". Be explicit to make the intent clear.
      p.stashInputText = ""
      var btn = findButton(p, "Stash")
      verify(btn !== null)
      btn.clicked()
      compare(fakeStore.calls.length, 1)
      compare(fakeStore.calls[0].kind, "stashSave")
      compare(fakeStore.calls[0].args.length, 0,
        "empty message -> store.stashSave() with NO arguments so the wire form is 1-arg (cwd only). " +
        "Passing '' would write an empty stash subject; the 1-arg form lets the backend auto-generate.")
      p.destroy()
    }

    function test_stash_save_with_whitespace_only_message_uses_1arg_form() {
      // Whitespace-only is "the user typed something but it isn't a real
      // subject". The pane's boolean check (length > 0) treats that as
      // truthy, so a string of spaces WOULD reach the store as-is. That
      // is a known limit of the simple gating — the alternative is
      // trimming, which is out of scope. The test pins the simple form
      // so a future trimming change is a deliberate edit.
      fakeStore.cwd = "/home/me/proj"
      var p = makePane()
      p.stashInputText = "   "
      var btn = findButton(p, "Stash")
      btn.clicked()
      compare(fakeStore.calls.length, 1)
      compare(fakeStore.calls[0].args.length, 1,
        "whitespace-only is sent as a message (length > 0); see comment")
      compare(fakeStore.calls[0].args[0], "   ")
      p.destroy()
    }
  }

  // ---- Stash pop: confirm dialog ----

  TestCase {
    name: "GitPane.stashPopConfirm"
    when: windowShown

    function init() { fakeStore.reset() }

    function test_pop_emits_signal_does_not_call_store_directly() {
      // The StashRow.Pop button routes through popRequested(index); the
      // pane's shared ConfirmDialog observes stashPopTarget, NOT the
      // store. An immediate store.stashPop() would skip the confirm.
      fakeStore.cwd = "/home/me/proj"
      fakeStore.stashes = [
        { index: 0, message: "first stash", branch: "main" },
        { index: 1, message: "second stash", branch: "main" }
      ]
      var p = makePane()
      verify(p !== null)
      compare(p.stashPopTarget, -1, "dialog closed at construction")

      // The StashRow is a Repeater delegate. Find the per-row Pop buttons
      // (there should be one per stash entry) by walking children.
      var pops = []
      function collect(parent) {
        if (!parent) return
        if (parent.text === "Pop" && parent.clicked && parent !== p) pops.push(parent)
        var children = parent.children || []
        for (var i = 0; i < children.length; i++) collect(children[i])
      }
      collect(p)
      compare(pops.length, 2, "one Pop button per stash entry")

      // Click the second entry's Pop button. The pane reads
      // stashRow.modelData.index at click time, so each row has its own
      // closure-captured index.
      pops[1].clicked()
      compare(fakeStore.calls.length, 0,
        "Pop button must NOT call store.stashPop directly — the confirm dialog gates the call")
      compare(p.stashPopTarget, 1,
        "Pop on the second stash must set stashPopTarget to its index")
      p.destroy()
    }

    function test_confirm_routes_to_store_stashPop() {
      fakeStore.cwd = "/home/me/proj"
      fakeStore.stashes = [{ index: 0, message: "x", branch: "main" }]
      var p = makePane()
      var pops = []
      function collect(parent) {
        if (!parent) return
        if (parent.text === "Pop" && parent.clicked && parent !== p) pops.push(parent)
        var children = parent.children || []
        for (var i = 0; i < children.length; i++) collect(children[i])
      }
      collect(p)
      verify(pops.length >= 1, "Pop button found")
      pops[0].clicked()
      compare(p.stashPopTarget, 0)
      compare(fakeStore.calls.length, 0, "still no call — dialog not confirmed yet")
      // Find the ConfirmDialog and emit its confirmed() signal directly.
      var dlg = null
      function findDialog(parent) {
        if (!parent) return null
        if (parent.opened !== undefined && parent.message !== undefined
            && parent.confirmText !== undefined && parent.confirmed) {
          return parent
        }
        var children = parent.children || []
        for (var i = 0; i < children.length; i++) {
          var hit = findDialog(children[i])
          if (hit) return hit
        }
        return null
      }
      dlg = findDialog(p)
      verify(dlg !== null, "ConfirmDialog present on the pane")
      compare(dlg.opened, true, "dialog must be open while stashPopTarget >= 0")
      dlg.confirmed()
      compare(fakeStore.calls.length, 1, "confirmed() routes to store.stashPop(index)")
      compare(fakeStore.calls[0].kind, "stashPop")
      compare(fakeStore.calls[0].args[0], 0)
      compare(p.stashPopTarget, -1,
        "stashPopTarget must reset to -1 after the call so the dialog closes")
      compare(dlg.opened, false,
        "dialog opened binding must follow stashPopTarget back to false")
      p.destroy()
    }

    function test_cancel_closes_dialog_without_calling_store() {
      fakeStore.cwd = "/home/me/proj"
      fakeStore.stashes = [{ index: 0, message: "x", branch: "main" }]
      var p = makePane()
      p.stashPopTarget = 0
      var dlg = null
      function findDialog(parent) {
        if (!parent) return null
        if (parent.opened !== undefined && parent.message !== undefined
            && parent.confirmText !== undefined && parent.confirmed) {
          return parent
        }
        var children = parent.children || []
        for (var i = 0; i < children.length; i++) {
          var hit = findDialog(children[i])
          if (hit) return hit
        }
        return null
      }
      dlg = findDialog(p)
      verify(dlg !== null)
      compare(dlg.opened, true)
      dlg.canceled()
      compare(fakeStore.calls.length, 0,
        "cancel must NOT route to store.stashPop")
      compare(p.stashPopTarget, -1, "cancel clears stashPopTarget")
      compare(dlg.opened, false, "dialog closes on cancel")
      p.destroy()
    }
  }

  // ---- ConfirmDialog binding follows stashPopTarget ----

  TestCase {
    name: "GitPane.dialogBinding"
    when: windowShown

    function test_dialog_stays_closed_while_target_is_negative_one() {
      fakeStore.reset()
      var p = makePane()
      function findDialog(parent) {
        if (!parent) return null
        if (parent.opened !== undefined && parent.message !== undefined
            && parent.confirmText !== undefined && parent.confirmed) {
          return parent
        }
        var children = parent.children || []
        for (var i = 0; i < children.length; i++) {
          var hit = findDialog(children[i])
          if (hit) return hit
        }
        return null
      }
      var dlg = findDialog(p)
      verify(dlg !== null, "ConfirmDialog present even with no stash entries")
      compare(p.stashPopTarget, -1)
      compare(dlg.opened, false)
      p.destroy()
    }
  }

  // ---- changeCwdRequested still wired ----

  TestCase {
    name: "GitPane.changeCwdRequested"
    when: windowShown

    function test_changeCwdRequested_signal_fires_from_set_folder_button() {
      fakeStore.reset()
      var p = makePane()
      var fired = false
      p.changeCwdRequested.connect(function () { fired = true })
      var btn = findButton(p, "Set folder…")
      verify(btn !== null, "Set folder… button present")
      btn.clicked()
      compare(fired, true,
        "Set folder… must still emit changeCwdRequested — this was the seam added before this task")
      p.destroy()
    }
  }
}
