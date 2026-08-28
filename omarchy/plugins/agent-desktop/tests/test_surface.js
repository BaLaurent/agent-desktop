const assert = require('assert')
const { load } = require('./load')

const S = load('lib/surface.js')

// The three spellings that mean quick chat. Dropping `text` or `voice` would
// silently route the existing ALT+SPACE / ALT+SHIFT+SPACE binds to the app
// window, which is the kind of regression nobody notices until they press the
// key.
;['quick', 'text', 'voice'].forEach(function (mode) {
  assert.strictEqual(S.surfaceFor(JSON.stringify({ mode: mode })), 'quick',
    mode + ' must open quick chat')
})

assert.strictEqual(S.surfaceFor('{"mode":"window"}'), 'window')

// Anything unparseable, absent or unrecognised is the app window. A payload
// typo must not produce a surface that shows nothing.
;[
  ['unknown mode', '{"mode":"banana"}'],
  ['empty object', '{}'],
  ['empty string', ''],
  ['not json', 'mode=quick'],
  ['json array', '[1,2,3]'],
  ['null literal', 'null'],
  ['bare number', '7'],
  ['quoted string', '"quick"'],
  ['truncated json', '{"mode":"quick"'],
  ['undefined', undefined],
  ['null', null],
].forEach(function (pair) {
  assert.strictEqual(S.surfaceFor(pair[1]), 'window', pair[0] + ' must fall back to the window')
})

// A mode that is not a string still must not throw.
assert.strictEqual(S.surfaceFor('{"mode":42}'), 'window')
assert.strictEqual(S.surfaceFor('{"mode":null}'), 'window')

// An already-parsed object is accepted, because Service.qml has one in hand.
assert.strictEqual(S.surfaceFor({ mode: 'quick' }), 'quick')
assert.strictEqual(S.surfaceFor({}), 'window')

// The bar widget's setting spelling.
assert.strictEqual(S.surfaceForClickSetting('QuickChat'), 'quick')
assert.strictEqual(S.surfaceForClickSetting('Window'), 'window')
assert.strictEqual(S.surfaceForClickSetting(''), 'window')
assert.strictEqual(S.surfaceForClickSetting(undefined), 'window')

// Middle click takes whichever surface left click did not, so both are always
// one click away however `openOnClick` is set.
assert.strictEqual(S.otherSurface('window'), 'quick')
assert.strictEqual(S.otherSurface('quick'), 'window')

// Only `voice` is a voice summon. `quick` and `text` are the other quick-
// chat spellings but must NOT toggle the mic — the keyboard shortcut
// ALT+SPACE (text) opens the overlay without recording.
assert.strictEqual(S.isVoiceRequest(JSON.stringify({ mode: 'voice' })), true,
  'mode=voice must be recognised as a voice request')
;['quick', 'text', 'window'].forEach(function (mode) {
  assert.strictEqual(S.isVoiceRequest(JSON.stringify({ mode: mode })), false,
    mode + ' must NOT be a voice request')
})
;[
  ['empty object', {}],
  ['empty json', ''],
  ['not json', 'mode=voice'],
  ['json null', null],
  ['undefined', undefined],
].forEach(function (pair) {
  assert.strictEqual(S.isVoiceRequest(pair[1]), false,
    pair[0] + ' must NOT be a voice request')
})

console.log('test_surface: ok')
