// Ported from src/main/utils/errors.ts (Electron-free, moved into the desktop shell).
/**
 * Sanitize error messages before sending to the renderer.
 * Strips internal file paths to avoid leaking server directory structure.
 */
export function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  // Strip absolute paths (e.g., /home/user/.config/agent-desktop/...)
  return msg.replace(/\/(?:home|root|Users|tmp|var)\/[^\s:'"]+/g, "[path]")
}
