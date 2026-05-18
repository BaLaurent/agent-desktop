import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { SettingsService } from '../services/settings'
import { detectBackendConvention, parseLastModelByBackend } from '../services/modelBackendMap'
import { getSetting } from '../utils/db'
import { validateWebhookUrl } from '../utils/webhookValidation'

/**
 * On an explicit `ai_model` write, remember it as the last NATIVE
 * selection for the currently active backend. This is the only trigger
 * that mutates `ai_lastModelByBackend` — the model resolver stays a pure
 * reader. The map is the fallback used when a stored id has no family
 * equivalent in the target backend (e.g. `openai/gpt-4o` → Claude).
 */
function recordNativeModelSelection(
  db: SqlJsAdapter,
  service: SettingsService,
  key: string,
  value: string,
): void {
  if (key !== 'ai_model' || !value || value === 'custom') return
  const backend = getSetting(db as any, 'ai_sdkBackend') || 'claude-agent-sdk'
  // Only track ids written in the active backend's own convention —
  // a leftover cross-backend id is not a genuine selection for `backend`.
  if (detectBackendConvention(value) !== backend) return
  const map = parseLastModelByBackend(getSetting(db as any, 'ai_lastModelByBackend'))
  if (map[backend] === value) return
  map[backend] = value
  service.set('ai_lastModelByBackend', JSON.stringify(map))
}

export function registerSettingsHandlers(
  registrar: HandleRegistrar,
  db: SqlJsAdapter,
  sharedService?: SettingsService,
): void {
  const service = sharedService ?? new SettingsService(db as any)

  registrar.handle('settings:get', async () => {
    try {
      return service.getAll()
    } catch (err) {
      throw new Error(`Failed to get settings: ${(err as Error).message}`)
    }
  })

  registrar.handle('settings:set', async (_event, key: unknown, value: unknown) => {
    try {
      const k = key as string
      const v = value as string
      if (typeof k === 'string' && /^webhook_\w*[Uu]rl$/.test(k)) {
        const result = validateWebhookUrl(v ?? '')
        if (!result.ok) {
          throw new Error(`Invalid webhook URL for '${k}': ${result.reason}`)
        }
      }
      service.set(k, v)
      recordNativeModelSelection(db, service, k, v)
    } catch (err) {
      throw new Error(`Failed to set setting: ${(err as Error).message}`)
    }
  })

  registrar.handle('settings:getLocked', async () => {
    return service.getLockedKeys()
  })
}
