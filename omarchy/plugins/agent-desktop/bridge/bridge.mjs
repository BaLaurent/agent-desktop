#!/usr/bin/env node
// Agent Desktop Omarchy plugin bridge — a transparent channel proxy.
//
// QML cannot open a TLS WebSocket against the server's self-signed cert, so this
// Node child sits between the QML front and the headless server and does nothing
// but frame translation. It has no per-feature knowledge: every channel the
// server exposes is reachable through one generic `invoke` op, and every server
// push is forwarded verbatim. Adding a surface to the QML front needs no edit
// here.
//
// Framing is one JSON object per line on stdio, so a QML `Process` can drive it
// with Process.write / SplitParser.
//
//   QML -> bridge
//     {"op":"invoke","rid":<int>,"channel":"<channel>","args":[...]}
//     {"op":"cancel","rid":<int>}                    drop a pending reply
//     {"op":"respond","id":"<requestId>","value":…,"confirmed":…,"cancelled":…}
//                                                    answer a pi:uiRequest
//     {"op":"rec.start"} / {"op":"rec.stop"} / {"op":"rec.cancel"}
//                                                    push-to-talk capture
//     {"op":"cv.start","config":{…}} / {"op":"cv.stop"}
//                                                    continuous-voice capture
//     {"op":"cv.pause","paused":<bool>}                  keep recorder running,
//                                                    drop blocks; resets in-progress
//                                                    utterance so half-duplex TTS
//                                                    suspension can't leave one behind
//
//   bridge -> QML
//     {"ev":"result","rid":<int>,"result":<any>}
//     {"ev":"result","rid":<int>,"error":"<string>"}
//     {"ev":"event","channel":"<channel>","data":<any>}   every server push
//     {"ev":"conn","server":"up"|"down","connected":<bool>,"error":"<string>?"}
//     {"ev":"log","level":"warn"|"error","message":"<string>"}
//     {"ev":"rec","active":<bool>}
//     {"ev":"audio","b64":"<base64 wav>"}
//     {"ev":"cv","active":<bool>}
//     {"ev":"cv","active":false,"error":"<reason>"}      // spawn or unexpected exit
//     {"ev":"utterance","b64":"<base64 wav>","startedAt":<ms>,"endedAt":<ms>}
//                                                    one per finalized utterance;
//                                                    tooShort utterances are dropped
//                                                    silently (cough/click filter)
//
// Transport: wss://127.0.0.1:<port>/ws with rejectUnauthorized:false (the server
// is HTTPS-only behind a self-signed EC cert). Auth handshake is
// {type:'auth', token} -> {type:'auth_result', success}. The token rotates on
// every server start, so the session file is re-read on every connect attempt.
import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import WebSocket from 'ws'
import { createCvSegmenter } from './cvSegmenter.mjs'
import { wavHeader } from './wav.mjs'

const sessionDir = process.env.XDG_RUNTIME_DIR || '/tmp'
const sessionPath = join(sessionDir, 'agent-desktop', 'session.json')

// The literal the web shim uses for the same condition
// (WS_DISCONNECTED_MESSAGE, src/core/types/constants.ts). One string for QML to
// test when deciding "reconnecting" from "failed".
const WS_DISCONNECTED_MESSAGE = 'WebSocket disconnected'

const RECORD_MAX_MS = 120_000

const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')
const log = (level, message) => send({ ev: 'log', level, message })

let ws = null
let authenticated = false
let reconnectTimer = null

// rid -> true. The rid is the caller's, so QML owns correlation and a reply can
// be routed without the bridge knowing what the call meant.
const pending = new Set()
// Invokes issued before auth_result lands, flushed in order once it does.
let preAuthQueue = []

let voiceProc = null
let voiceChunks = []
let voiceMaxTimer = null

// Continuous-voice capture state. ONE pw-record child owns the mic while
// `cvProc` is non-null. Mutual exclusion with push-to-talk is enforced in
// `startRecording` / `startCv`.
let cvProc = null
let cvSegmenter = null
let cvLastStderr = ''

