// Tripwire for lib/piUi.js — every entry point is exercised with a
// frozen initial state so a regression in the reducer flips a test
// rather than silently corrupting the chrome.
const assert = require('assert')
const { load, deepEqual } = require('./load')

const P = load('lib/piUi.js')

// ---- initialState ----------------------------------------------------------

const s = P.initialState()
deepEqual(s, {
  toasts: [],
  statuses: {},
  widgets: {},
  workingMessage: '',
  title: '',
  header: null,
  footer: null
}, 'initialState must start with empty chrome')

// ---- notify ----------------------------------------------------------------

let state = P.reduceEvent(s, { method: 'notify', message: 'hello', level: 'info' })
assert.strictEqual(state.toasts.length, 1, 'one toast')
assert.strictEqual(state.toasts[0].message, 'hello')
assert.strictEqual(state.toasts[0].level, 'info')

// A second notify appends — toasts are a list, not keyed.
state = P.reduceEvent(state, { method: 'notify', message: 'second', level: 'warning' })
assert.strictEqual(state.toasts.length, 2, 'second notify appends')
assert.strictEqual(state.toasts[1].level, 'warning')

// An empty / missing message is ignored — no toast with a blank body.
state = P.reduceEvent(state, { method: 'notify', message: '' })
assert.strictEqual(state.toasts.length, 2, 'empty notify is dropped')
state = P.reduceEvent(state, { method: 'notify' })
assert.strictEqual(state.toasts.length, 2, 'message-less notify is dropped')

// An unknown level falls back to 'info' rather than 'error'.
state = P.reduceEvent(s, { method: 'notify', message: 'x', level: 'bogus' })
assert.strictEqual(state.toasts[0].level, 'info', 'unknown level -> info')

// ---- setStatus (keyed replace) ---------------------------------------------

state = P.initialState()
state = P.reduceEvent(state, { method: 'setStatus', key: 'a', text: 'one' })
state = P.reduceEvent(state, { method: 'setStatus', key: 'b', text: 'two' })
deepEqual(state.statuses, { a: 'one', b: 'two' })

// A second setStatus for the same key REPLACES the value, never
// appends (the map size must not grow).
state = P.reduceEvent(state, { method: 'setStatus', key: 'a', text: 'one-updated' })
assert.strictEqual(state.statuses.a, 'one-updated', 'setStatus replaces')
assert.strictEqual(Object.keys(state.statuses).length, 2,
  'setStatus keyed replace must NOT grow the map; updating key a leaves key b in place')

// An empty text drops the chip.
state = P.reduceEvent(state, { method: 'setStatus', key: 'a', text: '' })
assert.strictEqual(state.statuses.a, undefined, 'empty text drops the chip')

// A key-less setStatus is ignored.
state = P.reduceEvent(s, { method: 'setStatus', text: 'orphan' })
assert.strictEqual(Object.keys(state.statuses).length, 0, 'missing key is ignored')

// ---- setWidget (keyed, with placement) ------------------------------------

state = P.initialState()
state = P.reduceEvent(state, { method: 'setWidget', key: 'w', content: ['line one', 'line two'], placement: 'aboveEditor' })
assert.strictEqual(state.widgets.w.content.length, 2)
assert.strictEqual(state.widgets.w.placement, 'aboveEditor')

// placement defaults to aboveEditor when absent or unknown.
state = P.reduceEvent(s, { method: 'setWidget', key: 'w', content: ['x'] })
assert.strictEqual(state.widgets.w.placement, 'aboveEditor', 'unknown placement -> aboveEditor')

// content as string -> wrapped in an array; non-array -> empty.
state = P.reduceEvent(s, { method: 'setWidget', key: 'w', content: 'just one' })
assert.strictEqual(state.widgets.w.content.length, 1)

// ---- setWorkingMessage -----------------------------------------------------

state = P.initialState()
state = P.reduceEvent(state, { method: 'setWorkingMessage', message: 'thinking' })
assert.strictEqual(state.workingMessage, 'thinking')

// No message -> empty string (clears it).
state = P.reduceEvent(state, { method: 'setWorkingMessage' })
assert.strictEqual(state.workingMessage, '', 'no message clears')

// ---- setTitle -------------------------------------------------------------

state = P.initialState()
state = P.reduceEvent(state, { method: 'setTitle', title: 'Window 1' })
assert.strictEqual(state.title, 'Window 1')

// Non-string is IGNORED (does not corrupt the title).
state = P.reduceEvent(state, { method: 'setTitle', title: 42 })
assert.strictEqual(state.title, 'Window 1', 'numeric title is ignored')
state = P.reduceEvent(state, { method: 'setTitle', title: { foo: 'bar' } })
assert.strictEqual(state.title, 'Window 1', 'object title is ignored')
state = P.reduceEvent(state, { method: 'setTitle', title: null })
assert.strictEqual(state.title, 'Window 1', 'null title is ignored')

// ---- setHeader / setFooter -------------------------------------------------

state = P.reduceEvent(s, { method: 'setHeader', component: { type: 'text', content: 'H' } })
assert.strictEqual(state.header.type, 'text')
assert.strictEqual(state.header.content, 'H')

state = P.reduceEvent(state, { method: 'setHeader', component: null })
assert.strictEqual(state.header, null, 'null component clears header')

// ---- unknown method does not throw ----------------------------------------

const before = P.initialState()
const after = P.reduceEvent(before, { method: 'completely-unknown', payload: 'whatever' })
deepEqual(after, before, 'unknown method is a no-op (returns same shape)')

// null / non-object events are no-ops.
assert.strictEqual(P.reduceEvent(s, null), s)
assert.strictEqual(P.reduceEvent(s, undefined), s)
assert.strictEqual(P.reduceEvent(s, 'a string'), s)
assert.strictEqual(P.reduceEvent(s, 42), s)

