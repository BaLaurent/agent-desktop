import QtQuick

// The git-pane state.
//
// Owns exactly the state the git:* channels produce:
//   - `isRepo`         boolean from git:isRepo(cwd)
//   - `status`         GitStatus from git:status(cwd) (see src/shared/git-types.ts)
//   - `commits`        GitCommit[] from git:logGraph(cwd, opts)
//   - `branches`       GitBranch[] from git:branches(cwd)
//   - `stashes`        GitStashEntry[] from git:stashList(cwd)
//   - `commitDetail`   last { body, files } from git:commitDetail(cwd, sha)
//
// One authoritative owner per mutable value. `cwd` is the conversation's
// cwd — the active conversation's cwd (Main wires it). All action channels
// (checkout / fetch / stashSave / stashPop) call back through `error` so
// the pane can surface failures without inspecting every action.
//
// git:checkout and git:fetch are gated by Phase 4.1's loopback origin and
// live behind the same code path as the rest of the file store's channels.
//
// A store that imports Quickshell cannot be loaded by qmltestrunner
// (CONTRACTS.md §2), so no local commands here. `Main` mounts a git pane
// that binds to this store's properties and uses `gitPane.requestRefresh()`
// on push events.
QtObject {
  id: store

  // Service.qml, which owns invoke/subscribe.
  required property var rpc

  property string cwd: ""
  property bool isRepo: false
  property var status: null              // GitStatus | null (null = not loaded yet)
  property var commits: []               // GitCommit[]
  property var branches: []              // GitBranch[]
  property var stashes: []               // GitStashEntry[]
  property var commitDetail: null        // { body, files } | null
  property string selectedSha: ""

  property bool loading: false
  property string error: ""

  // ---- refresh ---------------------------------------------------------

  function refresh(cwd) {
    if (cwd !== undefined && cwd !== null) store.cwd = String(cwd)
    if (store.cwd.length === 0) {
      isRepo = false
      status = null
      commits = []
      branches = []
      stashes = []
      return
    }
    loading = true
    // isRepo is a quick gate: skip the rest if not a repo, because status
    // and logGraph both shell out to git and would error with the same
    // "not-a-repo" answer a few ms later.
    rpc.invoke("git:isRepo", [store.cwd], function(repo) {
      isRepo = (repo === true)
      if (!isRepo) {
        // Non-repo short-circuits the rest. Loading clears because no
        // further fetches are pending.
        loading = false
        status = null
        commits = []
        branches = []
        stashes = []
        error = ""
        return
      }
      // Repo: kick off the four fetches in parallel. `loading` clears in
      // fetchStatus's success callback because status is the one whose
      // reply is most likely to come back first; the other callbacks drop
      // it on failure so a single channel error does not strand the UI.
      fetchStatus()
      fetchLog()
      fetchBranches()
      fetchStashes()
    }, function(err) {
      loading = false
      isRepo = false
      error = String(err)
    })
  }

  function fetchStatus() {
    rpc.invoke("git:status", [cwd], function(result) {
      // GitStatus = { branch, upstream, ahead, behind, detached, files[], clean }
      // (src/shared/git-types.ts:8-16). files[] items have { path, index,
      // worktree, renamedFrom? } where index/worktree are the single-char
      // status codes.
      status = (result && typeof result === "object") ? result : null
      loading = false
    }, function(err) {
      error = String(err)
      loading = false
    })
  }

  function fetchLog() {
    rpc.invoke("git:logGraph", [cwd, { limit: 200 }], function(result) {
      // GitCommit = { sha, shortSha, parents[], subject, body, authorName,
      // authorEmail, authorDate, refs[] }. The renderer hands refs through
      // the same classifyRef helper lib/gitGraph.js exposes.
      commits = (result && result.length) ? result : []
    }, function(err) {
      error = String(err)
      commits = []
    })
  }

  function fetchBranches() {
    rpc.invoke("git:branches", [cwd], function(result) {
      // GitBranch = { name, isCurrent, isRemote, upstream, ahead, behind,
      // lastCommitSha, lastCommitSubject, lastCommitDate }.
      branches = (result && result.length) ? result : []
    }, function(err) {
      error = String(err)
      branches = []
    })
  }

  function fetchStashes() {
    rpc.invoke("git:stashList", [cwd], function(result) {
      // GitStashEntry = { index, message, branch, date }.
      stashes = (result && result.length) ? result : []
    }, function(err) {
      error = String(err)
      stashes = []
    })
  }

  function fetchCommitDetail(sha) {
    if (!sha) return
    rpc.invoke("git:commitDetail", [cwd, sha], function(result) {
      // { body: string, files: GitCommitFile[] } where files entries are
      // { path, status: 'A'|'M'|'D'|'R'|'C', renamedFrom? }.
      commitDetail = (result && typeof result === "object") ? result : null
      selectedSha = String(sha)
    }, function(err) {
      error = String(err)
    })
  }

  // ---- actions ---------------------------------------------------------

  // git:checkout needs the loopback origin (Phase 4.1).
  function checkout(name, onOk, onErr) {
    rpc.invoke("git:checkout", [cwd, String(name || "")], function() {
      // Refetch everything: HEAD moved, status changed, log may have new
      // top, branches shifted.
      refresh()
      if (onOk) onOk()
    }, function(err) {
      error = String(err)
      if (onErr) onErr(err)
    })
  }

  // git:fetch needs the loopback origin (Phase 4.1).
  function fetch(remote, onOk, onErr) {
    var args = [cwd]
    if (remote) args.push(String(remote))
    rpc.invoke("git:fetch", args, function() {
      // After fetch, branches list may have changed and status may have a
      // new ahead/behind count.
      fetchBranches()
      fetchStatus()
      if (onOk) onOk()
    }, function(err) {
      error = String(err)
      if (onErr) onErr(err)
    })
  }

  function stashSave(message, onOk, onErr) {
    var args = [cwd]
    if (message) args.push(String(message))
    rpc.invoke("git:stashSave", args, function() {
      fetchStashes()
      if (onOk) onOk()
    }, function(err) {
      error = String(err)
      if (onErr) onErr(err)
    })
  }

  function stashPop(index, onOk, onErr) {
    rpc.invoke("git:stashPop", [cwd, Number(index)], function() {
      fetchStashes()
      fetchStatus()
      if (onOk) onOk()
    }, function(err) {
      error = String(err)
      if (onErr) onErr(err)
    })
  }
}
