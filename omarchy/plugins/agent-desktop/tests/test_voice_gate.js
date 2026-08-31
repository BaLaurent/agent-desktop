// Pure decision functions behind ContinuousVoiceStore.qml.
//
// Reference: src/renderer/services/voiceGate/{stripWakeword,createVoiceGate}.ts.
// These functions are the QML JS resource that runs in the same bytes under
// qmllint / qmltestrunner (loaded via tests/load.js which strips `.pragma
// library`). The contract documented for the store is verified here at the
// pure-function level; the store-level wiring (transcribe routing, generation
// counter, signal emission) is exercised in tests/qml/tst_continuous_voice_store.qml.
const assert = require('assert')
const { load, deepEqual } = require('./load')

const VG = load('lib/voiceGate.js')

// ---- stripWakeword ---------------------------------------------------------

// Clean leading wakeword, exact match.
deepEqual(
  VG.stripWakeword('hey jarvis what time is it', 'hey jarvis'),
  { text: 'what time is it', stripped: true },
  'a clean leading wakeword is stripped',
)

// Case + punctuation insensitivity. This is the canonical example from the
// task description: "Hey, Jarvis! what time is it" must still strip down to
// "what time is it".
deepEqual(
  VG.stripWakeword('Hey, Jarvis! what time is it', 'hey jarvis'),
  { text: 'what time is it', stripped: true },
  'case and punctuation differences do not block the strip',
)

// Trailing punctuation after the wakeword is cleaned from the remainder —
// "hey jarvis, what time is it" → "what time is it" (not ", what time is it").
deepEqual(
  VG.stripWakeword('hey jarvis, what time is it', 'hey jarvis'),
  { text: 'what time is it', stripped: true },
  'leading punctuation on the remainder is dropped',
)

// STT mangled the wake word ("hey jarvys") — must NOT strip, must NOT mark
// stripped. The reference's `stripped: false` path: the caller would still
// send the utterance because a wake event fired, but only the strip step is
// skipped.
deepEqual(
  VG.stripWakeword('hey jarvys what time is it', 'hey jarvis'),
  { text: 'hey jarvys what time is it', stripped: false },
  'a wake phrase that STT mangled must not match',
)

// Wake phrase that appears mid-sentence does not match (token-prefix only).
deepEqual(
  VG.stripWakeword('I told her hey jarvis is great', 'hey jarvis'),
  { text: 'I told her hey jarvis is great', stripped: false },
  'mid-sentence wake phrase does not match',
)

// Only the wakeword was spoken — strip succeeds but the remainder is empty.
// The caller treats this as "ignore, but arm" so the NEXT utterance (the
// command after the pause) is accepted by the follow-up window.
deepEqual(
  VG.stripWakeword('hey jarvis', 'hey jarvis'),
  { text: '', stripped: true },
  'a bare wake phrase leaves an empty remainder',
)

// Empty wakeword is a no-op — the strip cannot have any tokens.
deepEqual(
  VG.stripWakeword('anything here', ''),
  { text: 'anything here', stripped: false },
  'an empty wakeword is a no-op',
)
deepEqual(
  VG.stripWakeword('anything here', undefined),
  { text: 'anything here', stripped: false },
  'an undefined wakeword is a no-op',
)

// Transcript shorter than the wake phrase is a no-op (cannot prefix-match).
deepEqual(
  VG.stripWakeword('hey', 'hey jarvis'),
  { text: 'hey', stripped: false },
  'a shorter transcript cannot prefix-match',
)

// ---- armUntil / isArmed ---------------------------------------------------

// Positive window: deadline is now + window.
assert.strictEqual(VG.armUntil(10000, 8000), 18000,
  'armUntil(now, window) is now + window')

// Zero window means the feature is OFF, not "armed forever".
assert.strictEqual(VG.armUntil(10000, 0), 0, 'a 0 window is off')
assert.strictEqual(VG.armUntil(10000, -500), 0, 'a negative window is off')
assert.strictEqual(VG.armUntil(10000, NaN), 0, 'NaN window is off')
assert.strictEqual(VG.armUntil(10000, Infinity), 0, 'Infinity window is off')

// isArmed: a window opened at 18000 is open at 17999 and closed at 18001.
assert.strictEqual(VG.isArmed(18000, 10000), true, 'inside the window')
assert.strictEqual(VG.isArmed(18000, 18000), false, 'at the deadline the window has closed')
assert.strictEqual(VG.isArmed(18000, 18001), false, 'past the deadline is closed')

// Uninitialized (0) is never armed.
assert.strictEqual(VG.isArmed(0, 10000), false, '0 means never armed')
assert.strictEqual(VG.isArmed(undefined, 10000), false, 'undefined is never armed')
assert.strictEqual(VG.isArmed(null, 10000), false, 'null is never armed')

