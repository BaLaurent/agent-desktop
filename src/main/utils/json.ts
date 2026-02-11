/**
 * Safe JSON.parse wrapper — returns fallback instead of throwing.
 * Replaces the `try { JSON.parse(...) } catch {}` pattern repeated across services.
 */
export function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (json == null || json === '') return fallback
  try {
    return JSON.parse(json) as T
  } catch {
    console.warn('[json] Failed to parse:', json.slice(0, 100))
    return fallback
  }
}
