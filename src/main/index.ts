import './utils/coloredConsole'
import { ErrorBuffer } from '../core/services/errorBuffer'
import { patchConsoleError } from './bootstrap/mainErrorCapture'
import { createLogger } from '../core/utils/logger'

const log = createLogger('main')

export const mainErrorBuffer = new ErrorBuffer()
patchConsoleError(mainErrorBuffer)

import { app, BrowserWindow, ipcMain, Menu, session, shell } from 'electron'
import type { Session } from 'electron'
import { join } from 'path'
import { AgentEngine } from '../core'
import type { Broadcaster } from '../core/ports/broadcaster'
import { getDatabase, closeDatabase } from '../core/db/database'
import { getSetting } from '../core/utils/db'
import { bridgeDispatchToIpc } from './ipc'
import { createTray, setTrayUpdateCallbacks, rebuildTrayMenu, toggleAppWindow } from './services/tray'
import { initAutoUpdater, stopAutoUpdater, checkForUpdates, installUpdate } from './services/updater'
import { setupDeepLinks } from './services/deeplink'
import { registerPreviewScheme, registerPreviewProtocol } from './services/protocol'
import { registerModelScheme, registerModelProtocol } from './services/modelProtocol'
import { registerStreamWindow } from './services/streaming'
import { cleanupPastedFiles } from './services/files'
import { registerGlobalShortcuts, unregisterAll as unregisterGlobalShortcuts } from './services/globalShortcuts'
import { showOverlay } from './services/quickChat'
import { startScheduler, stopScheduler } from './services/scheduler'
import { startBridge, stopBridge } from './services/schedulerBridge'
import { shutdownAllKernels } from './services/jupyter'
import { shutdownAllSessions } from './services/sessionManager'
import { stop as stopTts } from './services/tts'
import { startServer, stopServer } from '../core/services/webServer'
import { loadFromDisk, attachPersistence } from './services/errorBufferPersist'
import { sendBugReport } from './services/bugReport'
import { scrub as scrubLog } from './services/logScrubber'
import { setMainContext } from './mainContext'

// Custom protocols — must be registered before app.ready
registerPreviewScheme()
registerModelScheme()

// Enrich PATH/HOME for AppImage and non-standard environments — before GPU flags
// (enrichEnvironment discovers WAYLAND_DISPLAY which affects Ozone platform choice)
import { enrichEnvironment } from './utils/env'
enrichEnvironment()

// GPU / Ozone flags — Linux only
if (process.platform === 'linux') {
  // Force Wayland backend when a Wayland compositor is running.
  // 'auto' hint tries X11 first when DISPLAY is set (XWayland), which is wrong on Hyprland/Sway.
  if (process.env.WAYLAND_DISPLAY) {
    app.commandLine.appendSwitch('ozone-platform', 'wayland')
  } else {
    app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
  }
  // Disable GPU compositing only: ANGLE+OpenGL fails on eglCreateImage with Ozone/Wayland
  // buffer import, ANGLE+Vulkan crashes Hyprland's EGL compositor (cross-API fence sync).
  // GPU remains available for WebGL, 3D previews, and CSS transforms.
  app.commandLine.appendSwitch('disable-gpu-compositing')
}

// Windows taskbar identity — affects notifications, jump lists, taskbar pinning.
// Must happen before any BrowserWindow is created.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.agent.desktop')
}

// --- Security hardening -----------------------------------------------------
//
// Single-patch consolidation of the Electron hardening review
// (.claude/reviews/2026-04-23/07-electron-packaging.md +
//  .claude/reviews/2026-04-23/01-security.md #14, #18).
//
// Kept as pure exported helpers so tests can exercise them against mock
// session / window objects without spinning up an Electron runtime.

/**
 * Content-Security-Policy served on every main-window response.
 *
 * Tight enough to foreclose script injection (`script-src 'self'`) while
 * still allowing the preview protocol to serve images/stylesheets into
 * iframes. Crucially, `connect-src` does NOT list `agent-preview:` — a
 * compromised renderer therefore cannot fetch arbitrary files through
 * the preview channel (e.g. `fetch('agent-preview:///home/<u>/.ssh/id_rsa')`).
 */
