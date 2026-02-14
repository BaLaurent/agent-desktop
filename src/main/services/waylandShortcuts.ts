import dbus, { type MessageBus, type Message, MessageType, Variant } from 'dbus-next'
import { execFile } from 'child_process'

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

function hyprctl(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('hyprctl', args, { timeout: 5000 }, (err, stdout) => {
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
        return false
      }
      console.warn(`[waylandShortcuts] Attempt ${retries} failed, retrying in ${RETRY_DELAY_MS}ms...`, err)
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    }
  }
  return false
}

async function tryRegister(
  shortcuts: Array<{ id: string; accelerator: string; description: string }>,
  onActivated: (shortcutId: string) => void
): Promise<boolean> {
  bus = dbus.sessionBus()

  // Wait for the D-Bus Hello handshake to complete — bus.name is null until then
  if (!bus.name) {
    await new Promise<void>((resolve, reject) => {
      bus!.once('connect', () => resolve())
      bus!.once('error', (err: Error) => reject(err))
    })
  }
  busName = bus.name!.slice(1).replace(/\./g, '_')

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
    cleanup()
    return false
  }

  sessionPath = createResp.results?.session_handle?.value as string
  if (!sessionPath) {
    console.warn('[waylandShortcuts] CreateSession returned no session handle')
    cleanup()
    return false
  }
  console.log('[waylandShortcuts] Session:', sessionPath)

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
    cleanup()
    return false
  }
  console.log('[waylandShortcuts] Bound', shortcuts.length, 'shortcuts')

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
  if (await isHyprland()) {
    for (const s of shortcuts) {
      const { mods, key } = toHyprlandBind(s.accelerator)
      const bindArgs = `${mods},${key},global,:${s.id}`
      try {
        await hyprctl(['keyword', 'bind', bindArgs])
        hyprlandBinds.push(`${mods},${key}`)
        console.log('[waylandShortcuts] hyprctl bind:', bindArgs)
      } catch (err) {
        console.warn('[waylandShortcuts] hyprctl bind failed:', bindArgs, err)
      }
    }
  }

  console.log('[waylandShortcuts] Registered via XDG Portal:', shortcuts.map((s) => s.id).join(', '))
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
    } catch {
      /* best effort */
    }
  }
  hyprlandBinds = []
}

/** Unregister all Wayland shortcuts and disconnect from D-Bus. */
export async function unregisterWaylandShortcuts(): Promise<void> {
  await removeHyprlandBinds()
  cleanup()
}
