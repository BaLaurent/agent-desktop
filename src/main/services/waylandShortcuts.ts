import dbus, { type MessageBus, type Message, MessageType, Variant } from 'dbus-next'
import { execFile, execFileSync } from 'child_process'
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { findBinaryInPath } from '../utils/env'

/** Append a timestamped line to shortcuts.log */
function logToFile(msg: string): void {
  try {
    const logPath = path.join(app.getPath('userData'), 'shortcuts.log')
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] [wayland] ${msg}\n`)
  } catch {
    // best effort
  }
}

let bus: MessageBus | null = null
let busName = ''
let sessionPath: string | null = null
let messageHandler: ((msg: Message) => void) | null = null
let hyprlandBinds: string[] = []

// FIFO-based shortcut activation (Hyprland only)
let fifoPath: string | null = null
let fifoFd: number | null = null
let fifoStream: fs.ReadStream | null = null
let fifoActive = false

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 5000
const RESPONSE_TIMEOUT_MS = 10000

/**
 * Convert Electron accelerator format to Hyprland bind format.
 * Electron: "Alt+Shift+Space" → Hyprland: ["ALT SHIFT", "space"]
 */
function toHyprlandBind(accelerator: string): { mods: string; key: string } {
  const parts = accelerator.split('+')
  const modifiers: string[] = []
  let key = ''

  for (const part of parts) {
    const lower = part.trim().toLowerCase()
    if (['ctrl', 'control', 'commandorcontrol'].includes(lower)) {
      modifiers.push('CTRL')
    } else if (['alt', 'option'].includes(lower)) {
      modifiers.push('ALT')
    } else if (lower === 'shift') {
      modifiers.push('SHIFT')
    } else if (['super', 'meta', 'command', 'cmd'].includes(lower)) {
      modifiers.push('SUPER')
    } else {
      key = lower
    }
  }

  return { mods: modifiers.join(' '), key }
}

// Cache the resolved hyprctl absolute path (undefined = not yet resolved)
let hyprctlPath: string | null | undefined = undefined

function resolveHyprctl(): string | null {
  if (hyprctlPath === undefined) {
    hyprctlPath = findBinaryInPath('hyprctl')
    if (hyprctlPath) {
      console.log('[waylandShortcuts] hyprctl found at:', hyprctlPath)
    } else {
      console.warn('[waylandShortcuts] hyprctl not found in PATH')
    }
  }
  return hyprctlPath
}

function hyprctl(args: string[]): Promise<string> {
  const binary = resolveHyprctl()
  if (!binary) return Promise.reject(new Error('hyprctl not found in PATH'))
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: 5000 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout.trim())
    })
  })
}

/** Check if Hyprland compositor is running (hyprctl is available and responsive). */
async function isHyprland(): Promise<boolean> {
  try {
    await hyprctl(['version'])
    return true
  } catch {
    return false
  }
}

// ─── FIFO-based shortcut activation (bypasses D-Bus signal reception) ───

/**
 * Get the FIFO path for shortcut activation.
 * Uses XDG_RUNTIME_DIR (/run/user/UID) — tmpfs, per-user, fast.
 */
function getFifoPath(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`
  return path.join(runtimeDir, 'agent-desktop-shortcuts.pipe')
}

/**
 * Create a FIFO and open it for reading.
 * Uses O_RDWR to prevent EOF when writers disconnect.
 */
