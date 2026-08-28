#!/usr/bin/env node
// Phase 4.1 acceptance probe: the loopback origin must widen the gate for a
// same-host front WITHOUT widening it for anything reachable over the network.
//
// One script, two dial addresses. If the LAN arm also succeeds, the loopback
// detection is wrong and the change must not ship — `mcp:testConnection` is
// documented as turn-key RCE in src/core/dispatch-allowlist.ts and the server
// binds 0.0.0.0.
//
//   node scripts/ws-origin-probe.mjs <lan-ip>
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import WebSocket from 'ws'

const lanIp = process.argv[2]
if (!lanIp) {
  console.error('usage: node scripts/ws-origin-probe.mjs <lan-ip>')
  process.exit(2)
}

const session = JSON.parse(
  readFileSync(join(process.env.XDG_RUNTIME_DIR || '/tmp', 'agent-desktop', 'session.json'), 'utf8')
)

// A config that reaches the gate but does nothing if it gets past it.
const HARMLESS_STDIO = { name: 'origin-probe', type: 'stdio', command: 'true', args: [] }

function call(host, channel, args) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`wss://${host}:${session.port}/ws`, { rejectUnauthorized: false })
    const done = (outcome) => { try { ws.close() } catch { /* already closing */ } resolve(outcome) }
    const timer = setTimeout(() => done({ error: 'timeout' }), 25000)

    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: session.token })))
    ws.on('error', (e) => { clearTimeout(timer); done({ error: `transport: ${e.message}` }) })
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'auth_result') {
        if (!msg.success) { clearTimeout(timer); return done({ error: `auth: ${msg.error}` }) }
        return ws.send(JSON.stringify({ type: 'invoke', id: '1', channel, args }))
      }
      if (msg.type === 'result') {
        clearTimeout(timer)
        done(msg.error ? { error: msg.error } : { result: msg.result })
      }
    })
  })
}

const show = (label, r) =>
  console.log(`${label.padEnd(46)} ${r.error ? 'ERROR: ' + r.error : 'OK: ' + JSON.stringify(r.result).slice(0, 90)}`)

let failures = 0
const expectOk = (label, r) => { show(label, r); if (r.error) { failures++; console.log('  ^^ EXPECTED SUCCESS') } }
const expectErr = (label, r, needle) => {
  show(label, r)
  if (!r.error || !r.error.includes(needle)) { failures++; console.log(`  ^^ EXPECTED AN ERROR CONTAINING: ${needle}`) }
}

console.log(`server port ${session.port}; loopback=127.0.0.1, lan=${lanIp}\n`)

// The channel Phase 4.1 un-gates for loopback only.
expectOk('loopback  mcp:testConnection', await call('127.0.0.1', 'mcp:testConnection', [HARMLESS_STDIO]))
expectErr('lan       mcp:testConnection', await call(lanIp, 'mcp:testConnection', [HARMLESS_STDIO]),
  'Channel not available via WebSocket: mcp:testConnection')

// WS_BLOCKED is absolute for both — a same-host client still has no business
// changing the server password.
expectErr('loopback  server:setPassword', await call('127.0.0.1', 'server:setPassword', ['x']), 'not available')
expectErr('lan       server:setPassword', await call(lanIp, 'server:setPassword', ['x']), 'not available')

// A channel that stays Electron-only for BOTH: proves 'ws-local' widened only
// LOCAL_WS_ALLOWED_CHANNELS, not all of ELECTRON_ONLY_CHANNELS.
expectErr('loopback  system:openExternal (stays gated)',
  await call('127.0.0.1', 'system:openExternal', ['https://example.com']), 'not available')

// Channels the Phase 4.3-4.5 moves made WS-reachable from anywhere.
expectOk('loopback  pi:listExtensions', await call('127.0.0.1', 'pi:listExtensions', []))
expectOk('lan       pi:listExtensions', await call(lanIp, 'pi:listExtensions', []))
expectOk('loopback  openscad:validateConfig', await call('127.0.0.1', 'openscad:validateConfig', []))

// An ordinary channel must be unaffected on both.
expectOk('loopback  settings:get', await call('127.0.0.1', 'settings:get', []))
expectOk('lan       settings:get', await call(lanIp, 'settings:get', []))

console.log(failures === 0 ? '\nALL EXPECTATIONS MET' : `\n${failures} EXPECTATION(S) VIOLATED`)
process.exit(failures === 0 ? 0 : 1)
