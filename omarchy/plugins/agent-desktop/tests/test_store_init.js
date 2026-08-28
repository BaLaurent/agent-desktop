const assert = require('assert')
const fs = require('fs')
const path = require('path')

// Every store that declares a no-arg `load()` must be loaded in
// `Service.onConnected_()`.
//
// That function is the plugin's one initialization point: stores cannot fetch
// at construction because the bridge is not authenticated yet and the server's
// token rotates on every restart. A store left out of it has a `load()` that
// nothing ever calls, and the symptom is a permanently empty or permanently
// "Loading…" surface — never an error, because the RPC was simply never made.
//
// Two shipped this way at once:
//   ConversationsStore  -> sidebar showed 0 of 14 conversations
//   SchedulerStore      -> task list stuck on "Loading…" forever, and the
//                          background-status row rendered its own defaults
//
// A store that legitimately loads on demand (per-conversation, per-directory)
// takes an argument and is not matched here.

const ROOT = path.join(__dirname, '..')
const SERVICE = fs.readFileSync(path.join(ROOT, 'Service.qml'), 'utf8')

// The body of onConnected_, up to its closing brace at function indent.
const onConnected = (() => {
  const start = SERVICE.indexOf('function onConnected_()')
  assert.ok(start > 0, 'Service.qml must declare onConnected_()')
  const end = SERVICE.indexOf('\n  }', start)
  assert.ok(end > start, 'could not find the end of onConnected_()')
  return SERVICE.slice(start, end)
})()

// pluginId -> the `id:` given to the store instance in Service.qml, so the
// check names the real symbol rather than guessing a naming convention.
function implIdFor(storeType) {
  const m = SERVICE.match(new RegExp(storeType + '\\s*\\{\\s*id:\\s*([A-Za-z_][A-Za-z0-9_]*)'))
  return m ? m[1] : null
}

const missing = []
const checked = []

for (const file of fs.readdirSync(path.join(ROOT, 'stores')).sort()) {
  if (!file.endsWith('.qml')) continue
  const src = fs.readFileSync(path.join(ROOT, 'stores', file), 'utf8')
  // A no-arg load() at store scope. `load(id)` / `load(cwd)` are on-demand.
  if (!/^ {2}function load\(\)/m.test(src)) continue

  const type = file.replace(/\.qml$/, '')
  const impl = implIdFor(type)
  if (!impl) {
    missing.push(`${type} declares load() but is not instantiated in Service.qml`)
    continue
  }
  checked.push(type)
  if (!onConnected.includes(impl + '.load()')) {
    missing.push(
      `${type} declares a no-arg load() that onConnected_() never calls ` +
      `(add \`${impl}.load()\`, or give load() an argument if it is on-demand)`)
  }
}

assert.ok(checked.length >= 8,
  `expected to find the store set, found only ${checked.length}`)
assert.deepStrictEqual(missing, [],
  'stores with an unreachable load():\n  ' + missing.join('\n  '))

console.log(`test_store_init: ok (${checked.length} stores load on connect)`)