// ---- decide — shared contract ---------------------------------------------

const T0 = 100000
function d(opts) {
  // Default mode = wakeword with a recognizable wakeword; tests override.
  return VG.decide(Object.assign({
    wakeword: 'hey jarvis',
    armedUntil: 0,
    nowMs: T0,
  }, opts))
}

// Empty / whitespace text → ignore with reason 'empty' in both modes.
deepEqual(d({ text: '' }), { action: 'ignore', text: '', reason: 'empty', arm: false }, 'empty text is ignored')
deepEqual(d({ text: '   ' }), { action: 'ignore', text: '', reason: 'empty', arm: false }, 'whitespace-only text is ignored')
deepEqual(d({ text: '', mode: 'intent' }), { action: 'ignore', text: '', reason: 'empty', arm: false }, 'empty text in intent mode is ignored')

// mode is 'intent' ONLY when it is exactly the string 'intent'. Everything else
// (undefined, 'wakeword' explicit, a typo) is treated as wakeword. This
// matches the reference's `mode === 'intent' ? 'intent' : 'wakeword'`.
deepEqual(
  d({ text: 'hey jarvis lights on', mode: 'Wwakeword' }),
  { action: 'send', text: 'lights on', reason: 'wakeword', arm: true },
  'a typo in the mode name falls back to wakeword',
)
deepEqual(
  d({ text: 'hey jarvis lights on', mode: undefined }),
  { action: 'send', text: 'lights on', reason: 'wakeword', arm: true },
  'undefined mode is wakeword',
)
deepEqual(
  d({ text: 'hey jarvis lights on', mode: null }),
  { action: 'send', text: 'lights on', reason: 'wakeword', arm: true },
  'null mode is wakeword',
)

// Wakeword mode: send with arm:true on a transcript that begins with the wake
// phrase.
deepEqual(
  d({ text: 'hey jarvis what time is it' }),
  { action: 'send', text: 'what time is it', reason: 'wakeword', arm: true },
  'wakeword + remainder sends and arms',
)

// Bare wake phrase in wakeword mode: ignore with reason 'wakeword-only' and
// arm:true so the FOLLOW-UP utterance (the command after the user's pause)
// is accepted by the next decide call. This is the reference's Case 1/2
// behaviour.
deepEqual(
  d({ text: 'hey jarvis' }),
  { action: 'ignore', text: '', reason: 'wakeword-only', arm: true },
  'bare wake phrase is ignored but arms the follow-up window',
)

// No wake prefix + not armed → no-wakeword ignore.
deepEqual(
  d({ text: 'just talking to myself' }),
  { action: 'ignore', text: '', reason: 'no-wakeword', arm: false },
  'no wake prefix and unarmed is ignored with no-wakeword',
)

// Follow-up window (armed) accepts a wakeword-mode utterance that does NOT
// start with the wake phrase. This is the reference's Case 2: "the user said
// 'hey jarvis' (armed), then 'what time is it' as a SEPARATE utterance".
deepEqual(
  d({ text: 'what time is it', armedUntil: T0 + 8000 }),
  { action: 'send', text: 'what time is it', reason: 'followup', arm: false },
  'armed window accepts an utterance without a wake prefix',
)

// Expired window is treated as unarmed.
deepEqual(
  d({ text: 'what time is it', armedUntil: T0 - 1 }),
  { action: 'ignore', text: '', reason: 'no-wakeword', arm: false },
  'an expired window is treated as unarmed',
)

// Empty wakeword in wakeword mode can never prefix-match → falls through to
// the armed check, then to no-wakeword.
deepEqual(
  d({ text: 'just talking to myself', wakeword: '' }),
  { action: 'ignore', text: '', reason: 'no-wakeword', arm: false },
  'empty wakeword cannot prefix-match and falls through',
)
deepEqual(
  d({ text: 'and what about tomorrow', wakeword: '', armedUntil: T0 + 8000 }),
  { action: 'send', text: 'and what about tomorrow', reason: 'followup', arm: false },
  'empty wakeword + armed window still accepts via follow-up',
)

// Intent mode: armed short-circuits the classifier and sends WITHOUT calling
// the classifier. This is the whole point of the follow-up window in intent
// mode (don't pay the LLM twice for natural back-and-forth).
deepEqual(
  d({ text: 'and what about tomorrow', mode: 'intent', armedUntil: T0 + 8000 }),
  { action: 'send', text: 'and what about tomorrow', reason: 'followup', arm: false },
  'intent mode + armed short-circuits to send',
)

// Intent mode: unarmed → ask the classifier.
deepEqual(
  d({ text: 'what is the capital of France', mode: 'intent' }),
  { action: 'classify', text: 'what is the capital of France', reason: '', arm: false },
  'intent mode + unarmed asks the classifier',
)

console.log('test_voice_gate: ok')
