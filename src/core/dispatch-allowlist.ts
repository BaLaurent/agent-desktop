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
 * Cat C — ELECTRON_ONLY_CHANNELS: local-only Electron features; refused over
 *   WS and discord/scheduler origins even when the handler is present in
 *   engine.dispatch (mirrored there via withSanitizedErrors in main/ipc.ts).
 *
 * Note: tray:*, globalShortcuts:*, deeplink:*, protocol:*, waylandShortcuts:*,
 * webhook:*, schedulerBridge:* are NOT registered via ipcMain.handle so they
 * never enter engine.dispatch at all — no entry needed here.
 */

export type DispatchOrigin = 'electron' | 'ws' | 'ws-local' | 'discord' | 'scheduler'

/**
 * Channels that MUST only be invoked from the Electron main process (i.e.
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
export const ELECTRON_ONLY_CHANNELS: ReadonlySet<string> = new Set([
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
 * NOTE — `settings:set` was previously blocked here. It is now reachable
 * over WS so the web UI has parity with the Electron app. Per-key locking
 * (e.g. CLI `--port` override pinning `server_port`) is enforced in
 * SettingsService.set() via lockedKeys, not here. Whitelisting of valid
 * keys is enforced by ALLOWED_SETTING_KEYS in the same service.
 */
// consumed by headless/index.test.ts (excluded). (suppressed below)
// fallow-ignore-next-line unused-export
export const WS_BLOCKED_CHANNELS: ReadonlySet<string> = new Set([
  'server:clearPassword',  // credential control-plane: remote must not clear the password
  'server:getStatus',
  'server:setPassword',    // credential control-plane: remote must not rotate the session secret
  'server:start',
  'server:stop',
])

/**
 * Subset of `ELECTRON_ONLY_CHANNELS` that a *same-host* WS client (origin
 * `'ws-local'`) is allowed to invoke. The 2026-04-23 audit blocks these
 * channels for LAN WS clients because `mcp:testConnection` is turn-key RCE
 * via attacker-controlled `command`/`args`, `git:fetch`/`git:checkout`
 * allow positional-argument injection (`--upload-pack=…`), and the
 * `system:purge*` channels wipe the DB without confirmation. A native
 * front running on the same machine as the server is trusted to perform
 * these on the user's behalf; a LAN client is not. Channels NOT listed
 * here remain blocked for `'ws-local'` just like for `'ws'`.
 */
// consumed by headless/index.test.ts (excluded). (suppressed below)
// fallow-ignore-next-line unused-export
export const LOCAL_WS_ALLOWED_CHANNELS: ReadonlySet<string> = new Set([
  // MCP server management — required by a native front to add/edit/test servers.
  'mcp:addServer',
  'mcp:updateServer',
  'mcp:testConnection',
  // Destructive DB wipes — exposed because a native front can show its own
  // confirmation dialog and call these only after the user confirms.
  'system:purgeAll',
  'system:purgeConversations',
  // Terminal + session prep — only meaningful on the same host as the server.
  'files:openTerminalHere',
  'files:prepareSession',
  // Git positional-argument injection — same-host trust model.
  'git:fetch',
  'git:checkout',
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
export function isElectronOnly(channel: string): boolean {
  return ELECTRON_ONLY_CHANNELS.has(channel)
}

export function isWsBlocked(channel: string): boolean {
  return WS_BLOCKED_CHANNELS.has(channel)
}

/**
 * Throws OriginDeniedError if the (channel, origin) pair is forbidden.
 * Safe to call on every dispatch invocation — O(1) set lookups.
 */
export function assertOriginAllowed(channel: string, origin: DispatchOrigin): void {
  if ((origin === 'ws' || origin === 'ws-local') && WS_BLOCKED_CHANNELS.has(channel)) {
    throw new OriginDeniedError(channel, origin)
  }
  if (
    origin !== 'electron' &&
    ELECTRON_ONLY_CHANNELS.has(channel) &&
    !(origin === 'ws-local' && LOCAL_WS_ALLOWED_CHANNELS.has(channel))
  ) {
    throw new OriginDeniedError(channel, origin)
  }
}
