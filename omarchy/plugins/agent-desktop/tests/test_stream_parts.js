const assert = require('assert')
const { load, deepEqual } = require('./load')

const S = load('lib/streamParts.js')

// Initial state is an empty array.
deepEqual(S.initialState(), [])

// ---- text coalescing -----------------------------------------------------
// Live measurement: a 4-char reply arrived as 3 text chunks totalling
// 'PONG'. Without coalescing, the transcript would show three paragraphs.
let parts = S.initialState()
parts = S.reduce(parts, { type: 'text', content: 'PO' })
parts = S.reduce(parts, { type: 'text', content: 'N' })
parts = S.reduce(parts, { type: 'text', content: 'G' })
assert.strictEqual(parts.length, 1, 'three text chunks must coalesce into one part')
assert.strictEqual(parts[0].type, 'text')
assert.strictEqual(parts[0].content, 'PONG')

// An empty text chunk is a no-op (no part pushed, no flush).
parts = S.reduce(parts, { type: 'text', content: '' })
assert.strictEqual(parts.length, 1, 'empty text chunk must not append')
assert.strictEqual(parts[0].content, 'PONG')

// A non-text chunk between two text chunks splits the run.
parts = S.reduce(parts, { type: 'mcp_status', mcpServers: JSON.stringify([{ name: 'x', status: 'connected' }]) })
parts = S.reduce(parts, { type: 'text', content: ' later' })
assert.strictEqual(parts.length, 3, 'mcp_status between two text chunks must split the run')
assert.strictEqual(parts[0].type, 'text')
assert.strictEqual(parts[0].content, 'PONG')
assert.strictEqual(parts[1].type, 'mcp_status')
assert.strictEqual(parts[2].type, 'text')
assert.strictEqual(parts[2].content, ' later')

// ---- thinking coalescing -------------------------------------------------
parts = S.initialState()
parts = S.reduce(parts, { type: 'thinking', content: 'step1' })
parts = S.reduce(parts, { type: 'thinking', content: ' + step2' })
assert.strictEqual(parts.length, 1)
assert.strictEqual(parts[0].type, 'thinking')
assert.strictEqual(parts[0].content, 'step1 + step2')

// thinking and text don't merge with each other.
let mix = S.initialState()
mix = S.reduce(mix, { type: 'thinking', content: 'hmm' })
mix = S.reduce(mix, { type: 'text', content: 'ok' })
mix = S.reduce(mix, { type: 'thinking', content: '?' })
assert.strictEqual(mix.length, 3)
assert.strictEqual(mix[0].type, 'thinking')
assert.strictEqual(mix[1].type, 'text')
assert.strictEqual(mix[2].type, 'thinking')
assert.strictEqual(mix[2].content, '?')

// ---- tool_start / tool_input / tool_result -------------------------------
parts = S.initialState()
parts = S.reduce(parts, { type: 'tool_start', toolName: 'Bash', toolId: 'tu_1' })
assert.strictEqual(parts.length, 1)
assert.strictEqual(parts[0].type, 'tool')
assert.strictEqual(parts[0].name, 'Bash')
assert.strictEqual(parts[0].id, 'tu_1')
assert.strictEqual(parts[0].status, 'running')

parts = S.reduce(parts, {
  type: 'tool_input',
  toolId: 'tu_1',
  toolInput: JSON.stringify({ command: 'ls' })
})
assert.strictEqual(parts[0].input.command, 'ls', 'tool_input attaches to the matching running tool')

// tool_result flips the matching tool to done and copies summary + output.
parts = S.reduce(parts, {
  type: 'tool_result',
  toolId: 'tu_1',
  content: 'ok',
  toolOutput: 'README.md\nsrc/'
})
assert.strictEqual(parts[0].status, 'done')
assert.strictEqual(parts[0].summary, 'ok')
assert.strictEqual(parts[0].output, 'README.md\nsrc/')

// ---- tool_input arriving BEFORE tool_start must NOT create a phantom part.
let phantom = S.initialState()
phantom = S.reduce(phantom, {
  type: 'tool_input',
  toolId: 'tu_late',
  toolInput: JSON.stringify({ file: 'x' })
})
assert.strictEqual(phantom.length, 0, 'orphan tool_input is dropped, no phantom part created')

