// The three pure decision functions behind ConversationsStore.ensureQuickChat.
//
// These ran inline in bridge/bridge.mjs before the bridge was rewritten as a
// generic proxy. Keeping them in lib/quickChat.js means the same JS that
// QML runs is the same JS the tests exercise.
//
// The null-create fallback is the reason this file is not just "a few
// obvious asserts": live evidence from a real bridge run this session shows
// `conversations:create` over WS returning literally `null` while the row is
// in fact inserted (id came back 15 from a follow-up `conversations:list`).
// Two tests below prove the fallback path — without them, a future
// regression of the workaround regresses silently and the next quick-chat
// conversation gets a duplicate "Quick Chat" row, in the worst case.
const assert = require('assert')
const { load } = require('./load')

const QC = load('lib/quickChat.js')

// ---- settingKeyFor ---------------------------------------------------------

// Voice mode + separate = voice slot.
assert.strictEqual(
  QC.settingKeyFor('voice', 'true'),
  'quickChat_voiceConversationId',
  'voice + separate means voice slot',
)
// Voice mode + NOT separate = shared slot — a typo in the setting that wrote
// 'true' as a literal would silently route every text-mode message to the
// voice slot.
assert.strictEqual(
  QC.settingKeyFor('voice', 'false'),
  'quickChat_conversationId',
  'voice + not-separate shares the slot',
)
// Text mode always shares, including when separate is true.
assert.strictEqual(
  QC.settingKeyFor('text', 'true'),
  'quickChat_conversationId',
  'text mode never uses the voice slot',
)
// Anything other than 'voice' (including undefined) is treated as text-mode.
assert.strictEqual(
  QC.settingKeyFor(undefined, 'true'),
  'quickChat_conversationId',
  'undefined mode is treated as text',
)
assert.strictEqual(
  QC.settingKeyFor('qwerty', 'true'),
  'quickChat_conversationId',
  'unknown mode is treated as text',
)

// ---- normalizeStoredId -----------------------------------------------------

// A real positive id is preserved.
assert.strictEqual(QC.normalizeStoredId(42), 42)
assert.strictEqual(QC.normalizeStoredId('42'), 42)

// Zero / empty / "null" / "undefined" / NaN / Infinity all collapse to 0 —
// every caller distinguishes "empty" from "valid id" by `> 0`.
// The strings 'null' and 'undefined' really do land here. They are the
// marker the front end leaves behind after a de-pinning action.
assert.strictEqual(QC.normalizeStoredId(null), 0)
assert.strictEqual(QC.normalizeStoredId(undefined), 0)
assert.strictEqual(QC.normalizeStoredId(''), 0)
assert.strictEqual(QC.normalizeStoredId('0'), 0)
assert.strictEqual(QC.normalizeStoredId('null'), 0)
assert.strictEqual(QC.normalizeStoredId('undefined'), 0)
assert.strictEqual(QC.normalizeStoredId(0), 0)
assert.strictEqual(QC.normalizeStoredId(NaN), 0)
assert.strictEqual(QC.normalizeStoredId(Infinity), 0)
assert.strictEqual(QC.normalizeStoredId(-Infinity), 0)
assert.strictEqual(QC.normalizeStoredId('not a number'), 0)
assert.strictEqual(QC.normalizeStoredId('42abc'), 0, 'partial parses are rejected')

// Negative ids collapse to 0 — the schema is rowid, but a corrupt write
// must not turn into a phantom "use id -1" path.
assert.strictEqual(QC.normalizeStoredId(-1), 0)

// Floats are floored — fractional ids don't exist, but a float that
// slipped through (e.g. from `getSetting` with a numeric setting) must
// not pass through silently.
assert.strictEqual(QC.normalizeStoredId(42.7), 42)
assert.strictEqual(QC.normalizeStoredId(42.0001), 42)

// ---- pickCreatedId ---------------------------------------------------------

// A non-null createResult wins — the happy path.
assert.strictEqual(
  QC.pickCreatedId(123, []),
  123,
  'a real id from create() is returned',
)
// String id is coerced.
assert.strictEqual(QC.pickCreatedId('123', []), 123)
// Float is floored.
assert.strictEqual(QC.pickCreatedId(123.9, []), 123)

// ----- the live-evidenced null-create workaround ---------------------------

// `conversations:create` over WS really does return null while inserting the
// row — verified on the running bridge this session. The fallback MUST scan
// the list, filter on title, and take the HIGHEST id (not first, not last
// — schema has no uniqueness on (title) and a previous bug that picked
// "any" doubled up the row after a same-day quick purge + recreate).
assert.strictEqual(
  QC.pickCreatedId(null, [
    { id: 1, title: 'Quick Chat' },
    { id: 7, title: 'Quick Chat' },
    { id: 4, title: 'Quick Chat' },
  ]),
  7,
  'highest matching id wins',
)

// Same shape as the live trace: create() returned null and a follow-up list
// returned a single Quick Chat row with id 15.
assert.strictEqual(
  QC.pickCreatedId(null, [{ id: 15, title: 'Quick Chat' }]),
  15,
  'single-row fallback returns its id',
)

// The fallback ignores voice rows — "Quick Chat (Voice)" belongs to the
// voice slot, not the text slot; reusing it would mix two streams.
assert.strictEqual(
  QC.pickCreatedId(null, [
    { id: 1, title: 'Quick Chat (Voice)' },
    { id: 2, title: 'Quick Chat (Voice)' },
  ]),
  0,
  'voice-only rows do not fall into the text slot',
)

// Mixed list: the highest text-mode row wins even when voice rows are
// present — a regression here would route text-mode messages to voice
// threads.
assert.strictEqual(
  QC.pickCreatedId(null, [
    { id: 1, title: 'Quick Chat (Voice)' },
    { id: 3, title: 'Quick Chat' },
    { id: 2, title: 'Quick Chat (Voice)' },
  ]),
  3,
  'voice rows do not block the text fallback',
)

// None match, even though other rows are present — pure "no Quick Chat"
// state, return 0 so the caller can surface a clear error rather than pick
// up an unrelated conversation.
assert.strictEqual(
  QC.pickCreatedId(null, [
    { id: 1, title: 'something else' },
    { id: 2, title: 'another thing' },
  ]),
  0,
  'no Quick Chat rows means no fallback id',
)

// Zero and empty string from create are both "no id", so the list fallback
// runs. Same code path as the null workaround.
assert.strictEqual(
  QC.pickCreatedId(0, [{ id: 5, title: 'Quick Chat' }]),
  5,
  'create() returning 0 falls through to the list',
)
assert.strictEqual(
  QC.pickCreatedId('', [{ id: 5, title: 'Quick Chat' }]),
  5,
  'create() returning "" falls through to the list',
)

// A listResult that is not an array (server errored out, or returned a
// string error) is treated as empty — not a crash.
assert.strictEqual(QC.pickCreatedId(null, null), 0)
assert.strictEqual(QC.pickCreatedId(null, undefined), 0)
assert.strictEqual(QC.pickCreatedId(null, 'oops'), 0)

// A row missing an id field does not poison the scan.
assert.strictEqual(
  QC.pickCreatedId(null, [
    { title: 'Quick Chat' },
    { id: 9, title: 'Quick Chat' },
  ]),
  9,
  'id-less row skipped',
)

console.log('test_quick_chat: ok')
