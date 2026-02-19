import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { spawn } from 'child_process'
import * as fs from 'fs/promises'
import { constants as fsConstants } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { getSetting } from '../utils/db'
import { validateString } from '../utils/validate'

const MAX_OUTPUT_SIZE = 50 * 1024 * 1024 // 50MB
const TIMEOUT_MS = 60_000

interface CompileResult {
  data: string   // base64-encoded .3mf
  warnings: string
}

interface ValidateResult {
  binaryFound: boolean
  binaryPath: string
  version: string
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

async function compile(db: Database.Database, scadFilePath: string): Promise<CompileResult> {
  const binaryPath = getSetting(db, 'openscad_binaryPath') || 'openscad'
  const tmpOutput = path.join(os.tmpdir(), `agent-openscad-${Date.now()}.3mf`)

  try {
    const result = await new Promise<CompileResult>((resolve, reject) => {
      const args = ['-o', tmpOutput, scadFilePath]
      const proc = spawn(binaryPath, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: TIMEOUT_MS,
        env: process.env,
      })

      let stderr = ''

      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          const hint = process.env.APPIMAGE
            ? ' When running as AppImage, use an absolute path (e.g. /usr/bin/openscad) in Settings > OpenSCAD.'
            : ''
          reject(new Error(`OpenSCAD binary not found: "${binaryPath}". Install OpenSCAD and configure the path in Settings > OpenSCAD.${hint}`))
        } else {
          reject(new Error(`Failed to start OpenSCAD: ${err.message}`))
        }
      })

      proc.on('close', async (code, signal) => {
        if (signal === 'SIGTERM') {
          reject(new Error('OpenSCAD compilation timed out (60s). Try simplifying the model.'))
          return
        }
        if (code !== 0) {
          const detail = stderr.trim().slice(0, 500)
          reject(new Error(`OpenSCAD exited with code ${code}${detail ? ': ' + detail : ''}`))
          return
        }

        try {
          const buffer = await fs.readFile(tmpOutput)
          if (buffer.length > MAX_OUTPUT_SIZE) {
            reject(new Error(`Output file too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB, max ${MAX_OUTPUT_SIZE / 1024 / 1024}MB)`))
            return
          }
          resolve({ data: buffer.toString('base64'), warnings: stderr.trim() })
        } catch (readErr) {
          reject(new Error(`Failed to read OpenSCAD output: ${(readErr as Error).message}`))
        }
      })
    })

    return result
  } finally {
    await fs.unlink(tmpOutput).catch(() => {})
  }
}

async function validateConfig(db: Database.Database): Promise<ValidateResult> {
  const binaryPath = getSetting(db, 'openscad_binaryPath') || 'openscad'
  const binaryFound = await findBinary(binaryPath)

  let version = ''
  if (binaryFound) {
    try {
      version = await new Promise<string>((resolve, reject) => {
        const proc = spawn(binaryPath, ['--version'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 5000,
          env: process.env,
        })

        let stdout = ''
        let stderr = ''

        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

        proc.on('close', () => {
          // OpenSCAD may output version to stdout or stderr
          resolve((stdout.trim() || stderr.trim()).split('\n')[0])
        })
        proc.on('error', () => reject(new Error('Failed to get version')))
      })
    } catch {
      version = ''
    }
  }

  return { binaryFound, binaryPath, version }
}

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle('openscad:compile', async (_event, scadFilePath: string) => {
    validateString(scadFilePath, 'scadFilePath')
    return compile(db, scadFilePath)
  })

  ipcMain.handle('openscad:validateConfig', async () => {
    return validateConfig(db)
  })
}

// Exported for testing
export { compile, validateConfig, findBinary }