export const CSP_POLICY = [
  "default-src 'self' agent-preview: agent-model:",
  // 'wasm-unsafe-eval' is the narrow CSP token that permits WebAssembly.compile/
  // instantiate (NOT eval/Function) — required for the Parakeet STT engine, which
  // runs onnxruntime-web in the renderer. Far weaker than 'unsafe-eval'.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: agent-preview:",
  // agent-model: serves onnxruntime-web's WASM artifacts AND manually-provided
  // Parakeet model files to the STT worker (file:// can't be fetch()ed in prod, so a
  // privileged protocol is required — same rationale as agent-preview:).
  // https: already covers the fromHub() HuggingFace download path.
  "connect-src 'self' ws: wss: https: agent-model:",
  // The Parakeet STT worker (Vite module worker, 'self'/blob:) plus onnxruntime-web's
  // internal threaded helper worker, which ORT may spawn from the wasmPaths origin
  // (agent-model:) or a blob: URL.
  "worker-src 'self' blob: agent-model:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
].join('; ')

/**
 * Renderer permission allowlist. Anything not in this set is denied when
 * the page calls a gated API (navigator.mediaDevices, Notification, etc.).
 */
export const PERMISSION_ALLOWLIST: ReadonlySet<string> = new Set([
  'media',
  'notifications',
  'clipboard-sanitized-write',
])

/** Install CSP + permission filter on an Electron Session. */
export function applySessionHardening(target: Session): void {
  target.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP_POLICY],
      },
    })
  })
  target.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(PERMISSION_ALLOWLIST.has(permission))
  })
}

/**
 * Lock a BrowserWindow to its launch origin:
 *   - `window.open()` / `target=_blank` is denied in-window; http(s) URLs
 *     are farmed out to the OS shell.
 *   - Cross-origin top-level navigations are blocked; http(s) URLs are
 *     opened externally, everything else is silently prevented.
 *
 * MUST be called before `loadURL`/`loadFile`, otherwise the first
 * navigation slips past the guards.
 */
export function hardenBrowserWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (ev, targetUrl) => {
    const currentUrl = win.webContents.getURL()
    if (!currentUrl) return
    try {
      if (new URL(targetUrl).origin !== new URL(currentUrl).origin) {
        ev.preventDefault()
        if (/^https?:\/\//i.test(targetUrl)) shell.openExternal(targetUrl)
      }
    } catch {
      // Unparseable target → safest to refuse the navigation outright.
      ev.preventDefault()
    }
  })
}

/**
 * Record renderer load failures so a blank/grey window leaves a trail.
 *
 * A window that renders grey almost always means the document or one of
 * its module scripts never loaded. `did-fail-load` carries the Chromium
 * error code + the URL that failed — enough to tell a CSP block
 * (`Refused to load…`), a refused connection (-102), and a missing file
 * (-6) apart *after the fact*, without reproducing.
 *
 * Routed through `console.error` on purpose: `patchConsoleError`
 * (installed at module load) both prints it to the terminal AND pushes it
 * into `mainErrorBuffer`, so it persists to `error-buffer.json` and rides
 * along in bug reports. Sub-frame failures and `ERR_ABORTED` (-3, fired on
 * ordinary navigations / HMR) are dropped as noise.
 */
export function logRendererLoadFailures(win: BrowserWindow): void {
  win.webContents.on('did-fail-load', (_ev, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    console.error(`[renderer] did-fail-load ${errorCode} ${errorDescription} — ${validatedURL}`)
  })
}

let mainWindow: BrowserWindow | null = null
let isShuttingDown = false

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

