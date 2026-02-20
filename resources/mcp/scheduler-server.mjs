#!/usr/bin/env node
// MCP Server for Agent Desktop Scheduler
// Standalone ESM script, zero dependencies.
// Communicates with the main process via Unix socket bridge.
//
// Protocol: newline-delimited JSON on stdin/stdout (NOT Content-Length framing).
// The Claude Agent SDK reads/writes JSON lines, not LSP-style Content-Length.

import * as net from 'node:net'
import * as fs from 'node:fs'
import { createInterface } from 'node:readline'

const SOCKET_PATH = process.env.SCHEDULER_SOCKET
const AUTH_TOKEN = process.env.SCHEDULER_TOKEN
const CONVERSATION_ID = Number(process.env.SCHEDULER_CONVERSATION_ID)
const LOG_FILE = process.env.SCHEDULER_LOG_FILE || null

// ─── Logging ────────────────────────────────────────────────

let logFd = null
if (LOG_FILE) {
  try {
    logFd = fs.openSync(LOG_FILE, 'a')
  } catch (err) {
    process.stderr.write(`[scheduler-server] Cannot open log file ${LOG_FILE}: ${err.message}\n`)
  }
}

function log(level, msg) {
  const line = `${new Date().toISOString()} [scheduler-server] [${level}] ${msg}\n`
  process.stderr.write(line)
  if (logFd !== null) {
    try { fs.writeSync(logFd, line) } catch { /* best effort */ }
  }
}

// ─── Env validation ─────────────────────────────────────────

if (!SOCKET_PATH || !AUTH_TOKEN || !CONVERSATION_ID) {
  const missing = [
    !SOCKET_PATH && 'SCHEDULER_SOCKET',
    !AUTH_TOKEN && 'SCHEDULER_TOKEN',
    !CONVERSATION_ID && 'SCHEDULER_CONVERSATION_ID',
  ].filter(Boolean).join(', ')
  log('ERROR', `Missing env vars: ${missing}`)
  process.exit(1)
}

log('INFO', `Starting: socket=${SOCKET_PATH} conv=${CONVERSATION_ID} log=${LOG_FILE || 'stderr-only'}`)

// ─── Bridge client (lazy connection) ────────────────────────

let bridgeConn = null
let bridgeConnecting = null
let requestId = 0
const pending = new Map()

function ensureBridge() {
  if (bridgeConn) return Promise.resolve(bridgeConn)
  if (bridgeConnecting) return bridgeConnecting

  log('INFO', `Connecting to bridge at ${SOCKET_PATH}`)

  bridgeConnecting = new Promise((resolve, reject) => {
    const conn = net.createConnection(SOCKET_PATH, () => {
      bridgeConn = conn
      bridgeConnecting = null
      log('INFO', 'Bridge connected')
      resolve(conn)
    })

    conn.on('error', (err) => {
      bridgeConn = null
      bridgeConnecting = null
      log('ERROR', `Bridge connection error: ${err.message} (code=${err.code || 'none'})`)
      reject(err)
    })

    conn.setTimeout(5000, () => {
      conn.destroy(new Error('Bridge connection timeout (5s)'))
    })

    let buffer = ''
    conn.on('data', (chunk) => {
      buffer += chunk.toString()
      let idx
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line) continue
        try {
          const resp = JSON.parse(line)
          const p = pending.get(resp.id)
          if (p) {
            pending.delete(resp.id)
            if (resp.error) {
              log('WARN', `Bridge call ${resp.id} error: ${resp.error}`)
              p.reject(new Error(resp.error))
            } else {
              p.resolve(resp.result)
            }
          }
        } catch (e) {
          log('WARN', `Bridge response parse error: ${e.message}, raw: ${line.slice(0, 200)}`)
        }
      }
    })

    conn.on('close', () => {
      log('WARN', 'Bridge connection closed')
      bridgeConn = null
    })
  })

  return bridgeConnecting
}

async function bridgeCall(method, params) {
  await ensureBridge()
  return new Promise((resolve, reject) => {
    const id = ++requestId
    pending.set(id, { resolve, reject })
    const msg = JSON.stringify({ id, method, token: AUTH_TOKEN, params: { ...params, conversation_id: CONVERSATION_ID } })
    log('DEBUG', `Bridge call #${id}: ${method}`)
    bridgeConn.write(msg + '\n')
  })
}

// ─── Tool definitions ────────────────────────────────────────