const readSession = () => {
  try {
    const parsed = JSON.parse(readFileSync(sessionPath, 'utf8'))
    if (!parsed.port || !parsed.token) return null
    return parsed
  } catch {
    return null
  }
}

// ---- ws transport -----------------------------------------------------------

const failAllPending = (message) => {
  for (const rid of pending) send({ ev: 'result', rid, error: message })
  pending.clear()
  for (const queued of preAuthQueue) {
    send({ ev: 'result', rid: queued.rid, error: message })
  }
  preAuthQueue = []
}

const scheduleReconnect = () => {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect() }, 2000)
}

const connect = () => {
  // Re-read every attempt: the server mints a fresh token per start, so a
  // cached one survives exactly until the first `systemctl restart`.
  const session = readSession()
  if (!session) {
    send({ ev: 'conn', server: 'down', connected: false })
    scheduleReconnect()
    return
  }

  send({ ev: 'conn', server: 'up', connected: false })

  let opened = false
  try {
    ws = new WebSocket(`wss://127.0.0.1:${session.port}/ws`, {
      rejectUnauthorized: false,
      maxPayload: 10 * 1024 * 1024
    })
  } catch (err) {
    log('warn', `ws construct failed: ${err.message}`)
    ws = null
    scheduleReconnect()
    return
  }

  ws.on('open', () => {
    opened = true
    try {
      ws.send(JSON.stringify({ type: 'auth', token: session.token }))
    } catch (err) {
      log('warn', `auth send failed: ${err.message}`)
    }
  })

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }

    if (msg.type === 'auth_result') {
      authenticated = msg.success === true
      send({
        ev: 'conn',
        server: 'up',
        connected: authenticated,
        error: msg.error || undefined
      })
      if (authenticated) {
        const queued = preAuthQueue
        preAuthQueue = []
        for (const q of queued) writeInvoke(q.rid, q.channel, q.args)
      } else {
        failAllPending(msg.error ? String(msg.error) : 'Not authenticated')
      }
      return
    }

    if (msg.type === 'result' && msg.id != null) {
      const rid = Number(msg.id)
      if (!pending.has(rid)) return
      pending.delete(rid)
      if (msg.error !== undefined && msg.error !== null) {
        send({ ev: 'result', rid, error: String(msg.error) })
      } else {
        send({ ev: 'result', rid, result: msg.result === undefined ? null : msg.result })
      }
      return
    }

    // Every push, verbatim. No allowlist, no reshaping — this is what makes the
    // bridge feature-agnostic.
    if (msg.type === 'event' && msg.channel) {
      send({ ev: 'event', channel: String(msg.channel), data: msg.data })
    }
  })

  ws.on('error', (err) => {
    log('warn', `ws error: ${err.message || String(err)}`)
  })

  ws.on('close', () => {
    authenticated = false
    ws = null
    failAllPending(WS_DISCONNECTED_MESSAGE)
    send({ ev: 'conn', server: opened ? 'up' : 'down', connected: false })
    scheduleReconnect()
  })
}

// ---- argument encoding ------------------------------------------------------

// QML cannot build a Uint8Array, so it spells a byte payload `{"__b64":"…"}`.
// This is the only place that knows the server's wire form
// (`{"__type":"binary","data":"…"}`, webServer.ts:159-169).
const encodeArgs = (args) => {
  if (!Array.isArray(args)) return []
  return args.map((arg) => {
    if (arg && typeof arg === 'object' && typeof arg.__b64 === 'string') {
      return { __type: 'binary', data: arg.__b64 }
    }
    return arg
  })
}

const writeInvoke = (rid, channel, args) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    pending.delete(rid)
    send({ ev: 'result', rid, error: WS_DISCONNECTED_MESSAGE })
    return
  }
  try {
    ws.send(JSON.stringify({ type: 'invoke', id: rid, channel, args: encodeArgs(args) }))
  } catch (err) {
    pending.delete(rid)
    send({ ev: 'result', rid, error: err.message || String(err) })
  }
}

