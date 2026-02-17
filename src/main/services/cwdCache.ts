/**
 * Shared CWD cache — extracted to avoid heavy transitive imports.
 * Both messages.ts (read/write) and conversations.ts (invalidate on cwd change) use this.
 */

export const CWD_CACHE_MAX = 1000
export const cwdCache = new Map<number, string>()

export function invalidateCwdCache(conversationId: number): void {
  cwdCache.delete(conversationId)
}