const TOOLS = [
  {
    name: 'schedule_task',
    description: 'Schedule a task (reminder, recurring action). Use delay_minutes for a one-time reminder (e.g. "remind me in 10 minutes"), or interval_value+interval_unit for recurring tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short name for the task (e.g. "Pasta reminder")' },
        prompt: { type: 'string', description: 'The message/instruction that will be sent when the task triggers. Write it as if you are the user asking you (the AI) to do something.' },
        delay_minutes: { type: 'number', description: 'For one-time reminders: number of minutes from now. Mutually exclusive with interval_value/interval_unit.' },
        interval_value: { type: 'number', description: 'For recurring tasks: interval amount (e.g. 2 for "every 2 hours")' },
        interval_unit: { type: 'string', enum: ['minutes', 'hours', 'days'], description: 'For recurring tasks: interval unit' },
        one_shot: { type: 'boolean', description: 'If true, task auto-disables after first execution. Automatically set when using delay_minutes.' },
        schedule_time: { type: 'string', description: 'For daily tasks: time in HH:MM format (24h). Only used with interval_unit=days.' },
      },
      required: ['name', 'prompt'],
    },
  },
  {
    name: 'list_scheduled_tasks',
    description: 'List all scheduled tasks for the current conversation.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'cancel_scheduled_task',
    description: 'Cancel (delete) a scheduled task by its ID.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'number', description: 'The ID of the task to cancel' },
      },
      required: ['task_id'],
    },
  },
]

// ─── Tool call handlers ──────────────────────────────────────

async function handleToolCall(name, args) {
  log('INFO', `Tool call: ${name} args=${JSON.stringify(args).slice(0, 500)}`)

  switch (name) {
    case 'schedule_task': {
      let { name: taskName, prompt, delay_minutes, interval_value, interval_unit, one_shot, schedule_time } = args

      if (!taskName || !prompt) {
        throw new Error('name and prompt are required')
      }

      // delay_minutes shorthand → one-shot with minutes interval
      if (delay_minutes != null) {
        if (interval_value != null || interval_unit != null) {
          throw new Error('delay_minutes is mutually exclusive with interval_value/interval_unit')
        }
        interval_value = Math.max(1, Math.round(delay_minutes))
        interval_unit = 'minutes'
        one_shot = true
      }

      if (!interval_value || !interval_unit) {
        throw new Error('Either delay_minutes or interval_value+interval_unit is required')
      }

      const result = await bridgeCall('scheduler.create', {
        name: taskName,
        prompt,
        interval_value,
        interval_unit,
        one_shot: one_shot ?? false,
        schedule_time: schedule_time || null,
      })

      log('INFO', `Task created: ${JSON.stringify(result)}`)
      return JSON.stringify(result)
    }

    case 'list_scheduled_tasks': {
      const result = await bridgeCall('scheduler.list', {})
      log('INFO', `Listed ${Array.isArray(result) ? result.length : '?'} tasks`)
      return JSON.stringify(result)
    }

    case 'cancel_scheduled_task': {
      const { task_id } = args
      if (!task_id) throw new Error('task_id is required')
      const result = await bridgeCall('scheduler.cancel', { task_id })
      log('INFO', `Cancelled task ${task_id}`)
      return JSON.stringify(result)
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ─── JSON-RPC message handling ──────────────────────────────

function sendResponse(response) {
  const line = JSON.stringify(response) + '\n'
  process.stdout.write(line)
  log('DEBUG', `Sent response: id=${response.id} hasResult=${!!response.result} hasError=${!!response.error}`)
}

function handleMessage(msg) {
  const { id, method, params } = msg
  log('INFO', `MCP recv: method=${method} id=${id}`)

  switch (method) {
    case 'initialize':
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'agent-scheduler', version: '1.0.0' },
        },
      })
      break

    case 'notifications/initialized':
      log('INFO', 'MCP initialized notification received')
      break

    case 'tools/list':
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      })
      break

    case 'tools/call':
      handleToolCall(params.name, params.arguments || {})
        .then((text) => {
          sendResponse({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text }],
            },
          })
        })
        .catch((err) => {
          log('ERROR', `Tool call ${params.name} failed: ${err.message}`)
          sendResponse({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Error: ${err.message}` }],
              isError: true,
            },
          })
        })
      break

    default:
      log('WARN', `Unknown MCP method: ${method}`)
      sendResponse({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      })
  }
}

// ─── Crash handlers ─────────────────────────────────────────

process.on('uncaughtException', (err) => {
  log('FATAL', `Uncaught exception: ${err.message}\n${err.stack || ''}`)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? `${reason.message}\n${reason.stack || ''}` : String(reason)
  log('FATAL', `Unhandled rejection: ${msg}`)
  process.exit(1)
})

// ─── Main: readline on stdin (newline-delimited JSON) ───────

const rl = createInterface({ input: process.stdin, terminal: false })

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  try {
    handleMessage(JSON.parse(trimmed))
  } catch (err) {
    log('ERROR', `Parse error: ${err.message}, line: ${trimmed.slice(0, 200)}`)
  }
})

rl.on('close', () => {
  log('INFO', 'stdin closed, shutting down')
  if (logFd !== null) { try { fs.closeSync(logFd) } catch { /* ok */ } }
  if (bridgeConn) bridgeConn.end()
  process.exit(0)
})

log('INFO', 'Ready for MCP (newline-delimited JSON on stdin/stdout)')
