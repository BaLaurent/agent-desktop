import type { Attachment } from '../../shared/types'

const MAX_WEB_IMAGE_SIZE = 50 * 1024 * 1024 // 50MB
const MAX_WEB_TEXT_SIZE = 10 * 1024 * 1024  // 10MB

const EXT_TO_TYPE_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  pdf: 'application/pdf',
  json: 'application/json',
  txt: 'text/plain',
  md: 'text/markdown',
  js: 'text/javascript',
  ts: 'text/typescript',
  py: 'text/x-python',
  csv: 'text/csv',
  yaml: 'text/yaml',
  yml: 'text/yaml',
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'])

/**
 * Converts a browser File object to an Attachment.
 *
 * Desktop (Electron): uses getPathForFile to get the local filesystem path.
 * Web mode (remote access): reads the file into memory and uploads it via
 * savePastedFile, which returns a server-side temp path.
 */
export async function fileToAttachment(file: File): Promise<Attachment | null> {
  const isWebMode = !!(window as any).__AGENT_WEB_MODE__
  const mime = file.type || extToType(file.name)

  if (isWebMode) {
    // Size guard — prevent OOM on large files
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    const maxSize = IMAGE_EXTS.has(ext) ? MAX_WEB_IMAGE_SIZE : MAX_WEB_TEXT_SIZE
    if (file.size > maxSize) {
      const limitMB = maxSize / 1024 / 1024
      console.error(`[fileToAttachment] File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds ${limitMB}MB limit`)
      throw new Error(`File "${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size: ${limitMB}MB`)
    }

    // Web mode: read file into memory, upload to server
    try {
      const buffer = await file.arrayBuffer()
      const path = await window.agent.files.savePastedFile(new Uint8Array(buffer), mime)
      return { name: file.name, path, type: mime, size: file.size }
    } catch (err) {
      console.error('[fileToAttachment] Upload failed:', err)
      return null
    }
  }

  // Desktop: direct filesystem path
  const path = window.agent.system.getPathForFile(file)
  return { name: file.name, path, type: mime, size: file.size }
}

function extToType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_TYPE_MAP[ext] ?? 'application/octet-stream'
}
