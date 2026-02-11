import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { spawn } from 'child_process'
import * as fs from 'fs/promises'
import { constants as fsConstants } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { safeJsonParse } from '../utils/json'
import { getSetting } from '../utils/db'

const MAX_BUFFER_SIZE = 50 * 1024 * 1024 // 50MB
const TIMEOUT_MS = 30_000

interface TranscribeResult {
  text: string
}

interface ValidateResult {
  binaryFound: boolean
  modelFound: boolean
  binaryPath: string
  modelPath: string
}

interface WhisperAdvancedParams {
  language?: string
  translate?: boolean
  prompt?: string
  threads?: number
  noGpu?: boolean
  flashAttn?: boolean
  temperature?: number
  bestOf?: number
  beamSize?: number
  noSpeechThreshold?: number
  noFallback?: boolean
  vad?: boolean
  vadModel?: string
  vadThreshold?: number
}

async function findBinary(binaryPath: string): Promise<boolean> {
  if (path.isAbsolute(binaryPath)) {
    try {
      await fs.access(binaryPath, fsConstants.X_OK)
      return true
    } catch {
      return false
    }
  }
  // Search PATH via `which`
  return new Promise((resolve) => {
    const proc = spawn('which', [binaryPath], { stdio: ['ignore', 'pipe', 'ignore'], env: process.env })
    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('close', (code) => resolve(code === 0 && out.trim().length > 0))
    proc.on('error', () => resolve(false))
  })
}

function buildAdvancedArgs(db: Database.Database): string[] {
  const raw = getSetting(db, 'whisper_advancedParams')
  const params = safeJsonParse<WhisperAdvancedParams>(raw, {})
  const args: string[] = []

  // General
  if (params.language && params.language !== 'en') {
    args.push('-l', params.language)
  }
  if (params.translate) {
    args.push('-tr')
  }
  if (params.prompt) {
    args.push('--prompt', params.prompt)
  }

  // Performance
  if (params.threads && params.threads !== 4) {
    args.push('-t', String(params.threads))
  }
  if (params.noGpu) {
    args.push('-ng')
  }
  if (params.flashAttn === false) {
    args.push('-nfa')
  }

  // Decoding
  if (typeof params.temperature === 'number' && params.temperature !== 0) {
    args.push('-tp', String(params.temperature))
  }
  if (params.bestOf && params.bestOf !== 5) {
    args.push('-bo', String(params.bestOf))
  }
  if (params.beamSize && params.beamSize !== 5) {
    args.push('-bs', String(params.beamSize))
  }
  if (typeof params.noSpeechThreshold === 'number' && params.noSpeechThreshold !== 0.6) {
    args.push('-nth', String(params.noSpeechThreshold))
  }
  if (params.noFallback) {
    args.push('-nf')
  }

  // VAD
  if (params.vad) {
    args.push('--vad')
    if (params.vadModel) {
      args.push('-vm', params.vadModel)
    }
    if (typeof params.vadThreshold === 'number' && params.vadThreshold !== 0.5) {
      args.push('-vt', String(params.vadThreshold))
    }
  }

  return args
}

async function transcribe(db: Database.Database, wavBuffer: Buffer): Promise<TranscribeResult> {
  if (!wavBuffer || wavBuffer.length === 0) {
    throw new Error('Empty audio buffer')
  }
  if (wavBuffer.length > MAX_BUFFER_SIZE) {
    throw new Error(`Audio buffer too large (${(wavBuffer.length / 1024 / 1024).toFixed(1)}MB, max ${MAX_BUFFER_SIZE / 1024 / 1024}MB)`)
  }

  const binaryPath = getSetting(db, 'whisper_binaryPath') || 'whisper-cli'
  const modelPath = getSetting(db, 'whisper_modelPath')

  if (!modelPath) {
    throw new Error('Whisper model path not configured. Go to Settings > Voice Input to set it.')
  }

  // Write temp WAV file
  const tmpFile = path.join(os.tmpdir(), `agent-voice-${Date.now()}.wav`)
  try {
    await fs.writeFile(tmpFile, wavBuffer)

    const text = await new Promise<string>((resolve, reject) => {
      const advancedArgs = buildAdvancedArgs(db)
      const args = ['-m', modelPath, '-f', tmpFile, '--no-timestamps', ...advancedArgs]
      const proc = spawn(binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: TIMEOUT_MS,
        env: process.env,
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          const hint = process.env.APPIMAGE
            ? ' When running as AppImage, use an absolute path (e.g. /usr/local/bin/whisper-cli) in Settings > Voice Input.'
            : ''
          reject(new Error(`Whisper binary not found: "${binaryPath}". Install whisper.cpp and configure the path in Settings > Voice Input.${hint}`))
        } else {
          reject(new Error(`Failed to start whisper: ${err.message}`))
        }
      })

      proc.on('close', (code, signal) => {
        if (signal === 'SIGTERM') {
          reject(new Error('Whisper transcription timed out (30s). Try a shorter recording.'))
        } else if (code !== 0) {
          const detail = stderr.trim().slice(0, 500)
          reject(new Error(`Whisper exited with code ${code}${detail ? ': ' + detail : ''}`))
        } else {
          resolve(stdout.trim())
        }
      })
    })

    return { text }
  } finally {
    // Always clean up temp file
    await fs.unlink(tmpFile).catch(() => {})
  }
}

async function validateConfig(db: Database.Database): Promise<ValidateResult> {
  const binaryPath = getSetting(db, 'whisper_binaryPath') || 'whisper-cli'
  const modelPath = getSetting(db, 'whisper_modelPath')

  const binaryFound = await findBinary(binaryPath)

  let modelFound = false
  if (modelPath) {
    try {
      await fs.access(modelPath, fsConstants.R_OK)
      modelFound = true
    } catch {
      modelFound = false
    }
  }

  return { binaryFound, modelFound, binaryPath, modelPath }
}

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle('whisper:transcribe', async (_event, wavBuffer: Uint8Array | Buffer) => {
    // Renderer sends Uint8Array via structured clone; convert to Buffer for fs.writeFile
    const buf = Buffer.isBuffer(wavBuffer) ? wavBuffer : Buffer.from(wavBuffer)
    return transcribe(db, buf)
  })

  ipcMain.handle('whisper:validateConfig', async () => {
    return validateConfig(db)
  })
}

// Exported for testing
export { transcribe, validateConfig, findBinary, buildAdvancedArgs }
export { getSetting } from '../utils/db'
