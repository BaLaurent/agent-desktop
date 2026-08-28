import QtQuick
import QtTest

// GitStore exercised in a real QML engine.
//
// The behaviour under test is the store's response to channel calls:
//   refresh(cwd) -> git:isRepo (cwd) -> if true, fires the four fetches
//                    git:status, git:logGraph, git:branches, git:stashList
//   fetchCommitDetail(sha) -> git:commitDetail (cwd, sha)
//   checkout(name) -> git:checkout (cwd, name) -> refetch all
//   stashSave(message?) / stashPop(index) -> git:stashSave / git:stashPop
//   fetch(remote?) -> git:fetch
//
// The fake rpc is the same per-call-capture pattern as the other store
// tests. We resolve per call by channel.

Item {
  width: 400
  height: 400

  QtObject {
    id: fakeRpc
    property var calls: []
    property var subs: ([])

    property string pluginId: "agent-desktop"
    property string pluginDir: ""

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

    // For channels the store calls multiple times (e.g. status + log +
    // branches + stashList from one refresh()), resolve them all at once.
    function acceptAll(channel, result) {
      var remaining = []
      for (var i = 0; i < calls.length; i++) {
        if (calls[i].channel === channel && calls[i].ok) {
          calls[i].ok(result)
        } else {
          remaining.push(calls[i])
        }
      }
      calls = remaining
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
    Component.onCompleted: setSource("../../stores/GitStore.qml",
      ({ rpc: fakeRpc }))
  }

  TestCase {
    name: "GitStore"
    when: windowShown

    property var store: storeLoader.item

    function initTestCase() {
      verify(store !== null, "GitStore.qml loaded")
    }

    function init() {
      fakeRpc.reset()
      store.cwd = ""
      store.isRepo = false
      store.status = null
      store.commits = []
      store.branches = []
      store.stashes = []
      store.commitDetail = null
      store.selectedSha = ""
      store.loading = false
      store.error = ""
    }

    // ---- refresh() with no cwd ------------------------------------------

    function test_refresh_no_cwd_resets_state() {
      store.refresh()
      compare(fakeRpc.calls.length, 0,
        "no cwd -> no git:* call, because there's nothing to ask about")
      compare(store.isRepo, false)
      compare(store.status, null)
      compare(store.commits.length, 0)
    }

    // ---- refresh() with a cwd --------------------------------------------

    // refresh() first calls git:isRepo; if false, no other git:* call.
    function test_refresh_calls_is_repo_first() {
      store.refresh("/home/me/proj")
      compare(fakeRpc.calls.length, 1)
      compare(fakeRpc.calls[0].channel, "git:isRepo")
      compare(fakeRpc.calls[0].args[0], "/home/me/proj")
    }

    function test_refresh_non_repo_skips_remaining_fetches() {
      store.refresh("/home/me/proj")
      fakeRpc.accept("git:isRepo", false)
      compare(fakeRpc.calls.length, 0,
        "non-repo: status/log/branches/stashList must NOT be called")
      compare(store.isRepo, false)
      compare(store.status, null)
      compare(store.commits.length, 0)
      compare(store.branches.length, 0)
      compare(store.stashes.length, 0)
      compare(store.loading, false)
    }

    function test_refresh_repo_triggers_all_fetches() {
      store.refresh("/home/me/proj")
      fakeRpc.accept("git:isRepo", true)
      var chans = fakeRpc.channelsSoFar()
      compare(chans.indexOf("git:status") >= 0, true)
      compare(chans.indexOf("git:logGraph") >= 0, true)
      compare(chans.indexOf("git:branches") >= 0, true)
      compare(chans.indexOf("git:stashList") >= 0, true)
    }

    // A repo reply populates all four lists.
    function test_refresh_repo_populates_state() {
      store.refresh("/home/me/proj")
      fakeRpc.accept("git:isRepo", true)
      fakeRpc.accept("git:status", {
        branch: "main", upstream: "origin/main",
        ahead: 1, behind: 0, detached: false, clean: false,
        files: [
          { path: "src/main.ts", index: "M", worktree: " " }
        ]
      })
      fakeRpc.accept("git:logGraph", [
        { sha: "aaaa", shortSha: "aaaa", parents: ["bbbb"],
          subject: "first", body: "",
          authorName: "x", authorEmail: "x@x", authorDate: "2026-01-15T00:00:00Z",
          refs: ["HEAD -> main"] }
      ])
      fakeRpc.accept("git:branches", [
        { name: "main", isCurrent: true, isRemote: false,
          upstream: "origin/main", ahead: 1, behind: 0,
          lastCommitSha: "aaaa", lastCommitSubject: "first",
          lastCommitDate: "2026-01-15T00:00:00Z" }
      ])
      fakeRpc.accept("git:stashList", [
        { index: 0, message: "WIP", branch: "main",
          date: "2026-01-15T00:00:00Z" }
      ])

      compare(store.isRepo, true)
      compare(store.status.branch, "main")
      compare(store.status.files.length, 1)
      compare(store.status.files[0].path, "src/main.ts")
      compare(store.commits.length, 1)
      compare(store.commits[0].sha, "aaaa")
      compare(store.branches.length, 1)
      compare(store.branches[0].name, "main")
      compare(store.branches[0].isCurrent, true)
      compare(store.stashes.length, 1)
      compare(store.stashes[0].message, "WIP")
      compare(store.loading, false)
    }

    // A refresh() failure surfaces the error.
    function test_refresh_is_repo_failure_surfaces_error() {
      store.refresh("/home/me/proj")
      fakeRpc.refuse("git:isRepo", "git: not-found")
      compare(store.isRepo, false)
      compare(store.error, "git: not-found")
      compare(store.loading, false)
    }

    // refresh(cwd) updates the store's cwd, so subsequent calls do not
    // need to be passed again.
    function test_refresh_updates_cwd() {
      store.refresh("/home/me/proj")
      compare(store.cwd, "/home/me/proj")
    }

    // refresh() with no cwd argument uses the existing cwd.
    function test_refresh_no_arg_uses_stored_cwd() {
      store.refresh("/home/me/proj")
      fakeRpc.reset()
      store.refresh()
      compare(fakeRpc.calls[0].args[0], "/home/me/proj",
        "second refresh with no arg reuses stored cwd")
    }

    // ---- fetchCommitDetail ----------------------------------------------

    function test_fetch_commit_detail_invokes() {
      store.refresh("/home/me/proj")
      fakeRpc.accept("git:isRepo", true)
      fakeRpc.acceptAll("git:status", { branch: "main", files: [] })
      fakeRpc.acceptAll("git:logGraph", [])
      fakeRpc.acceptAll("git:branches", [])
      fakeRpc.acceptAll("git:stashList", [])
      fakeRpc.reset()

      store.fetchCommitDetail("aaaa")
      compare(fakeRpc.calls[0].channel, "git:commitDetail")
      compare(fakeRpc.calls[0].args[0], "/home/me/proj")
      compare(fakeRpc.calls[0].args[1], "aaaa")
    }

    function test_fetch_commit_detail_populates_state() {
      store.refresh("/home/me/proj")
      fakeRpc.accept("git:isRepo", true)
      fakeRpc.acceptAll("git:status", { branch: "main", files: [] })
      fakeRpc.acceptAll("git:logGraph", [])
      fakeRpc.acceptAll("git:branches", [])
      fakeRpc.acceptAll("git:stashList", [])
      fakeRpc.reset()

      store.fetchCommitDetail("aaaa")
      fakeRpc.accept("git:commitDetail", {
        body: "the body",
        files: [
          { path: "src/main.ts", status: "M" },
          { path: "src/lib.ts", status: "A" }
        ]
      })
      compare(store.selectedSha, "aaaa")
      verify(store.commitDetail !== null)
      compare(store.commitDetail.body, "the body")
      compare(store.commitDetail.files.length, 2)
      compare(store.commitDetail.files[0].status, "M")
    }

    // No sha -> no call.
    function test_fetch_commit_detail_no_sha_no_call() {
      store.fetchCommitDetail("")
      compare(fakeRpc.calls.length, 0)
    }

    // ---- checkout -------------------------------------------------------

    function test_checkout_invokes_with_name() {
      store.refresh("/home/me/proj")
      fakeRpc.accept("git:isRepo", true)
      fakeRpc.acceptAll("git:status", { branch: "main", files: [] })
      fakeRpc.acceptAll("git:logGraph", [])
      fakeRpc.acceptAll("git:branches", [])
      fakeRpc.acceptAll("git:stashList", [])
      fakeRpc.reset()

      store.checkout("feature/foo")
      compare(fakeRpc.calls[0].channel, "git:checkout")
      compare(fakeRpc.calls[0].args[0], "/home/me/proj")
      compare(fakeRpc.calls[0].args[1], "feature/foo")
    }

    // A successful checkout triggers a refetch (HEAD moved). The store
    // does not swallow the refetch's individual channel errors so a
    // git-pull-after-checkout failure surfaces naturally.
    function test_checkout_success_refetches() {
      store.refresh("/home/me/proj")
      fakeRpc.accept("git:isRepo", true)
      fakeRpc.acceptAll("git:status", { branch: "main", files: [] })
      fakeRpc.acceptAll("git:logGraph", [])
      fakeRpc.acceptAll("git:branches", [])
      fakeRpc.acceptAll("git:stashList", [])
      fakeRpc.reset()

      store.checkout("feature/foo")
      // First the checkout itself.
      compare(fakeRpc.calls[0].channel, "git:checkout")
      fakeRpc.accept("git:checkout", undefined)
      // Once the checkout returns, refresh fires isRepo at index 0.
      compare(fakeRpc.calls[0].channel, "git:isRepo",
        "checkout success triggers a full refresh (isRepo is the first call)")
    }

    function test_checkout_failure_surfaces_error() {
      store.refresh("/home/me/proj")
      fakeRpc.accept("git:isRepo", true)
      fakeRpc.acceptAll("git:status", { branch: "main", files: [] })
      fakeRpc.acceptAll("git:logGraph", [])
      fakeRpc.acceptAll("git:branches", [])
      fakeRpc.acceptAll("git:stashList", [])
      fakeRpc.reset()

      store.checkout("nonexistent")
      fakeRpc.refuse("git:checkout", "git: not-found")
      compare(store.error, "git: not-found")
    }

    // ---- stashSave / stashPop ------------------------------------------

    function test_stash_save_invokes_with_message() {
      store.refresh("/home/me/proj")
      fakeRpc.accept("git:isRepo", true)
      fakeRpc.acceptAll("git:status", { branch: "main", files: [] })
      fakeRpc.acceptAll("git:logGraph", [])
      fakeRpc.acceptAll("git:branches", [])
      fakeRpc.acceptAll("git:stashList", [])
      fakeRpc.reset()

      store.stashSave("WIP on main")
      compare(fakeRpc.calls[0].channel, "git:stashSave")
      compare(fakeRpc.calls[0].args[0], "/home/me/proj")
      compare(fakeRpc.calls[0].args[1], "WIP on main")
    }

    function test_stash_save_without_message_omits_arg() {
      store.refresh("/home/me/proj")
      fakeRpc.accept("git:isRepo", true)
      fakeRpc.acceptAll("git:status", { branch: "main", files: [] })
      fakeRpc.acceptAll("git:logGraph", [])
      fakeRpc.acceptAll("git:branches", [])
      fakeRpc.acceptAll("git:stashList", [])
      fakeRpc.reset()

      store.stashSave()
      compare(fakeRpc.calls[0].args.length, 1,
        "stashSave() with no message uses 1-arg form (cwd only)")
    }

    function test_stash_pop_invokes_with_index() {
      store.refresh("/home/me/proj")
      fakeRpc.accept("git:isRepo", true)
      fakeRpc.acceptAll("git:status", { branch: "main", files: [] })
      fakeRpc.acceptAll("git:logGraph", [])
      fakeRpc.acceptAll("git:branches", [])
      fakeRpc.acceptAll("git:stashList", [])
      fakeRpc.reset()

      store.stashPop(0)
      compare(fakeRpc.calls[0].channel, "git:stashPop")
      compare(fakeRpc.calls[0].args[0], "/home/me/proj")
      compare(fakeRpc.calls[0].args[1], 0)
    }

    // ---- fetch ---------------------------------------------------------

    function test_fetch_invokes_without_remote() {
      store.refresh("/home/me/proj")
      fakeRpc.accept("git:isRepo", true)
      fakeRpc.acceptAll("git:status", { branch: "main", files: [] })
      fakeRpc.acceptAll("git:logGraph", [])
      fakeRpc.acceptAll("git:branches", [])
      fakeRpc.acceptAll("git:stashList", [])
      fakeRpc.reset()

      store.fetch()
      compare(fakeRpc.calls[0].channel, "git:fetch")
      compare(fakeRpc.calls[0].args.length, 1,
        "fetch() with no remote -> cwd-only arg list")
    }

    function test_fetch_invokes_with_remote() {
      store.refresh("/home/me/proj")
      fakeRpc.accept("git:isRepo", true)
      fakeRpc.acceptAll("git:status", { branch: "main", files: [] })
      fakeRpc.acceptAll("git:logGraph", [])
      fakeRpc.acceptAll("git:branches", [])
      fakeRpc.acceptAll("git:stashList", [])
      fakeRpc.reset()

      store.fetch("origin")
      compare(fakeRpc.calls[0].args.length, 2)
      compare(fakeRpc.calls[0].args[1], "origin")
    }

    // A successful fetch re-pulls status + branches because the
    // upstream may have moved.
    function test_fetch_success_refetches_status_and_branches() {
      store.refresh("/home/me/proj")
      fakeRpc.accept("git:isRepo", true)
      fakeRpc.acceptAll("git:status", { branch: "main", files: [] })
      fakeRpc.acceptAll("git:logGraph", [])
      fakeRpc.acceptAll("git:branches", [])
      fakeRpc.acceptAll("git:stashList", [])
      fakeRpc.reset()

      store.fetch()
      fakeRpc.accept("git:fetch", undefined)
      var chans = fakeRpc.channelsSoFar()
      compare(chans.indexOf("git:branches") >= 0, true,
        "fetch triggers a branches refetch")
      compare(chans.indexOf("git:status") >= 0, true,
        "fetch triggers a status refetch")
    }
  }
}
