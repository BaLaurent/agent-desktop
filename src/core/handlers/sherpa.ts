import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { transcribe, validateConfig, resetRecognizerCache } from '../services/sherpaStt'
import { downloadPreset } from '../services/sherpaModelDownload'

export function registerSherpaHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  registrar.handle('sherpa:transcribe', async (_event, wavBuffer: unknown) => {
    const raw = wavBuffer as Uint8Array | Buffer
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    return transcribe(db as any, buf)
  })

  registrar.handle('sherpa:validateConfig', async () => {
    return validateConfig(db as any)
  })

  registrar.handle('sherpa:downloadModel', async (event: any, presetId: unknown) => {
    const dir = await downloadPreset(String(presetId), (p) => {
      // Best-effort progress push to the requesting renderer (Electron only).
      event?.sender?.send?.('sherpa:downloadProgress', p)
    })
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('sherpa_modelPath', dir)
    resetRecognizerCache()
    return { modelPath: dir }
  })
}
