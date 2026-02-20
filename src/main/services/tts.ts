import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { promises as fsp } from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { getMainWindow } from '../index'
import { loadAgentSDK } from './anthropic'
import { injectApiKeyEnv } from './streaming'
import { findBinaryInPath } from '../utils/env'
import { getSetting } from '../utils/db'
import { sanitizeError } from '../utils/errors'
import { validateString } from '../utils/validate'
import { duckOtherStreams, restoreOtherStreams } from '../utils/volume'
import { HAIKU_MODEL } from '../../shared/constants'

// ─── Module state ────────────────────────────────────────────

let currentProcess: ChildProcess | null = null
let cachedPlayer: string | null = null

// ─── State notification ──────────────────────────────────────

function notifySpeakingState(speaking: boolean): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('tts:stateChange', { speaking })
  }
}

// ─── Internal helpers ────────────────────────────────────────

const PLAYER_NAMES = ['mpv', 'ffplay', 'paplay', 'aplay'] as const

function stripMarkdown(text: string): string {
  return text
    // Code blocks (```...```)
    .replace(/```[\s\S]*?```/g, '')
    // Inline code (`...`)
    .replace(/`([^`]*)`/g, '$1')
    // Images (![alt](url))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    // Links [text](url) → keep text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Heading markers
    .replace(/^#{1,6}\s+/gm, '')
    // Bold/italic (** __ * _)
    .replace(/(\*{1,3}|_{1,3})(.+?)\1/g, '$2')
    // List bullets (- * +) at start of line
    .replace(/^[\s]*[-*+]\s+/gm, '')
    // Horizontal rules (--- or more)
    .replace(/^-{3,}\s*$/gm, '')
    // Emojis and symbols (breaks TTS)
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
    // Collapse multiple newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function autoDetectPlayer(): string | null {
  if (cachedPlayer) return cachedPlayer
  for (const name of PLAYER_NAMES) {
    const found = findBinaryInPath(name)
    if (found) {
      cachedPlayer = found
      return found
    }
  }
  return null
}

function getPlayerPath(db: Database.Database): string | null {
  const configured = getSetting(db, 'tts_playerPath')
  if (configured && configured !== 'auto') {
    const resolved = findBinaryInPath(configured)
    if (resolved) return resolved
    console.warn('[tts] Configured player not found:', configured)
  }
  return autoDetectPlayer()
}

function playAudioFile(filePath: string, db: Database.Database): Promise<void> {
  return new Promise((resolve, reject) => {
    const player = getPlayerPath(db)
    if (!player) {
      reject(new Error('No audio player found. Install mpv, ffplay, paplay, or aplay.'))
      return
    }

    const playerName = path.basename(player)
    // ffplay needs -nodisp -autoexit to avoid opening a window
    const args = playerName === 'ffplay'
      ? ['-nodisp', '-autoexit', filePath]
      : [filePath]

    const proc = spawn(player, args, { stdio: 'ignore' })
    currentProcess = proc

    proc.on('error', (err) => {
      currentProcess = null
      reject(err)
    })
    proc.on('exit', (code) => {
      if (currentProcess === proc) currentProcess = null
      if (code !== 0 && code !== null) {
        reject(new Error(`Audio player ${playerName} exited with code ${code}`))
      } else {
        resolve()
      }
    })
  })
}

async function generateSummary(
  content: string,
  db: Database.Database,
  aiSettings: { ttsSummaryPrompt?: string; apiKey?: string; baseUrl?: string }
): Promise<string> {
  const truncatedContent = content.slice(0, 4000)

  const defaultPrompt =
    'Summarize the following AI response in 1-2 concise sentences suitable for text-to-speech. Focus on the key information and actionable points. Respond with ONLY the summary.\n\n{response}'

  const promptTemplate = aiSettings.ttsSummaryPrompt || defaultPrompt
  const prompt = promptTemplate.replace('{response}', truncatedContent)

  // Inject API key env vars
  const apiKey = aiSettings.apiKey || getSetting(db, 'ai_apiKey') || undefined
  const baseUrl = aiSettings.baseUrl || getSetting(db, 'ai_baseUrl') || undefined
  const restoreEnv = injectApiKeyEnv(apiKey, baseUrl)

  try {
    const sdk = await loadAgentSDK()

    let summary = ''
    const agentQuery = sdk.query({
      prompt,
      options: {
        model: HAIKU_MODEL,
        maxTurns: 1,
        allowDangerouslySkipPermissions: true,
        permissionMode: 'bypassPermissions',
        tools: [],
      },
    })

    for await (const message of agentQuery) {
      const msg = message as {
        type: string
        subtype?: string
        result?: string
        message?: { content?: Array<{ type: string; text?: string }> }
      }
      if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            summary = block.text.trim()
          }
        }
      }
      if (msg.type === 'result' && msg.subtype === 'success' && typeof msg.result === 'string' && msg.result.trim()) {
        summary = msg.result.trim()
      }
    }

    if (summary) return summary
    console.warn('[tts] Summary generation returned empty, using truncated original')
    return truncatedContent
  } catch (err) {
    console.warn('[tts] Summary generation failed, using truncated original:', sanitizeError(err))
    return truncatedContent
  } finally {
    restoreEnv?.()
  }
}

// ─── Provider implementations ────────────────────────────────

async function speakWithPiper(text: string, piperUrl: string, db: Database.Database): Promise<void> {
  const tmpFile = path.join(os.tmpdir(), `agent-tts-${Date.now()}.wav`)
  try {
    const response = await fetch(piperUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) {
      throw new Error(`Piper returned ${response.status}: ${response.statusText}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    await fsp.writeFile(tmpFile, buffer)
    await playAudioFile(tmpFile, db)
  } finally {
    await fsp.unlink(tmpFile).catch(() => {})
  }
}

