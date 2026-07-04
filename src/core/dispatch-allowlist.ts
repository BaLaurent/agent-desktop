/**
 * Dispatch origin + channel allowlist.
 *
 * Every invocation through the DispatchRegistry carries an `origin` tag
 * identifying where the call came from. Sensitive channels refuse
 * non-`electron` origins; a narrower block-list blocks specific channels
 * from reaching the WebSocket bridge at all.
 *
 * This is the canonical source of truth for the WS-reachable attack
 * surface. New handlers are opt-in: the default policy is "reachable from
 * every origin." Add entries here when a handler drives spawn, fs, git, or
 * destructive DB work.
 *
 * ─── Channel categorisation ────────────────────────────────────────────────
 *
 * Cat A — open to WS (registered in core/handlers/, reachable via engine.dispatch)
 *   auth:*, conversations:*, folders:*, settings:* (read), messages:*, files:*
 *   (read/write, gated by CWD whitelist), themes:*, commands:*, macros:*,
 *   knowledge:* (kb:listCollections, kb:getCollectionFiles), scheduler:*,
 *   tts:*, whisper:*, voice:*, system:getLogs, system:clearCache, mcp:* (read),
 *   tools:*, shortcuts:*, models:*, attachments:*, git:* (read), bug:*,
 *   webServerAuth:*
 *
 * Cat B — WS_BLOCKED_CHANNELS: credentialed control-plane; refused over WS
 *   regardless of authenticated state.
 *
 * Cat C — LOCAL_ONLY_CHANNELS: local-only desktop features; refused over
 *   WS and discord/scheduler origins even when the handler is present in
 *   engine.dispatch (mirrored there via withSanitizedErrors in main/ipc.ts).
 *
 * Note: tray:*, globalShortcuts:*, deeplink:*, protocol:*, waylandShortcuts:*,
 * webhook:*, schedulerBridge:* are NOT registered via ipcMain.handle so they
 * never enter engine.dispatch at all — no entry needed here.
 */

export type DispatchOrigin = 'local' | 'ws' | 'discord' | 'scheduler'

/**
 * Channels that MUST only be invoked from the local desktop process (i.e.
 * from a trusted renderer via ipcMain). Remote WS/Discord/scheduler
 * invocations are refused.
 *
 * Selection criteria (from 2026-04-23 security audit):
 *  - Drives subprocess spawn with attacker-controlled argv
 *  - Touches the filesystem outside the conversation CWD
 *  - Executes destructive DB operations without user confirmation
 *  - Invokes git with attacker-controlled positional arguments
 *  - Opens host-OS GUI dialogs or file manager windows
 *  - Controls Electron overlay windows (quickChat)
 *  - Manages Electron auto-updater lifecycle
 *  - Spawns/terminates local Jupyter kernels
 *  - Compiles local SCAD files
 */
// consumed by headless/index.test.ts (excluded). (suppressed below)
// fallow-ignore-next-line unused-export
export const LOCAL_ONLY_CHANNELS: ReadonlySet<string> = new Set([
  // MCP server management — arbitrary command+args, turn-key RCE via testConnection
  'mcp:addServer',
  'mcp:updateServer',
  'mcp:testConnection',
  // Destructive DB wipes — no server-side confirmation
  'system:purgeAll',
  'system:purgeConversations',
  // Terminal + session prep — spawns processes and copies filesystem trees
  'files:openTerminalHere',
  'files:prepareSession',
  // Git positional-argument injection (--upload-pack=, etc.)
  'git:fetch',
  'git:checkout',
  // System integration — opens host OS dialogs or external apps; uses event.sender
  'system:getInfo',
  'system:openExternal',
  'system:showNotification',
  'system:selectFolder',
  'system:selectFile',
  // File manager integration — launches host GUI; no meaning on mobile
  'files:revealInFileManager',
  'files:openWithDefault',
  // File deletion — destructive; mobile clients must not initiate trash ops on the host
  'files:trash',
  // Knowledge folder reveal — opens host file manager
  'kb:openKnowledgesFolder',
  // Jupyter — spawns/terminates local kernel processes; local-only
  'jupyter:startKernel',
  'jupyter:executeCell',
  'jupyter:interruptKernel',
  'jupyter:restartKernel',
  'jupyter:shutdownKernel',
  'jupyter:getStatus',
  'jupyter:detectJupyter',
  // OpenSCAD — compiles .scad files using local toolchain
  'openscad:compile',
  'openscad:validateConfig',
  // Quick Chat — Electron overlay window control
  'quickChat:getConversationId',
  'quickChat:purge',
  'quickChat:hide',
  'quickChat:setBubbleMode',
  'quickChat:reregisterShortcuts',
  // Electron auto-updater — manages app lifecycle on the host
  'updates:check',
  'updates:download',
  'updates:install',
  'updates:getStatus',
  // PI extensions — local extension registry, host filesystem
  'pi:listExtensions',
])

/**
 * Channels that the WebSocket bridge MUST never forward, regardless of
 * the authenticated-client state. These are control-plane operations
 * that a remote client has no legitimate reason to invoke on the host.
 *
 *  - server:{start,stop,getStatus} — remote clients must not manage the
 *    server they are connected through.
 *  - server:{setPassword,clearPassword} — LAN attacker must not rotate the
 *    session secret and lock out the legitimate user.
 *  - openscad:exportStl — uses `event.sender` (null over WS → crash).
 *
 * NOTE — `settings:set` was previously blocked here. It is now reachable
 * over WS so the web UI has parity with the Electron app. Per-key locking
 * (e.g. CLI `--port` override pinning `server_port`) is enforced in
 * SettingsService.set() via lockedKeys, not here. Whitelisting of valid
 * keys is enforced by ALLOWED_SETTING_KEYS in the same service.
 */
// consumed by headless/index.test.ts (excluded). (suppressed below)
// fallow-ignore-next-line unused-export
export const WS_BLOCKED_CHANNELS: ReadonlySet<string> = new Set([
  'openscad:exportStl',
  'server:clearPassword',  // credential control-plane: remote must not clear the password
  'server:getStatus',
  'server:setPassword',    // credential control-plane: remote must not rotate the session secret
  'server:start',
  'server:stop',
])

export class OriginDeniedError extends Error {
  readonly channel: string
  readonly origin: DispatchOrigin
  constructor(channel: string, origin: DispatchOrigin) {
    super(`Channel '${channel}' is not available from origin '${origin}'`)
    this.name = 'OriginDeniedError'
    this.channel = channel
    this.origin = origin
  }
}

// consumed by headless/index.test.ts (excluded). (suppressed below)
// fallow-ignore-next-line unused-export
export function isLocalOnly(channel: string): boolean {
  return LOCAL_ONLY_CHANNELS.has(channel)
}

export function isWsBlocked(channel: string): boolean {
  return WS_BLOCKED_CHANNELS.has(channel)
}

/**
 * Throws OriginDeniedError if the (channel, origin) pair is forbidden.
 * Safe to call on every dispatch invocation — O(1) set lookups.
 */
export function assertOriginAllowed(channel: string, origin: DispatchOrigin): void {
  if (origin === 'ws' && WS_BLOCKED_CHANNELS.has(channel)) {
    throw new OriginDeniedError(channel, origin)
  }
  if (origin !== 'local' && LOCAL_ONLY_CHANNELS.has(channel)) {
    throw new OriginDeniedError(channel, origin)
  }
}
