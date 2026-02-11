// ─── Image Extensions (without dots) ─────────────────────────
// Used by files.ts (file explorer) for binary → base64 reading
export const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'tiff', 'tif',
])

// ─── Image Extensions (with dots) ────────────────────────────
// Used by attachments.ts for file classification
export const IMAGE_EXTENSIONS_DOTTED = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
])

// ─── Text / Supported Extensions (with dots) ─────────────────
// Used by knowledge.ts + attachments.ts for text file detection
export const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.js', '.ts', '.py', '.json', '.csv', '.yaml', '.yml',
])

// ─── MIME Type Utilities ─────────────────────────────────────

export function getImageMime(ext: string): string {
  switch (ext) {
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'png': return 'image/png'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'bmp': return 'image/bmp'
    case 'ico': return 'image/x-icon'
    case 'avif': return 'image/avif'
    case 'tiff': case 'tif': return 'image/tiff'
    default: return 'application/octet-stream'
  }
}

export function mimeToExt(mime: string): string | null {
  switch (mime) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/gif': return 'gif'
    case 'image/webp': return 'webp'
    case 'image/bmp': return 'bmp'
    case 'image/svg+xml': return 'svg'
    case 'image/avif': return 'avif'
    default: return null
  }
}

export function getMimeType(ext: string): string {
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.js': 'text/javascript',
    '.ts': 'text/typescript',
    '.py': 'text/x-python',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.yaml': 'application/x-yaml',
    '.yml': 'application/x-yaml',
    '.pdf': 'application/pdf',
  }
  return mimeMap[ext] || 'application/octet-stream'
}
