import * as net from 'net'
import * as http from 'http'
import * as https from 'https'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import type { DispatchRegistry } from '../dispatch'
import type { HandleRegistrar } from '../dispatch'
import { ensureSelfSignedCert } from '../utils/cert'
import { WebSocketServer, WebSocket } from 'ws'
import { createRateLimiter, type RateLimiter, type WebPasswordService } from '../auth'
import { addBroadcastHandler } from '../utils/broadcast'
import { assertOriginAllowed, isWsBlocked, OriginDeniedError } from '../dispatch-allowlist'
import { cookieIsValid, type RouteContext } from './web/middleware'
import { handleLoginPost, handleLogout, handleLoginGet } from './web/routes/login'
import { handleShimJs, handleShortCode, handleStatic } from './web/routes/static'
import { handleWsUpgrade } from './web/routes/wsUpgrade'
import { createLogger } from '../utils/logger'

const log = createLogger('webServer')

// ─── State ───────────────────────────────────────────

let tcpServer: net.Server | null = null
let httpServer: http.Server | https.Server | null = null
let wss: WebSocketServer | null = null
let serverToken: string | null = null
let serverPort: number | null = null
let serverShortCode: string | null = null
let serverAccessMode: 'lan' | 'all' = 'lan'
let serverProtocol: 'https' | 'http' = 'https'
const authenticatedClients = new Set<WebSocket>()
let webPassword: WebPasswordService | null = null
const rateLimiter: RateLimiter = createRateLimiter()
const COOKIE_NAME = 'agent_session'
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
const clientAlive = new WeakMap<WebSocket, boolean>()
/** Stores the cookie value captured at WS upgrade, used to re-validate on heartbeat after secret rotation. */
const clientCookies = new WeakMap<WebSocket, string>()
const HEARTBEAT_INTERVAL = 30_000
let unsubBroadcast: (() => void) | null = null

// Injectable state set when startServer() is called
let serverDispatch: DispatchRegistry | null = null
let rendererDir: string = ''

// ─── Shim generator ─────────────────────────────────

