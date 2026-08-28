// Tripwire for lib/gitGraph.js — the lane-assignment algorithm that the
// GitPane.qml delegate reads through. The plan calls for a node test over
// four shapes: a linear history, a simple merge, two parallel branches,
// and an empty log. Plus the ref-classifier helper, which is the same kind
// of pure decision that the renderer ships.
//
// `deepEqual` (not `deepStrictEqual`) is required whenever the actual value
// was built inside the vm context: vm-realm objects carry that realm's
// prototypes and `deepStrictEqual` rejects them against literals declared
// outside. `tests/load.js` documents this.
const assert = require('assert')
const { load, deepEqual } = require('./load')

const GG = load('lib/gitGraph.js')

// ---- empty log ------------------------------------------------------------

deepEqual(GG.layout([]), { nodes: [], edges: [], columns: 0 },
  'empty commits list produces empty layout')
deepEqual(GG.layout(null), { nodes: [], edges: [], columns: 0 },
  'null commits list produces empty layout')
deepEqual(GG.layout(undefined), { nodes: [], edges: [], columns: 0 },
  'undefined commits list produces empty layout')

// ---- linear history -------------------------------------------------------
//
// Three commits, each the parent of the next. Each commit gets its own lane
// in this layout because once a commit leaves the visible window, its lane
// is freed (activeTracks[col] = null) and the next commit claims a free
// track — but the layout here shows that lane 0 is reused as the natural
// continuation of a linear chain. That is because git returns commits
// in topo order, and the parent's sha is now in activeTracks[col] so the
// NEXT commit (the child, before we walked the parents) does NOT take
// col 0 again unless it is the same sha.

var linear = [
  { sha: 'c1', parents: ['c0'], subject: 'third', refs: [] },
  { sha: 'c0', parents: ['r'],  subject: 'second', refs: [] },
  { sha: 'r',  parents: [],      subject: 'root',   refs: [] }
]
var linearResult = GG.layout(linear)
assert.strictEqual(linearResult.nodes.length, 3, 'three nodes')
assert.strictEqual(linearResult.edges.length, 2,
  'two edges resolve: c1->c0 and c0->r; r has no parent')
// The first commit goes to lane 0 (only free track). Its parent r is not
// in the window yet, so the edge from c1 -> r resolves to nothing.
var n0 = linearResult.nodes[0]
assert.strictEqual(n0.commit.sha, 'c1', 'first node is c1')
assert.strictEqual(n0.x, 0, 'first node on lane 0')
assert.strictEqual(n0.y, 0, 'first node at row 0')

// c0's parent r is in activeTracks[0] when we walk c0 (set by c1's first
// parent slot). r takes col 0. So c0 appears on lane 0 — natural
// continuation of the chain.
var n1 = linearResult.nodes[1]
assert.strictEqual(n1.commit.sha, 'c0', 'second node is c0')
assert.strictEqual(n1.x, 0,
  'c0 on lane 0 (parent-of-c1 slot is in c1\'s lane, which c0 reuses)')

// r's parent slot is empty (r has no parents). When we walk r, we look
// for r in activeTracks — lane 0 matches (c0's parent). r takes lane 0
// too, so the whole chain renders as a single vertical line.
var n2 = linearResult.nodes[2]
assert.strictEqual(n2.commit.sha, 'r', 'third node is r')
assert.strictEqual(n2.x, 0, 'r on lane 0 (linear chain = single lane)')
// A merge commit has parents.length >= 2. The first parent continues the
// current lane; the additional parents claim a fresh lane (or reuse one
// already holding that sha). Edges include one 'direct' (for the first
// parent) and one or more 'merge' (for the additional ones).
var simpleMerge = [
  { sha: 'm',  parents: ['a', 'b'], subject: 'merge', refs: [] },
  { sha: 'a',  parents: ['r'],      subject: 'A branch tip', refs: [] },
  { sha: 'b',  parents: ['r'],      subject: 'B branch tip', refs: [] },
  { sha: 'r',  parents: [],         subject: 'root', refs: [] }
]
var mergeResult = GG.layout(simpleMerge)

// m is on lane 0. Its first parent a is on lane 0 (continuation). Its
// second parent b claims a fresh lane — lane 1.
// We then process a. a takes lane 0 because m already marked a as the
// lane-0 child of its first parent (activeTracks[0] = a from m). a's
// parent r is then placed in a's lane (lane 0).
// We then process b. b is in activeTracks[1] from m. b takes lane 1.
// b's parent r — lane 1 (because we just set activeTracks[1] = r).
// We then process r. r was placed in lane 0 by a and lane 1 by b.
// When processing r, we look for r in activeTracks: lane 0 matches.
// So r takes lane 0. That means b's edge to r is from lane 1 to lane 0,
// a merge edge.