// ---- voice capture ----------------------------------------------------------
//
// The renderer captures with getUserMedia; QML has no audio input, so capture
// lives here. Named ops rather than a generic handler table: this is the one
// feature the bridge legitimately owns, because it owns a child process.

// The RIFF/WAVE framing is shared with the continuous-capture path — see
// bridge/wav.mjs for why it is one module and not two copies.

// voice:duck / voice:restore are server-side pactl/playerctl calls. Their
// result is irrelevant and no QML rid is waiting on it, so the frame goes out
// under a negative id that no `pending` entry claims — the reply is dropped by
// the same lookup that routes real results.
let internalRid = -1
const fireAndForget = (channel) => {
  if (!ws || ws.readyState !== WebSocket.OPEN || !authenticated) return
  try {
    ws.send(JSON.stringify({ type: 'invoke', id: internalRid--, channel, args: [] }))
  } catch (err) {
    log('warn', `${channel} failed: ${err.message}`)
  }
}

const clearVoiceTimer = () => {
  if (voiceMaxTimer) { clearTimeout(voiceMaxTimer); voiceMaxTimer = null }
}

const startRecording = () => {
  if (voiceProc) { log('warn', 'already recording'); return }
  if (cvProc) {
    // Continuous capture already owns the mic — refuse rather than spawn a
    // second recorder. The error matches the cv-side message so the front
    // end sees the same shape regardless of which side tried first.
    send({ ev: 'rec', active: false, error: 'continuous voice is running' })
    return
  }
  voiceChunks = []
  fireAndForget('voice:duck')

  try {
    voiceProc = spawn('pw-record', [
      '--rate', '16000',
      '--channels', '1',
      '--format', 's16',
      '--container', 'raw',
      '-'
    ])
  } catch (err) {
    voiceProc = null
    log('error', `pw-record spawn failed: ${err.message}`)
    send({ ev: 'rec', active: false })
    fireAndForget('voice:restore')
    return
  }

  // Local handle, so the exit handler can tell "this recorder died on its
  // own" from "stopRecording() already replaced/cleared voiceProc".
  const proc = voiceProc
  // Last stderr line, kept so an unexpected exit can name its own cause.
  let lastStderr = ''

  voiceProc.on('error', (err) => {
    log('error', `pw-record failed: ${err.message}`)
  })
  voiceProc.stdout.on('data', (chunk) => { voiceChunks.push(chunk) })
  voiceProc.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim()
    if (!text) return
    lastStderr = text.split('\n').filter(Boolean).pop() || text
    log('warn', `pw-record: ${text}`)
  })

  // A recorder that dies on its own — no capture device, no permission, a
  // node that vanished — used to be reported ONLY through `log`, which the
  // front end cannot read. `rec active:true` was already sent, so the UI sat
  // in a false "listening" state forever with nothing on screen, and the
  // eventual stop() collected an empty buffer. Report it on the recording
  // channel instead, with the reason the recorder itself gave.
  voiceProc.on('exit', (code, signal) => {
    // stopRecording() clears voiceProc before killing, so a non-null value
    // here means nobody asked for this exit.
    if (voiceProc !== proc) return
    voiceProc = null
    clearVoiceTimer()
    voiceChunks = []
    fireAndForget('voice:restore')
    send({
      ev: 'rec',
      active: false,
      error: lastStderr
        || `pw-record exited unexpectedly (${signal || 'code ' + code})`
    })
  })

  send({ ev: 'rec', active: true })
  voiceMaxTimer = setTimeout(() => {
    log('warn', 'voice capture hit 120 s cap, auto-stopping')
    stopRecording()
  }, RECORD_MAX_MS)
}