function createShortcutPipe(onActivated: (shortcutId: string) => void): boolean {
  const pipePath = getFifoPath()

  try {
    // Remove stale FIFO from previous run
    try { fs.unlinkSync(pipePath) } catch { /* doesn't exist */ }

    // Create FIFO (named pipe)
    execFileSync('mkfifo', [pipePath], { timeout: 5000 })
    logToFile(`FIFO created: ${pipePath}`)

    // Open with O_RDWR only — keeps pipe open (no EOF when writers disconnect).
    // Do NOT use O_NONBLOCK: it causes EAGAIN errors with createReadStream.
    // O_RDWR on a FIFO never blocks on open() (both endpoints satisfied by same fd),
    // and libuv handles async reads via its threadpool.
    const fd = fs.openSync(pipePath, fs.constants.O_RDWR)

    const stream = fs.createReadStream('', { fd, encoding: 'utf8', autoClose: false })
    let buffer = ''

    stream.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // keep incomplete line in buffer
      for (const line of lines) {
        const id = line.trim()
        if (id) {
          console.log('[waylandShortcuts] FIFO activated:', id)
          logToFile(`FIFO activated: ${id}`)
          onActivated(id)
        }
      }
    })

    stream.on('error', (err) => {
      console.error('[waylandShortcuts] FIFO read error:', err)
      logToFile(`FIFO error: ${err}`)
    })

    fifoPath = pipePath
    fifoFd = fd
    fifoStream = stream
    fifoActive = true

    return true
  } catch (err) {
    console.error('[waylandShortcuts] Failed to create FIFO:', err)
    logToFile(`FIFO creation FAILED: ${err}`)
    return false
  }
}

/** Close and remove the FIFO. */
function destroyShortcutPipe(): void {
  if (fifoStream) {
    try { fifoStream.destroy() } catch { /* best effort */ }
    fifoStream = null
  }
  if (fifoFd !== null) {
    try { fs.closeSync(fifoFd) } catch { /* best effort */ }
    fifoFd = null
  }
  if (fifoPath) {
    try { fs.unlinkSync(fifoPath) } catch { /* best effort */ }
    logToFile(`FIFO destroyed: ${fifoPath}`)
    fifoPath = null
  }
  fifoActive = false
}

// ─── Portal-based registration (for non-Hyprland compositors) ───

/**
 * Wait for a Portal Response signal on a specific request path.
 *
 * Portal methods return a request object path. The actual result arrives
 * via a Response signal on that path. response=0 means success.
 *
 * Must use raw bus message listener + AddMatch — getProxyObject fails on
 * request paths because xdg-desktop-portal-hyprland doesn't expose the
 * org.freedesktop.portal.Request interface for introspection.
 */
function waitForResponse(token: string): Promise<{ response: number; results: Record<string, Variant> } | null> {
  if (!bus) return Promise.resolve(null)
  const expectedPath = `/org/freedesktop/portal/desktop/request/${busName}/${token}`
  const msgBus = bus

  return new Promise(async (resolve) => {
    const timeout = setTimeout(() => {
      if (msgBus) msgBus.removeListener('message', handler)
      resolve(null)
    }, RESPONSE_TIMEOUT_MS)

    function handler(msg: Message): void {
      if (
        msg.type === MessageType.SIGNAL &&
        msg.interface === 'org.freedesktop.portal.Request' &&
        msg.member === 'Response' &&
        msg.path === expectedPath
      ) {
        clearTimeout(timeout)
        msgBus.removeListener('message', handler)
        const [response, results] = msg.body
        resolve({ response, results })
      }
    }

    msgBus.on('message', handler)

    // Register signal match rule so the bus actually delivers the signal to us
    try {
      await msgBus.call(
        new dbus.Message({
          type: MessageType.METHOD_CALL,
          destination: 'org.freedesktop.DBus',
          path: '/org/freedesktop/DBus',
          interface: 'org.freedesktop.DBus',
          member: 'AddMatch',
          signature: 's',
          body: [`type='signal',interface='org.freedesktop.portal.Request',member='Response',path='${expectedPath}'`],
        })
      )
    } catch {
      clearTimeout(timeout)
      msgBus.removeListener('message', handler)
      resolve(null)
    }
  })
}

// ─── Registration entry points ───

/**
 * Register global shortcuts via the XDG Desktop Portal (Wayland).
 *
 * On Hyprland: bypasses D-Bus signal reception (broken in Electron's event loop)
 * and uses a FIFO (named pipe) + hyprctl exec dispatcher instead.
 *
 * On non-Hyprland: uses the standard portal Activated signal via D-Bus.
 *
 * @returns true if the portal accepted the shortcuts, false if unavailable
 */
