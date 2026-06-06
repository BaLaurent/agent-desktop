import { protocol, net, app } from 'electron'
import { pathToFileURL } from 'url'
import path from 'path'
import { createLogger } from '../../core/utils/logger'

const log = createLogger('parakeet-protocol')

const SCHEME = 'agent-model'

/**
 * The Parakeet STT engine runs onnxruntime-web in a renderer Web Worker. Under the
 * packaged app the renderer is served from file://, where `fetch()` is blocked — so
 * ORT's WASM artifacts and any manually-provided model files must be delivered through
 * a privileged, fetch-capable protocol (same rationale as `agent-preview:`).
 *
 *   agent-model://ort/<file>     → onnxruntime-web/dist/<file>   (WASM runtime, dev + prod)
 *   agent-model://model/<file>   → <manual model dir>/<file>     (parakeet_modelSource='manual')
 *
 * `stream: true` lets ORT range-request the large encoder/decoder .onnx files.
 */
export function registerModelScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ])
}

/**
 * onnxruntime-web/dist. Resolve the actually-installed package so this works when node_modules is
 * hoisted to a parent (git worktrees, monorepos) where it isn't under process.cwd(). The package's
 * main entry lives in dist/, so its dirname IS the dist dir. Falls back to the cwd/getAppPath guess.
 */
function ortDistDir(): string {
  try {
    return path.dirname(require.resolve('onnxruntime-web'))
  } catch {
    const base = app.isPackaged ? app.getAppPath() : process.cwd()
    return path.join(base, 'node_modules', 'onnxruntime-web', 'dist')
  }
}

/** Bundled openWakeWord models (melspectrogram, embedding, pretrained wakewords). */
function bundledHotwordDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'hotword-models')
    : path.join(app.getAppPath(), 'resources', 'hotword-models')
}

/** Resolve a request path against a base dir, rejecting traversal outside it. */
function confine(baseDir: string, rest: string): string | null {
  const resolved = path.resolve(baseDir, rest)
  if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) return null
  return resolved
}

/**
 * Register the agent-model: handler. Must be called after app.ready.
 *
 * @param getManualModelDir Returns the user's manual model directory, or null when
 *   download mode is active / no directory is configured. Read lazily per request so
 *   settings changes take effect without re-registration.
 * @param opts.getHotwordModelDir Returns the folder holding the active custom/trained wakeword
 *   .onnx (host 'hotword-model'); null when bundled mode. Melspec/embedding always come from the
 *   bundled dir (host 'hotword').
 */
export function registerModelProtocol(
  getManualModelDir: () => string | null,
  opts?: { getHotwordModelDir?: () => string | null },
): void {
  protocol.handle(SCHEME, (request) => {
    let host: string
    let rest: string
    try {
      const url = new URL(request.url)
      host = url.host
      rest = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    } catch {
      return new Response('Bad request', { status: 400 })
    }

    let baseDir: string
    if (host === 'ort') {
      baseDir = ortDistDir()
    } else if (host === 'model') {
      const dir = getManualModelDir()
      if (!dir) return new Response('Model directory not configured', { status: 404 })
      baseDir = path.resolve(dir)
    } else if (host === 'hotword') {
      baseDir = bundledHotwordDir()
    } else if (host === 'hotword-model') {
      const dir = opts?.getHotwordModelDir?.() ?? null
      if (!dir) return new Response('Hotword model directory not configured', { status: 404 })
      baseDir = path.resolve(dir)
    } else {
      return new Response('Not found', { status: 404 })
    }

    const filePath = confine(baseDir, rest)
    if (!filePath) {
      log.warn('rejected: path traversal', { url: request.url })
      return new Response('Forbidden', { status: 403 })
    }

    // A missing file (e.g. wake-word models not downloaded yet) otherwise surfaces as a raw
    // net::ERR_FILE_NOT_FOUND in the main process; return a clean 404 the worker can report.
    return net.fetch(pathToFileURL(filePath).href).catch(() => {
      log.warn('model file not found', { url: request.url, filePath })
      return new Response('Not found', { status: 404 })
    })
  })
}
