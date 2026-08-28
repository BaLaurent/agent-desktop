import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { compile, validateConfig, exportStl } from '../services/openscad'
import { validateString } from '../utils/validate'

export function registerOpenscadHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  registrar.handle('openscad:compile', async (_event, scadFilePath: unknown) => {
    const fp = validateString(scadFilePath, 'scadFilePath')
    return compile(db as any, fp)
  })

  registrar.handle('openscad:validateConfig', async () => {
    return validateConfig(db as any)
  })

  /**
   * Export the .scad file to STL at an explicit destination path supplied by
   * the caller. Returns `null` if validation fails before the spawn — the
   * Electron renderer opens its own save dialog first and passes the chosen
   * path, so the handler no longer touches the renderer/electron dialog APIs.
   */
  registrar.handle('openscad:exportStl', async (_event, scadFilePath: unknown, outputPath: unknown) => {
    const fp = validateString(scadFilePath, 'scadFilePath')
    const op = validateString(outputPath, 'outputPath')
    await exportStl(db as any, fp, op)
    return op
  })
}