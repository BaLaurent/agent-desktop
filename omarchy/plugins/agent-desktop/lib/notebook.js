.pragma library

// .ipynb parsing + cell-output reducer for the Jupyter notebook pane.
//
// Two pure functions:
//
//   parseNotebook(jsonText) -> { cells: [...], error?: string }
//     A malformed file returns { error: <string>, cells: [] }; the pane
//     shows the error instead of crashing.
//
//   reduceOutput(outputs, chunk) -> outputs
//     Fold one JupyterOutputChunk into the cell's output list. Returns a
//     NEW array (QML bindings fire on assignment), never mutating the
//     existing one.
//
// nbformat-4 source can be EITHER a string OR an array of strings — both
// are valid and the renderer concatenates them on save. This parser
// handles both.

function _flattenSource(raw) {
  if (raw === null || raw === undefined) return ""
  if (typeof raw === "string") return raw
  if (Array.isArray(raw)) {
    var out = []
    for (var i = 0; i < raw.length; i++) {
      if (typeof raw[i] === "string") out.push(raw[i])
    }
    // nbformat concatenates with NO separator between lines when joined
    // by \n in the canonical save. Match the source's own convention: if
    // each line ends with \n, join with ''; otherwise join with \n.
    if (out.length === 0) return ""
    var firstEndsNL = out[0].endsWith && out[0].endsWith("\n")
    return firstEndsNL ? out.join("") : out.join("\n")
  }
  return String(raw)
}

function _flattenOutputs(raw) {
  if (!Array.isArray(raw)) return []
  var out = []
  for (var i = 0; i < raw.length; i++) {
    out.push(_flattenOneOutput(raw[i]))
  }
  return out
}

function _flattenOneOutput(raw) {
  if (!raw || typeof raw !== "object") {
    return { type: "unknown", text: "" }
  }
  switch (raw.output_type) {
    case "stream": {
      var name = (typeof raw.name === "string") ? raw.name : "stdout"
      return {
        type: "stream",
        name: name,
        text: _flattenSource(raw.text)
      }
    }
    case "execute_result":
    case "display_data": {
      return {
        type: raw.output_type,
        data: (raw.data && typeof raw.data === "object") ? raw.data : {},
        metadata: (raw.metadata && typeof raw.metadata === "object") ? raw.metadata : {}
      }
    }
    case "error": {
      var ename = (typeof raw.ename === "string") ? raw.ename : ""
      var evalue = (typeof raw.evalue === "string") ? raw.evalue : ""
      var tb = Array.isArray(raw.traceback) ? raw.traceback.map(function (s) { return String(s) }) : []
      return { type: "error", ename: ename, evalue: evalue, traceback: tb }
    }
    default:
      return { type: "unknown", text: JSON.stringify(raw) }
  }
}

function parseNotebook(jsonText) {
  var parsed
  try {
    parsed = JSON.parse(String(jsonText || ""))
  } catch (e) {
    return { cells: [], error: "Invalid JSON: " + (e && e.message ? e.message : String(e)) }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { cells: [], error: "Notebook root must be an object" }
  }

  // nbformat-4 cells live at .cells. nbformat-3 has a different shape
  // (worksheets[*].cells); we only support v4 in the QML pane and report
  // any older file as such.
  var nbformat = parsed.nbformat
  if (nbformat !== undefined && nbformat !== 4) {
    return { cells: [], error: "Unsupported nbformat " + nbformat + " (only 4 is rendered)" }
  }
  if (!Array.isArray(parsed.cells)) {
    return { cells: [], error: "Notebook is missing a cells array" }
  }

  var out = []
  for (var i = 0; i < parsed.cells.length; i++) {
    var c = parsed.cells[i]
    if (!c || typeof c !== "object") continue
    var kind = c.cell_type === "markdown" ? "markdown" : "code"
    var cell = {
      kind: kind,
      source: _flattenSource(c.source),
      outputs: kind === "code" ? _flattenOutputs(c.outputs) : []
    }
    out.push(cell)
  }
  return { cells: out }
}

// fold one JupyterOutputChunk into the output list for one cell.
// A stream chunk is appended to the trailing stream output (matching the
// kernel's batching). Anything else pushes a new output. status / ready
// chunks are kept as outputs so the pane can render the kernel state.
function reduceOutput(outputs, chunk) {
  var list = Array.isArray(outputs) ? outputs : []
  if (!chunk || typeof chunk !== "object") return list

  switch (chunk.type) {
    case "stream": {
      var text = (typeof chunk.text === "string") ? chunk.text : ""
      var name = (typeof chunk.name === "string") ? chunk.name : "stdout"
      if (list.length > 0) {
        var last = list[list.length - 1]
        if (last && last.type === "stream" && last.name === name) {
          var merged = list.slice(0, list.length - 1)
          merged.push({ type: "stream", name: name, text: last.text + text })
          return merged
        }
      }
      return list.concat([{ type: "stream", name: name, text: text }])
    }
    case "execute_result":
    case "display_data": {
      return list.concat([{
        type: chunk.type,
        data: (chunk.data && typeof chunk.data === "object") ? chunk.data : {},
        metadata: (chunk.metadata && typeof chunk.metadata === "object") ? chunk.metadata : {}
      }])
    }
    case "error": {
      var ename = (typeof chunk.ename === "string") ? chunk.ename : ""
      var evalue = (typeof chunk.evalue === "string") ? chunk.evalue : ""
      var tb = Array.isArray(chunk.traceback)
        ? chunk.traceback.map(function (s) { return String(s) })
        : []
      return list.concat([{ type: "error", ename: ename, evalue: evalue, traceback: tb }])
    }
    case "status":
    case "ready": {
      return list.concat([{
        type: chunk.type,
        state: (typeof chunk.state === "string") ? chunk.state : (chunk.type === "ready" ? "idle" : ""),
        language: (typeof chunk.language === "string") ? chunk.language : ""
      }])
    }
    default:
      // An empty/garbage chunk (no `type` at all) is dropped: producing
      // an "unknown" output for every null/undefined that arrives on
      // the wire is just noise. A real chunk with an unknown type is
      // kept so the pane can render something diagnostic.
      if (!chunk.type) return list
      return list.concat([{ type: "unknown", raw: JSON.stringify(chunk) }])
  }
}