export function generateShim(token: string): string {
  // This JS replaces window.agent (the Electron preload) with WebSocket-based calls
  return `(function() {
  'use strict';
  window.__AGENT_WEB_MODE__ = true;
  document.documentElement.classList.add('mobile');

  var token = window.__AGENT_TOKEN__ || new URLSearchParams(window.location.search).get('token') || sessionStorage.getItem('agent_token') || '';
  if (token) sessionStorage.setItem('agent_token', token);

  var ws = null;
  var reqId = 0;
  var pending = {};
  var listeners = {};
  var connected = false;
  var sendQueue = [];

  function flushQueue() {
    while (sendQueue.length > 0 && connected && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(sendQueue.shift());
    }
  }

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/ws');
    ws.onopen = function() {
      ws.send(JSON.stringify({ type: 'auth', token: token }));
    };
    ws.onmessage = function(ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch(e) { return; }
      if (msg.type === 'auth_result') {
        connected = msg.success;
        if (!msg.success) console.error('[agent-ws] Auth failed:', msg.error);
        else flushQueue();
        return;
      }
      if (msg.type === 'result') {
        var cb = pending[msg.id];
        if (cb) {
          delete pending[msg.id];
          if (msg.error) cb.reject(new Error(msg.error));
          else cb.resolve(msg.result);
        }
        return;
      }
      if (msg.type === 'event') {
        var cbs = listeners[msg.channel];
        if (cbs) cbs.forEach(function(fn) { try { fn(msg.data); } catch(e) { console.error(e); } });
        return;
      }
    };
    ws.onclose = function() {
      connected = false;
      sendQueue.length = 0;
      // Reject all pending
      Object.keys(pending).forEach(function(id) {
        pending[id].reject(new Error('WebSocket disconnected'));
        delete pending[id];
      });
      // Auto-reconnect after 2s
      setTimeout(connect, 2000);
    };
    ws.onerror = function() {};
  }

  function invoke(channel, args) {
    return new Promise(function(resolve, reject) {
      var id = String(++reqId);
      pending[id] = { resolve: resolve, reject: reject };
      // Encode special types that JSON cannot represent natively:
      // - Uint8Array → { __type: 'binary', data } (base64, chunked to avoid stack overflow)
      // - undefined  → { __type: 'undefined' }    (JSON.stringify turns undefined into null)
      var encodedArgs = args.map(function(a) {
        if (a === undefined) return { __type: 'undefined' };
        if (a instanceof Uint8Array) {
          var chunks = [];
          for (var i = 0; i < a.length; i += 8192) {
            chunks.push(String.fromCharCode.apply(null, a.subarray(i, i + 8192)));
          }
          return { __type: 'binary', data: btoa(chunks.join('')) };
        }
        return a;
      });
      var payload = JSON.stringify({ type: 'invoke', id: id, channel: channel, args: encodedArgs });
      // Queue the message if WS isn't ready yet — flushed when auth_result success arrives,
      // or rejected (from pending) when WS closes.
      if (ws && ws.readyState === WebSocket.OPEN && connected) {
        ws.send(payload);
      } else {
        sendQueue.push(payload);
      }
    });
  }

  function subscribe(channel, fn) {
    if (!listeners[channel]) listeners[channel] = [];
    listeners[channel].push(fn);
    return function() {
      var arr = listeners[channel];
      if (arr) {
        var idx = arr.indexOf(fn);
        if (idx >= 0) arr.splice(idx, 1);
      }
    };
  }

  function noop() {}
  function noopAsync() { return Promise.resolve(null); }

  window.agent = {
    auth: {
      getStatus: function() { return invoke('auth:getStatus', []); },
      login: function() { return invoke('auth:login', []); },
      logout: function() { return invoke('auth:logout', []); },
    },
    conversations: {
      list: function() { return invoke('conversations:list', []); },
      get: function(id) { return invoke('conversations:get', [id]); },
      create: function(title, folderId) { return invoke('conversations:create', [title, folderId]); },
      update: function(id, data) { return invoke('conversations:update', [id, data]); },
      delete: function(id) { return invoke('conversations:delete', [id]); },
      deleteMany: function(ids) { return invoke('conversations:deleteMany', [ids]); },
      moveMany: function(ids, folderId) { return invoke('conversations:moveMany', [ids, folderId]); },
      colorMany: function(ids, color) { return invoke('conversations:colorMany', [ids, color]); },
      export: function(id, format) { return invoke('conversations:export', [id, format]); },
      import: function(data) { return invoke('conversations:import', [data]); },
      search: function(query) { return invoke('conversations:search', [query]); },
      generateTitle: function(id) { return invoke('conversations:generateTitle', [id]); },
      fork: function(cid, mid) { return invoke('conversations:fork', [cid, mid]); },
    },
    messages: {
      send: function(cid, content, attachments) { return invoke('messages:send', [cid, content, attachments]); },
      stop: function(cid) { return invoke('messages:stop', [cid]); },
      regenerate: function(cid) { return invoke('messages:regenerate', [cid]); },
      edit: function(mid, content) { return invoke('messages:edit', [mid, content]); },
      compact: function(cid) { return invoke('messages:compact', [cid]); },
      respondToApproval: function(rid, resp) { return invoke('messages:respondToApproval', [rid, resp]); },
      onStream: function(cb) { return subscribe('messages:stream', cb); },
    },
    files: {
      listTree: function(bp, ep) { return invoke('files:listTree', [bp, ep]); },
      listDir: function(dp) { return invoke('files:listDir', [dp]); },
      readFile: function(fp) { return invoke('files:readFile', [fp]); },
      writeFile: function(fp, c) { return invoke('files:writeFile', [fp, c]); },
      savePastedFile: function(data, mime) { return invoke('files:savePastedFile', [data, mime]); },
      revealInFileManager: function() { return Promise.resolve(); },
      openTerminalHere: function() { return Promise.resolve(); },
      openWithDefault: function() { return Promise.resolve(); },
      trash: function(fp) { return invoke('files:trash', [fp]); },
      rename: function(fp, nn) { return invoke('files:rename', [fp, nn]); },
      duplicate: function(fp) { return invoke('files:duplicate', [fp]); },
      move: function(sp, dd) { return invoke('files:move', [sp, dd]); },
      createFile: function(dp, n) { return invoke('files:createFile', [dp, n]); },
      createFolder: function(dp, n) { return invoke('files:createFolder', [dp, n]); },
      prepareSession: function(cid, sp, m, r) { return invoke('files:prepareSession', [cid, sp, m, r]); },
    },
    folders: {
      list: function() { return invoke('folders:list', []); },
      create: function(name, pid) { return invoke('folders:create', [name, pid]); },
      update: function(id, data) { return invoke('folders:update', [id, data]); },
      delete: function(id, mode) { return invoke('folders:delete', [id, mode]); },
      reorder: function(ids) { return invoke('folders:reorder', [ids]); },
      getDefault: function() { return invoke('folders:getDefault', []); },
    },
    mcp: {
      listServers: function() { return invoke('mcp:listServers', []); },
      addServer: function(c) { return invoke('mcp:addServer', [c]); },
      updateServer: function(id, c) { return invoke('mcp:updateServer', [id, c]); },
      removeServer: function(id) { return invoke('mcp:removeServer', [id]); },
      toggleServer: function(id) { return invoke('mcp:toggleServer', [id]); },
      testConnection: function(id) { return invoke('mcp:testConnection', [id]); },
    },
    tools: {
      listAvailable: function() { return invoke('tools:listAvailable', []); },
      setEnabled: function(v) { return invoke('tools:setEnabled', [v]); },
      toggle: function(tn) { return invoke('tools:toggle', [tn]); },
    },
    kb: {
      listCollections: function() { return invoke('kb:listCollections', []); },
      getCollectionFiles: function(cn) { return invoke('kb:getCollectionFiles', [cn]); },
      openKnowledgesFolder: function() { return Promise.resolve(); },
    },
    pi: {
      listExtensions: function() { return invoke('pi:listExtensions', []); },
      onUIEvent: function(cb) { return subscribe('pi:uiEvent', cb); },
      onUIRequest: function(cb) { return subscribe('pi:uiRequest', cb); },
      respondUI: noop,
      sendTuiInput: noop,
      onTuiRender: function() { return noop; },
      onTuiDone: function() { return noop; },
    },
    settings: {
      get: function() { return invoke('settings:get', []); },
      set: function(k, v) { return invoke('settings:set', [k, v]); },
      getLocked: function() { return invoke('settings:getLocked', []); },
      setStreamingTimeout: noop,
    },
    themes: {
      list: function() { return invoke('themes:list', []); },
      read: function(fn) { return invoke('themes:read', [fn]); },
      create: function(fn, css) { return invoke('themes:create', [fn, css]); },
      save: function(fn, css) { return invoke('themes:save', [fn, css]); },
      delete: function(fn) { return invoke('themes:delete', [fn]); },
      getDir: function() { return invoke('themes:getDir', []); },
      refresh: function() { return invoke('themes:refresh', []); },
    },
    commands: {
      list: function(cwd, sm) { return invoke('commands:list', [cwd, sm]); },
    },
    context: {
      getBreakdown: function(cid) { return invoke('context:getBreakdown', [cid]); },
      getSkillsOverhead: function(cwd) { return invoke('context:getSkillsOverhead', [cwd]); },
    },
    macros: {
      load: function(name) { return invoke('macros:load', [name]); },
      list: function() { return invoke('macros:list', []); },
      save: function(name, description, messages, oldName) { return invoke('macros:save', [name, description, messages, oldName]); },
      delete: function(name) { return invoke('macros:delete', [name]); },
    },
    quickChat: {
      getConversationId: function(m) { return invoke('quickChat:getConversationId', [m]); },
      purge: function() { return invoke('quickChat:purge', []); },
      hide: noopAsync,
      setBubbleMode: noopAsync,
      reregisterShortcuts: function() { return invoke('quickChat:reregisterShortcuts', []); },
    },
    shortcuts: {
      list: function() { return invoke('shortcuts:list', []); },
      update: function(id, kb) { return invoke('shortcuts:update', [id, kb]); },
    },
    whisper: {
      transcribe: function(buf) { return invoke('whisper:transcribe', [buf]); },
      validateConfig: function() { return invoke('whisper:validateConfig', []); },
    },
    voice: {
      duck: noopAsync,
      restore: noopAsync,
    },
    tts: {
      speak: function(t) { return invoke('tts:speak', [t]); },
      speakMessage: function(t, cid, mid) { return invoke('tts:speakMessage', [t, cid, mid]); },
      stop: function() { return invoke('tts:stop', []); },
      validate: function() { return invoke('tts:validate', []); },
      detectPlayers: function() { return invoke('tts:detectPlayers', []); },
      listSayVoices: function() { return invoke('tts:listSayVoices', []); },
      onStateChange: function(cb) { return subscribe('tts:stateChange', cb); },
    },
    openscad: {
      compile: function(fp) { return invoke('openscad:compile', [fp]); },
      validateConfig: function() { return invoke('openscad:validateConfig', []); },
      exportStl: function(fp) { return invoke('openscad:exportStl', [fp]); },
    },
    scheduler: {
      list: function() { return invoke('scheduler:list', []); },
      get: function(id) { return invoke('scheduler:get', [id]); },
      create: function(d) { return invoke('scheduler:create', [d]); },
      update: function(id, d) { return invoke('scheduler:update', [id, d]); },
      delete: function(id) { return invoke('scheduler:delete', [id]); },
      toggle: function(id, e) { return invoke('scheduler:toggle', [id, e]); },
      runNow: function(id) { return invoke('scheduler:runNow', [id]); },
      conversationTasks: function(cid) { return invoke('scheduler:conversationTasks', [cid]); },
      listVariables: function() { return invoke('scheduler:listVariables', []); },
      onTaskUpdate: function(cb) { return subscribe('scheduler:taskUpdate', cb); },
    },
    updates: {
      check: function() { return invoke('updates:check', []); },
      download: function() { return invoke('updates:download', []); },
      install: function() { return invoke('updates:install', []); },
      getStatus: function() { return invoke('updates:getStatus', []); },
      onStatus: function(cb) { return subscribe('updates:status', cb); },
    },
    jupyter: {
      startKernel: function(fp, kn) { return invoke('jupyter:startKernel', [fp, kn]); },
      executeCell: function(fp, c) { return invoke('jupyter:executeCell', [fp, c]); },
      interruptKernel: function(fp) { return invoke('jupyter:interruptKernel', [fp]); },
      restartKernel: function(fp) { return invoke('jupyter:restartKernel', [fp]); },
      shutdownKernel: function(fp) { return invoke('jupyter:shutdownKernel', [fp]); },
      getStatus: function(fp) { return invoke('jupyter:getStatus', [fp]); },
      detectJupyter: function() { return invoke('jupyter:detectJupyter', []); },
      onOutput: function(cb) { return subscribe('jupyter:output', cb); },
    },
    system: {
      getPathForFile: function() { return ''; },
      getInfo: function() { return invoke('system:getInfo', []); },
      getLogs: function(limit) { return invoke('system:getLogs', [limit]); },
      clearCache: function() { return invoke('system:clearCache', []); },
      openExternal: function(url) { window.open(url, '_blank'); return Promise.resolve(); },
      selectFolder: noopAsync,
      selectFile: noopAsync,
      showNotification: function(title, body) {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(title, { body: body });
        }
        return Promise.resolve();
      },
      purgeConversations: function() { return invoke('system:purgeConversations', []); },
      purgeAll: function() { return invoke('system:purgeAll', []); },
    },
    events: {
      onTrayNewConversation: function(cb) { return subscribe('tray:newConversation', cb); },
      onDeeplinkNavigate: function(cb) { return subscribe('deeplink:navigate', cb); },
      onConversationTitleUpdated: function(cb) { return subscribe('conversations:titleUpdated', cb); },
      onOverlayStopRecording: function() { return noop; },
      onConversationsRefresh: function(cb) { return subscribe('conversations:refresh', cb); },
      onConversationUpdated: function(cb) { return subscribe('messages:conversationUpdated', cb); },
      onAutoThemeSwitch: function(cb) { return subscribe('theme:autoSwitch', cb); },
    },
    bugReport: {
      getMainErrors: function() { return Promise.resolve([]); },
      scrub: function(text) { return Promise.resolve(text); },
      send: noopAsync,
      onOpenRequest: function() { return noop; },
    },
    models: {
      list: function() { return invoke('models:list', []); },
      refresh: function() { return invoke('models:refresh', []); },
    },
    server: {
      start: noopAsync,
      stop: noopAsync,
      getStatus: function() { return Promise.resolve({ running: false, port: null, url: null, urlHostname: null, lanIp: null, hostname: null, token: null, shortCode: null, accessMode: null, clients: 0, firewallWarning: null }); },
      setPassword: function(p) { return invoke('server:setPassword', [p]); },
      clearPassword: function() { return invoke('server:clearPassword', []); },
      isPasswordSet: function() { return invoke('server:isPasswordSet', []); },
      getSessionDurationDays: function() { return invoke('server:getSessionDurationDays', []); },
      setSessionDurationDays: function(d) { return invoke('server:setSessionDurationDays', [d]); },
      getRememberDurationDays: function() { return invoke('server:getRememberDurationDays', []); },
      setRememberDurationDays: function(d) { return invoke('server:setRememberDurationDays', [d]); },
    },
    discord: {
      connect: function() { return invoke('discord:connect', []); },
      disconnect: function() { return invoke('discord:disconnect', []); },
      status: function() { return invoke('discord:status', []); },
    },
    git: {
      isRepo: function(cwd) { return invoke('git:isRepo', [cwd]); },
      status: function(cwd) { return invoke('git:status', [cwd]); },
      logGraph: function(cwd, opts) { return invoke('git:logGraph', [cwd, opts]); },
      commitDetail: function(cwd, sha) { return invoke('git:commitDetail', [cwd, sha]); },
      branches: function(cwd) { return invoke('git:branches', [cwd]); },
      stashList: function(cwd) { return invoke('git:stashList', [cwd]); },
      // git:checkout and git:fetch are ELECTRON_ONLY_CHANNELS; the call will
      // reject with OriginDeniedError on the server side. Surfaced as-is so
      // the UI gets a clear error instead of a silent no-op.
      checkout: function(cwd, name) { return invoke('git:checkout', [cwd, name]); },
      stashSave: function(cwd, message) { return invoke('git:stashSave', [cwd, message]); },
      stashPop: function(cwd, index) { return invoke('git:stashPop', [cwd, index]); },
      fetch: function(cwd, remote) { return invoke('git:fetch', [cwd, remote]); },
    },
    window: {
      minimize: noop,
      maximize: noop,
      close: noop,
    },
  };

  connect();
})();
`
}