export async function registerWaylandShortcuts(
  shortcuts: Array<{ id: string; accelerator: string; description: string }>,
  onActivated: (shortcutId: string) => void
): Promise<boolean> {
  await unregisterWaylandShortcuts()

  let retries = 0
  while (retries <= MAX_RETRIES) {
    try {
      return await tryRegister(shortcuts, onActivated)
    } catch (err) {
      retries++
      if (retries > MAX_RETRIES) {
        console.warn('[waylandShortcuts] All retries exhausted:', err)
        logToFile(`All ${MAX_RETRIES} retries exhausted: ${err}`)
        return false
      }
      console.warn(`[waylandShortcuts] Attempt ${retries} failed, retrying in ${RETRY_DELAY_MS}ms...`, err)
      logToFile(`Attempt ${retries} failed: ${err}`)
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    }
  }
  return false
}

async function tryRegister(
  shortcuts: Array<{ id: string; accelerator: string; description: string }>,
  onActivated: (shortcutId: string) => void
): Promise<boolean> {
  const hypr = await isHyprland()
  logToFile(`isHyprland: ${hypr}`)

  if (hypr) {
    return tryRegisterHyprland(shortcuts, onActivated)
  }

  return tryRegisterPortal(shortcuts, onActivated)
}

/**
 * Hyprland path: FIFO + hyprctl exec dispatcher.
 * Bypasses D-Bus signal reception entirely — the most reliable approach
 * because dbus-next's signal handling doesn't work in Electron's event loop.
 */
async function tryRegisterHyprland(
  shortcuts: Array<{ id: string; accelerator: string; description: string }>,
  onActivated: (shortcutId: string) => void
): Promise<boolean> {
  const pipePath = getFifoPath()

  // 1. Create FIFO for receiving shortcut activations
  if (!createShortcutPipe(onActivated)) {
    logToFile('Hyprland: FIFO creation failed, aborting')
    return false
  }

  // 2. Bind shortcuts via hyprctl with exec dispatcher
  //    When key is pressed, Hyprland runs: echo <shortcut-id> > <fifo-path>
  let successCount = 0
  for (const s of shortcuts) {
    const { mods, key } = toHyprlandBind(s.accelerator)
    // Remove any stale binding for this key combo (survives app restarts)
    try { await hyprctl(['keyword', 'unbind', `${mods},${key}`]) } catch { /* may not exist */ }
    // Use exec dispatcher with echo to write shortcut ID to FIFO
    const bindArgs = `${mods},${key},exec,echo ${s.id} > ${pipePath}`
    try {
      const out = await hyprctl(['keyword', 'bind', bindArgs])
      hyprlandBinds.push(`${mods},${key}`)
      console.log('[waylandShortcuts] hyprctl bind (exec):', bindArgs)
      logToFile(`hyprctl bind OK (exec): ${bindArgs} → ${out}`)
      successCount++
    } catch (err) {
      console.warn('[waylandShortcuts] hyprctl bind failed:', bindArgs, err)
      logToFile(`hyprctl bind FAILED: ${bindArgs} → ${err}`)
    }
  }

  if (successCount === 0) {
    console.error('[waylandShortcuts] All hyprctl binds failed — shortcuts will not work')
    logToFile('All hyprctl binds failed')
    destroyShortcutPipe()
    return false
  }
  if (successCount < shortcuts.length) {
    console.warn(`[waylandShortcuts] ${successCount}/${shortcuts.length} hyprctl binds succeeded (partial)`)
    logToFile(`Partial: ${successCount}/${shortcuts.length} binds succeeded`)
  }

  console.log('[waylandShortcuts] Registered via Hyprland exec+FIFO:', shortcuts.map((s) => s.id).join(', '))
  logToFile(`REGISTERED (Hyprland exec+FIFO): ${shortcuts.map((s) => s.id).join(', ')}`)
  return true
}

