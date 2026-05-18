import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { spawn, spawnSync } from 'child_process'
import type { ChildProcess } from 'child_process'
import { promises as fsp } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { findBinaryInPath } from '../utils/env'
import { getSetting } from '../utils/db'
import { validateString, validatePositiveInt } from '../utils/validate'
import { HAIKU_MODEL } from '../types/constants'
import { loadAgentSDK } from '../services/anthropic'
import { mapModelToBackend, parseLastModelByBackend } from '../services/modelBackendMap'
import { injectApiKeyEnv } from '../services/streaming'
import { duckOtherStreams, restoreOtherStreams } from '../utils/volume'
import { createLogger, errToCtx } from '../utils/logger'

const log = createLogger('tts')

// ─── Module state ───────────────────────────────────────────

let currentProcess: ChildProcess | null = null
let cachedPlayer: string | null = null
let currentMessageId: number | null = null

// ─── Speaking state listener (set by Electron main) ────────

type SpeakingStateListener = (speaking: boolean, messageId: number | null) => void
let speakingStateListener: SpeakingStateListener | null = null

export function setSpeakingStateListener(listener: SpeakingStateListener | null): void {
  speakingStateListener = listener
}

function notifySpeakingState(speaking: boolean): void {
  speakingStateListener?.(speaking, currentMessageId)
}

// ─── Inline helpers ─────────────────────────────────────────

const PLAYER_NAMES = ['mpv', 'ffplay', 'paplay', 'aplay'] as const

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*{1,3}|_{1,3})(.+?)\1/g, '$2')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^-{3,}\s*$/gm, '')
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
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

function getPlayerPath(db: any): string | null {
  const configured = getSetting(db, 'tts_playerPath')
  if (configured && configured !== 'auto') {
    const resolved = findBinaryInPath(configured)
    if (resolved) return resolved
    log.warn('Configured player not found', { configured })
  }
  return autoDetectPlayer()
}

function playAudioFile(filePath: string, db: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const player = getPlayerPath(db)
    if (!player) {
      reject(new Error('No audio player found. Install mpv, ffplay, paplay, or aplay.'))
      return
    }

    const playerName = path.basename(player)
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

// ─── Provider implementations ───────────────────────────────

async function speakWithPiper(text: string, piperUrl: string, db: any): Promise<void> {
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

async function speakWithEdgeTts(text: string, voice: string, edgeBinary: string, db: any): Promise<void> {
  const tmpWav = path.join(os.tmpdir(), `agent-tts-${Date.now()}.mp3`)
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

function speakWithSay(text: string, voice?: string): Promise<void> {
  if (process.platform !== 'darwin') {
    return Promise.reject(new Error('say is only available on macOS'))
  }
  return new Promise((resolve, reject) => {
    const args = voice ? ['-v', voice, text] : [text]
    const proc = spawn('say', args, { stdio: ['ignore', 'ignore', 'pipe'] })
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
        reject(new Error(`say exited with code ${code}${stderr.trim() ? ': ' + stderr.trim().slice(0, 200) : ''}`))
      } else {
        resolve()
      }
    })
  })
}

// ─── Core speak/stop ────────────────────────────────────────

function stopInternal(): void {
  if (currentProcess) {
    try {
      currentProcess.kill('SIGTERM')
    } catch {
      // already dead
    }
    currentProcess = null
  }
}

export function stop(): void {
  stopInternal()
  currentMessageId = null
  notifySpeakingState(false)
}

export async function speak(text: string, db: any): Promise<void> {
  stopInternal()

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
      case 'say': {
        if (process.platform !== 'darwin') throw new Error('say is only available on macOS')
        const voice = getSetting(db, 'tts_sayVoice') || undefined
        await speakWithSay(cleanText, voice)
        break
      }
      default:
        throw new Error(`Unknown TTS provider: ${provider}`)
    }
  } finally {
    await restoreOtherStreams().catch(() => {})
    notifySpeakingState(false)
  }
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