// ─── LAN IP detection ───────────────────────────────

// Virtual/tunnel interface prefixes to skip — these are not reachable from LAN
const VIRTUAL_IFACE_PREFIXES = ['docker', 'br-', 'veth', 'tailscale', 'tun', 'tap', 'virbr', 'lxc', 'cni', 'flannel', 'calico', 'podman']

function isVirtualInterface(name: string): boolean {
  return VIRTUAL_IFACE_PREFIXES.some(prefix => name.startsWith(prefix))
}

function isPrivateIp(addr: string): boolean {
  return addr.startsWith('192.168.') ||
    addr.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(addr)
}

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function generateShortCode(length = 8): string {
  const bytes = crypto.randomBytes(length)
  let code = ''
  for (let i = 0; i < length; i++) {
    code += BASE62[bytes[i] % 62]
  }
  return code
}

function stripMappedIpv6(addr: string): string {
  return addr.startsWith('::ffff:') ? addr.slice(7) : addr
}

function isAllowedRemote(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false
  const addr = stripMappedIpv6(remoteAddress)
  // Localhost always allowed
  if (addr === '127.0.0.1' || addr === '::1' || addr === 'localhost') return true
  // In 'all' mode, everything is allowed
  if (serverAccessMode === 'all') return true
  // In 'lan' mode, only private IPs
  return isPrivateIp(addr)
}