// tool_input with NO toolId attaches to the MOST-RECENT running tool
// (mirrors chatStore.ts:718-728 — `(!toolId || p.id === toolId)` and
// `status === 'running'`).
let noId = S.initialState()
noId = S.reduce(noId, { type: 'tool_start', toolName: 'Bash', toolId: 'tu_a' })
noId = S.reduce(noId, { type: 'tool_start', toolName: 'Read', toolId: 'tu_b' })
noId = S.reduce(noId, {
  type: 'tool_input',
  // no toolId
  toolInput: JSON.stringify({ file_path: '/a/b' })
})
assert.strictEqual(noId.length, 2)
assert.strictEqual(noId[0].input, undefined, 'the older running tool is left alone')
assert.strictEqual(noId[1].input && noId[1].input.file_path, '/a/b',
  'a tool_input chunk without an id attaches to the most-recent running tool')

// tool_input with no id AND no running tool -> drop, no phantom part.
let noIdNoTool = S.reduce(S.initialState(), {
  type: 'tool_input',
  toolInput: JSON.stringify({ x: 1 })
})
assert.strictEqual(noIdNoTool.length, 0)

// ---- tool_result with no matching tool is dropped (not appended).
let orphan = S.initialState()
orphan = S.reduce(orphan, {
  type: 'tool_result',
  toolId: 'tu_missing',
  content: 'x'
})
assert.strictEqual(orphan.length, 0)

// ---- tool_input with malformed JSON does NOT clobber the running tool.
let malformed = S.initialState()
malformed = S.reduce(malformed, {
  type: 'tool_start',
  toolName: 'Bash',
  toolId: 'tu_m'
})
malformed = S.reduce(malformed, {
  type: 'tool_input',
  toolId: 'tu_m',
  toolInput: '{not json'
})
assert.strictEqual(malformed[0].input, undefined, 'malformed tool_input leaves input unset')

// ---- tool_approval --------------------------------------------------------
parts = S.initialState()
parts = S.reduce(parts, {
  type: 'tool_approval',
  requestId: 'req_1',
  toolName: 'Bash',
  toolInput: JSON.stringify({ command: 'rm -rf /' })
})
assert.strictEqual(parts[0].type, 'tool_approval')
assert.strictEqual(parts[0].requestId, 'req_1')
assert.strictEqual(parts[0].toolName, 'Bash')
assert.strictEqual(parts[0].toolInput.command, 'rm -rf /')

// Malformed toolInput degrades to {} (never throws).
parts = S.reduce(parts, {
  type: 'tool_approval',
  requestId: 'req_2',
  toolName: 'Write',
  toolInput: '{not json'
})
assert.strictEqual(parts[1].toolInput && Object.keys(parts[1].toolInput).length, 0)

// ---- ask_user with malformed questions JSON ------------------------------
parts = S.reduce(S.initialState(), {
  type: 'ask_user',
  requestId: 'q1',
  questions: '{not json'
})
assert.strictEqual(parts[0].type, 'ask_user')
deepEqual(parts[0].questions, [], 'malformed questions JSON yields []')

// ask_user with valid JSON parses cleanly.
parts = S.reduce(parts, {
  type: 'ask_user',
  requestId: 'q2',
  questions: JSON.stringify([{ question: '?', header: 'h', options: [{ label: 'a', description: 'd' }], multiSelect: false }])
})
assert.strictEqual(parts[1].questions.length, 1)
assert.strictEqual(parts[1].questions[0].header, 'h')

// ---- plan_approval_request ------------------------------------------------
parts = S.initialState()
parts = S.reduce(parts, {
  type: 'plan_approval_request',
  conversationId: 42,
  content: 'step 1: ...'
})
assert.strictEqual(parts[0].type, 'plan_approval_request')
assert.strictEqual(parts[0].conversationId, 42)
assert.strictEqual(parts[0].plan, 'step 1: ...')

// ---- mcp_status replaces, never accumulates -------------------------------
// Live measurement: mcp_status arrives mid-turn even with zero MCP servers
// configured. Replace-not-accumulate is load-bearing.
let mcpParts = S.initialState()
mcpParts = S.reduce(mcpParts, {
  type: 'mcp_status',
  mcpServers: JSON.stringify([{ name: 'a', status: 'connecting' }])
})
mcpParts = S.reduce(mcpParts, {
  type: 'mcp_status',
  mcpServers: JSON.stringify([{ name: 'a', status: 'connected' }, { name: 'b', status: 'connected' }])
})
const mcpCount = mcpParts.filter(function (p) { return p.type === 'mcp_status' }).length
assert.strictEqual(mcpCount, 1, 'two mcp_status chunks collapse to one part')
assert.strictEqual(mcpParts[0].servers.length, 2, 'the replacement carries the latest server list')

