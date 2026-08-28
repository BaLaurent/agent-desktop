// Tripwire for lib/schedule.js: every entry point is exercised with a frozen
// `nowIso` so an output change is proof a regression slipped in, not a clock
// race. The boundaries the plan called out are each their own assertion:
// null timestamps, a next-run in the past, singular vs plural, max_runs reached.
const assert = require('assert')
const { load } = require('./load')

const S = load('lib/schedule.js')

// 2026-01-15 12:00:00 UTC. Pinned so a test can’t drift on the wall clock.
const NOW = '2026-01-15T12:00:00.000Z'

function isoOffset(seconds) {
  return new Date(Date.parse(NOW) + seconds * 1000).toISOString()
}

// ---- formatInterval ---------------------------------------------------------

;[
  [1, 'minutes', 'every 1 minute'],
  [2, 'minutes', 'every 2 minutes'],
  [15, 'minutes', 'every 15 minutes'],
  [1, 'hours',   'every 1 hour'],
  [3, 'hours',   'every 3 hours'],
  [1, 'days',    'every 1 day'],
  [7, 'days',    'every 7 days'],
].forEach(function (row) {
  assert.strictEqual(S.formatInterval(row[0], row[1]), row[2],
    'formatInterval(' + row[0] + ',' + row[1] + ')')
})

// Negative / zero / NaN / undefined -> the dash placeholder. A bad value
// must not produce a misleading "every NaN".
assert.strictEqual(S.formatInterval(0, 'minutes'), '—')
assert.strictEqual(S.formatInterval(-1, 'minutes'), '—')
assert.strictEqual(S.formatInterval(NaN, 'minutes'), '—')
assert.strictEqual(S.formatInterval(undefined, 'minutes'), '—')

// An unknown unit still renders something honest rather than crashing the row.
assert.strictEqual(S.formatInterval(5, 'fortnights'), 'every 5 fortrnights'.replace('fortrnights', 'fortnights'))
// (The above is just to assert it does not throw — exact spelling isn’t prescribed.)

// ---- formatNextRun ----------------------------------------------------------

// Null / undefined / unparseable -> "—". A task whose max_runs was reached
// reports `next_run_at: null`; that is exactly this case.
assert.strictEqual(S.formatNextRun(null, NOW), '—',
  'next_run_at null must render "—"')
assert.strictEqual(S.formatNextRun(undefined, NOW), '—',
  'next_run_at undefined must render "—"')
assert.strictEqual(S.formatNextRun('not a date', NOW), '—',
  'next_run_at unparseable must render "—"')

// A next-run in the future at the four cardinal buckets.
assert.strictEqual(S.formatNextRun(isoOffset(30), NOW), 'in a moment',
  'next-run inside a minute')
assert.strictEqual(S.formatNextRun(isoOffset(240), NOW), 'in 4 min',
  'next-run in the minutes bucket')
assert.strictEqual(S.formatNextRun(isoOffset(7200), NOW), 'in 2 h',
  'next-run in the hours bucket')
assert.strictEqual(S.formatNextRun(isoOffset(86400 * 3), NOW), 'in 3 d',
  'next-run in the days bucket')

// A next-run in the past: scheduler rows show "overdue by X" rather than
// staying silent, so the user notices the queue is wedged.
assert.strictEqual(S.formatNextRun(isoOffset(-240), NOW), 'overdue by 4 min',
  'overdue next-run in the minutes bucket')
assert.strictEqual(S.formatNextRun(isoOffset(-3600), NOW), 'overdue by 1 h',
  'overdue next-run in the hours bucket')

// Exactly now: the row shows "now", not "overdue by a moment" — the
// moment-bucket prefix would be misleading either way at zero.
assert.strictEqual(S.formatNextRun(isoOffset(0), NOW), 'now',
  'next-run exactly at now')

// ---- formatLastRun ----------------------------------------------------------

// Null / undefined / unparseable -> "never".
assert.strictEqual(S.formatLastRun(null, NOW), 'never',
  'no prior run -> "never"')
assert.strictEqual(S.formatLastRun(undefined, NOW), 'never',
  'undefined last-run -> "never"')
assert.strictEqual(S.formatLastRun('not a date', NOW), 'never',
  'unparseable last-run -> "never"')

// Inside the moment bucket: "just now" rather than "0 min ago", which the
// plan called out as a noise floor.
assert.strictEqual(S.formatLastRun(isoOffset(-15), NOW), 'just now',
  'last-run inside the minute')
assert.strictEqual(S.formatLastRun(isoOffset(0), NOW), 'just now',
  'last-run exactly at now')

// Past runs: "X min/h/d ago". Past-tense is computed by lib's relativeAgo
// helper, not by reusing relativeFromNow with an empty prefix — every
// realistic last-run hits this branch.
assert.strictEqual(S.formatLastRun(isoOffset(-240), NOW), '4 min ago')
assert.strictEqual(S.formatLastRun(isoOffset(-7200), NOW), '2 h ago')
assert.strictEqual(S.formatLastRun(isoOffset(-86400 * 3), NOW), '3 d ago')

// Clock-skew defence: a last_run_at slightly in the future must not become
// a future-tense row, just "just now". Real reason: the server runs on
// another machine; a 1s skew would otherwise render "-1 min ago".
assert.strictEqual(S.formatLastRun(isoOffset(5), NOW), 'just now',
  'slight clock skew must render "just now", not a future-tense string')
// ---- describeTask -----------------------------------------------------------


// The "no task" defence — describeTask(t, t) is called from a binding; an
// empty list must not throw.
assert.strictEqual(S.describeTask(null, NOW), '')
assert.strictEqual(S.describeTask(undefined, NOW), '')
assert.strictEqual(S.describeTask({}, NOW), '— · —')

// The ordinary row: every 15 minutes, next in 4 min, linked to a chat.
assert.strictEqual(
  S.describeTask({
    interval_value: 15, interval_unit: 'minutes',
    next_run_at: isoOffset(240), run_count: 1, max_runs: null,
    conversation_title: 'Ops'
  }, NOW),
  'every 15 minutes · in 4 min · → Ops'
)

// max_runs reached: the limit badge wins over the next-run summary. A row
// at its limit is no longer scheduled, so "in 4 min" would be a lie.
assert.strictEqual(
  S.describeTask({
    interval_value: 5, interval_unit: 'minutes',
    next_run_at: null, run_count: 5, max_runs: 5
  }, NOW),
  'every 5 minutes · limit reached'
)

// max_runs == null: an unlimited task is never "limit reached" even if its
// run_count is large.
assert.strictEqual(
  S.describeTask({
    interval_value: 1, interval_unit: 'days',
    next_run_at: isoOffset(86400), run_count: 9999, max_runs: null
  }, NOW),
  'every 1 day · in 1 d'
)

// Singular vs plural flows through describeTask too — a row with interval
// 1 must read "every 1 day", not "every 1 days". This is the regression the
// plan singled out as having cost real debugging time elsewhere.
assert.strictEqual(
  S.describeTask({
    interval_value: 1, interval_unit: 'days',
    next_run_at: isoOffset(86400), run_count: 0, max_runs: null
  }, NOW),
  'every 1 day · in 1 d'
)

console.log('test_schedule: ok')