async function speakWithEdgeTts(
  text: string,
  voice: string,
  edgeBinary: string,
  db: Database.Database
): Promise<void> {
  const tmpWav = path.join(os.tmpdir(), `agent-tts-${Date.now()}.mp3`)
  // For text > 5000 chars, use --file flag to avoid shell arg limits
  const useFile = text.length > 5000
  const tmpTextFile = useFile ? path.join(os.tmpdir(), `agent-tts-text-${Date.now()}.txt`) : null

  try {
    if (tmpTextFile) {
      await fsp.writeFile(tmpTextFile, text, 'utf8')
    }

    await new Promise<void>((resolve, reject) => {
      const args = useFile && tmpTextFile
        ? ['--file', tmpTextFile, '--voice', voice, '--write-media', tmpWav]
        : ['--text', text, '--voice', voice, '--write-media', tmpWav]

      const proc = spawn(edgeBinary, args, { stdio: 'ignore' })
      currentProcess = proc

      proc.on('error', (err) => {
        currentProcess = null
        reject(err)
      })
      proc.on('exit', (code) => {
        if (currentProcess === proc) currentProcess = null
        if (code !== 0) {
          reject(new Error(`edge-tts exited with code ${code}`))
        } else {
          resolve()
        }
      })
    })

    await playAudioFile(tmpWav, db)
  } finally {
    await fsp.unlink(tmpWav).catch(() => {})
    if (tmpTextFile) {
      await fsp.unlink(tmpTextFile).catch(() => {})
    }
  }
}

function speakWithSpdSay(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('spd-say', ['-e', text], { stdio: ['ignore', 'ignore', 'pipe'] })
    currentProcess = proc
    let stderr = ''

    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('error', (err) => {
      currentProcess = null
      reject(err)
    })
    proc.on('exit', (code) => {
      if (currentProcess === proc) currentProcess = null
      if (code !== 0) {
        reject(new Error(`spd-say exited with code ${code}${stderr.trim() ? ': ' + stderr.trim().slice(0, 200) : ''}`))
      } else {
        resolve()
      }
    })
  })
}

// ─── Exported functions ──────────────────────────────────────

export function stop(): void {
  if (currentProcess) {
    try {
      currentProcess.kill('SIGTERM')
    } catch {
      // already dead
    }
    currentProcess = null
  }
  notifySpeakingState(false)
}