assert.strictEqual(mergeResult.nodes[0].x, 0, 'merge commit on lane 0')
assert.strictEqual(mergeResult.nodes[1].x, 0, 'A tip on lane 0 (continuation)')
assert.strictEqual(mergeResult.nodes[2].x, 1, 'B tip on lane 1 (merge lane)')
assert.strictEqual(mergeResult.nodes[3].x, 0, 'root reused lane 0 (occupied by A)')

// Edges: m->a (direct), m->b (merge), a->r (direct), b->r (direct).
// b has only ONE parent (r) so b's edge to r is b's first-parent edge,
// which the algorithm tags 'direct'. The 'merge' tag only applies to
// additional (pIdx > 0) parent edges, not to "any edge that crosses lanes".
assert.strictEqual(mergeResult.edges.length, 4, 'four edges total')

var directEdges = mergeResult.edges.filter(function (e) { return e.kind === 'direct' })
var mergeEdges = mergeResult.edges.filter(function (e) { return e.kind === 'merge' })
assert.strictEqual(directEdges.length, 3,
  'three direct edges (m->a, a->r, b->r)')
assert.strictEqual(mergeEdges.length, 1,
  'one merge edge (m->b, the additional parent of a merge commit)')

// m->a is direct (same lane).
assert.ok(mergeResult.edges.some(function (e) {
   return e.kind === 'direct' && e.from.commit.sha === 'a' && e.to.commit.sha === 'm'
 }), 'a -> m edge is direct')
// m->b is a merge (different lanes).
assert.ok(mergeResult.edges.some(function (e) {
  return e.kind === 'merge' && e.from.commit.sha === 'b' && e.to.commit.sha === 'm'
}), 'b -> m edge is a merge')

// ---- two parallel branches ------------------------------------------------
//
// No merge: just two branches diverging from a common root. Both branch
// tips stay in their own lanes.
var parallel = [
  { sha: 'b1', parents: ['r'], subject: 'branch 1 tip', refs: [] },
  { sha: 'b2', parents: ['r'], subject: 'branch 2 tip', refs: [] },
  { sha: 'r',  parents: [],    subject: 'root', refs: [] }
]
var parResult = GG.layout(parallel)

// b1 on lane 0, its parent r placed in activeTracks[0].
// b2 — its sha is not in activeTracks, so it claims a fresh lane
// (lane 1). Its first parent r is then placed in lane 1.
// r — we look for r in activeTracks; the FIRST match wins (lane 0).
// So b1->r is lane 0->0 (direct), and b2->r is lane 1->1 (direct).
// Both edges are 'direct' because neither is an additional-parent edge.
assert.strictEqual(parResult.nodes[0].x, 0, 'b1 on lane 0')
assert.strictEqual(parResult.nodes[1].x, 1, 'b2 on lane 1')
assert.strictEqual(parResult.nodes[2].x, 0,
  'root on lane 0 (first-match wins; lane 0 was the earlier activeTracks slot)')
assert.ok(parResult.edges.every(function (e) { return e.kind === 'direct' }),
  'parallel branches with no merge produce only direct edges')

// ---- classifyRef ----------------------------------------------------------
//
// The GitPane uses this to decide how to badge a ref: HEAD, branch, remote,
// or tag. Same spelling the renderer uses.
var remotes = { 'origin/main': true, 'origin/dev': true }

deepEqual(
  GG.classifyRef('HEAD -> main', remotes),
  { label: 'main', kind: 'head' },
  'HEAD -> branch is a head ref pointing at main'
)
deepEqual(
  GG.classifyRef('HEAD', remotes),
  { label: 'HEAD', kind: 'head' },
  'bare HEAD is a head ref'
)
deepEqual(
  GG.classifyRef('tag: v1.0.0', remotes),
  { label: 'v1.0.0', kind: 'tag' },
  'tag: prefix is a tag ref'
)
deepEqual(
  GG.classifyRef('origin/main', remotes),
  { label: 'origin/main', kind: 'remote' },
  'ref in remotes set is a remote ref'
)
deepEqual(
  GG.classifyRef('feature/foo', remotes),
  { label: 'feature/foo', kind: 'branch' },
  'unknown ref is a branch'
)
assert.strictEqual(GG.classifyRef(null, remotes), null, 'null ref -> null')
assert.strictEqual(GG.classifyRef('', remotes), null, 'empty ref -> null')

// ---- colorFor -------------------------------------------------------------
//
// We do not assert the exact palette because QML owns the colours — we
// assert the helper is deterministic and never throws on weird input.
assert.strictEqual(GG.colorFor(0), GG.colorFor(8), 'palette is periodic (8 lanes apart -> same)')
assert.strictEqual(GG.colorFor(0), GG.colorFor(0), 'palette is deterministic')
assert.ok(typeof GG.colorFor(-1) === 'string' && GG.colorFor(-1).length > 0,
  'negative x is clamped to a colour, no throw')
assert.ok(typeof GG.colorFor(NaN) === 'string' && GG.colorFor(NaN).length > 0,
  'NaN is clamped to a colour, no throw')

console.log('test_git_graph: ok')