// Empty mcpServers list is dropped (matches the renderer, which also drops
// empty status updates).
let mcpEmpty = S.reduce(S.initialState(), {
  type: 'mcp_status',
  mcpServers: JSON.stringify([])
})
assert.strictEqual(mcpEmpty.length, 0)

// Malformed mcpServers JSON degrades to nothing.
let mcpMalformed = S.reduce(S.initialState(), {
  type: 'mcp_status',
  mcpServers: '{not json'
})
assert.strictEqual(mcpMalformed.length, 0)

// ---- system_message, task_notification ------------------------------------
parts = S.initialState()
parts = S.reduce(parts, {
  type: 'system_message',
  content: 'session restored',
  hookName: 'SessionStart',
  hookEvent: 'startup'
})
assert.strictEqual(parts[0].type, 'system_message')
assert.strictEqual(parts[0].hookName, 'SessionStart')

parts = S.reduce(parts, {
  type: 'task_notification',
  content: 'agent did things',
  taskId: 't1',
  taskStatus: 'completed',
  outputFile: '/tmp/out'
})
assert.strictEqual(parts[1].type, 'task_notification')
assert.strictEqual(parts[1].summary, 'agent did things')
assert.strictEqual(parts[1].taskId, 't1')
assert.strictEqual(parts[1].outputFile, '/tmp/out')

// ---- retry replaces, never accumulates ------------------------------------
let retryParts = S.initialState()
retryParts = S.reduce(retryParts, {
  type: 'retry',
  content: 'attempt 1',
  retryAttempt: 1,
  retryMaxAttempts: 3
})
retryParts = S.reduce(retryParts, {
  type: 'retry',
  content: 'attempt 2',
  retryAttempt: 2,
  retryMaxAttempts: 3
})
const retryCount = retryParts.filter(function (p) { return p.type === 'retry' }).length
assert.strictEqual(retryCount, 1)
assert.strictEqual(retryParts[0].attempt, 2)
assert.strictEqual(retryParts[0].message, 'attempt 2')

// ---- error chunk pushes a marked text part --------------------------------
let errParts = S.reduce(S.initialState(), {
  type: 'error',
  content: 'boom'
})
assert.strictEqual(errParts[0].type, 'text')
assert.strictEqual(errParts[0].isError, true)
assert.strictEqual(errParts[0].content, 'boom')

// ---- done is a no-op ------------------------------------------------------
let doneParts = [{ type: 'text', content: 'committed' }]
const after = S.reduce(doneParts, { type: 'done' })
assert.strictEqual(after.length, 1)
assert.strictEqual(after[0].content, 'committed')

// ---- full multi-chunk turn -----------------------------------------------
// End-to-end smoke of the same shape we observe live: text x3, mcp_status x1,
// done x1.
let turn = S.initialState()
turn = S.reduce(turn, { type: 'text', content: 'PO' })
turn = S.reduce(turn, { type: 'text', content: 'N' })
turn = S.reduce(turn, { type: 'text', content: 'G' })
turn = S.reduce(turn, {
  type: 'mcp_status',
  mcpServers: JSON.stringify([{ name: 'none', status: 'connected' }])
})
turn = S.reduce(turn, { type: 'done' })
assert.strictEqual(turn.length, 2, 'one text part + one mcp_status part')
assert.strictEqual(turn[0].content, 'PONG')
assert.strictEqual(turn[1].type, 'mcp_status')