function getLanIp(): string {
  const interfaces = os.networkInterfaces()
  // First pass: physical interfaces with private IPs (wlan0, eth0, enp*, wlp*, etc.)
  for (const name of Object.keys(interfaces)) {
    if (isVirtualInterface(name)) continue
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal && isPrivateIp(iface.address)) {
        return iface.address
      }
    }
  }
  // Second pass: any interface with private IP (including virtual — better than nothing)
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal && isPrivateIp(iface.address)) {
        return iface.address
      }
    }
  }
  // Last resort: any non-internal IPv4
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return '127.0.0.1'
}

function getHostname(): string {
  return os.hostname()
}

// ─── Safe WebSocket send ─────────────────────────

function safeSend(ws: WebSocket, payload: string): void {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload)
    }
  } catch {
    authenticatedClients.delete(ws)
  }
}

// ─── WebSocket message handling ─────────────────────

function handleWsMessage(ws: WebSocket, raw: string): void {
  let msg: { type: string; token?: string; id?: string; channel?: string; args?: unknown[] }
  try {
    msg = JSON.parse(raw)
  } catch {
    return
  }

  if (msg.type === 'auth') {
    if (authenticatedClients.has(ws)) {
      safeSend(ws, JSON.stringify({ type: 'auth_result', success: true }))
      return
    }
    if (msg.token === serverToken) {
      authenticatedClients.add(ws)
      safeSend(ws, JSON.stringify({ type: 'auth_result', success: true }))
    } else {
      safeSend(ws, JSON.stringify({ type: 'auth_result', success: false, error: 'Invalid token' }))
    }
    return
  }

  if (!authenticatedClients.has(ws)) {
    safeSend(ws, JSON.stringify({ type: 'auth_result', success: false, error: 'Not authenticated' }))
    return
  }

  if (msg.type === 'invoke' && msg.id && msg.channel) {
    // Enforce the dispatch allowlist — WS_BLOCKED_CHANNELS and ELECTRON_ONLY_CHANNELS
    // are the canonical source of truth (src/core/dispatch-allowlist.ts).
    if (isWsBlocked(msg.channel)) {
      safeSend(ws, JSON.stringify({ type: 'result', id: msg.id, error: `Channel not available via WebSocket: ${msg.channel}` }))
      return
    }
    try {
      assertOriginAllowed(msg.channel, 'ws')
    } catch (err) {
      if (err instanceof OriginDeniedError) {
        safeSend(ws, JSON.stringify({ type: 'result', id: msg.id, error: `Channel not available via WebSocket: ${msg.channel}` }))
        return
      }
      throw err
    }

    const handler = serverDispatch?.get(msg.channel)
    if (!handler) {
      safeSend(ws, JSON.stringify({ type: 'result', id: msg.id, error: `Unknown channel: ${msg.channel}` }))
      return
    }

    // Decode special types back to their native representations
    const decodedArgs = (msg.args || []).map((arg) => {
      if (arg && typeof arg === 'object') {
        const typed = arg as Record<string, unknown>
        if (typed.__type === 'undefined') return undefined
        if (typed.__type === 'binary') {
          return new Uint8Array(Buffer.from(typed.data as string, 'base64'))
        }
      }
      return arg
    })

    handler(...decodedArgs)
      .then((result) => {
        safeSend(ws, JSON.stringify({ type: 'result', id: msg.id, result }))
      })
      .catch((err) => {
        safeSend(ws, JSON.stringify({ type: 'result', id: msg.id, error: err instanceof Error ? err.message : String(err) }))
      })
  }
}

