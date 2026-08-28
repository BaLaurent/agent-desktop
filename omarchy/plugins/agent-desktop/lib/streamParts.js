.pragma library

// Pure reducer for streaming chunks into the renderer-side part list.
//
// A decision, so it lives in JS rather than in a store binding: the shape is
// driven by the renderer's StreamPart union (src/renderer/stores/chatStore.ts
// 910-924, groupStreamParts.ts) and is easier to test in isolation than
// against a live QML engine. The store calls this on every chunk and owns
// the surrounding buffer / persistence concerns.
//
// Rules per chunk.type — every malformed JSON payload degrades to the part
// WITHOUT that field; nothing throws.

function initialState() {
  return []
}

function parseJSON(raw) {
  if (typeof raw !== "string" || raw.length === 0) return undefined
  try {
    return JSON.parse(raw)
  } catch (e) {
    return undefined
  }
}

function appendTrailing(parts, kind, content) {
  // Coalesce trailing text/thinking parts, the way the renderer's
  // handleText/handleThinking do. Measured live: chunks arrive split
  // arbitrarily small (a 4-char reply arrived as 3 text chunks), so this
  // coalescing is what keeps the transcript from becoming 3 paragraphs.
  var last = parts.length > 0 ? parts[parts.length - 1] : null
  if (last && last.type === kind) {
    var next = parts.slice()
    var merged = ({})
    for (var k in last) merged[k] = last[k]
    merged.content = last.content + content
    next[next.length - 1] = merged
    return next
  }
  var pushed = parts.slice()
  var obj = ({})
  obj.type = kind
  obj.content = content
  pushed.push(obj)
  return pushed
}

function findToolById(parts, id) {
  // Most-recent-first: a tool_input before tool_start must NOT create a
  // phantom part (the plan calls this out), so we never auto-create.
  for (var i = parts.length - 1; i >= 0; i--) {
    var p = parts[i]
    if (p && p.type === "tool" && p.id === id) return i
  }
  return -1
}

function findToolByIdOrLatestRunning(parts, id) {
  // Mirrors the renderer's handleToolInput: prefer id match, fall back to the
  // most-recent running tool when id is missing. We only fill `input` here,
  // so the no-match case is a no-op (caller-side requirement).
  if (id) {
    var at = findToolById(parts, id)
    if (at >= 0) return at
    return -1
  }
  for (var i = parts.length - 1; i >= 0; i--) {
    var p = parts[i]
    if (p && p.type === "tool" && p.status === "running") return i
  }
  return -1
}

function replaceByType(parts, type, fresh) {
  var out = []
  var replaced = false
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i]
    if (!replaced && p && p.type === type) {
      out.push(fresh)
      replaced = true
    } else {
      out.push(p)
    }
  }
  if (!replaced) out.push(fresh)
  return out
}