export async function speak(text: string, db: Database.Database): Promise<void> {
  stop()

  const provider = getSetting(db, 'tts_provider')
  if (!provider || provider === 'off') return

  const maxLength = parseInt(getSetting(db, 'tts_maxLength') || '2000', 10)
  const stripped = stripMarkdown(text)
  const cleanText = maxLength > 0 ? stripped.slice(0, maxLength) : stripped
  if (!cleanText) return

  notifySpeakingState(true)

  const duck = Number(getSetting(db, 'voice_volumeDuck')) || 0
  if (duck > 0) await duckOtherStreams(duck)

  try {
    switch (provider) {
      case 'piper': {
        const piperUrl = getSetting(db, 'tts_piperUrl')
        if (!piperUrl) throw new Error('Piper URL not configured')
        await speakWithPiper(cleanText, piperUrl, db)
        break
      }
      case 'edgetts': {
        const voice = getSetting(db, 'tts_edgettsVoice') || 'en-US-AriaNeural'
        const edgeBinary = getSetting(db, 'tts_edgettsBinary') || 'edge-tts'
        const resolved = findBinaryInPath(edgeBinary)
        if (!resolved) throw new Error(`edge-tts binary not found: ${edgeBinary}`)
        await speakWithEdgeTts(cleanText, voice, resolved, db)
        break
      }
      case 'spd-say': {
        const resolved = findBinaryInPath('spd-say')
        if (!resolved) throw new Error('spd-say binary not found')
        await speakWithSpdSay(cleanText)
        break
      }
      default:
        throw new Error(`Unknown TTS provider: ${provider}`)
    }
  } finally {
    restoreOtherStreams().catch(() => {})
    notifySpeakingState(false)
  }
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

export async function speakResponse(
  content: string,
  db: Database.Database,
  conversationId: number,
  aiSettings: { ttsResponseMode?: string; ttsAutoWordLimit?: number; ttsSummaryPrompt?: string; apiKey?: string; baseUrl?: string }
): Promise<void> {
  const mode = aiSettings.ttsResponseMode
  if (!mode || mode === 'off') return

  try {
    if (mode === 'full') {
      await speak(content, db)
    } else if (mode === 'summary') {
      const summary = await generateSummary(content, db, aiSettings)
      await speak(summary, db)
    } else if (mode === 'auto') {
      const wordLimit = aiSettings.ttsAutoWordLimit || 200
      const wordCount = countWords(stripMarkdown(content))
      if (wordCount <= wordLimit) {
        await speak(content, db)
      } else {
        const summary = await generateSummary(content, db, aiSettings)
        await speak(summary, db)
      }
    }
  } catch (err) {
    console.error('[tts] speakResponse failed:', sanitizeError(err))
  }
}

export async function validateConfig(
  db: Database.Database
): Promise<{ provider: string; providerFound: boolean; playerFound: boolean; playerPath: string; error?: string }> {
  const provider = getSetting(db, 'tts_provider') || 'off'
  let providerFound = false
  let playerFound = false
  let playerPath = ''
  let error: string | undefined

  switch (provider) {
    case 'off':
      providerFound = true
      playerFound = true
      break
    case 'piper': {
      const url = getSetting(db, 'tts_piperUrl')
      providerFound = !!url
      if (!url) error = 'Piper URL not configured'
      const player = getPlayerPath(db)
      playerFound = !!player
      playerPath = player || ''
      if (!player) error = (error ? error + '; ' : '') + 'No audio player found'
      break
    }
    case 'edgetts': {
      const binary = getSetting(db, 'tts_edgettsBinary') || 'edge-tts'
      const resolved = findBinaryInPath(binary)
      providerFound = !!resolved
      if (!resolved) error = `edge-tts binary not found: ${binary}`
      const player = getPlayerPath(db)
      playerFound = !!player
      playerPath = player || ''
      if (!player) error = (error ? error + '; ' : '') + 'No audio player found'
      break
    }
    case 'spd-say': {
      const resolved = findBinaryInPath('spd-say')
      providerFound = !!resolved
      if (!resolved) error = 'spd-say binary not found'
      // spd-say plays directly, no separate player needed
      playerFound = true
      break
    }
    default:
      error = `Unknown provider: ${provider}`
  }

  return { provider, providerFound, playerFound, playerPath, error }
}

export function detectPlayers(): { name: string; path: string; available: boolean }[] {
  return PLAYER_NAMES.map((name) => {
    const found = findBinaryInPath(name)
    return { name, path: found || '', available: !!found }
  })
}

// ─── IPC handlers ────────────────────────────────────────────

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle('tts:speak', async (_event, text: unknown) => {
    const validated = validateString(text, 'text', 100_000)
    await speak(validated, db)
  })

  ipcMain.handle('tts:stop', () => {
    stop()
  })

  ipcMain.handle('tts:validate', async () => {
    return validateConfig(db)
  })

  ipcMain.handle('tts:detectPlayers', () => {
    return detectPlayers()
  })
}