// ─── Broadcast to WS clients ────────────────────────

function broadcastEvent(channel: string, ...args: unknown[]): void {
  if (authenticatedClients.size === 0) return
  const data = args.length === 1 ? args[0] : args
  const payload = JSON.stringify({ type: 'event', channel, data })
  for (const client of authenticatedClients) {
    if (client.readyState === WebSocket.OPEN) {
      safeSend(client, payload)
    } else {
      authenticatedClients.delete(client)
    }
  }
}

// ─── Server lifecycle ───────────────────────────────

export interface ServerStartOptions {
  shortCode?: string
  accessMode?: 'lan' | 'all'
  sslDir?: string         // default: path.join(__dirname, '../../ssl')
  rendererDir?: string    // default: path.join(__dirname, '../renderer')
  dispatch?: DispatchRegistry
  webPassword?: WebPasswordService
}

export async function startServer(port: number, options?: ServerStartOptions): Promise<{ url: string; token: string }> {
  // Early return if already running
  if (tcpServer || httpServer) {
    const ip = getLanIp()
    const url = serverShortCode
      ? `${serverProtocol}://${ip}:${serverPort}/s/${serverShortCode}`
      : `${serverProtocol}://${ip}:${serverPort}?token=${serverToken}`
    return { url, token: serverToken! }
  }

  // Wire injectable deps into module-level state
  serverDispatch = options?.dispatch ?? null
  webPassword = options?.webPassword ?? null
  rendererDir = options?.rendererDir ?? path.join(__dirname, '../renderer')

  // Try SSL, fall back to HTTP if OpenSSL is unavailable
  const resolvedSslDir = options?.sslDir ?? path.join(__dirname, '../../ssl')
  let sslKey: Buffer | null = null
  let sslCert: Buffer | null = null
  try {
    const result = await ensureSelfSignedCert(resolvedSslDir)
    sslKey = result.key
    sslCert = result.cert
    serverProtocol = 'https'
  } catch (err) {
    log.warn('SSL unavailable — falling back to HTTP (less secure)')
    log.warn('SSL error detail', err)
    serverProtocol = 'http'
  }

  serverToken = crypto.randomBytes(32).toString('hex')
  serverPort = port
  serverShortCode = options?.shortCode || generateShortCode()
  serverAccessMode = options?.accessMode === 'all' ? 'all' : 'lan'
  const shimScript = generateShim(serverToken)

  // Route all `broadcast()` calls (stream chunks, conversationUpdated, title
  // updates…) to connected WS clients. `broadcastEvent` is safe to register
  // before any client connects — it no-ops when `authenticatedClients` is empty.
  if (!unsubBroadcast) {
    unsubBroadcast = addBroadcastHandler(broadcastEvent)
  }

  const devUrl = process.env.ELECTRON_RENDERER_URL

  const routeCtx: RouteContext = {
    shimScript,
    devUrl,
    port,
    rendererDir,
    serverProtocol,
    serverShortCode,
    serverToken,
    webPassword,
    rateLimiter,
    cookieName: COOKIE_NAME,
  }

  // Shared request handler — works identically for HTTP and HTTPS
  const requestHandler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (!isAllowedRemote(req.socket.remoteAddress)) {
      res.writeHead(403)
      res.end('Forbidden: LAN access only')
      return
    }

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    const url = new URL(req.url || '/', `http://localhost:${port}`)

    // Served before cookie gate — clients need the shim to bootstrap WS
    if (url.pathname === '/agent-ws-shim.js') return handleShimJs(req, res, routeCtx)

    // Login/logout routes handle their own auth (rate limit + scrypt)
    if (url.pathname === '/login' && req.method === 'POST') return handleLoginPost(req, res, routeCtx)
    if (url.pathname === '/logout' && req.method === 'POST') return handleLogout(req, res, routeCtx)
    if (url.pathname === '/login') return handleLoginGet(req, res, routeCtx)

    // Cookie gate: all other routes require auth when password is set
    const passwordSet = !!webPassword && webPassword.isPasswordSet()
    if (passwordSet && !cookieIsValid(req, routeCtx)) {
      res.writeHead(302, { Location: '/login' })
      res.end()
      return
    }

    // Short-code entry point
    const shortMatch = url.pathname.match(/^\/s\/([a-zA-Z0-9]+)$/)
    if (shortMatch) return handleShortCode(shortMatch[1], req, res, routeCtx)

    // Static assets / dev proxy fallback
    handleStatic(url.pathname, req, res, routeCtx)
  }

  // Shared upgrade handler — works identically for HTTP and HTTPS
  const upgradeHandler = (req: http.IncomingMessage, socket: import('stream').Duplex, head: Buffer) => {
    handleWsUpgrade(req, socket, head, {
      ...routeCtx,
      wss: wss!,
      authenticatedClients,
      clientCookies,
      isAllowedRemote,
    })
  }

  return new Promise((resolve, reject) => {
    // Create server — HTTPS with TCP wrapper, or plain HTTP as fallback
    if (sslKey && sslCert) {
      httpServer = https.createServer({ key: sslKey, cert: sslCert }, requestHandler)
    } else {
      httpServer = http.createServer(requestHandler)
    }

    wss = new WebSocketServer({ noServer: true, maxPayload: 10 * 1024 * 1024 })
    httpServer.on('upgrade', upgradeHandler)

    wss.on('connection', (wsClient) => {
      clientAlive.set(wsClient, true)
      wsClient.on('pong', () => {
        clientAlive.set(wsClient, true)
      })
      wsClient.on('message', (data) => {
        handleWsMessage(wsClient, data.toString())
      })
      wsClient.on('close', () => {
        authenticatedClients.delete(wsClient)
        clientCookies.delete(wsClient)
      })
      wsClient.on('error', () => {
        authenticatedClients.delete(wsClient)
        clientCookies.delete(wsClient)
      })
    })

    // Heartbeat: detect dead connections and re-validate cookie-authed clients.
    // Re-auth runs before the alive check so a revoked session disconnects this tick.
    heartbeatTimer = setInterval(() => {
      if (!wss) return
      for (const client of wss.clients) {
        // Re-validate cookie when password auth is active (secret may have rotated)
        if (webPassword?.isPasswordSet() && authenticatedClients.has(client)) {
          const storedCookie = clientCookies.get(client)
          if (!storedCookie || !webPassword.validateCookie(storedCookie)) {
            authenticatedClients.delete(client)
            clientCookies.delete(client)
            client.close(1008, 'session revoked')
            continue
          }
        }

        if (!clientAlive.get(client)) {
          authenticatedClients.delete(client)
          client.terminate()
          continue
        }
        clientAlive.set(client, false)
        try { client.ping() } catch {
          authenticatedClients.delete(client)
          client.terminate()
        }
      }
    }, HEARTBEAT_INTERVAL)

    httpServer.on('error', (err) => {
      log.error('Server error', err)
      reject(err)
    })

    if (sslKey && sslCert) {
      // HTTPS mode: TCP wrapper peeks first byte to detect TLS vs plain HTTP
      const redirectServer = http.createServer((req, res) => {
        const host = req.headers.host || `localhost:${port}`
        const hostname = host.replace(/:\d+$/, '')
        res.writeHead(301, { Location: `https://${hostname}:${port}${req.url || '/'}` })
        res.end()
      })

      tcpServer = net.createServer((socket) => {
        socket.once('readable', () => {
          const buf = socket.read(1)
          if (!buf || buf.length === 0) return
          socket.unshift(buf)
          const target = buf[0] === 0x16 ? httpServer! : redirectServer
          target.emit('connection', socket)
        })
        socket.on('error', () => {})
      })

      tcpServer.on('error', (err) => {
        log.error('TCP server error', err)
        reject(err)
      })

      tcpServer.listen(port, '0.0.0.0', () => {
        const ip = getLanIp()
        const shortUrl = `https://${ip}:${port}/s/${serverShortCode}`
        log.info('Listening', { url: shortUrl, protocol: 'HTTPS' })
        resolve({ url: shortUrl, token: serverToken! })
      })
    } else {
      // HTTP fallback: direct listen, no TCP wrapper needed
      httpServer.listen(port, '0.0.0.0', () => {
        const ip = getLanIp()
        const shortUrl = `http://${ip}:${port}/s/${serverShortCode}`
        log.info('Listening', { url: shortUrl, protocol: 'HTTP' })
        resolve({ url: shortUrl, token: serverToken! })
      })
    }
  })
}

