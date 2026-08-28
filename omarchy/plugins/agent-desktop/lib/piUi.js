.pragma library

// Pure reducer for the pi:uiEvent event stream into chrome state.
//
// The chrome is the non-modal surface an extension UI event paints:
//   notify           -> a transient toast at the requested level
//   setStatus        -> a KEYED chip in the status line (a second event
//                      with the same key REPLACES, never appends)
//   setWidget        -> a keyed text block placed aboveEditor / belowEditor
//   setWorkingMessage -> the streaming indicator's label
//   setTitle         -> the window title
//   setHeader / setFooter -> a PiUINode tree (rendered by PiUINode.qml)
//
// Initial state shape (one property per chrome):
//
//   { toasts: [], statuses: {}, widgets: {}, workingMessage: "",
//     title: "", header: null, footer: null }
//
// reduceEvent(state, event) returns the next state. No throws, no mutation.
// Every malformed input degrades to a no-op (the chrome simply stays put).

// Maximum nesting depth accepted by normalizeNode. A cycle or a tree deeper
// than this is clamped to a text node carrying the JSON — better than a
// hang, and it makes the bug visible without crashing the chrome.
var MAX_DEPTH = 32

function initialState() {
  return {
    toasts: [],
    statuses: {},
    widgets: {},
    workingMessage: "",
    title: "",
    header: null,
    footer: null
  }
}

// Make a shallow copy of state. Reassign-not-mutate, so QML bindings fire.
function _copy(state) {
  return {
    toasts: state.toasts.slice(),
    statuses: Object.assign({}, state.statuses),
    widgets: Object.assign({}, state.widgets),
    workingMessage: state.workingMessage,
    title: state.title,
    header: state.header,
    footer: state.footer
  }
}

