import { pathToFileURL } from 'url'
import { resolve } from 'path'

type PISdk = typeof import('@mariozechner/pi-coding-agent')
let _piCache: PISdk | null = null

async function loadPISdk(): Promise<PISdk> {
  if (!_piCache) {
    // Function-based import() resolves bare specifiers from CWD, not __dirname.
    // In production (AppImage/deb), CWD != app directory so the bare specifier fails.
    // Resolve the absolute path via __dirname (CJS), convert to file URL, then import.
    const entry = resolve(__dirname, '..', '..', 'node_modules',
      '@mariozechner', 'pi-coding-agent', 'dist', 'index.js')
    const url = pathToFileURL(entry).href
    _piCache = await (Function(
      'return import(' + JSON.stringify(url) + ')'
    )() as Promise<PISdk>)
  }
  return _piCache
}

export { loadPISdk }