export async function stopServer(): Promise<void> {
  serverDispatch = null
  webPassword = null
  rendererDir = ''

  if (unsubBroadcast) {
    unsubBroadcast()
    unsubBroadcast = null
  }

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  // Close all WS clients
  for (const client of authenticatedClients) {
    client.close()
  }
  authenticatedClients.clear()

  // Close WSS first, then HTTP server
  if (wss) {
    await new Promise<void>((resolve) => {
      wss!.close(() => resolve())
    })
    wss = null
  }

  // HTTPS mode: tcpServer owns the port; HTTP mode: httpServer listens directly
  if (tcpServer) {
    httpServer = null
    await new Promise<void>((resolve) => {
      tcpServer!.close(() => {
        tcpServer = null
        serverToken = null
        serverPort = null
        serverShortCode = null
        resolve()
      })
    })
  } else if (httpServer) {
    await new Promise<void>((resolve) => {
      httpServer!.close(() => {
        httpServer = null
        serverToken = null
        serverPort = null
        serverShortCode = null
        resolve()
      })
    })
  }
}

// consumed by webServer.test.ts (excluded) and via dispatch handler (server:getStatus). (suppressed below)
// fallow-ignore-next-line unused-export
export async function getServerStatus(): Promise<{
  running: boolean
  port: number | null
  url: string | null
  urlHostname: string | null
  lanIp: string | null
  hostname: string | null
  token: string | null
  shortCode: string | null
  accessMode: string | null
  clients: number
  firewallWarning: string | null
}> {
  if (!httpServer || !serverToken) {
    return { running: false, port: null, url: null, urlHostname: null, lanIp: null, hostname: null, token: null, shortCode: null, accessMode: null, clients: 0, firewallWarning: null }
  }
  const ip = getLanIp()
  const host = getHostname()
  const shortUrl = serverShortCode
    ? `${serverProtocol}://${ip}:${serverPort}/s/${serverShortCode}`
    : `${serverProtocol}://${ip}:${serverPort}?token=${serverToken}`
  const shortUrlHostname = serverShortCode
    ? `${serverProtocol}://${host}:${serverPort}/s/${serverShortCode}`
    : `${serverProtocol}://${host}:${serverPort}?token=${serverToken}`
  return {
    running: true,
    port: serverPort,
    url: shortUrl,
    urlHostname: shortUrlHostname,
    lanIp: ip,
    hostname: host,
    token: serverToken,
    shortCode: serverShortCode,
    accessMode: serverAccessMode,
    clients: authenticatedClients.size,
    firewallWarning: await detectFirewallBlock(serverPort!),
  }
}

