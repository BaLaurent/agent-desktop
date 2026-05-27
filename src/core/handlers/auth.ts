import * as path from 'path'
import * as os from 'os'
import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { getSetting } from '../utils/db'
import type { AuthStatus, AuthDiagnostics } from '../types/types'
import {
  getCredentialsPath,
  credentialsAvailable,
  getUserInfoFromCredentials,
} from '../auth/credentials'

async function runDiagnostics(sdkError?: string): Promise<AuthDiagnostics> {
  const home = os.homedir()
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')
  const credentialsPath = path.join(configDir, '.credentials.json')

  return {
    claudeBinaryFound: false,
    claudeBinaryPath: null,
    credentialsFileExists: await credentialsAvailable(credentialsPath),
    configDir,
    isAppImage: !!process.env.APPIMAGE,
    home,
    ldLibraryPath: process.env.LD_LIBRARY_PATH || undefined,
    sdkError,
  }
}

async function getStatus(db: SqlJsAdapter): Promise<AuthStatus> {
  // Check for API key auth first — bypass OAuth entirely when set
  try {
    if (getSetting(db as any, 'ai_apiKey')) {
      return {
        authenticated: true,
        user: { email: 'API Key', name: 'API Key User' },
      }
    }
  } catch {
    // settings table might not exist yet during initial setup
  }

  const credentialsPath = getCredentialsPath()

  if (!(await credentialsAvailable(credentialsPath))) {
    const hint =
      process.platform === 'darwin'
        ? 'Run `claude login` in your terminal first.'
        : `Credentials not found at ${credentialsPath}. Run \`claude login\` in your terminal first.`
    const diagnostics = await runDiagnostics('Credentials file not found')
    return {
      authenticated: false,
      user: null,
      error: hint,
      diagnostics,
    }
  }

  const userInfo = await getUserInfoFromCredentials(credentialsPath)
  return { authenticated: true, user: userInfo }
}

function logout(): AuthStatus {
  return { authenticated: false, user: null }
}

export function registerAuthHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  registrar.handle('auth:getStatus', async () => {
    try {
      return await getStatus(db)
    } catch (err) {
      throw new Error(`Failed to get auth status: ${(err as Error).message}`)
    }
  })

  registrar.handle('auth:login', async () => {
    try {
      const status = await getStatus(db)
      if (!status.authenticated) {
        throw new Error(status.error || 'Not logged in. Run `claude login` in your terminal first.')
      }
      return status
    } catch (err) {
      throw new Error(`Login failed: ${(err as Error).message}`)
    }
  })

  registrar.handle('auth:logout', async () => {
    return logout()
  })
}
