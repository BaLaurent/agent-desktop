#!/usr/bin/env node
// MCP Server for Agent Desktop Scheduler
// Standalone ESM script, zero dependencies.
// Communicates with the main process via Unix socket bridge.

import * as net from 'node:net'

const SOCKET_PATH = process.env.SCHEDULER_SOCKET
const AUTH_TOKEN = process.env.SCHEDULER_TOKEN
const CONVERSATION_ID = Number(process.env.SCHEDULER_CONVERSATION_ID)

if (!SOCKET_PATH || !AUTH_TOKEN || !CONVERSATION_ID) {
  process.stderr.write('Missing SCHEDULER_SOCKET, SCHEDULER_TOKEN, or SCHEDULER_CONVERSATION_ID\n')
  process.exit(1)
}

// ─── Bridge client ───────────────────────────────────────────

let bridgeConn = null
let requestId = 0
const pending = new Map()

function connectBridge() {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(SOCKET_PATH, () => {
      bridgeConn = conn
      resolve(conn)
    })
    conn.on('error', reject)

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
            if (resp.error) p.reject(new Error(resp.error))
            else p.resolve(resp.result)
          }
        } catch { /* ignore parse errors */ }
      }
    })
  })
}

function bridgeCall(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++requestId
    pending.set(id, { resolve, reject })
    const msg = JSON.stringify({ id, method, token: AUTH_TOKEN, params: { ...params, conversation_id: CONVERSATION_ID } })
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

      return JSON.stringify(result)
    }

    case 'list_scheduled_tasks': {
      const result = await bridgeCall('scheduler.list', {})
      return JSON.stringify(result)
    }

    case 'cancel_scheduled_task': {
      const { task_id } = args
      if (!task_id) throw new Error('task_id is required')
      const result = await bridgeCall('scheduler.cancel', { task_id })
      return JSON.stringify(result)
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ─── MCP stdio protocol (Content-Length framing) ─────────────

let inputBuffer = Buffer.alloc(0)

function sendResponse(response) {
  const body = JSON.stringify(response)
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`
  process.stdout.write(header + body)
}

function handleMessage(msg) {
  const { id, method, params } = msg

  switch (method) {
    case 'initialize':
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'agent-scheduler', version: '1.0.0' },
        },
      })
      break

    case 'notifications/initialized':
      // No response needed for notifications
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
      sendResponse({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      })
  }
}

function processInput() {
  while (true) {
    // Look for Content-Length header
    const headerEnd = inputBuffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) return

    const header = inputBuffer.slice(0, headerEnd).toString()
    const match = header.match(/Content-Length:\s*(\d+)/i)
    if (!match) {
      // Skip malformed data
      inputBuffer = inputBuffer.slice(headerEnd + 4)
      continue
    }

    const contentLength = parseInt(match[1], 10)
    const bodyStart = headerEnd + 4

    if (inputBuffer.length < bodyStart + contentLength) return // incomplete

    const body = inputBuffer.slice(bodyStart, bodyStart + contentLength).toString()
    inputBuffer = inputBuffer.slice(bodyStart + contentLength)

    try {
      handleMessage(JSON.parse(body))
    } catch (err) {
      process.stderr.write(`[scheduler-server] Parse error: ${err.message}\n`)
    }
  }
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  await connectBridge()
  process.stderr.write('[scheduler-server] Connected to bridge, ready for MCP\n')

  process.stdin.on('data', (chunk) => {
    inputBuffer = Buffer.concat([inputBuffer, chunk])
    processInput()
  })

  process.stdin.on('end', () => {
    if (bridgeConn) bridgeConn.end()
    process.exit(0)
  })
}

main().catch((err) => {
  process.stderr.write(`[scheduler-server] Fatal: ${err.message}\n`)
  process.exit(1)
})