// ─── Firewall detection (async + cached) ─────────────

let firewallCache: { result: string | null; port: number; ts: number } | null = null
const FIREWALL_CACHE_TTL = 60_000 // 60s

async function detectFirewallBlock(port: number): Promise<string | null> {
  if (process.platform !== 'linux') return null

  // Return cached result if fresh
  if (firewallCache && firewallCache.port === port && Date.now() - firewallCache.ts < FIREWALL_CACHE_TTL) {
    return firewallCache.result
  }

  const result = await detectFirewallBlockUncached(port)
  firewallCache = { result, port, ts: Date.now() }
  return result
}

async function detectFirewallBlockUncached(port: number): Promise<string | null> {
  // Check nftables config
  try {
    const nftConf = await fs.promises.readFile('/etc/nftables.conf', 'utf-8')
    const hasDropPolicy = /chain\s+input\s*\{[^}]*policy\s+drop/s.test(nftConf)
    if (hasDropPolicy) {
      const portAllowed = new RegExp(`tcp\\s+dport\\s+(?:\\{[^}]*\\b${port}\\b[^}]*\\}|\\b${port}\\b)\\s+accept`).test(nftConf)
      if (!portAllowed) {
        return `nftables: input policy is "drop" and port ${port} is not allowed. Run:\nsudo iptables -I INPUT -p tcp --dport ${port} -j ACCEPT`
      }
    }
  } catch {
    // File doesn't exist or not readable — no nftables
  }

  // Check iptables saved rules
  try {
    const iptRules = await fs.promises.readFile('/etc/iptables/iptables.rules', 'utf-8')
    const hasDropPolicy = /:INPUT\s+DROP/.test(iptRules)
    if (hasDropPolicy) {
      const portAllowed = new RegExp(`--dport\\s+${port}\\s+-j\\s+ACCEPT`).test(iptRules)
      if (!portAllowed) {
        return `iptables: INPUT policy is DROP and port ${port} is not allowed. Run:\nsudo iptables -I INPUT -p tcp --dport ${port} -j ACCEPT`
      }
    }
  } catch {
    // No saved iptables rules
  }

  // Check ufw
  try {
    const ufwProfiles = await fs.promises.readdir('/etc/ufw')
    if (ufwProfiles.length > 0) {
      const beforeRules = await fs.promises.readFile('/etc/ufw/before.rules', 'utf-8')
      // ufw is active if before.rules exists and has content
      if (beforeRules.length > 100) {
        try {
          const userRules = await fs.promises.readFile('/etc/ufw/user.rules', 'utf-8')
          const portAllowed = new RegExp(`--dport\\s+${port}\\s+-j\\s+ACCEPT`).test(userRules)
          if (!portAllowed) {
            return `ufw may be blocking port ${port}. Run:\nsudo ufw allow ${port}/tcp`
          }
        } catch {
          return `ufw appears active but port ${port} may not be allowed. Run:\nsudo ufw allow ${port}/tcp`
        }
      }
    }
  } catch {
    // No ufw
  }

  return null
}

// ─── IPC handlers ───────────────────────────────────

export interface WebServerHandlerOptions {
  webPassword?: WebPasswordService
  dispatch?: DispatchRegistry
}

export function registerWebServerHandlers(
  registrar: HandleRegistrar,
  options?: WebServerHandlerOptions,
): void {
  registrar.handle('server:start', async (_event, port?: unknown, userOptions?: unknown) => {
    const p = typeof port === 'number' && port > 0 ? port : 3484
    const fromUser = (userOptions as ServerStartOptions) || {}
    const merged: ServerStartOptions = {
      ...fromUser,
      webPassword: options?.webPassword,
      dispatch: fromUser.dispatch ?? options?.dispatch,
    }
    return startServer(p, merged)
  })

  registrar.handle('server:stop', async () => {
    await stopServer()
  })

  registrar.handle('server:getStatus', async () => {
    return getServerStatus()
  })
}
