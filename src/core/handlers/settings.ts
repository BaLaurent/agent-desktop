import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { SettingsService } from '../services/settings'
import { validateWebhookUrl } from '../utils/webhookValidation'

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
    } catch (err) {
      throw new Error(`Failed to set setting: ${(err as Error).message}`)
    }
  })

  registrar.handle('settings:getLocked', async () => {
    return service.getLockedKeys()
  })
}
