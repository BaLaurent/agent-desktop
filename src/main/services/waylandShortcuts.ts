import dbus, { type MessageBus, type Message, MessageType, Variant } from 'dbus-next'
import { execFile } from 'child_process'
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

/**
 * Register global shortcuts via the XDG Desktop Portal (Wayland).
 *
 * On Hyprland, the portal doesn't auto-assign keybindings from preferred_trigger.
 * Instead, we register shortcut IDs with the portal, then use `hyprctl keyword bind`
 * to create the actual keybindings that dispatch to the portal via the `global` action.
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
  logToFile(`tryRegister: DBUS_SESSION_BUS_ADDRESS=${process.env.DBUS_SESSION_BUS_ADDRESS || '(unset)'}`)
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
    cleanup()
    return false
  }

  sessionPath = createResp.results?.session_handle?.value as string
  if (!sessionPath) {
    console.warn('[waylandShortcuts] CreateSession returned no session handle')
    logToFile('CreateSession returned no session handle')
    cleanup()
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
    cleanup()
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

  // 4. On Hyprland, configure keybindings via hyprctl so key presses
  //    dispatch the `global` action to the portal. Format: `:shortcut-id`
  //    (colon prefix = empty appid, matching our portal session).
  const hypr = await isHyprland()
  logToFile(`isHyprland: ${hypr}`)
  if (hypr) {
    let successCount = 0
    for (const s of shortcuts) {
      const { mods, key } = toHyprlandBind(s.accelerator)
      // Remove any stale binding for this key combo (survives app restarts)
      try { await hyprctl(['keyword', 'unbind', `${mods},${key}`]) } catch { /* may not exist */ }
      const bindArgs = `${mods},${key},global,:${s.id}`
      try {
        const out = await hyprctl(['keyword', 'bind', bindArgs])
        hyprlandBinds.push(`${mods},${key}`)
        console.log('[waylandShortcuts] hyprctl bind:', bindArgs)
        logToFile(`hyprctl bind OK: ${bindArgs} → ${out}`)
        successCount++
      } catch (err) {
        console.warn('[waylandShortcuts] hyprctl bind failed:', bindArgs, err)
        logToFile(`hyprctl bind FAILED: ${bindArgs} → ${err}`)
      }
    }
    if (successCount === 0) {
      console.error('[waylandShortcuts] All hyprctl binds failed — shortcuts will not work')
      logToFile('All hyprctl binds failed')
      cleanup()
      return false
    } else if (successCount < shortcuts.length) {
      console.warn(`[waylandShortcuts] ${successCount}/${shortcuts.length} hyprctl binds succeeded (partial)`)
      logToFile(`Partial: ${successCount}/${shortcuts.length} binds succeeded`)
    }
  }

  console.log('[waylandShortcuts] Registered via XDG Portal:', shortcuts.map((s) => s.id).join(', '))
  logToFile(`REGISTERED: ${shortcuts.map((s) => s.id).join(', ')}`)
  return true
}

function cleanup(): void {
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
 * Rebind Hyprland keybindings without recreating the D-Bus session.
 *
 * When only the key combinations change (not the shortcut IDs), we can skip
 * the full session teardown/rebuild. The portal session and Activated signal
 * listener stay intact — only the hyprctl `global` bindings are updated.
 *
 * @returns true if rebind succeeded, false if no active session exists
 */
export async function rebindWaylandShortcuts(
  shortcuts: Array<{ id: string; accelerator: string }>
): Promise<boolean> {
  if (!sessionPath || !bus) return false

  await removeHyprlandBinds()

  const hypr = await isHyprland()
  if (!hypr) return true // non-Hyprland Wayland — portal handles bindings natively

  logToFile(`rebindWaylandShortcuts: updating ${shortcuts.length} hyprctl binds (session intact)`)
  let successCount = 0
  for (const s of shortcuts) {
    const { mods, key } = toHyprlandBind(s.accelerator)
    // Remove any stale binding for this key combo (survives app restarts)
    try { await hyprctl(['keyword', 'unbind', `${mods},${key}`]) } catch { /* may not exist */ }
    const bindArgs = `${mods},${key},global,:${s.id}`
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

/** Unregister all Wayland shortcuts and disconnect from D-Bus. */
export async function unregisterWaylandShortcuts(): Promise<void> {
  await removeHyprlandBinds()
  cleanup()
}
