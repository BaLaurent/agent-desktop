.pragma library

// Lane assignment for the git log graph.
//
// Mirrors the algorithm in src/renderer/components/panel/git/graph/layout.ts,
// which walks commits in the order git returned them (already topologically
// sorted by `--topo-order`), assigns each commit a column (its "lane"), and
// emits an edge list between commits and their parents.
//
// Why in JS rather than inline QML: the rule is the most complex single
// decision in GitPane.qml and the only one with more than one reasonable
// answer for the same input — and the renderer has its own copy of the same
// algorithm. A node test that runs the same input against both proves they
// agree, which is exactly what the plan said to write first.
//
// Inputs:
//   commits — GitCommit[] (sha, shortSha, parents, subject, body,
//             authorName, authorEmail, authorDate, refs) — same shape as
//             src/shared/git-types.ts.
// Output:
//   { nodes: GraphNode[], edges: GraphEdge[], columns: int }
//     GraphNode = { commit, x, y, color }   // color is a palette index,
//                                          // NOT a hex string: QML keeps
//                                          // the palette.
//     GraphEdge = { from, to, kind: 'direct'|'merge', color }

var GRAPH_COLORS = [
  "#82aaff", // blue
  "#c3e88d", // green
  "#ffcb6b", // amber
  "#f78c6c", // orange
  "#ce93d8", // violet
  "#7fdbca", // teal
  "#ff9e64", // coral
  "#c792ea"  // lavender
]

function colorFor(x) {
  if (typeof x !== "number" || !isFinite(x) || x < 0) return GRAPH_COLORS[0]
  return GRAPH_COLORS[x % GRAPH_COLORS.length]
}

function layout(commits) {
  var nodes = []
  var edges = []
  var activeTracks = []   // index -> sha | null
  var nodesBySha = ({})
  var pending = []
  var maxCols = 0

  function allocFreeTrack() {
    for (var i = 0; i < activeTracks.length; i++) {
      if (activeTracks[i] === null) return i
    }
    activeTracks.push(null)
    return activeTracks.length - 1
  }

  if (!commits || commits.length === 0) {
    return { nodes: [], edges: [], columns: 0 }
  }

  for (var y = 0; y < commits.length; y++) {
    var commit = commits[y]
    if (!commit || !commit.sha) continue

    // A commit reuses its track if any active track currently holds its sha
    // (i.e. the same commit reached us as a parent of an earlier one). The
    // renderer's reference implementation does the same lookup; without it,
    // an octopus merge or a re-revisited branch would get a phantom column.
    var col = -1
    for (var t = 0; t < activeTracks.length; t++) {
      if (activeTracks[t] === commit.sha) { col = t; break }
    }
    if (col === -1) col = allocFreeTrack()

    var node = ({
      commit: commit,
      x: col,
      y: y,
      color: colorFor(col)
    })
    nodes.push(node)
    nodesBySha[commit.sha] = node
    activeTracks[col] = null

    var parents = commit.parents || []
    for (var p = 0; p < parents.length; p++) {
      var parentSha = parents[p]
      var parentCol
      if (p === 0) {
        // First parent stays on the same lane — the natural continuation
        // of a commit.
        parentCol = col
      } else {
        // Merge parents claim the leftmost free track OR the existing
        // track if one already holds this sha (the same-shasa look-ahead
        // the renderer does).
        parentCol = -1
        for (var u = 0; u < activeTracks.length; u++) {
          if (activeTracks[u] === parentSha) { parentCol = u; break }
        }
        if (parentCol === -1) parentCol = allocFreeTrack()
      }
      activeTracks[parentCol] = parentSha
      pending.push({
        childSha: commit.sha,
        parentSha: parentSha,
        kind: p === 0 ? "direct" : "merge",
        color: colorFor(parentCol)
      })
    }

    if (activeTracks.length > maxCols) maxCols = activeTracks.length
  }

  // Resolve edges. A pending edge only resolves when BOTH endpoints exist
  // in the commit list — parents outside the window are dropped, matching
  // the renderer's `if (!child || !parent) continue` guard.
  for (var i = 0; i < pending.length; i++) {
    var pe = pending[i]
    var child = nodesBySha[pe.childSha]
    var parent = nodesBySha[pe.parentSha]
    if (!child || !parent) continue
    edges.push({ from: parent, to: child, kind: pe.kind, color: pe.color })
  }

  return { nodes: nodes, edges: edges, columns: Math.max(maxCols, 1) }
}

// A tiny helper the QML pane uses to classify refs (HEAD -> main,
// tag: v1, remote refs, plain branches). Inputs:
//   raw      — one entry of GitCommit.refs[]
//   remotes  — Set<string> of known remote branch names (e.g. "origin/main")
// Returns: { label, kind: 'head'|'branch'|'remote'|'tag' }
function classifyRef(raw, remotes) {
  if (!raw) return null
  var s = String(raw)
  if (s.indexOf("HEAD -> ") === 0) {
    return ({ label: s.slice("HEAD -> ".length), kind: "head" })
  }
  if (s === "HEAD") return ({ label: "HEAD", kind: "head" })
  if (s.indexOf("tag: ") === 0) {
    return ({ label: s.slice("tag: ".length), kind: "tag" })
  }
  if (remotes && remotes[s] === true) return ({ label: s, kind: "remote" })
  return ({ label: s, kind: "branch" })
}
