// Tripwire for lib/settingsRows.js.
//
// Three things are at stake here:
//   - claudeOnly/piOnly filtering keeps the right rows visible per backend.
//   - clampNumber() is the only place that knows the bounds, so a regression
//     here makes the wrong number stick.
//   - optionIndexFor() returns -1 for a value not in options, which the
//     page renders as a hint rather than picking the wrong row.
//
// Sentinel flip discipline (test_clamp_flip) is included so a green-on-
// first-run is proven to discriminate; see the comment on that test.
const assert = require('assert')
const { load, deepEqual } = require('./load')

const SR = load('lib/settingsRows.js')

const SAMPLE = [
  { key: 'ai_sdkBackend', type: 'select', options: [{ value: 'claude-agent-sdk', label: 'Claude' }, { value: 'pi', label: 'PI' }] },
  { key: 'ai_apiKey',     type: 'textarea', claudeOnly: true },
  { key: 'pi_extensionsDir', type: 'textarea', piOnly: true },
  { key: 'ai_model',      type: 'select', options: [{ value: 'sonnet', label: 'Sonnet' }, { value: 'opus', label: 'Opus' }] },
  { key: 'ai_maxBudgetUsd', type: 'number', min: 0, max: 10, step: 0.1 },
  { key: 'agent_name',    type: 'textarea' },
]

// ---- rowsFor ---------------------------------------------------------

// On the Claude backend the piOnly row is hidden; on the PI backend the
// claudeOnly row is hidden. Everything else passes through in order.
deepEqual(
  SR.rowsFor(SAMPLE, 'claude-agent-sdk').map(function (d) { return d.key }),
  ['ai_sdkBackend', 'ai_apiKey', 'ai_model', 'ai_maxBudgetUsd', 'agent_name'],
  'rowsFor(claude) hides piOnly rows'
)
deepEqual(
  SR.rowsFor(SAMPLE, 'pi').map(function (d) { return d.key }),
  ['ai_sdkBackend', 'pi_extensionsDir', 'ai_model', 'ai_maxBudgetUsd', 'agent_name'],
  'rowsFor(pi) hides claudeOnly rows'
)

// An unknown backend string behaves like Claude — claudeOnly stays
// visible because the predicate is "backend === 'pi'?" not "starts with".
deepEqual(
  SR.rowsFor(SAMPLE, 'something-else').map(function (d) { return d.key }),
  SR.rowsFor(SAMPLE, 'claude-agent-sdk').map(function (d) { return d.key }),
  'rowsFor with unknown backend = rowsFor(claude)'
)

// An empty-string backend behaves like Claude too (same predicate).
deepEqual(
  SR.rowsFor(SAMPLE, '').map(function (d) { return d.key }),
  SR.rowsFor(SAMPLE, 'claude-agent-sdk').map(function (d) { return d.key }),
  'rowsFor with empty backend = rowsFor(claude)'
)


deepEqual(SR.rowsFor(null, 'pi'), [], 'rowsFor(null) returns []')
deepEqual(SR.rowsFor(undefined, 'pi'), [], 'rowsFor(undefined) returns []')
deepEqual(SR.rowsFor('not an array', 'pi'), [], 'rowsFor(non-array) returns []')


// Defensive: a null/undefined/prim element in the array is skipped, not
// crashing the loop. The order of the surviving elements is preserved.
deepEqual(
  SR.rowsFor([null, SAMPLE[0], undefined, SAMPLE[1]], 'claude-agent-sdk').map(function (d) { return d.key }),
  ['ai_sdkBackend', 'ai_apiKey'],
  'rowsFor skips nullish elements'
)

// ---- controlKindFor --------------------------------------------------

assert.strictEqual(SR.controlKindFor({ type: 'select' }), 'dropdown')
assert.strictEqual(SR.controlKindFor({ type: 'number' }), 'number')
assert.strictEqual(SR.controlKindFor({ type: 'textarea' }), 'textarea')

// A type the page does not know falls back to a plain text input rather
// than throwing — a future def type should not silently vanish the row.
assert.strictEqual(SR.controlKindFor({ type: 'color-picker' }), 'text')
assert.strictEqual(SR.controlKindFor({}), 'text', 'controlKindFor empty def returns text')
assert.strictEqual(SR.controlKindFor(null), 'text', 'controlKindFor null returns text')

// ---- clampNumber -----------------------------------------------------

// In bounds: returned unchanged.
assert.strictEqual(SR.clampNumber(5, { min: 0, max: 10 }), 5)
assert.strictEqual(SR.clampNumber(0, { min: 0, max: 10 }), 0)
assert.strictEqual(SR.clampNumber(10, { min: 0, max: 10 }), 10)

// At the lower bound, exactly.
assert.strictEqual(SR.clampNumber(-0.0001, { min: 0, max: 10 }), 0)
assert.strictEqual(SR.clampNumber(-100, { min: 0, max: 10 }), 0)