const stopRecording = async () => {
  if (!voiceProc) {
    send({ ev: 'rec', active: false })
    return
  }
  const proc = voiceProc
  voiceProc = null
  clearVoiceTimer()

  try { proc.kill('SIGINT') } catch { /* already gone */ }
  await new Promise((resolve) => {
    if (proc.exitCode != null) return resolve()
    const t = setTimeout(resolve, 1500)
    proc.once('exit', () => { clearTimeout(t); resolve() })
  })

  const pcm = Buffer.concat(voiceChunks)
  voiceChunks = []

  fireAndForget('voice:restore')
  send({ ev: 'rec', active: false })

  if (pcm.length === 0) {
    send({ ev: 'audio', b64: '' })
    return
  }
  send({ ev: 'audio', b64: Buffer.concat([wavHeader(pcm.length), pcm]).toString('base64') })
}

const cancelRecording = () => {
  clearVoiceTimer()
  if (voiceProc && voiceProc.exitCode === null) {
    try { voiceProc.kill('SIGKILL') } catch { /* already gone */ }
  }
  voiceProc = null
  voiceChunks = []
  fireAndForget('voice:restore')
  send({ ev: 'rec', active: false })
}
// ---- continuous-voice capture ---------------------------------------------
//
// The renderer captures via getUserMedia + ScriptProcessor; QML has no audio
// input, so this side owns a long-lived pw-record child and segments the
// stdout through the shared VAD (src/core/services/vadStateMachine.ts).
// Segmentation lives in bridge/cvSegmenter.mjs so the bridge and the test
// share the same code — the orchestrator MUST NOT duplicate it.
//
// Frame contract (bridge -> QML):
//   {"ev":"cv","active":true}
//   {"ev":"cv","active":false}                              // clean stop
//   {"ev":"cv","active":false,"error":"<reason>"}           // spawn/exit failure
//   {"ev":"utterance","b64":"<base64 wav>","startedAt":<ms>,"endedAt":<ms>}

const startCv = (config) => {
  if (cvProc) {
    log('warn', 'continuous capture already running')
    return
  }
  if (voiceProc) {
    send({ ev: 'cv', active: false, error: 'a push-to-talk capture is running' })
    return
  }

  // Build the segmenter BEFORE spawning, so the first stdout bytes already
  // have a destination. If spawn fails below we explicitly reset().
  cvSegmenter = createCvSegmenter({
    silenceThreshold: Number(config?.silenceThreshold) || 0.012,
    silenceDurationMs: Number(config?.silenceDurationMs) || 900,
    minUtteranceMs: Number(config?.minUtteranceMs) || 400,
    onsetBlocks: Number(config?.onsetBlocks) || 3,
    preSpeechPadMs: Number(config?.preSpeechPadMs) || 200,
    onUtterance: (u) => send({ ev: 'utterance', b64: u.b64, startedAt: u.startedAt, endedAt: u.endedAt }),
  })
  cvLastStderr = ''

  fireAndForget('voice:duck')

  let proc
  try {
    proc = spawn('pw-record', [
      '--rate', '16000',
      '--channels', '1',
      '--format', 's16',
      '--container', 'raw',
      '-'
    ])
  } catch (err) {
    cvProc = null
    cvSegmenter = null
    log('error', `pw-record spawn failed: ${err.message}`)
    fireAndForget('voice:restore')
    send({ ev: 'cv', active: false, error: err.message || String(err) })
    return
  }
  cvProc = proc

  const liveProc = proc
  proc.on('error', (err) => {
    log('error', `pw-record (cv) failed: ${err.message}`)
  })
  proc.stdout.on('data', (chunk) => {
    if (cvSegmenter) {
      try {
        for (const u of cvSegmenter.pushChunk(chunk)) {
          // pushChunk already emits via the onUtterance callback; this
        // catch is a defence-in-depth measure so a malformed chunk
        // never crashes the bridge.
        }
      } catch (err) {
        log('error', `cv segmentation failed: ${err.message}`)
      }
    }
  })
  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim()
    if (!text) return
    cvLastStderr = text.split('\n').filter(Boolean).pop() || text
    log('warn', `pw-record (cv): ${text}`)
  })

  // Same discipline as the push-to-talk path: a recorder that dies on its
  // own used to leave the UI stuck in a fake "listening" state. Report it
  // on the cv channel with the reason the recorder itself gave.
  proc.on('exit', (code, signal) => {
    if (cvProc !== liveProc) return
    cvProc = null
    if (cvSegmenter) { cvSegmenter.reset(); cvSegmenter = null }
    fireAndForget('voice:restore')
    send({
      ev: 'cv',
      active: false,
      error: cvLastStderr
        || `pw-record exited unexpectedly (${signal || 'code ' + code})`
    })
  })

  send({ ev: 'cv', active: true })
}