function reduce(parts, chunk) {
  if (!chunk || typeof chunk !== "object") return parts
  var next = Array.isArray(parts) ? parts.slice() : []

  switch (chunk.type) {
    case "text": {
      if (!chunk.content) return next
      return appendTrailing(next, "text", String(chunk.content))
    }
    case "thinking": {
      if (!chunk.content) return next
      return appendTrailing(next, "thinking", String(chunk.content))
    }
    case "tool_start": {
      var toolName = chunk.toolName || chunk.content || "tool"
      var toolId = chunk.toolId || ("tool_" + Date.now())
      var pushed = next.slice()
      var t = ({})
      t.type = "tool"
      t.name = toolName
      t.id = toolId
      t.status = "running"
      pushed.push(t)
      return pushed
    }
    case "tool_input": {
      // chatStore.ts:718-728 — when no toolId is given, attach to the most-
      // recent running tool; otherwise match by id. findToolByIdOrLatestRunning
      // returns -1 in either case when nothing matches, which keeps the rule
      // "no phantom part when there is no running tool" intact.
      var idx = findToolByIdOrLatestRunning(next, chunk.toolId)
      if (idx < 0) return next
      var parsed = parseJSON(chunk.toolInput)
      if (parsed === undefined) return next
      var out = next.slice()
      var cur = ({})
      for (var k in next[idx]) cur[k] = next[idx][k]
      cur.input = parsed
      out[idx] = cur
      return out
    }
    case "tool_result": {
      if (!chunk.toolId) return next
      var at = findToolById(next, chunk.toolId)
      if (at < 0) return next
      var done = next.slice()
      var cur2 = ({})
      for (var k2 in next[at]) cur2[k2] = next[at][k2]
      cur2.status = "done"
      if (chunk.content !== undefined) cur2.summary = String(chunk.content)
      if (chunk.toolOutput !== undefined) cur2.output = String(chunk.toolOutput)
      done[at] = cur2
      return done
    }
    case "tool_approval": {
      if (!chunk.requestId || !chunk.toolName) return next
      var ap = next.slice()
      var tp = ({})
      tp.type = "tool_approval"
      tp.requestId = chunk.requestId
      tp.toolName = chunk.toolName
      tp.toolInput = parseJSON(chunk.toolInput) || ({})
      ap.push(tp)
      return ap
    }
    case "ask_user": {
      if (!chunk.requestId || !chunk.questions) return next
      var au = next.slice()
      var aq = ({})
      aq.type = "ask_user"
      aq.requestId = chunk.requestId
      aq.questions = parseJSON(chunk.questions) || []
      au.push(aq)
      return au
    }
    case "plan_approval_request": {
      if (!chunk.content || chunk.conversationId === undefined) return next
      var pl = next.slice()
      var plp = ({})
      plp.type = "plan_approval_request"
      plp.conversationId = chunk.conversationId
      plp.plan = String(chunk.content)
      pl.push(plp)
      return pl
    }
    case "mcp_status": {
      if (!chunk.mcpServers) return next
      var servers = parseJSON(chunk.mcpServers)
      if (!Array.isArray(servers) || servers.length === 0) return next
      var fresh = ({})
      fresh.type = "mcp_status"
      fresh.servers = servers
      return replaceByType(next, "mcp_status", fresh)
    }
    case "system_message": {
      if (!chunk.content) return next
      var sm = next.slice()
      var smp = ({})
      smp.type = "system_message"
      smp.content = String(chunk.content)
      if (chunk.hookName !== undefined) smp.hookName = chunk.hookName
      if (chunk.hookEvent !== undefined) smp.hookEvent = chunk.hookEvent
      sm.push(smp)
      return sm
    }
    case "task_notification": {
      var tn = next.slice()
      var tnp = ({})
      tnp.type = "task_notification"
      tnp.summary = chunk.content !== undefined
        ? String(chunk.content)
        : "Agent task completed"
      if (chunk.taskId !== undefined) tnp.taskId = chunk.taskId
      if (chunk.taskStatus !== undefined) tnp.taskStatus = chunk.taskStatus
      if (chunk.outputFile !== undefined) tnp.outputFile = chunk.outputFile
      tn.push(tnp)
      return tn
    }
    case "retry": {
      var rt = ({})
      rt.type = "retry"
      rt.message = chunk.content !== undefined ? String(chunk.content) : "Retrying..."
      rt.attempt = chunk.retryAttempt || 0
      rt.maxAttempts = chunk.retryMaxAttempts || 0
      return replaceByType(next, "retry", rt)
    }
    case "error": {
      var err = next.slice()
      var erp = ({})
      erp.type = "text"
      erp.content = chunk.content !== undefined
        ? String(chunk.content)
        : "Stream error"
      erp.isError = true
      err.push(erp)
      return err
    }
    case "done":
      // Terminator — caller commits; reducer returns the list unchanged.
      return next
    default:
      return next
  }
}

// Parse a persisted messages.tool_calls JSON string into the same
// {type:'tool',...} shape the renderer uses for inline rendering. Matches
// ToolCallsSection.tsx's parseToolCalls + toolCallToStreamPart, including
// the rule that an empty '{}' input is treated as absent.
function partsFromToolCalls(toolCallsJson) {
  if (typeof toolCallsJson !== "string" || toolCallsJson.length === 0) return []
  var calls = parseJSON(toolCallsJson)
  if (!Array.isArray(calls)) return []
  var out = []
  for (var i = 0; i < calls.length; i++) {
    var tc = calls[i]
    if (!tc || typeof tc !== "object") continue
    var part = ({})
    part.type = "tool"
    part.name = tc.name || "tool"
    part.id = tc.id || ("tool_" + i)
    part.status = tc.status === "error" ? "done" : "done"
    if (tc.output) part.output = String(tc.output)
    if (tc.input && tc.input !== "{}") {
      var parsed = parseJSON(tc.input)
      if (parsed !== undefined) part.input = parsed
    }
    out.push(part)
  }
  return out
}

// Group adjacent {type:'tool', name:'Task'} parts into one task_group.
// Only `name === 'Task'` groups — matching groupStreamParts.ts.
function groupTasks(parts) {
  if (!Array.isArray(parts)) return []
  var out = []
  var i = 0
  while (i < parts.length) {
    var p = parts[i]
    if (p && p.type === "tool" && p.name === "Task") {
      var group = [p]
      var j = i + 1
      while (j < parts.length) {
        var q = parts[j]
        if (q && q.type === "tool" && q.name === "Task") {
          group.push(q)
          j++
        } else {
          break
        }
      }
      if (group.length >= 2) {
        var grp = ({})
        grp.type = "task_group"
        grp.items = group
        out.push(grp)
      } else {
        out.push(p)
      }
      i = j
    } else {
      out.push(p)
      i++
    }
  }
  return out
}