/**
 * Non-Hyprland path: standard XDG Desktop Portal with D-Bus Activated signal.
 * Used for GNOME, KDE, Sway, etc. where the portal handles keybinding natively.
 */
async function tryRegisterPortal(
  shortcuts: Array<{ id: string; accelerator: string; description: string }>,
  onActivated: (shortcutId: string) => void
): Promise<boolean> {
  logToFile(`tryRegisterPortal: DBUS_SESSION_BUS_ADDRESS=${process.env.DBUS_SESSION_BUS_ADDRESS || '(unset)'}`)
  bus = dbus.sessionBus()

  // Wait for the D-Bus Hello handshake to complete — bus.name is null until then
  if (!bus.name) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('D-Bus connect timeout after 10s')), 10_000)
      bus!.once('connect', () => { clearTimeout(timeout); resolve() })
      bus!.once('error', (err: Error) => { clearTimeout(timeout); reject(err) })
    })
  }
  busName = bus.name!.slice(1).replace(/\./g, '_')
  logToFile(`D-Bus connected: name=${bus.name} busName=${busName}`)

  const proxy = await bus.getProxyObject(
    'org.freedesktop.portal.Desktop',
    '/org/freedesktop/portal/desktop'
  )

  const gs = proxy.getInterface('org.freedesktop.portal.GlobalShortcuts')

  // 1. CreateSession
  const createToken = `agent_req_${process.pid}`
  const sessionToken = `agent_sess_${process.pid}`
  const createResponseP = waitForResponse(createToken)

  await gs.CreateSession({
    session_handle_token: new Variant('s', sessionToken),
    handle_token: new Variant('s', createToken),
  })

  const createResp = await createResponseP
  if (!createResp || createResp.response !== 0) {
    console.warn('[waylandShortcuts] CreateSession failed, response:', createResp?.response)
    logToFile(`CreateSession FAILED: response=${createResp?.response ?? 'null (timeout)'}`)
    cleanupBus()
    return false
  }

  sessionPath = createResp.results?.session_handle?.value as string
  if (!sessionPath) {
    console.warn('[waylandShortcuts] CreateSession returned no session handle')
    logToFile('CreateSession returned no session handle')
    cleanupBus()
    return false
  }
  console.log('[waylandShortcuts] Session:', sessionPath)
  logToFile(`CreateSession OK: ${sessionPath}`)

  // 2. BindShortcuts — do NOT include preferred_trigger (unsupported by Hyprland portal)
  const bindToken = `agent_bind_${process.pid}`
  const bindResponseP = waitForResponse(bindToken)

  const shortcutSpecs = shortcuts.map((s) => [
    s.id,
    { description: new Variant('s', s.description) },
  ])

  await gs.BindShortcuts(sessionPath, shortcutSpecs, '', {
    handle_token: new Variant('s', bindToken),
  })

  const bindResp = await bindResponseP
  if (!bindResp || bindResp.response !== 0) {
    console.warn('[waylandShortcuts] BindShortcuts failed, response:', bindResp?.response)
    logToFile(`BindShortcuts FAILED: response=${bindResp?.response ?? 'null (timeout)'}`)
    cleanupBus()
    return false
  }
  console.log('[waylandShortcuts] Bound', shortcuts.length, 'shortcuts')
  logToFile(`BindShortcuts OK: ${shortcuts.length} shortcuts`)

  // 3. Listen for Activated signal via raw bus messages
  await bus.call(
    new dbus.Message({
      type: MessageType.METHOD_CALL,
      destination: 'org.freedesktop.DBus',
      path: '/org/freedesktop/DBus',
      interface: 'org.freedesktop.DBus',
      member: 'AddMatch',
      signature: 's',
      body: [`type='signal',interface='org.freedesktop.portal.GlobalShortcuts',member='Activated'`],
    })
  )

  messageHandler = (msg: Message) => {
    if (
      msg.type === MessageType.SIGNAL &&
      msg.interface === 'org.freedesktop.portal.GlobalShortcuts' &&
      msg.member === 'Activated'
    ) {
      // Activated(session_handle: o, shortcut_id: s, timestamp: t, options: a{sv})
      const shortcutId = msg.body?.[1] as string
      if (shortcutId) {
        console.log('[waylandShortcuts] Activated:', shortcutId)
        onActivated(shortcutId)
      }
    }
  }
  bus.on('message', messageHandler)

  console.log('[waylandShortcuts] Registered via XDG Portal:', shortcuts.map((s) => s.id).join(', '))
  logToFile(`REGISTERED (Portal): ${shortcuts.map((s) => s.id).join(', ')}`)
  return true
}

