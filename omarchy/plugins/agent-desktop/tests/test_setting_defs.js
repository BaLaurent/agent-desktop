// Tripwire for generated/settingDefs.js: a stale or truncated artifact is the
// one failure mode the settings page cannot detect at runtime (a missing def is
// just a missing row). Loaded through the same shim QML's `import … as` uses, so
// a file that node can read but QML cannot fails here.
const assert = require('assert')
const { load, deepEqual } = require('./load')

const C = load('generated/settingDefs.js')

assert.strictEqual(C.SETTING_DEFS.length, 19, 'SETTING_DEFS lost or gained an entry')

C.SETTING_DEFS.forEach(function (def) {
  assert.ok(C.AI_OVERRIDE_KEYS.indexOf(def.key) >= 0, def.key + ' is not an AI override key')
  assert.ok(['select', 'number', 'textarea'].indexOf(def.type) >= 0,
    def.key + ' has unknown type ' + def.type)
  if (def.type !== 'select') return
  assert.ok(Array.isArray(def.options) && def.options.length > 0,
    def.key + ' is a select with no options')
  def.options.forEach(function (opt) {
    assert.strictEqual(typeof opt.value, 'string', def.key + ' option missing value')
    assert.strictEqual(typeof opt.label, 'string', def.key + ' option missing label')
  })
})

// deepEqual, not assert.deepStrictEqual: values built inside the vm realm carry
// that realm's Array prototype and would be rejected against a literal here.
deepEqual(
  C.PERMISSION_OPTIONS.map(function (o) { return o.value }),
  ['bypassPermissions', 'acceptEdits', 'default', 'dontAsk', 'plan'],
  'permission modes changed'
)

// The two arrays that were module-private in constants.ts until this plugin
// needed them; a re-privatised export would silently emit nothing at all.
;[
  ['SKILLS_TOGGLE_OPTIONS', C.SKILLS_TOGGLE_OPTIONS],
  ['PLAN_APPROVAL_OPTIONS', C.PLAN_APPROVAL_OPTIONS],
  ['SDK_BACKEND_OPTIONS', C.SDK_BACKEND_OPTIONS],
  ['MODEL_OPTIONS', C.MODEL_OPTIONS],
  ['SETTING_SOURCES_OPTIONS', C.SETTING_SOURCES_OPTIONS],
  ['CONFIG_SHARING_OPTIONS', C.CONFIG_SHARING_OPTIONS],
].forEach(function (pair) {
  assert.ok(Array.isArray(pair[1]) && pair[1].length > 0, pair[0] + ' is empty or absent')
})

assert.strictEqual(typeof C.DEFAULT_MODEL, 'string')
assert.ok(C.DEFAULT_MODEL.length > 0, 'DEFAULT_MODEL is empty')

assert.strictEqual(C.NOTIFICATION_EVENTS.length, 7, 'notification events changed')
C.NOTIFICATION_EVENTS.forEach(function (ev) {
  const cfg = C.DEFAULT_NOTIFICATION_CONFIG[ev.key]
  assert.ok(cfg, 'no default notification config for ' + ev.key)
  assert.strictEqual(typeof cfg.sound, 'boolean')
  assert.strictEqual(typeof cfg.desktop, 'boolean')
})

assert.ok(C.DEFAULT_EXCLUDE_PATTERNS.indexOf('node_modules') >= 0)

// The bridge answers a dropped socket with this exact literal; QML tests for it
// to tell "reconnecting" from "failed".
assert.strictEqual(C.WS_DISCONNECTED_MESSAGE, 'WebSocket disconnected')

console.log('test_setting_defs: ok')
