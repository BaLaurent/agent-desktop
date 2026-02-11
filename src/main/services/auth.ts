import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import type { AuthStatus, AuthDiagnostics } from '../../shared/types'
import { loadAgentSDK } from './anthropic'
import { findBinaryInPath, isAppImage } from '../utils/env'

function runDiagnostics(sdkError?: string): AuthDiagnostics {
  const home = os.homedir()
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')
  const credentialsPath = path.join(configDir, '.credentials.json')
  const claudeBinaryPath = findBinaryInPath('claude')

  return {
    claudeBinaryFound: claudeBinaryPath !== null,
    claudeBinaryPath,
    credentialsFileExists: fs.existsSync(credentialsPath),
    configDir,
    isAppImage: isAppImage(),
    home,
    ldLibraryPath: process.env.LD_LIBRARY_PATH || undefined,
    sdkError,
  }
}

async function getStatus(): Promise<AuthStatus> {
  // Pre-check: if credentials file doesn't exist, skip the SDK call entirely
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  const credentialsPath = path.join(configDir, '.credentials.json')

  if (!fs.existsSync(credentialsPath)) {
    const diagnostics = runDiagnostics('Credentials file not found')
    return {
      authenticated: false,
      user: null,
      error: `Credentials not found at ${credentialsPath}. Run \`claude login\` in your terminal first.`,
      diagnostics,
    }
  }

  try {
    const sdk = await loadAgentSDK()

    const testQuery = sdk.query({
      prompt: 'Reply with OK',
      options: {
        maxTurns: 1,
        allowedTools: [],
        permissionMode: 'bypassPermissions' as const,
        allowDangerouslySkipPermissions: true,
      },
    })

    for await (const message of testQuery) {
      const msg = message as Record<string, unknown>
      if (msg.type === 'system' && (msg as { subtype?: string }).subtype === 'init') {
        return {
          authenticated: true,
          user: { email: 'Claude User', name: 'Claude User' },
        }
      }
      if (msg.type === 'result') {
        const isError = !!(msg as { is_error?: boolean }).is_error
        return {
          authenticated: !isError,
          user: isError ? null : { email: 'Claude User', name: 'Claude User' },
        }
      }
    }

    return { authenticated: true, user: { email: 'Claude User', name: 'Claude User' } }
  } catch (err) {
    const sdkError = err instanceof Error ? err.message : String(err)
    const diagnostics = runDiagnostics(sdkError)
    return {
      authenticated: false,
      user: null,
      error: `Authentication failed: ${sdkError}`,
      diagnostics,
    }
  }
}

async function login(): Promise<AuthStatus> {
  const status = await getStatus()
  if (!status.authenticated) {
    throw new Error(status.error || 'Not logged in. Run `claude login` in your terminal first.')
  }
  return status
}

function logout(): AuthStatus {
  return { authenticated: false, user: null }
}

export function registerHandlers(ipcMain: IpcMain, _db: Database.Database): void {
  ipcMain.handle('auth:getStatus', () => getStatus())
  ipcMain.handle('auth:login', () => login())
  ipcMain.handle('auth:logout', () => logout())
}

// Exported for testing
export { getStatus, runDiagnostics }