// ---- realistic approval-gated turn (no tool_result) ----------------------
// Live: a permission-gated Write produced this exact chunk sequence:
//
//   text -> mcp_status -> tool_start -> tool_input -> tool_approval -> text -> done
//
// No `tool_result` ever arrived. The reducer MUST stay faithful (it does):
// the Write tool's tool part ends the turn still at status:'running'. The
// UI is responsible for rendering a settled state once the turn commits —
// the reducer just records what the server sent. This test documents the
// gap so neither side quietly fixes it on the wrong end.
let approvalTurn = S.initialState()
approvalTurn = S.reduce(approvalTurn, { type: 'text', content: 'write ' })
approvalTurn = S.reduce(approvalTurn, {
  type: 'mcp_status',
  mcpServers: JSON.stringify([{ name: 'noop', status: 'connected' }])
})
approvalTurn = S.reduce(approvalTurn, { type: 'tool_start', toolName: 'Write', toolId: 'tu_w' })
approvalTurn = S.reduce(approvalTurn, {
  type: 'tool_input',
  toolId: 'tu_w',
  toolInput: JSON.stringify({ file_path: '/tmp/x', content: 'hi' })
})
approvalTurn = S.reduce(approvalTurn, {
  type: 'tool_approval',
  requestId: 'r1',
  toolName: 'Write',
  toolInput: JSON.stringify({ file_path: '/tmp/x' })
})
approvalTurn = S.reduce(approvalTurn, { type: 'text', content: 'wrote it' })
approvalTurn = S.reduce(approvalTurn, { type: 'done' })
const toolPart = approvalTurn.filter(function (p) { return p.type === 'tool' })[0]
assert.ok(toolPart, 'tool part exists')
assert.strictEqual(toolPart.status, 'running',
  'no tool_result was emitted; tool part stays running until done. ' +
  'Documented gap — UI must render settled on turnActive=false')

// ---- partsFromToolCalls ---------------------------------------------------
// Persisted messages.tool_calls JSON -> {type:'tool'} parts.
const toolCallsJson = JSON.stringify([
  { id: 'tu_1', name: 'Bash', input: '{"command":"ls"}', output: 'README.md', status: 'done' },
  { id: 'tu_2', name: 'Read', input: '{"file_path":"/a/b/c.txt"}', output: '...', status: 'done' },
  { id: 'tu_3', name: 'Write', input: '{}', output: '', status: 'done' }
])
const persistedParts = S.partsFromToolCalls(toolCallsJson)
assert.strictEqual(persistedParts.length, 3)
assert.strictEqual(persistedParts[0].type, 'tool')
assert.strictEqual(persistedParts[0].input.command, 'ls')
assert.strictEqual(persistedParts[1].input.file_path, '/a/b/c.txt')
assert.strictEqual(persistedParts[2].input, undefined, 'empty {} input is treated as absent')

// Empty / null / non-array tool_calls -> empty parts.
deepEqual(S.partsFromToolCalls(null), [])
deepEqual(S.partsFromToolCalls(''), [])
deepEqual(S.partsFromToolCalls('{}'), [])
deepEqual(S.partsFromToolCalls('{not json'), [])

// ---- groupTasks -----------------------------------------------------------
// Adjacent Task tools group; non-Task tools split the group.
const taskParts = [
  { type: 'tool', name: 'Task', id: 'a', status: 'done' },
  { type: 'tool', name: 'Task', id: 'b', status: 'done' },
  { type: 'tool', name: 'Bash', id: 'c', status: 'done' },
  { type: 'tool', name: 'Task', id: 'd', status: 'done' },
  { type: 'tool', name: 'Task', id: 'e', status: 'done' }
]
const grouped = S.groupTasks(taskParts)
assert.strictEqual(grouped.length, 3)
assert.strictEqual(grouped[0].type, 'task_group')
assert.strictEqual(grouped[0].items.length, 2)
assert.strictEqual(grouped[1].type, 'tool')
assert.strictEqual(grouped[1].name, 'Bash', 'non-Task tool is its own group, not folded in')
assert.strictEqual(grouped[2].type, 'task_group')
assert.strictEqual(grouped[2].items.length, 2)
assert.strictEqual(grouped[2].items[0].id, 'd')
assert.strictEqual(grouped[2].items[1].id, 'e')

// A single Task is NOT a group (matches groupStreamParts.ts).
const singleTask = S.groupTasks([
  { type: 'tool', name: 'Task', id: 'a', status: 'done' },
  { type: 'tool', name: 'Bash', id: 'b', status: 'done' }
])
assert.strictEqual(singleTask.length, 2)
assert.strictEqual(singleTask[0].type, 'tool')
assert.strictEqual(singleTask[0].name, 'Task')

// Non-tool parts are passed through untouched.
const mixed = S.groupTasks([
  { type: 'text', content: 'before' },
  { type: 'tool', name: 'Task', id: 'a', status: 'done' },
  { type: 'tool', name: 'Task', id: 'b', status: 'done' },
  { type: 'text', content: 'after' }
])
assert.strictEqual(mixed.length, 3)
assert.strictEqual(mixed[0].type, 'text')
assert.strictEqual(mixed[1].type, 'task_group')
assert.strictEqual(mixed[2].type, 'text')

console.log('test_stream_parts: ok')
