pragma ComponentBehavior: Bound

import QtQuick

import "../lib/notebook.js" as NB

// Jupyter notebook state, per-notebook-filePath.
//
// One authoritative owner per filePath:
//   - notebook: { cells: [{kind, source, outputs}], error? } from
//               files:readFile + lib/notebook.parseNotebook
//   - cellOutputs: cellIndex -> output[]    the live outputs as jupyter:output
//                                         chunks land, folded via
//                                         lib/notebook.reduceOutput
//   - kernelStatus: { state: 'idle'|'busy'|'starting'|'dead', language }
//   - executionCount: cellIndex -> number
//
// No Quickshell imports. The pane (components/NotebookPane.qml) handles
// the Qt.labs.platform FileDialog for picking a notebook.
QtObject {
  id: store

  required property var rpc

  property string filePath: ""
  property var notebook: ({ cells: [] })   // {cells, error?}
  property var cellOutputs: ({})            // cellIndex (string) -> output[]
  property var executionCount: ({})         // cellIndex (string) -> number
  property var kernelStatus: ({ state: "", language: "" })
  property bool loading: false
  property bool loaded: false
  property string error: ""

  // ---- subs ---------------------------------------------------------------

  Component.onCompleted: {
    store.rpc.subscribe("jupyter:output", store.handleOutput)
  }
  Component.onDestruction: {
    store.rpc.unsubscribe("jupyter:output", store.handleOutput)
  }

  // ---- load ---------------------------------------------------------------

  // Read the .ipynb through files:readFile (file content). Parsing lives
  // in lib/notebook.js so it is node-testable and the same bytes the
  // pane sees are the bytes the tests cover.
  function load(path) {
    store.filePath = String(path || "")
    store.loading = true
    store.loaded = false
    store.error = ""
    store.notebook = ({ cells: [] })
    store.cellOutputs = ({})
    store.executionCount = ({})
    store.kernelStatus = ({ state: "", language: "" })

    if (store.filePath.length === 0) {
      store.loading = false
      store.error = "No notebook path supplied"
      return
    }

    store.rpc.invoke("files:readFile", [store.filePath], function (content) {
      // files:readFile may return null if the file does not exist or is
      // binary; the parser handles "" gracefully.
      var text = (content === null || content === undefined) ? "" : String(content)
      var parsed = NB.parseNotebook(text)
      store.notebook = parsed
      store.loading = false
      store.loaded = true
      if (parsed && parsed.error) store.error = parsed.error
    }, function (err) {
      store.loading = false
      store.error = String(err)
    })

    // Start (or reuse) the kernel so subsequent executeCell calls work.
    store.rpc.invoke("jupyter:startKernel", [store.filePath], function (result) {
      if (result && typeof result.status === "string") {
        store.kernelStatus = { state: result.status, language: store.kernelStatus.language || "" }
      }
    }, function () { /* older servers may not have this; executeCell will fail loud */ })

    // Read the kernel's own state too (startKernel only returns 'starting').
    store.rpc.invoke("jupyter:getStatus", [store.filePath], function (status) {
      if (typeof status === "string") {
        var cur = store.kernelStatus
        cur.state = status
        store.kernelStatus = cur
      }
    }, function () { /* fine */ })
  }

  function clear() {
    store.filePath = ""
    store.notebook = ({ cells: [] })
    store.cellOutputs = ({})
    store.executionCount = ({})
    store.kernelStatus = ({ state: "", language: "" })
    store.loading = false
    store.loaded = false
    store.error = ""
  }

  // ---- execute ------------------------------------------------------------

  // Run one cell. The cellIndex is its position in notebook.cells.
  function executeCell(cellIndex, code) {
    if (!store.filePath) {
      store.error = "No notebook loaded"
      return
    }
    var idx = Number(cellIndex)
    if (!isFinite(idx) || idx < 0) return

    // Optimistic: drop prior outputs so the cell visibly re-runs.
    var co = ({})
    for (var k in store.cellOutputs) co[k] = store.cellOutputs[k]
    delete co[String(idx)]
    store.cellOutputs = co

    store.rpc.invoke("jupyter:executeCell", [store.filePath, String(code || "")], function (reqId) {
      // Nothing to do — chunks arrive via jupyter:output, indexed by id.
      // We rely on the `id` in chunks to demultiplex (a server may run
      // cells out of order). Map reqId -> cellIndex for that.
      store._pendingByReq[String(reqId)] = idx
    }, function (err) {
      store.error = String(err)
    })
  }

  // Internal: id -> cellIndex map. The server's executeCell returns a
  // request id; the chunks it emits carry the same id so we know which
  // cell's outputs to fold into.
  property var _pendingByReq: ({})

  // ---- push handler -------------------------------------------------------

  function handleOutput(chunk) {
    if (!chunk || typeof chunk !== "object") return
    if (chunk.filePath !== store.filePath) return

    // Determine which cell this chunk belongs to:
    //   - `id` from the server is the request id we stashed above
    //   - fallback to 0 if absent (some kernels batch everything to the
    //     last cell).
    var cellIndex = -1
    if (chunk.id !== null && chunk.id !== undefined && store._pendingByReq[String(chunk.id)] !== undefined) {
      cellIndex = store._pendingByReq[String(chunk.id)]
    } else if (store.notebook && Array.isArray(store.notebook.cells) && store.notebook.cells.length > 0) {
      cellIndex = store.notebook.cells.length - 1
    }
    if (cellIndex < 0) return

    var key = String(cellIndex)
    var existing = store.cellOutputs[key]
    var updated = NB.reduceOutput(existing, chunk)
    var map = ({})
    for (var k in store.cellOutputs) map[k] = store.cellOutputs[k]
    map[key] = updated
    store.cellOutputs = map

    // Track execution_count if the chunk carries one.
    if (chunk.execution_count !== undefined && chunk.execution_count !== null) {
      var ec = ({})
      for (var e in store.executionCount) ec[e] = store.executionCount[e]
      ec[key] = Number(chunk.execution_count)
      store.executionCount = ec
    }

    // Kernel-level state from `status` chunks.
    if (chunk.type === "status" && typeof chunk.state === "string") {
      var ks = store.kernelStatus
      ks.state = chunk.state
      store.kernelStatus = ks
    } else if (chunk.type === "ready") {
      var kr = store.kernelStatus
      kr.state = "idle"
      if (typeof chunk.language === "string") kr.language = chunk.language
      store.kernelStatus = kr
    }
  }
}
