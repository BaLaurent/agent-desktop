import { readFile, writeFile, rename, unlink } from 'fs/promises'
import type { ErrorBuffer, ErrorEntry } from '../../core/services/errorBuffer'
import { createLogger, errToCtx } from '../../core/utils/logger'

const log = createLogger('errorBufferPersist')

const FLUSH_DEBOUNCE_MS = 2000

export async function loadFromDisk(buffer: ErrorBuffer, path: string): Promise<void> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    log.warn('read failed, starting empty', errToCtx(err))
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    log.warn('corrupt persist file, discarding')
    await unlink(path).catch(() => {})
    return
  }
  if (!Array.isArray(parsed)) return
  for (const entry of parsed) {
    if (isErrorEntry(entry)) buffer.push(entry)
  }
}

export function attachPersistence(buffer: ErrorBuffer, path: string): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight = false
  let dirty = false

  const flush = async (): Promise<void> => {
    timer = null
    if (inFlight) {
      dirty = true
      return
    }
    inFlight = true
    dirty = false
    const tmp = `${path}.tmp`
    const payload = JSON.stringify(buffer.getAll())
    try {
      await writeFile(tmp, payload, 'utf8')
      await rename(tmp, path)
    } catch (err) {
      log.warn('flush failed', errToCtx(err))
      try {
        await unlink(tmp)
      } catch {
        // ignore — tmp may not exist (writeFile failed) or unlink itself failed
      }
    } finally {
      inFlight = false
      if (dirty && timer === null) {
        timer = setTimeout(() => {
          void flush()
        }, FLUSH_DEBOUNCE_MS)
      }
    }
  }

  const unsub = buffer.onPush(() => {
    if (timer !== null) return
    timer = setTimeout(() => {
      void flush()
    }, FLUSH_DEBOUNCE_MS)
  })

  return () => {
    unsub()
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
}

function isErrorEntry(value: unknown): value is ErrorEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.timestamp === 'string' &&
    (v.source === 'main' || v.source === 'renderer') &&
    v.level === 'error' &&
    typeof v.message === 'string'
  )
}