function cleanupBus(): void {
  if (messageHandler && bus) {
    bus.removeListener('message', messageHandler)
    messageHandler = null
  }
  sessionPath = null
  if (bus) {
    try {
      bus.disconnect()
    } catch {
      /* already disconnected */
    }
    bus = null
  }
  busName = ''
}

/** Remove Hyprland keybindings created by us. */
async function removeHyprlandBinds(): Promise<void> {
  for (const bind of hyprlandBinds) {
    try {
      await hyprctl(['keyword', 'unbind', bind])
      logToFile(`hyprctl unbind OK: ${bind}`)
    } catch {
      logToFile(`hyprctl unbind FAILED (best effort): ${bind}`)
    }
  }
  hyprlandBinds = []
}

/**
 * Rebind Hyprland keybindings without recreating the FIFO or D-Bus session.
 *
 * When only the key combinations change (not the shortcut IDs), we can skip
 * the full teardown/rebuild. The FIFO (or portal session) stays intact — only
 * the hyprctl bindings are updated.
 *
 * @returns true if rebind succeeded, false if no active session exists
 */
export async function rebindWaylandShortcuts(
  shortcuts: Array<{ id: string; accelerator: string }>
): Promise<boolean> {
  // Need either FIFO or portal session active
  if (!fifoActive && !sessionPath) return false

  await removeHyprlandBinds()

  const hypr = await isHyprland()
  if (!hypr) return true // non-Hyprland Wayland — portal handles bindings natively

  const pipePath = fifoActive ? getFifoPath() : null

  logToFile(`rebindWaylandShortcuts: updating ${shortcuts.length} hyprctl binds (fifo=${!!pipePath})`)
  let successCount = 0
  for (const s of shortcuts) {
    const { mods, key } = toHyprlandBind(s.accelerator)
    // Remove any stale binding for this key combo (survives app restarts)
    try { await hyprctl(['keyword', 'unbind', `${mods},${key}`]) } catch { /* may not exist */ }
    // Use exec+FIFO if active, otherwise global+portal
    const bindArgs = pipePath
      ? `${mods},${key},exec,echo ${s.id} > ${pipePath}`
      : `${mods},${key},global,:${s.id}`
    try {
      const out = await hyprctl(['keyword', 'bind', bindArgs])
      hyprlandBinds.push(`${mods},${key}`)
      console.log('[waylandShortcuts] hyprctl rebind:', bindArgs)
      logToFile(`hyprctl rebind OK: ${bindArgs} → ${out}`)
      successCount++
    } catch (err) {
      console.warn('[waylandShortcuts] hyprctl rebind failed:', bindArgs, err)
      logToFile(`hyprctl rebind FAILED: ${bindArgs} → ${err}`)
    }
  }

  if (successCount === 0) {
    console.error('[waylandShortcuts] All hyprctl rebinds failed')
    logToFile('All hyprctl rebinds failed')
    return false
  }
  if (successCount < shortcuts.length) {
    console.warn(`[waylandShortcuts] ${successCount}/${shortcuts.length} hyprctl rebinds succeeded (partial)`)
    logToFile(`Partial rebind: ${successCount}/${shortcuts.length} succeeded`)
  }
  return true
}

/** Unregister all Wayland shortcuts and clean up resources. */
export async function unregisterWaylandShortcuts(): Promise<void> {
  await removeHyprlandBinds()
  destroyShortcutPipe()
  cleanupBus()
}
