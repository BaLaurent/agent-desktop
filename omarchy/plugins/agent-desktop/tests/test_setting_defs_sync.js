const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// `generated/settingDefs.js` must match what the emitter produces from
// src/core/types/constants.ts.
//
// That file's own header states its purpose: it exists "rather than from a
// hand-copied duplicate that drifts". But nothing verified it, while the
// plugin's two OTHER generated artefacts both have a --check wired into
// `make test` (gen-stubs.js --check, gen-component-load.js --check). So the one
// generated file with no guard was the settings UI's entire data source.
//
// Why that matters more than it looks: the QML settings page is data-driven —
// `SettingsPage.qml:80` renders `SR.rowsFor(SD.SETTING_DEFS, backend)`. A
// setting added to the server and not re-emitted here therefore gets NO UI row
// at all, silently. There is no error, no empty control, nothing: the row
// simply does not exist, and the user cannot change a setting the server
// happily stores.
//
// Note the emitter deliberately emits MORE than SETTING_DEFS: the seven
// NOTIFICATION_EVENTS keys (success, refusal, error_js, error_execution,
// error_max_turns, error_max_budget, max_tokens) also land here, because
// NotificationConfigGrid renders them from the same file. So a plain
// "generated keys == SETTING_DEFS keys" assertion would fail on correct
// output. Comparing against the emitter's own result sidesteps that entirely
// and needs no list to keep in step.
const PLUGIN = path.join(__dirname, '..')
const REPO = path.resolve(PLUGIN, '../../..')
const GENERATED = path.join(PLUGIN, 'generated/settingDefs.js')

assert.ok(fs.existsSync(GENERATED), `missing generated file: ${GENERATED}`)

const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))
const script = pkg.scripts && pkg.scripts['build:omarchy-consts']
assert.ok(
  script,
  'package.json has no build:omarchy-consts script — the generated settings ' +
    'file can no longer be reproduced, so nothing can verify it'
)

const committed = fs.readFileSync(GENERATED, 'utf8')

// The npm script writes straight over the generated file, so restore it
// whatever happens — a check must never be able to leave a dirty tree.
let regenerated
try {
  execSync('npm run build:omarchy-consts', { cwd: REPO, stdio: 'pipe' })
  regenerated = fs.readFileSync(GENERATED, 'utf8')
} finally {
  fs.writeFileSync(GENERATED, committed)
}

if (regenerated !== committed) {
  const cKeys = [...committed.matchAll(/"key":\s*"([^"]+)"/g)].map((m) => m[1])
  const rKeys = [...regenerated.matchAll(/"key":\s*"([^"]+)"/g)].map((m) => m[1])
  const added = rKeys.filter((k) => !cKeys.includes(k))
  const removed = cKeys.filter((k) => !rKeys.includes(k))
  const detail = [
    added.length ? `  settings with NO UI row until regenerated: ${added.join(', ')}` : '',
    removed.length ? `  rows for settings the server no longer defines: ${removed.join(', ')}` : '',
    !added.length && !removed.length ? '  same keys, but the emitted content differs (label/type/options changed)' : '',
  ].filter(Boolean).join('\n')

  assert.fail(
    'generated/settingDefs.js is out of sync with src/core/types/constants.ts.\n' +
      detail +
      '\n  Run: npm run build:omarchy-consts'
  )
}

const keyCount = [...committed.matchAll(/"key":\s*"([^"]+)"/g)].length
console.log(`test_setting_defs_sync: ok (${keyCount} emitted keys match the source)`)
