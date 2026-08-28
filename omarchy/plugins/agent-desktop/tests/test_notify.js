const assert = require('assert')
const { load, deepEqual } = require('./load')

const N = load('lib/notify.js')
const SettingDefs = N.SettingDefs

// ---- commandFor ---------------------------------------------------------
// Always emits the same argv shape, regardless of title/body content.
const argv = N.commandFor('Title', 'Body')
deepEqual(argv, ['notify-send', '-a', 'Agent Desktop', 'Title', 'Body'])

// Strings (not numbers) even when called with numbers.
const numeric = N.commandFor(1, 2)
assert.strictEqual(typeof numeric[3], 'string')
assert.strictEqual(typeof numeric[4], 'string')

// Empty title/body still produce a valid argv array (notify-send accepts
// empty strings).
const empty = N.commandFor('', '')
assert.strictEqual(empty.length, 5)
assert.strictEqual(empty[3], '')

// ---- shouldNotify --------------------------------------------------------
// The defaults are imported from settingDefs.js — verify they are present
// and match the shape that consumers rely on (Record<NotificationEvent,
// NotificationEventConfig>).
assert.ok(SettingDefs)
assert.ok(SettingDefs.DEFAULT_NOTIFICATION_CONFIG)
const defaultKeys = Object.keys(SettingDefs.DEFAULT_NOTIFICATION_CONFIG).sort()
deepEqual(defaultKeys, [
  'error_execution',
  'error_js',
  'error_max_budget',
  'error_max_turns',
  'max_tokens',
  'refusal',
  'success'
])

// Without a config (null / empty / undefined / malformed JSON), defaults are
// used. For every event that has desktop:true by default, shouldNotify
// returns true. error_js has desktop:false by default — that's the only
// exception the spec ships.
assert.strictEqual(N.shouldNotify(null, 'success'), true)
assert.strictEqual(N.shouldNotify(null, 'error_execution'), true)
assert.strictEqual(N.shouldNotify(null, 'error_js'), false,
  'error_js has desktop=false in the defaults')

// Empty string / non-JSON falls back to defaults too.
assert.strictEqual(N.shouldNotify('', 'success'), true)
assert.strictEqual(N.shouldNotify('{not json', 'success'), true)
assert.strictEqual(N.shouldNotify('null', 'success'), true)

// A parsed object (from JSON.parse) works directly, not just strings.
const parsed = JSON.parse('{"success":{"sound":false,"desktop":false}}')
assert.strictEqual(N.shouldNotify(parsed, 'success'), false,
  'a parsed object with desktop:false wins over the default')
assert.strictEqual(N.shouldNotify(parsed, 'error_js'), false,
  'unrelated events still use defaults')

// Merging: a config that overrides only `sound` keeps the default for
// `desktop` (matches the spread semantics the renderer uses).
const partial = JSON.parse('{"success":{"sound":false,"desktop":true}}')
const r = N.shouldNotify(partial, 'success')
assert.strictEqual(r, true)

// An event the config does not name at all -> falls through to the default
// (the server may add events before the client learns about them).
assert.strictEqual(N.shouldNotify('{}', 'success'), true)

// An unknown event key -> false, not a crash.
assert.strictEqual(N.shouldNotify(null, 'never_seen'), false)

// JSON arrays / non-objects are treated as no config.
assert.strictEqual(N.shouldNotify([], 'success'), true)
assert.strictEqual(N.shouldNotify('"a string"', 'success'), true)
assert.strictEqual(N.shouldNotify(42, 'success'), true)

// ---- the SOUND half ------------------------------------------------------
// It had no implementation: `shouldNotify` answers `merged.desktop === true`
// and nothing read `.sound`, so the settings page's Sound column — seven
// switches, persisted — did nothing at all.

assert.strictEqual(N.shouldPlaySound('{"success":{"sound":true,"desktop":false}}', 'success'),
  true, 'sound on, desktop off -> sound plays')
assert.strictEqual(N.shouldNotify('{"success":{"sound":true,"desktop":false}}', 'success'),
  false, 'the two halves are independent')
assert.strictEqual(N.shouldPlaySound('{"success":{"sound":false,"desktop":true}}', 'success'),
  false, 'sound off, desktop on -> silent')
assert.strictEqual(N.shouldPlaySound(null, 'never_seen'),
  false, 'an unknown event is silent, not a crash')

// A config naming ONLY `desktop` must keep the server's default for `sound`.
// The previous merge rebuilt the slot from `slot.sound`, undefined in that
// case, so touching the desktop switch silently cleared a sound the user
// never touched.
assert.strictEqual(N.shouldPlaySound('{"success":{"desktop":false}}', 'success'),
  true, 'a desktop-only override must not clear the sound default')
assert.strictEqual(N.shouldNotify('{"success":{"sound":false}}', 'success'),
  true, 'and a sound-only override must not clear the desktop default')
// Success gets a different sound from every failure, matching the Electron
// split (playCompletionSound / playErrorSound).
//
// `join` rather than deepStrictEqual: tests/load.js runs the QML JS resource
// in a vm context, so an array it returns has that realm's Array.prototype
// and deepStrictEqual refuses it as "same structure but not reference-equal".
assert.strictEqual(N.soundCommandFor('success').join(' '),
  'canberra-gtk-play -i complete')
assert.strictEqual(N.soundCommandFor('error_js').join(' '),
  'canberra-gtk-play -i dialog-error')
assert.strictEqual(N.soundCommandFor('max_tokens').join(' '),
  'canberra-gtk-play -i dialog-error')

console.log('test_notify: ok')