// Append a toast. Each toast carries a unique id so the chrome can drop
// the right one on autoDismiss. The id is the caller's to supply; we
// derive one if absent.
function _addToast(state, ev) {
  var msg = (ev && typeof ev.message === "string") ? ev.message : ""
  if (msg.length === 0) return state
  var level = (ev && (ev.level === "warning" || ev.level === "error"))
    ? ev.level : "info"
  var id = ev.id || ("t_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8))
  var next = _copy(state)
  next.toasts = state.toasts.concat([{ id: id, message: msg, level: level }])
  return next
}

function _dismissToast(state, id) {
  if (state.toasts.length === 0) return state
  var next = []
  for (var i = 0; i < state.toasts.length; i++) {
    if (state.toasts[i].id !== id) next.push(state.toasts[i])
  }
  if (next.length === state.toasts.length) return state
  var out = _copy(state)
  out.toasts = next
  return out
}

function reduceEvent(state, ev) {
  if (!ev || typeof ev !== "object") return state
  var base = state || initialState()

  switch (ev.method) {
    case "notify": return _addToast(base, ev)
    case "setStatus": {
      if (!ev.key || typeof ev.key !== "string") return base
      var next = _copy(base)
      // Text undefined / null / "" means "remove the chip", which is what
      // the renderer does and is what the doc-string promises.
      if (ev.text === undefined || ev.text === null || ev.text === "") {
        if (next.statuses[ev.key] === undefined) return base
        delete next.statuses[ev.key]
        return next
      }
      next.statuses[ev.key] = String(ev.text)
      return next
    }
    case "setWidget": {
      if (!ev.key || typeof ev.key !== "string") return base
      var placement = (ev.placement === "belowEditor") ? "belowEditor" : "aboveEditor"
      var content
      if (Array.isArray(ev.content)) {
        content = ev.content.map(function (s) { return String(s) })
      } else if (typeof ev.content === "string") {
        content = [ev.content]
      } else {
        content = []
      }
      var n = _copy(base)
      n.widgets[ev.key] = { key: ev.key, content: content, placement: placement }
      return n
    }
    case "setWorkingMessage": {
      var msg = (ev && typeof ev.message === "string") ? ev.message : ""
      if (msg === base.workingMessage) return base
      var wm = _copy(base)
      wm.workingMessage = msg
      return wm
    }
    case "setTitle": {
      // Non-string is ignored — a window title has to render as text, and
      // an extension that sends a number or an object is buggy; surfacing
      // the bug is better than silently rendering "[object Object]".
      if (typeof ev.title !== "string") return base
      if (ev.title === base.title) return base
      var t = _copy(base)
      t.title = ev.title
      return t
    }
    case "setHeader": {
      var h = _copy(base)
      h.header = ev.component ? normalizeNode(ev.component, 0) : null
      return h
    }
    case "setFooter": {
      var f = _copy(base)
      f.footer = ev.component ? normalizeNode(ev.component, 0) : null
      return f
    }
    default:
      // Unknown method: no-op. We do NOT throw — a future extension that
      // arrives before the client knows its method should not crash the
      // chrome.
      return base
  }
}

// normalizeNode(raw) -> a safe PiUINode-shaped object the QML tree
// delegate can render. Unknown types degrade to { type: 'text', content:
// JSON.stringify(raw), style: 'error' } — never a throw. Cycles and
// excessive depth clamp to the same.
function normalizeNode(raw, depth) {
  var d = depth || 0
  if (raw === null || raw === undefined) {
    return { type: "text", content: "", style: "muted" }
  }
  if (typeof raw !== "object") {
    return { type: "text", content: String(raw) }
  }
  // Depth / cycle clamp. A cycle re-enters with the same object identity;
  // we don't have a weakmap available portably, so depth alone is the
  // guard. MAX_DEPTH is generous for any real extension UI.
  if (d >= MAX_DEPTH) {
    return { type: "text", content: "[truncated]", style: "muted" }
  }

  switch (raw.type) {
    case "text": {
      var style
      if (raw.style === "bold" || raw.style === "muted"
          || raw.style === "error" || raw.style === "accent") {
        style = raw.style
      } else {
        style = undefined
      }
      return {
        type: "text",
        content: (typeof raw.content === "string") ? raw.content : String(raw.content || ""),
        style: style
      }
    }
    case "button":
      return {
        type: "button",
        label: (typeof raw.label === "string") ? raw.label : "",
        action: (typeof raw.action === "string") ? raw.action : ""
      }
    case "input":
      return {
        type: "input",
        id: (typeof raw.id === "string") ? raw.id : "",
        placeholder: (typeof raw.placeholder === "string") ? raw.placeholder : ""
      }
    case "select":
      return {
        type: "select",
        id: (typeof raw.id === "string") ? raw.id : "",
        options: Array.isArray(raw.options)
          ? raw.options.map(function (o) { return String(o) })
          : []
      }
    case "progress": {
      var v = Number(raw.value)
      if (!isFinite(v)) v = 0
      var m = raw.max !== undefined ? Number(raw.max) : undefined
      if (m !== undefined && !isFinite(m)) m = undefined
      return { type: "progress", value: v, max: m }
    }
    case "divider":
      return { type: "divider" }
    case "hstack":
    case "vstack": {
      var children = []
      if (Array.isArray(raw.children)) {
        for (var i = 0; i < raw.children.length; i++) {
          children.push(normalizeNode(raw.children[i], d + 1))
        }
      }
      var gap
      if (typeof raw.gap === "number" && isFinite(raw.gap)) gap = raw.gap
      var out = { type: raw.type, children: children }
      if (gap !== undefined) out.gap = gap
      return out
    }
    case "badge":
      return {
        type: "badge",
        text: (typeof raw.text === "string") ? raw.text : "",
        color: (typeof raw.color === "string") ? raw.color : undefined
      }
    default:
      // Unknown type: degrade to a text node carrying the raw JSON so the
      // extension's payload is at least visible to the user — and the bug
      // is visible to whoever is debugging.
      return {
        type: "text",
        content: JSON.stringify(raw),
        style: "error"
      }
  }
}

// Build the modal payload (for a pi:uiRequest) by method. Only `editor`
// is ever actually emitted today; the others are reachable in principle
// and we still render them correctly if the server ever emits one.
//
// Returns one of:
//   { kind: 'editor', title, prefill }
//   { kind: 'select', title, options }
//   { kind: 'confirm', title, message }
//   { kind: 'input', title, placeholder }
//   { kind: 'custom', title, node }
//   { kind: 'unknown', request }
function describeRequest(req) {
  if (!req || typeof req !== "object") {
    return { kind: "unknown", request: req }
  }
  switch (req.method) {
    case "editor":
      return {
        kind: "editor",
        title: (typeof req.title === "string") ? req.title : "Edit",
        prefill: (typeof req.prefill === "string") ? req.prefill : ""
      }
    case "select":
      return {
        kind: "select",
        title: (typeof req.title === "string") ? req.title : "Pick one",
        options: Array.isArray(req.options)
          ? req.options.map(function (o) { return String(o) })
          : []
      }
    case "confirm":
      return {
        kind: "confirm",
        title: (typeof req.title === "string") ? req.title : "Confirm",
        message: (typeof req.message === "string") ? req.message : ""
      }
    case "input":
      return {
        kind: "input",
        title: (typeof req.title === "string") ? req.title : "Enter a value",
        placeholder: (typeof req.placeholder === "string") ? req.placeholder : ""
      }
    case "custom":
      return {
        kind: "custom",
        title: (typeof req.title === "string") ? req.title : "",
        node: normalizeNode(req.component, 0)
      }
    default:
      return { kind: "unknown", request: req }
  }
}

// Build a PiUIResponse-shaped payload from the modal's outcome.
// The bridge's `respond` op carries {value?, confirmed?, cancelled?};
// exactly one of them is meaningful per method, so the others are
// omitted. A dismissal is ALWAYS {cancelled: true} — that is the only
// way the omp responder learns the user dismissed the dialog, and a
// hang would otherwise block the turn.
function responseFor(kind, outcome) {
  if (kind === "editor") {
    if (outcome && outcome.submitted) {
      return { value: String(outcome.value || "") }
    }
    return { cancelled: true }
  }
  if (kind === "select") {
    if (outcome && outcome.submitted) {
      return { value: String(outcome.value || "") }
    }
    return { cancelled: true }
  }
  if (kind === "confirm") {
    if (outcome && outcome.submitted) {
      return { confirmed: true }
    }
    return { cancelled: true }
  }
  if (kind === "input") {
    if (outcome && outcome.submitted) {
      return { value: String(outcome.value || "") }
    }
    return { cancelled: true }
  }
  if (kind === "custom") {
    if (outcome && outcome.submitted) {
      // custom dialogs carry whatever the renderer chose. value carries
      // a string if the renderer wants to forward it; cancelled: true
      // is the universal "user dismissed".
      var v = outcome.value
      if (typeof v === "string") return { value: v }
      return { cancelled: true }
    }
    return { cancelled: true }
  }
  return { cancelled: true }
}