async function generateSummary(
  content: string,
  db: any,
  aiSettings: { ttsSummaryPrompt?: string; ttsSummaryModel?: string; apiKey?: string; baseUrl?: string }
): Promise<string> {
  const truncatedContent = content.slice(0, 4000)

  const defaultPrompt =
    'Summarize the following AI response in 1-2 concise sentences suitable for text-to-speech. Focus on the key information and actionable points. Respond with ONLY the summary.\n\n{response}'

  const promptTemplate = aiSettings.ttsSummaryPrompt || defaultPrompt
  const prompt = promptTemplate.replace('{response}', truncatedContent)

  const apiKey = aiSettings.apiKey || getSetting(db, 'ai_apiKey') || undefined
  const baseUrl = aiSettings.baseUrl || getSetting(db, 'ai_baseUrl') || undefined
  const restoreEnv = injectApiKeyEnv(apiKey, baseUrl)

  try {
    const sdk = await loadAgentSDK()

    let summary = ''
    // TTS summary always runs through the Claude Agent SDK below, so the
    // id must be in Claude convention regardless of the chat backend.
    const summaryModel = mapModelToBackend(
      aiSettings.ttsSummaryModel || HAIKU_MODEL,
      'claude-agent-sdk',
      { lastModelByBackend: parseLastModelByBackend(getSetting(db, 'ai_lastModelByBackend')) },
    ) as string
    // Force the Claude Code CLI binary from PATH — see streaming.ts for
    // the musl-vs-glibc rationale.
    const claudeExecutable = findBinaryInPath('claude')
    const agentQuery = sdk.query({
      prompt,
      options: {
        model: summaryModel,
        maxTurns: 1,
        allowDangerouslySkipPermissions: true,
        permissionMode: 'bypassPermissions' as any,
        tools: [],
        ...(claudeExecutable ? { pathToClaudeCodeExecutable: claudeExecutable } : {}),
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
    log.warn('Summary generation returned empty, using truncated original')
    return truncatedContent
  } catch (err) {
    log.warn('Summary generation failed, using truncated original', errToCtx(err))
    return truncatedContent
  } finally {
    restoreEnv?.()
  }
}

export async function speakResponse(
  content: string,
  db: any,
  _conversationId: number,
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
    log.error('speakResponse failed', err)
  }
}

export async function speakMessage(text: string, db: any, conversationId: number, messageId: number): Promise<void> {
  currentMessageId = messageId
  try {
    const { getAISettings } = await import('./messages')
    const aiSettings = getAISettings(db, conversationId)
    await speakResponse(text, db, conversationId, aiSettings)
  } finally {
    currentMessageId = null
  }
}

export async function validateConfig(
  db: any
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
    case 'say': {
      if (process.platform !== 'darwin') {
        error = 'say is only available on macOS'
        break
      }
      const resolved = findBinaryInPath('say')
      providerFound = !!resolved
      if (!resolved) error = 'say binary not found (unexpected on macOS)'
      // say plays directly, no separate player needed
      playerFound = true
      playerPath = resolved || '/usr/bin/say'
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

export function listSayVoices(): { name: string; locale: string }[] {
  if (process.platform !== 'darwin') return []
  try {
    const result = spawnSync('say', ['-v', '?'], { encoding: 'utf8', timeout: 5000 })
    if (!result.stdout) return []
    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(.+?)\s{2,}([a-z]{2}_[A-Z]{2,})\s+#/)
        if (!match) return null
        return { name: match[1].trim(), locale: match[2] }
      })
      .filter((v): v is { name: string; locale: string } => v !== null)
  } catch {
    return []
  }
}

// ─── Handler registration ───────────────────────────────────

export function registerTtsHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  registrar.handle('tts:speak', async (_event, text: unknown) => {
    const validated = validateString(text, 'text', 100_000)
    await speak(validated, db as any)
  })

  registrar.handle('tts:speakMessage', async (_event, text: unknown, conversationId: unknown, messageId: unknown) => {
    const t = validateString(text, 'text', 100_000)
    const cid = validatePositiveInt(conversationId, 'conversationId')
    const mid = validatePositiveInt(messageId, 'messageId')
    await speakMessage(t, db as any, cid, mid)
  })

  registrar.handle('tts:stop', async () => {
    stop()
  })

  registrar.handle('tts:validate', async () => {
    return validateConfig(db as any)
  })

  registrar.handle('tts:detectPlayers', async () => {
    return detectPlayers()
  })

  registrar.handle('tts:listSayVoices', async () => {
    return listSayVoices()
  })
}
