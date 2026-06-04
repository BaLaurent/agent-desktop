import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { transcribe, validateConfig } from '../services/whisper'
import { applyVoiceAudioEffects, clearVoiceAudioEffects } from '../services/voiceAudioEffects'

// ─── Handler registration ───────────────────────────────────

export function registerWhisperHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  registrar.handle('whisper:transcribe', async (_event, wavBuffer: unknown) => {
    const raw = wavBuffer as Uint8Array | Buffer
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    return transcribe(db as any, buf)
  })

  registrar.handle('whisper:validateConfig', async () => {
    return validateConfig(db as any)
  })

  registrar.handle('voice:duck', async () => {
    await applyVoiceAudioEffects(db as any)
  })

  registrar.handle('voice:restore', async () => {
    await clearVoiceAudioEffects(db as any)
  })
}
