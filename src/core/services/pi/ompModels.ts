// omp model discovery for the model-picker UI.
//
// Replaces the former pi/modelRegistry.discoverPIModels (which used the
// in-process @mariozechner SDK's ModelRegistry). Spawns a short-lived omp RPC
// process, asks it for the available models via `get_available_models`, and maps
// them to the { value, label } shape the picker expects (value = "provider/id").

import { findOmpBinary } from './ompLocator'
import { OmpRpcClient } from './ompRpcClient'
import { createLogger, errToCtx } from '../../utils/logger'

const log = createLogger('pi.ompModels')

export interface OmpModelOption {
  value: string
  label: string
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** Map raw model records → { value, label } using "provider/id". */
function toOptions(models: unknown): OmpModelOption[] {
  if (!Array.isArray(models)) return []
  const out: OmpModelOption[] = []
  for (const m of models) {
    if (!isRecord(m)) continue
    const provider = typeof m.provider === 'string' ? m.provider : undefined
    const id = typeof m.id === 'string' ? m.id : undefined
    if (!provider || !id) continue
    const value = `${provider}/${id}`
    out.push({ value, label: value })
  }
  return out
}

/**
 * Discover models available to omp. Returns [] if omp is unavailable so the
 * caller can fall back to its static list.
 */
export async function discoverOmpModels(): Promise<OmpModelOption[]> {
  const ompPath = findOmpBinary()
  if (!ompPath) {
    log.warn('omp binary not found; returning no models')
    return []
  }

  const client = new OmpRpcClient({ ompPath, args: ['--no-tools', '--no-session'] })
  try {
    await client.start()
    const resp = await client.getAvailableModels()
    if (!resp.success) return []
    const data = isRecord(resp.data) ? resp.data.models : undefined
    return toOptions(data)
  } catch (err) {
    log.warn('omp model discovery failed', errToCtx(err))
    return []
  } finally {
    client.stop()
  }
}
