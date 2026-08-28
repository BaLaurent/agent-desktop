import QtQuick
import QtTest

// JupyterStore, exercised in a real QML engine.
//
// The fake `rpc` captures invokes (so a test can deliver `readFile`
// results), captures subscriptions (so the test can emit
// `jupyter:output` chunks), and resolves per-call by channel — exactly
// the same pattern as tst_scheduler_store.qml.
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

    function reset() { calls = [] }
  }

  Loader {
    id: storeLoader
    Component.onCompleted: setSource("../../stores/JupyterStore.qml", ({ rpc: fakeRpc }))
  }

  TestCase {
    name: "JupyterStore"
    when: windowShown

    property var store: storeLoader.item

    function initTestCase() {
      verify(store !== null, "JupyterStore.qml loaded")
    }

    function init() {
      fakeRpc.reset()
      store.filePath = ""
      store.notebook = ({ cells: [] })
      store.cellOutputs = ({})
      store.executionCount = ({})
      store.kernelStatus = ({ state: "", language: "" })
      store.loading = false
      store.loaded = false
      store.error = ""
    }

    // ---- subs -------------------------------------------------------------

    function test_subscribes_to_jupyter_output() {
      var chans = []
      for (var i = 0; i < fakeRpc.subs.length; i++) chans.push(fakeRpc.subs[i].channel)
      verify(chans.indexOf("jupyter:output") >= 0,
        "JupyterStore must subscribe to jupyter:output")
    }

    // ---- load: empty path -------------------------------------------------

    function test_load_empty_path_surfaces_error() {
      store.load("")
      compare(store.error, "No notebook path supplied",
        "empty path must produce a clear error")
    }

    // ---- load: parses the file -------------------------------------------

    function test_load_parses_minimal_notebook() {
      var nb = JSON.stringify({
        nbformat: 4,
        nbformat_minor: 5,
        cells: [
          { cell_type: "code", execution_count: null, metadata: {}, outputs: [],
            source: "print(1)" },
          { cell_type: "markdown", metadata: {}, source: "# Title" }
        ]
      })
      store.load("/tmp/a.ipynb")
      // The store calls files:readFile, jupyter:startKernel, jupyter:getStatus.
      fakeRpc.accept("files:readFile", nb)
      fakeRpc.accept("jupyter:startKernel", { status: "starting" })
      fakeRpc.accept("jupyter:getStatus", "starting")
      compare(store.loading, false)
      compare(store.loaded, true)
      compare(store.error, "")
      compare(store.notebook.cells.length, 2)
      compare(store.notebook.cells[0].kind, "code")
      compare(store.notebook.cells[0].source, "print(1)")
      compare(store.notebook.cells[1].kind, "markdown")
    }

    // ---- load: invalid JSON surfaces error, never throws -----------------

    function test_load_invalid_json_sets_error() {
      store.load("/tmp/a.ipynb")
      fakeRpc.accept("files:readFile", "{not json")
      verify(store.error.length > 0,
        "invalid JSON must produce an error string")
      compare(store.notebook.cells.length, 0,
        "malformed file leaves cells empty")
    }

    function test_load_missing_cells_array_sets_error() {
      store.load("/tmp/a.ipynb")
      fakeRpc.accept("files:readFile", JSON.stringify({ nbformat: 4 }))
      verify(store.error.length > 0)
    }

    // ---- executeCell: invokes the channel --------------------------------

    function test_executeCell_invokes_jupyter_executeCell() {
      store.load("/tmp/a.ipynb")
      var nb = JSON.stringify({
        nbformat: 4, nbformat_minor: 5,
        cells: [{ cell_type: "code", execution_count: null, metadata: {},
                  outputs: [], source: "x = 1" }]
      })
      fakeRpc.accept("files:readFile", nb)
      fakeRpc.accept("jupyter:startKernel", { status: "starting" })
      fakeRpc.accept("jupyter:getStatus", "starting")

      // Drop prior calls so we look only at executeCell's.
      var before = fakeRpc.calls.length
      store.executeCell(0, "x = 2")
      var found = false
      for (var i = before; i < fakeRpc.calls.length; i++) {
        if (fakeRpc.calls[i].channel === "jupyter:executeCell") {
          found = true
          compare(fakeRpc.calls[i].args[0], "/tmp/a.ipynb")
          compare(fakeRpc.calls[i].args[1], "x = 2")
        }
      }
      verify(found, "executeCell must invoke jupyter:executeCell")
    }

    // ---- push: stream chunk folds into cell outputs ----------------------

    function test_stream_chunk_folds_into_cell_outputs() {
      store.load("/tmp/a.ipynb")
      var nb = JSON.stringify({
        nbformat: 4, nbformat_minor: 5,
        cells: [{ cell_type: "code", execution_count: null, metadata: {},
                  outputs: [], source: "print(1)" }]
      })
      fakeRpc.accept("files:readFile", nb)
      fakeRpc.accept("jupyter:startKernel", { status: "starting" })
      fakeRpc.accept("jupyter:getStatus", "starting")

      fakeRpc.emit("jupyter:output", {
        filePath: "/tmp/a.ipynb",
        id: null,
        type: "stream",
        name: "stdout",
        text: "hello\n"
      })

      var outputs = store.cellOutputs["0"]
      verify(outputs !== undefined, "stream chunk produces an output entry")
      compare(outputs.length, 1)
      compare(outputs[0].type, "stream")
      compare(outputs[0].text, "hello\n")
    }

    function test_stream_chunks_coalesce_same_name() {
      store.load("/tmp/a.ipynb")
      var nb = JSON.stringify({
        nbformat: 4, nbformat_minor: 5,
        cells: [{ cell_type: "code", execution_count: null, metadata: {},
                  outputs: [], source: "x" }]
      })
      fakeRpc.accept("files:readFile", nb)
      fakeRpc.accept("jupyter:startKernel", { status: "starting" })
      fakeRpc.accept("jupyter:getStatus", "starting")

      fakeRpc.emit("jupyter:output", { filePath: "/tmp/a.ipynb", id: null,
                                        type: "stream", name: "stdout", text: "a" })
      fakeRpc.emit("jupyter:output", { filePath: "/tmp/a.ipynb", id: null,
                                        type: "stream", name: "stdout", text: "b" })

      var outputs = store.cellOutputs["0"]
      compare(outputs.length, 1, "adjacent stdout streams coalesce")
      compare(outputs[0].text, "ab")
    }

    // ---- push: execute_result preserves base64 PNG -----------------------

    function test_execute_result_with_base64_png_passes_through() {
      store.load("/tmp/a.ipynb")
      var nb = JSON.stringify({
        nbformat: 4, nbformat_minor: 5,
        cells: [{ cell_type: "code", execution_count: 1, metadata: {},
                  outputs: [], source: "x" }]
      })
      fakeRpc.accept("files:readFile", nb)
      fakeRpc.accept("jupyter:startKernel", { status: "starting" })
      fakeRpc.accept("jupyter:getStatus", "starting")

      var pngB64 = "iVBORw0KGgo="
      fakeRpc.emit("jupyter:output", {
        filePath: "/tmp/a.ipynb",
        id: null,
        type: "execute_result",
        execution_count: 7,
        data: { "text/plain": "42", "image/png": pngB64 }
      })

      var outputs = store.cellOutputs["0"]
      compare(outputs.length, 1)
      compare(outputs[0].type, "execute_result")
      compare(outputs[0].data["image/png"], pngB64,
        "base64 PNG data must pass through")
      compare(store.executionCount["0"], 7)
    }

    // ---- push: error chunk -----------------------------------------------

    function test_error_chunk_folds_into_outputs() {
      store.load("/tmp/a.ipynb")
      var nb = JSON.stringify({
        nbformat: 4, nbformat_minor: 5,
        cells: [{ cell_type: "code", execution_count: null, metadata: {},
                  outputs: [], source: "x" }]
      })
      fakeRpc.accept("files:readFile", nb)
      fakeRpc.accept("jupyter:startKernel", { status: "starting" })
      fakeRpc.accept("jupyter:getStatus", "starting")

      fakeRpc.emit("jupyter:output", {
        filePath: "/tmp/a.ipynb",
        id: null,
        type: "error",
        ename: "NameError",
        evalue: "name 'x' is not defined",
        traceback: ["tb line 1"]
      })

      var outputs = store.cellOutputs["0"]
      compare(outputs[0].type, "error")
      compare(outputs[0].ename, "NameError")
      compare(outputs[0].traceback[0], "tb line 1")
    }

    // ---- push: status / ready update kernel state -----------------------

    function test_status_chunk_updates_kernel_state() {
      store.load("/tmp/a.ipynb")
      var nb = JSON.stringify({
        nbformat: 4, nbformat_minor: 5,
        cells: [{ cell_type: "code", execution_count: null, metadata: {},
                  outputs: [], source: "x" }]
      })
      fakeRpc.accept("files:readFile", nb)
      fakeRpc.accept("jupyter:startKernel", { status: "starting" })
      fakeRpc.accept("jupyter:getStatus", "starting")

      fakeRpc.emit("jupyter:output", {
        filePath: "/tmp/a.ipynb",
        id: null,
        type: "ready",
        language: "python"
      })
      compare(store.kernelStatus.state, "idle")
      compare(store.kernelStatus.language, "python")

      fakeRpc.emit("jupyter:output", {
        filePath: "/tmp/a.ipynb",
        id: null,
        type: "status",
        state: "busy"
      })
      compare(store.kernelStatus.state, "busy")
    }

    // ---- push: wrong filePath is ignored ---------------------------------

    function test_chunk_for_other_notebook_is_ignored() {
      store.load("/tmp/a.ipynb")
      var nb = JSON.stringify({
        nbformat: 4, nbformat_minor: 5,
        cells: [{ cell_type: "code", execution_count: null, metadata: {},
                  outputs: [], source: "x" }]
      })
      fakeRpc.accept("files:readFile", nb)
      fakeRpc.accept("jupyter:startKernel", { status: "starting" })
      fakeRpc.accept("jupyter:getStatus", "starting")

      fakeRpc.emit("jupyter:output", {
        filePath: "/tmp/OTHER.ipynb",
        id: null,
        type: "stream",
        name: "stdout",
        text: "ignored"
      })
      compare(store.cellOutputs["0"], undefined,
        "chunks for a different filePath must not be folded in")
    }

    // ---- clear ------------------------------------------------------------

    function test_clear_resets_state() {
      store.load("/tmp/a.ipynb")
      var nb = JSON.stringify({
        nbformat: 4, nbformat_minor: 5,
        cells: [{ cell_type: "code", execution_count: null, metadata: {},
                  outputs: [], source: "x" }]
      })
      fakeRpc.accept("files:readFile", nb)
      fakeRpc.accept("jupyter:startKernel", { status: "starting" })
      fakeRpc.accept("jupyter:getStatus", "starting")

      store.clear()
      compare(store.filePath, "")
      compare(store.notebook.cells.length, 0)
      compare(store.cellOutputs["0"], undefined)
    }
  }
}