// ---- normalizeNode: known types -------------------------------------------

assert.strictEqual(P.normalizeNode({ type: 'text', content: 'hi' }).content, 'hi')
assert.strictEqual(P.normalizeNode({ type: 'text', content: 'hi', style: 'bold' }).style, 'bold')
assert.strictEqual(P.normalizeNode({ type: 'text', content: 'hi', style: 'unknown' }).style, undefined,
  'unknown text style is dropped')

assert.strictEqual(P.normalizeNode({ type: 'button', label: 'OK', action: 'a' }).label, 'OK')

assert.strictEqual(P.normalizeNode({ type: 'input', id: 'x' }).id, 'x')
assert.strictEqual(P.normalizeNode({ type: 'input', id: 'x', placeholder: '...' }).placeholder, '...')

assert.strictEqual(P.normalizeNode({ type: 'select', id: 's', options: ['a','b'] }).options.length, 2)
assert.strictEqual(P.normalizeNode({ type: 'select', id: 's', options: [1, 2] }).options[0], '1',
  'select options are stringified')

assert.strictEqual(P.normalizeNode({ type: 'progress', value: 5, max: 10 }).value, 5)
assert.strictEqual(P.normalizeNode({ type: 'progress', value: 'bad', max: 10 }).value, 0,
  'non-numeric progress value -> 0')

assert.strictEqual(P.normalizeNode({ type: 'divider' }).type, 'divider')

// hstack / vstack
let h = P.normalizeNode({ type: 'hstack', children: [{ type: 'text', content: 'a' }, { type: 'text', content: 'b' }] })
assert.strictEqual(h.children.length, 2)
assert.strictEqual(h.children[0].content, 'a')
assert.strictEqual(P.normalizeNode({ type: 'vstack', children: [] }).children.length, 0)

assert.strictEqual(P.normalizeNode({ type: 'badge', text: 'ready', color: 'red' }).text, 'ready')

// ---- normalizeNode: unknown type degrades to text -------------------------

const unknown = P.normalizeNode({ type: 'something-new', payload: 42 })
assert.strictEqual(unknown.type, 'text', 'unknown type degrades to text')
assert.strictEqual(unknown.style, 'error', 'degraded node is marked style=error')
assert.ok(unknown.content.indexOf('something-new') >= 0,
  'degraded node carries the JSON of the bad payload')

// ---- normalizeNode: depth clamping ----------------------------------------

let deep = { type: 'vstack' }
let cur = deep
for (let i = 0; i < 100; i++) {
  var next = { type: 'vstack', children: [cur] }
  cur = next
}
const clamped = P.normalizeNode(cur, 0)
function depth(n) {
  if (!n || typeof n !== 'object') return 0
  if (!Array.isArray(n.children)) return 1
  let max = 1
  for (let i = 0; i < n.children.length; i++) {
    const d = depth(n.children[i])
    if (d > max) max = d
  }
  return max + 1
}
assert.ok(depth(clamped) <= 33,
  'normalizeNode clamps excessive nesting depth')

// ---- normalizeNode: never throws on garbage -------------------------------

assert.doesNotThrow(function () { P.normalizeNode(null) })
assert.doesNotThrow(function () { P.normalizeNode(undefined) })
assert.doesNotThrow(function () { P.normalizeNode('a string') })
assert.doesNotThrow(function () { P.normalizeNode(42) })
assert.doesNotThrow(function () { P.normalizeNode({}) })

// ---- describeRequest -------------------------------------------------------

assert.strictEqual(P.describeRequest({ method: 'editor', title: 't', prefill: 'p' }).kind, 'editor')
assert.strictEqual(P.describeRequest({ method: 'editor', title: 't' }).prefill, '',
  'editor without prefill -> empty string')

assert.strictEqual(P.describeRequest({ method: 'select', title: 't', options: ['a'] }).kind, 'select')
assert.strictEqual(P.describeRequest({ method: 'select', title: 't' }).options.length, 0,
  'select without options -> empty array')

assert.strictEqual(P.describeRequest({ method: 'confirm', title: 't', message: 'm' }).kind, 'confirm')

assert.strictEqual(P.describeRequest({ method: 'input', title: 't' }).placeholder, '',
  'input without placeholder -> empty string')

assert.strictEqual(P.describeRequest({ method: 'custom', title: 't', component: { type: 'text', content: 'c' } }).kind, 'custom')
assert.strictEqual(P.describeRequest({ method: 'unknown-method' }).kind, 'unknown')

// ---- responseFor: dismissed ALWAYS -> cancelled ---------------------------

const r1 = P.responseFor('editor', { submitted: false })
assert.strictEqual(r1.cancelled, true, 'dismissed editor -> cancelled: true')
assert.strictEqual(r1.value, undefined)

const r2 = P.responseFor('editor', null)
assert.strictEqual(r2.cancelled, true, 'null outcome -> cancelled')

const r3 = P.responseFor('select', { submitted: true, value: 'B' })
assert.strictEqual(r3.value, 'B')
assert.strictEqual(r3.cancelled, undefined)

const r4 = P.responseFor('confirm', { submitted: true })
assert.strictEqual(r4.confirmed, true)
assert.strictEqual(r4.cancelled, undefined)

const r5 = P.responseFor('confirm', { submitted: false })
assert.strictEqual(r5.cancelled, true, 'No on confirm -> cancelled')

const r6 = P.responseFor('input', { submitted: true, value: 'typed' })
assert.strictEqual(r6.value, 'typed')

// Unknown kind always cancels — never hangs.
const r7 = P.responseFor('totally-unknown', { submitted: true })
assert.strictEqual(r7.cancelled, true)

console.log('test_pi_ui: ok')
