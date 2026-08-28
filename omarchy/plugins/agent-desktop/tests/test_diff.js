const assert = require('assert')
const { load } = require('./load')

const D = load('lib/diff.js')
const TS = load('lib/toolSummary.js')

const ops = (r) => r.rows.map((x) => x.op + x.text).join('|')

// ---- the three SDK spellings ---------------------------------------------
// An edit card exists to show WHAT CHANGED. Claude's Edit tool sends
// `old_string`/`new_string` — the documented Anthropic schema — while the
// renderer's own getEditDiffStrings matches only `old_str`/`oldText`
// (src/renderer/components/chat/toolUse/toolInputUtils.ts:11). So a real
// Claude edit matched nothing and neither front ever rendered a diff for one.

assert.deepStrictEqual(
  { ...TS.editStrings({ old_string: 'a', new_string: 'b' }) },
  { oldStr: 'a', newStr: 'b' },
  "Claude's old_string/new_string")
assert.deepStrictEqual(
  { ...TS.editStrings({ old_str: 'a', new_str: 'b' }) },
  { oldStr: 'a', newStr: 'b' },
  'old_str/new_str')
assert.deepStrictEqual(
  { ...TS.editStrings({ oldText: 'a', newText: 'b' }) },
  { oldStr: 'a', newStr: 'b' },
  "PI's oldText/newText")
assert.strictEqual(TS.editStrings({ file_path: '/x' }), null,
  'a non-edit input has no pair')
assert.strictEqual(TS.editStrings(null), null, 'null input is not a crash')
// A partial pair is not a diff: rendering one side against `undefined` would
// show the whole file as removed.
assert.strictEqual(TS.editStrings({ old_string: 'a' }), null, 'old without new')
assert.strictEqual(TS.editStrings({ new_string: 'b' }), null, 'new without old')

// ---- line diff -----------------------------------------------------------

assert.strictEqual(ops(D.lineDiff('one\ntwo\nthree', 'one\nTWO\nthree')),
  ' one|-two|+TWO| three',
  'a replaced line reads as removal then addition, in place')

assert.strictEqual(ops(D.lineDiff('a', 'a\nb')), ' a|+b', 'pure append')
assert.strictEqual(ops(D.lineDiff('a\nb', 'a')), ' a|-b', 'pure removal')
assert.strictEqual(ops(D.lineDiff('', 'x')), '+x', 'from empty')
assert.strictEqual(ops(D.lineDiff('x', '')), '-x', 'to empty')
assert.strictEqual(ops(D.lineDiff('same', 'same')), ' same', 'no change')

// A trailing newline must not invent a phantom changed line — a naive split
// leaves a final "" that then shows up as an added or removed blank.
assert.strictEqual(ops(D.lineDiff('a\n', 'a\n')), ' a',
  'a trailing newline is not a line')
assert.strictEqual(ops(D.lineDiff('a\n', 'a\nb\n')), ' a|+b',
  'trailing newlines on both sides')

{
  const r = D.lineDiff('one\ntwo', 'ONE\ntwo\nthree')
  assert.strictEqual(r.removed, 1, 'counts the removal')
  assert.strictEqual(r.added, 2, 'counts both additions')
  assert.strictEqual(r.truncated, false)
}

// ---- the cap -------------------------------------------------------------
// The table is O(n*m) and this runs on the UI thread; a Write of a whole file
// would freeze the transcript. Past the cap the caller must be told, not
// handed empty rows that look like "no change".
{
  const big = Array.from({ length: 500 }, (_, i) => 'l' + i).join('\n')
  const r = D.lineDiff(big, big)
  assert.strictEqual(r.truncated, true, 'over the cap -> truncated')
  assert.strictEqual(r.rows.length, 0, 'and no rows to render')
}
{
  const r = D.lineDiff('a\nb', 'a\nc', 1)
  assert.strictEqual(r.truncated, true, 'the cap is honoured when passed in')
}

console.log('test_diff: ok')