const stopCv = () => {
  if (!cvProc) {
    send({ ev: 'cv', active: false })
    return
  }
  const proc = cvProc
  cvProc = null
  if (cvSegmenter) { cvSegmenter.reset(); cvSegmenter = null }

  try { proc.kill('SIGINT') } catch { /* already gone */ }
  fireAndForget('voice:restore')
  send({ ev: 'cv', active: false })
}

const pauseCv = (paused) => {
  if (!cvSegmenter) return
  if (paused) cvSegmenter.pause()
  else cvSegmenter.resume()
}

const handleCommand = (cmd) => {
  switch (cmd.op) {
    case 'invoke': {
      const rid = Number(cmd.rid)
      if (!Number.isFinite(rid)) { log('warn', 'invoke without a numeric rid'); return }
      const channel = String(cmd.channel || '')
      if (!channel) { send({ ev: 'result', rid, error: 'missing channel' }); return }
      pending.add(rid)
      if (!authenticated) {
        preAuthQueue.push({ rid, channel, args: cmd.args })
        return
      }
      writeInvoke(rid, channel, cmd.args)
      return
    }
    case 'cancel': {
      const rid = Number(cmd.rid)
      pending.delete(rid)
      preAuthQueue = preAuthQueue.filter((q) => q.rid !== rid)
      return
    }
    case 'respond': {
      // pi:uiRequest reply. Written straight through with no reshaping; the
      // server's `respond` frame is already the PiUIResponse shape.
      if (!ws || ws.readyState !== WebSocket.OPEN || !authenticated) {
        log('warn', 'respond dropped: not connected')
        return
      }
      const frame = { type: 'respond', id: String(cmd.id || '') }
      if (cmd.value !== undefined) frame.value = cmd.value
      if (cmd.confirmed !== undefined) frame.confirmed = cmd.confirmed
      if (cmd.cancelled !== undefined) frame.cancelled = cmd.cancelled
      try { ws.send(JSON.stringify(frame)) } catch (err) {
        log('warn', `respond send failed: ${err.message}`)
      }
      return
    }
    case 'rec.start': startRecording(); return
    case 'rec.stop': stopRecording(); return
    case 'rec.cancel': cancelRecording(); return
    case 'cv.start': startCv(cmd.config || {}); return
    case 'cv.stop': stopCv(); return
    case 'cv.pause': pauseCv(Boolean(cmd.paused)); return
    default:
      log('warn', `unknown op: ${cmd && cmd.op}`)
  }
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (!line || line.trim().length === 0) return
  let cmd
  try { cmd = JSON.parse(line) } catch {
    log('warn', 'bad command line')
    return
  }
  if (!cmd || typeof cmd !== 'object') { log('warn', 'bad command line'); return }
  try {
    const r = handleCommand(cmd)
    if (r && typeof r.catch === 'function') {
      r.catch((err) => log('error', `op ${cmd.op} threw: ${err && err.message}`))
    }
  } catch (err) {
    log('error', `op ${cmd.op} threw: ${err && err.message}`)
  }
})

const shutdown = () => {
  clearVoiceTimer()
  if (voiceProc && voiceProc.exitCode === null) {
    try { voiceProc.kill('SIGKILL') } catch { /* already gone */ }
  }
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

connect()
