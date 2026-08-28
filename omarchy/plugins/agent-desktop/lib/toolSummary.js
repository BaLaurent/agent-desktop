.pragma library

// One-line summary of a tool invocation, mirroring src/renderer/components/chat/toolUse/toolInputUtils.ts
// and the renderer's GenericTool fallback (src/renderer/components/chat/toolUse/ToolUseBlock.tsx
// falls through to the generic branch). The summary is what the user reads at
// a glance, so the formatting matches the React implementation rather than
// the SDK's verbose output.
//
// Rules, in order:
//   - Read / NotebookRead: file path (input.file_path || input.path || input.notebook_path)
//   - Edit / MultiEdit / NotebookEdit: diff summary (old_string/new_string or old_str/new_str)
//   - Write: file path
//   - Bash: input.command (truncated)
//   - mcp__<server>__<tool>: server and tool segments
//   - Glob / Grep: pattern
//   - Task: prompt
//   - WebFetch: URL
//   - everything else: tool name + first 120 chars of the JSON input

var MAX_GENERIC_PREVIEW = 120
var MAX_BASH_PREVIEW = 200

function truncate(s, n) {
  s = String(s)
  return s.length > n ? s.slice(0, n) + "…" : s
}

function truncatePath(p, segments) {
  if (segments === undefined) segments = 3
  if (!p) return ""
  var parts = String(p).split("/")
  if (parts.length <= segments + 1) return String(p)
  return parts.slice(-(segments + 1)).join("/")
}

// The old/new pair, whatever the SDK calls it, or null.
//
// THREE spellings, not two. Claude's Edit tool sends `old_string`/`new_string`
// (that is the documented Anthropic schema, and what
// src/renderer/components/chat/bubble/MessageBubble.stories.tsx:93 uses); the
// PI SDK sends `oldText`/`newText`; `old_str`/`new_str` is the third form the
// renderer's own `getEditDiffStrings`
// (src/renderer/components/chat/toolUse/toolInputUtils.ts:11) matches. That
// function reads ONLY `old_str`/`oldText`, so a real Claude edit never matched
// and neither front ever showed a diff for one.
function editStrings(input) {
  if (!input || typeof input !== "object") return null
  var oldStr = input.old_string !== undefined ? input.old_string
    : (input.old_str !== undefined ? input.old_str : input.oldText)
  var newStr = input.new_string !== undefined ? input.new_string
    : (input.new_str !== undefined ? input.new_str : input.newText)
  if (typeof oldStr !== "string" || typeof newStr !== "string") return null
  return ({ oldStr: oldStr, newStr: newStr })
}

function diffSummary(input) {
  var pair = editStrings(input)
  if (!pair) return null
  var a = pair.oldStr.length
  var b = pair.newStr.length
  var delta = b - a
  var sign = delta >= 0 ? "+" : ""
  return "edit (" + a + " → " + b + ", " + sign + delta + ")"
}

function summarize(name, input) {
  if (!name) return ""
  var tool = String(name)
  var data = (input && typeof input === "object") ? input : {}

  // Read / NotebookRead — file path tools
  if (tool === "Read" || tool === "NotebookRead" || tool === "View") {
    var rPath = data.file_path || data.path || data.notebook_path
    if (rPath) return tool + " " + truncatePath(rPath)
  }

  // Edit / MultiEdit / NotebookEdit
  if (tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit" || tool === "edit") {
    var diff = diffSummary(data)
    if (diff) return diff
    var ePath = data.file_path || data.path
    if (ePath) return "edit " + truncatePath(ePath)
  }

  // Write
  if (tool === "Write") {
    var wPath = data.file_path || data.path
    if (wPath) return "write " + truncatePath(wPath)
  }

  // Bash — the command itself, truncated
  if (tool === "Bash" || tool === "bash") {
    if (typeof data.command === "string") {
      return "$ " + truncate(data.command, MAX_BASH_PREVIEW)
    }
  }

  // Glob / Grep
  if (tool === "Glob") {
    if (typeof data.pattern === "string") return "glob " + data.pattern
  }
  if (tool === "Grep") {
    if (typeof data.pattern === "string") return "grep " + data.pattern
  }

  // Task (sub-agent)
  if (tool === "Task") {
    if (typeof data.prompt === "string") return "task: " + truncate(data.prompt, 80)
    if (typeof data.description === "string") return "task: " + truncate(data.description, 80)
  }

  // WebFetch / WebSearch
  if (tool === "WebFetch") {
    if (typeof data.url === "string") {
      var u = data.url
      // Strip scheme so the chip stays readable.
      var sidx = u.indexOf("://")
      if (sidx > 0) u = u.slice(sidx + 3)
      return "fetch " + truncate(u, 80)
    }
  }
  if (tool === "WebSearch") {
    if (typeof data.query === "string") return "search: " + truncate(data.query, 60)
  }

  // MCP tools — `mcp__<server>__<tool>`
  if (tool.indexOf("mcp__") === 0) {
    var rest = tool.slice("mcp__".length)
    var sep = rest.indexOf("__")
    if (sep > 0) {
      var server = rest.slice(0, sep)
      var tn = rest.slice(sep + 2)
      return "mcp:" + server + " " + tn
    }
    return tool
  }

  // Generic fallback: tool name + first 120 chars of the JSON input, matching
  // the renderer's GenericTool branch.
  var preview = ""
  if (input !== undefined && input !== null) {
    try {
      preview = typeof input === "string" ? input : JSON.stringify(input)
    } catch (e) {
      preview = ""
    }
  }
  if (preview) return tool + " " + truncate(preview, MAX_GENERIC_PREVIEW)
  return tool
}