// Window control IPC — registered once, use module-level mainWindow via closure
let windowIpcRegistered = false
function registerWindowIpc(): void {
  if (windowIpcRegistered) return
  windowIpcRegistered = true

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window:close', () => {
    try {
      const db = getDatabase()
      if (getSetting(db as any, 'minimizeToTray') === 'true') {
        mainWindow?.hide()
        return
      }
    } catch {
      // Fall through to close
    }
    mainWindow?.close()
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required: electron-vite preload needs Node.js access for ipcRenderer
    },
  })

  registerWindowIpc()

  // Origin-lock the window BEFORE loadURL/loadFile — otherwise the first
  // navigation dispatches before setWindowOpenHandler/will-navigate are wired.
  hardenBrowserWindow(mainWindow)
  logRendererLoadFailures(mainWindow)

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Single-instance guard. This is also the single-WRITER guarantee: agent.db is
// sql.js (whole file held in RAM, rewritten wholesale on flush), so a second
// live instance would silently revert the first's changes. If another instance
// holds the lock, this one quits instead of running as a co-equal writer.
// (The old "kill the existing instance and take over" path was racy — its
// 500ms SIGTERM grace let two instances coexist and clobber each other.)
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // Dev-only orphan watchdog. electron-vite restarts (on a main-process file change) don't always
  // terminate the previous Electron process — it gets reparented to init/systemd and lingers as a
  // zombie that keeps holding the IndexedDB LOCK, so the next instance can't open storage. Detect
  // the reparenting (our parent PID changes once electron-vite dies) and self-exit. Skipped in the
  // packaged app, where there is no supervising parent to lose.
  if (!app.isPackaged) {
    const parentPid = process.ppid
    const orphanWatch = setInterval(() => {
      // NOTE: process.ppid is cached at startup and does NOT update on reparenting, so we can't
      // compare it. Instead poll whether our original parent (electron-vite) still exists — signal 0
      // checks liveness without sending anything; ESRCH means it's gone and we've been orphaned.
      try {
        process.kill(parentPid, 0)
      } catch {
        app.exit(0)
      }
    }, 1000)
    orphanWatch.unref?.()
  }

  app.whenReady().then(async () => {
    // Register the Claude Agent SDK with Core BEFORE any engine init.
    // Core's anthropic.ts is now a registry-only module — entry points own SDK resolution.
    // Function trick avoids esbuild bundling the SDK into asar (where node can't read it).
    {
      const { registerAgentSDK } = await import('../core/services/anthropic')
      const sdk = await (Function('return import("@anthropic-ai/claude-agent-sdk")')() as Promise<typeof import('@anthropic-ai/claude-agent-sdk')>)
      registerAgentSDK(sdk)
    }

    registerPreviewProtocol()

    // agent-model: serves the openWakeWord hotword worker its onnxruntime-web WASM runtime
    // (host 'ort') and the hotword model files (hosts 'hotword' / 'hotword-model').
    registerModelProtocol(
      {
        getHotwordModelDir: () => {
          try {
            const db = getDatabase()
            if (getSetting(db as any, 'hotword_modelSource') !== 'manual') return null
            const dir = getSetting(db as any, 'hotword_modelPath')
            return dir && dir.trim() ? dir : null
          } catch {
            return null
          }
        },
      },
    )

    // Security hardening — session CSP + permission filter + app-level
    // guards. Must run after ready; defaultSession is not available before.
    //
    // CSP `script-src 'self'` would block Vite HMR's inline scripts in dev
    // (React preamble injected by @vitejs/plugin-react, /@vite/client wiring).
    // ELECTRON_RENDERER_URL is set by electron-vite only when a dev server
    // is attached, so skipping CSP under that signal keeps the prod
    // hardening tight without breaking dev iteration.
    if (!process.env.ELECTRON_RENDERER_URL) {
      applySessionHardening(session.defaultSession)
    }
    if (app.isPackaged) Menu.setApplicationMenu(null)
    app.on('certificate-error', (_e, _wc, _url, _err, _cert, cb) => cb(false))
    app.on('render-process-gone', (_e, _wc, details) => {
      log.error('renderer crashed', undefined, { details })
    })
    app.on('child-process-gone', (_e, details) => {
      // Electron 33 folds the former `gpu-process-crashed` event into
      // child-process-gone with type==='GPU'.
      if (details.type === 'GPU') log.error('gpu crashed', undefined, { details })
      else log.error('child-process crashed', undefined, { details })
    })

    const errorBufferPath = join(app.getPath('userData'), 'error-buffer.json')
    await loadFromDisk(mainErrorBuffer, errorBufferPath)
    attachPersistence(mainErrorBuffer, errorBufferPath)
    const dbPath = join(app.getPath('userData'), 'agent.db')
    const wasmPath = app.isPackaged ? join(process.resourcesPath, 'sql-wasm.wasm') : undefined

    // Broadcaster adapter — forwards engine events to Electron renderer
    const electronBroadcaster: Broadcaster = {
      broadcast(channel: string, data: unknown): void {
        const win = getMainWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send(channel, data)
        }
      },
    }

    // HookRunner adapter — delegates to Electron-side hook execution
    const { electronHookRunner } = await import('./services/hookRunner')

    const engine = new AgentEngine({
      dbPath,
      wasmPath,
      themesDir: join(app.getPath('home'), '.agent-desktop', 'themes'),
      broadcaster: electronBroadcaster,
      hookRunner: electronHookRunner,
      bugReport: {
        mainBuffer: mainErrorBuffer,
        getMetadata: async () => {
          // engine.db is valid after init(); this closure is only invoked at
          // handler call time, never at registration time.
          const db = engine.db as any
          return {
            version: app.getVersion(),
            platform: `${process.platform} (${process.arch})`,
            session:
              process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY
                ? ('Wayland' as const)
                : process.env.DISPLAY
                  ? ('X11' as const)
                  : ('unknown' as const),
            electron: process.versions.electron ?? 'unknown',
            node: process.versions.node ?? 'unknown',
            aiBackend: getSetting(db, 'ai_sdkBackend') || 'claude-agent-sdk',
            theme: getSetting(db, 'activeTheme') || 'default',
            webMode: process.env.AGENT_WEB_MODE ? ('yes' as const) : ('no' as const),
          }
        },
        getWebhookUrl: () =>
          ((import.meta as any).env.MAIN_VITE_BUG_WEBHOOK_URL as string | undefined) ?? '',
        sendBugReport,
        scrub: scrubLog,
      },
    })
    await engine.init()
    const db = engine.db as any

    bridgeDispatchToIpc(engine, ipcMain)

    cleanupPastedFiles().catch(() => {}) // fire-and-forget: remove stale paste temp files
    setupDeepLinks(app)
    createWindow()
    registerStreamWindow(mainWindow!)

    // Publish the main context for services. The `mainWindow` accessor uses a
    // closure so a single context object survives window recreation (close +
    // tray reopen reassigns the module-level `mainWindow` ref).
    setMainContext({
      mainWindow: () => mainWindow,
      ipcMain,
      db,
    })
    registerGlobalShortcuts(db, {
      onQuickChat: () => showOverlay('text'),
      onQuickVoice: () => showOverlay('voice'),
      onShowApp: () => toggleAppWindow(),
      onStopTts: () => stopTts(),
    })

    startBridge(db)
    startScheduler(db).catch(err => log.error('scheduler start failed', err))
    createTray(getMainWindow, createWindow)

    // Auto-start web server if configured
    if (getSetting(db, 'server_autoStart') === 'true') {
      const port = parseInt(getSetting(db, 'server_port') || '3484', 10) || 3484
      const shortCode = getSetting(db, 'server_shortCode') || undefined
      const accessMode = getSetting(db, 'server_accessMode')
      startServer(port, {
        shortCode,
        accessMode: accessMode === 'all' ? 'all' : 'lan',
        sslDir: join(app.getPath('userData'), 'ssl'),
        rendererDir: join(__dirname, '../renderer'),
        dispatch: engine.dispatch,
      }).then(() => {
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('server_enabled', 'true')").run()
      }).catch(err => log.error('web server auto-start failed', err))
    }

    if (app.isPackaged) {
      setTrayUpdateCallbacks(checkForUpdates, installUpdate)
      initAutoUpdater(getMainWindow, () => rebuildTrayMenu(true))
    }
  }).catch((err) => {
    // dialog must be required inline — not available if app.ready fails
    const { dialog } = require('electron')
    log.error('startup fatal', err)
    dialog.showErrorBox('Startup Failed', err.message || String(err))
    app.quit()
  })

  app.on('before-quit', (e) => {
    if (isShuttingDown) return
    e.preventDefault()
    isShuttingDown = true

    // Sync cleanup
    shutdownAllSessions()
    shutdownAllKernels()
    stopScheduler()
    stopBridge()
    unregisterGlobalShortcuts() // async but fire-and-forget OK
    stopAutoUpdater()
    stopTts()
    closeDatabase() // flush() + close() — ensures all pending writes are persisted

    // Async cleanup with timeout safety (3s max)
    Promise.race([
      stopServer(),
      new Promise(resolve => setTimeout(resolve, 3000)),
    ]).finally(() => app.exit())
  })

  app.on('window-all-closed', () => {
    try {
      const db = getDatabase()
      if (getSetting(db as any, 'minimizeToTray') === 'true') return
    } catch {
      // Fall through to quit
    }
    app.quit()
  })
}
