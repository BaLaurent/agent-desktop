import type { Attachment } from '../../shared/types'

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
  const map: Record<string, string> = {
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
  return map[ext] ?? 'application/octet-stream'
}
