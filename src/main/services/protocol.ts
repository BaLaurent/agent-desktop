import { protocol, net } from 'electron'
import { pathToFileURL } from 'url'
import { resolve } from 'path'
import { validatePathSafe } from '../utils/validate'

/**
 * Register the agent-preview: scheme as privileged.
 * MUST be called before app.ready — Electron requires scheme registration at startup.
 */
export function registerPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'agent-preview',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
      },
    },
  ])
}

/**
 * Register the agent-preview: protocol handler.
 * Must be called after app.ready.
 *
 * Maps agent-preview:///absolute/path/to/file → reads file from disk.
 * Relative resources in HTML (CSS, images, fonts) resolve naturally
 * because the scheme is registered as "standard".
 */
export function registerPreviewProtocol(): void {
  protocol.handle('agent-preview', (request) => {
    let filePath: string
    let allowedBase: string | null = null
    try {
      const url = new URL(request.url)
      filePath = decodeURIComponent(url.pathname)
      allowedBase = url.searchParams.get('base')
      if (allowedBase) allowedBase = decodeURIComponent(allowedBase)
    } catch {
      return new Response('Bad request', { status: 400 })
    }

    // Resolve to absolute and validate
    filePath = resolve(filePath)
    try {
      validatePathSafe(filePath)
    } catch {
      return new Response('Forbidden', { status: 403 })
    }

    // If base directory specified, restrict to that subtree
    if (allowedBase) {
      const resolvedBase = resolve(allowedBase)
      if (!filePath.startsWith(resolvedBase + '/') && filePath !== resolvedBase) {
        return new Response('Forbidden', { status: 403 })
      }
    }

    // Delegate to Electron's net module — it handles MIME detection from extension
    return net.fetch(pathToFileURL(filePath).href)
  })
}