// Above the upper bound, exactly.
assert.strictEqual(SR.clampNumber(10.0001, { min: 0, max: 10 }), 10)
assert.strictEqual(SR.clampNumber(1e9, { min: 0, max: 10 }), 10)

// Missing min = no lower bound (a positive value passes through).
assert.strictEqual(SR.clampNumber(-50, { max: 10 }), -50)
assert.strictEqual(SR.clampNumber(11, { max: 10 }), 10)

// Missing max = no upper bound.
assert.strictEqual(SR.clampNumber(1e9, { min: 0 }), 1e9)
assert.strictEqual(SR.clampNumber(-1, { min: 0 }), 0)

// A non-numeric input falls back to the min, then the max.
assert.strictEqual(SR.clampNumber('not a number', { min: 1, max: 9 }), 1)
assert.strictEqual(SR.clampNumber('not a number', { max: 9 }), 9)
assert.strictEqual(SR.clampNumber('not a number', { min: 1 }), 1)
// No bounds at all and a non-numeric input -> NaN, so the row renders an
// empty NumberField and the user sees they have to fix it.
assert.ok(isNaN(SR.clampNumber('not a number', {})))

// Non-numeric `min`/`max` are ignored, not silently zeroed.
assert.strictEqual(SR.clampNumber(5, { min: 'oops', max: 10 }), 5)
assert.strictEqual(SR.clampNumber(20, { min: 0, max: 'oops' }), 20)
assert.ok(isNaN(SR.clampNumber('oops', { min: 'oops', max: 'oops' })))

// Empty-string `min`/`max` are NOT ignored — Number('') is 0, so an empty
// string is treated as a present 0. That matches DB-stored defaults, which
// arrive as strings and may include "".
assert.strictEqual(SR.clampNumber(-5, { min: '', max: 10 }), 0,
  'empty-string min = 0 (matches DB-stored defaults)')

// Step is intentionally not applied here — the page's NumberField uses
// stepSize. Make sure clampNumber is not silently doing it.
assert.strictEqual(SR.clampNumber(3.33, { min: 0, max: 10, step: 0.1 }), 3.33,
  'clampNumber does not snap to step')

// ---- optionIndexFor --------------------------------------------------

// The match is a strict string-equal on `value`. The stored setting is
// always a string (settings is Record<string, string>), so a numeric
// `currentValue` should not silently match "42".
const opts = [{ value: 'sonnet' }, { value: 'opus' }]
assert.strictEqual(SR.optionIndexFor({ options: opts }, 'sonnet'), 0)
assert.strictEqual(SR.optionIndexFor({ options: opts }, 'opus'), 1)
assert.strictEqual(SR.optionIndexFor({ options: opts }, 'Opus'), -1,
  'optionIndexFor is case-sensitive — "Opus" is not "opus"')

// Empty / undefined currentValue -> -1 (the row shows an "unknown value" hint).
assert.strictEqual(SR.optionIndexFor({ options: opts }, ''), -1)
assert.strictEqual(SR.optionIndexFor({ options: opts }, undefined), -1)
assert.strictEqual(SR.optionIndexFor({ options: opts }, null), -1)

// Missing options array -> -1.
assert.strictEqual(SR.optionIndexFor({ options: [] }, 'sonnet'), -1)
assert.strictEqual(SR.optionIndexFor({}, 'sonnet'), -1)
assert.strictEqual(SR.optionIndexFor(null, 'sonnet'), -1)

// The value-not-in-options case is the most important one — it is what
// makes a stale DB row (e.g. an old `ai_model` that no longer exists)
// not silently render as a different option.
assert.strictEqual(SR.optionIndexFor({ options: opts }, 'haiku'), -1,
  'value absent from options returns -1, not the first option')

// An option missing `value` is skipped, not crashed on.
assert.strictEqual(
  SR.optionIndexFor({ options: [{ label: 'broken' }, { value: 'opus' }] }, 'opus'),
  1,
  'optionIndexFor skips options missing value'
)

// ---- sentinel flip (discrimination proof) ---------------------------

// Pick a single expected value, flip it to a sentinel, watch the test fail,
// then restore. This is the proof that test_clamp_above_max actually
// exercises the clamp branch — a test that passes on either side is
// worse than no test because it claims coverage it does not have.
{
  const ok = SR.clampNumber(15, { min: 0, max: 10 })
  assert.strictEqual(ok, 10, 'clampNumber 15 -> 10 (above max)')
  // Flip: assert the unclamped value as the expected. The test must fail
  // here (ok is 10, expected is 15).
  const failOk = (function () {
    try { assert.strictEqual(ok, 15); return 'passed' }
    catch (e) { return 'failed' }
  })()
  if (failOk !== 'failed') {
    throw new Error('sentinel flip on clampNumber did not fail — test does not discriminate')
  }
}

console.log('test_settings_rows: ok')