import * as net from 'net'
import * as http from 'http'
import * as https from 'https'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import type { IpcMain } from 'electron'
import { app } from 'electron'
import { ensureSelfSignedCert } from '../utils/cert'
import { WebSocketServer, WebSocket } from 'ws'
import { ipcDispatch } from '../ipc'
import { setBroadcastHandler } from '../utils/broadcast'

// ─── State ───────────────────────────────────────────

let tcpServer: net.Server | null = null
let httpServer: http.Server | https.Server | null = null
let wss: WebSocketServer | null = null
let serverToken: string | null = null
let serverPort: number | null = null
let serverShortCode: string | null = null
let serverAccessMode: 'lan' | 'all' = 'lan'
const authenticatedClients = new Set<WebSocket>()

// ─── MIME types ──────────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
}

// ─── Shim generator ─────────────────────────────────

function generateShim(token: string): string {
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
      if (!ws || ws.readyState !== WebSocket.OPEN || !connected) {
        return reject(new Error('Not connected'));
      }
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
      ws.send(JSON.stringify({ type: 'invoke', id: id, channel: channel, args: encodedArgs }));
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
    },
    settings: {
      get: function() { return invoke('settings:get', []); },
      set: function(k, v) { return invoke('settings:set', [k, v]); },
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
    macros: {
      load: function(name) { return invoke('macros:load', [name]); },
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
    server: {
      start: noopAsync,
      stop: noopAsync,
      getStatus: function() { return Promise.resolve({ running: false, port: null, url: null, urlHostname: null, lanIp: null, hostname: null, token: null, shortCode: null, accessMode: null, clients: 0, firewallWarning: null }); },
    },
    discord: {
      connect: function() { return invoke('discord:connect', []); },
      disconnect: function() { return invoke('discord:disconnect', []); },
      status: function() { return invoke('discord:status', []); },
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

// ─── Static file serving ────────────────────────────

function getRendererDir(): string {
  return path.join(__dirname, '../renderer')
}

function serveStaticFile(
  reqPath: string,
  res: http.ServerResponse,
  shimScript: string,
): void {
  const rendererDir = getRendererDir()
  // Normalize and prevent directory traversal
  const safePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '')
  const filePath = path.join(rendererDir, safePath === '/' ? 'index.html' : safePath)

  // Security: must be within renderer dir
  if (!filePath.startsWith(rendererDir)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: serve index.html for non-file paths
      if (safePath !== '/' && !path.extname(safePath)) {
        serveStaticFile('/', res, shimScript)
        return
      }
      res.writeHead(404)
      res.end('Not found')
      return
    }

    const ext = path.extname(filePath)
    const contentType = MIME[ext] || 'application/octet-stream'

    // Inject shim script into index.html before </head>
    if (ext === '.html') {
      let html = data.toString('utf-8')
      html = html.replace('</head>', `<script>${shimScript}</script>\n</head>`)
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(html)
      return
    }

    res.writeHead(200, { 'Content-Type': contentType })
    res.end(data)
  })
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
    if (msg.token === serverToken) {
      authenticatedClients.add(ws)
      ws.send(JSON.stringify({ type: 'auth_result', success: true }))
    } else {
      ws.send(JSON.stringify({ type: 'auth_result', success: false, error: 'Invalid token' }))
    }
    return
  }

  if (!authenticatedClients.has(ws)) {
    ws.send(JSON.stringify({ type: 'auth_result', success: false, error: 'Not authenticated' }))
    return
  }

  if (msg.type === 'invoke' && msg.id && msg.channel) {
    // Block channels that are unsafe via WebSocket:
    // - server:* — web clients must not control the server itself
    // - openscad:exportStl — uses event.sender (null via WS → crash)
    if (msg.channel.startsWith('server:') || msg.channel === 'openscad:exportStl') {
      ws.send(JSON.stringify({ type: 'result', id: msg.id, error: `Channel not available via WebSocket: ${msg.channel}` }))
      return
    }

    const handler = ipcDispatch.get(msg.channel)
    if (!handler) {
      ws.send(JSON.stringify({ type: 'result', id: msg.id, error: `Unknown channel: ${msg.channel}` }))
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
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'result', id: msg.id, result }))
        }
      })
      .catch((err) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'result', id: msg.id, error: err instanceof Error ? err.message : String(err) }))
        }
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
      client.send(payload)
    }
  }
}

// ─── Server lifecycle ───────────────────────────────

export interface ServerStartOptions {
  shortCode?: string
  accessMode?: 'lan' | 'all'
}

export async function startServer(port: number, options?: ServerStartOptions): Promise<{ url: string; token: string }> {
  // Early return if already running
  if (tcpServer) {
    const ip = getLanIp()
    const url = serverShortCode
      ? `https://${ip}:${serverPort}/s/${serverShortCode}`
      : `https://${ip}:${serverPort}?token=${serverToken}`
    return { url, token: serverToken! }
  }

  // Load or generate SSL certificate
  const sslDir = path.join(app.getPath('userData'), 'ssl')
  const { key, cert: certPem } = await ensureSelfSignedCert(sslDir)

  serverToken = crypto.randomBytes(32).toString('hex')
  serverPort = port
  serverShortCode = options?.shortCode || generateShortCode()
  serverAccessMode = options?.accessMode === 'all' ? 'all' : 'lan'
  const shimScript = generateShim(serverToken)

  const devUrl = process.env.ELECTRON_RENDERER_URL

  return new Promise((resolve, reject) => {
    httpServer = https.createServer({ key, cert: certPem }, (req, res) => {
      // Network access check
      if (!isAllowedRemote(req.socket.remoteAddress)) {
        res.writeHead(403)
        res.end('Forbidden: LAN access only')
        return
      }

      // CORS headers for dev mode
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      const url = new URL(req.url || '/', `http://localhost:${port}`)

      // Serve the shim as a standalone script
      if (url.pathname === '/agent-ws-shim.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' })
        res.end(shimScript)
        return
      }

      // Short URL route: /s/<code>
      const shortMatch = url.pathname.match(/^\/s\/([a-zA-Z0-9]+)$/)
      if (shortMatch) {
        if (shortMatch[1] !== serverShortCode) {
          res.writeHead(403)
          res.end('Invalid short code')
          return
        }
        // Serve index.html with token injected via window.__AGENT_TOKEN__
        const tokenScript = `<script>window.__AGENT_TOKEN__=${JSON.stringify(serverToken)};</script>`
        if (devUrl) {
          proxyToDevWithTokenInjection(devUrl, req, res, shimScript, tokenScript)
        } else {
          serveStaticFileWithTokenInjection('/', res, shimScript, tokenScript)
        }
        return
      }

      if (devUrl) {
        // Dev mode: proxy to electron-vite dev server
        proxyToDev(devUrl, url.pathname, req, res, shimScript)
      } else {
        // Production: serve static files from out/renderer/
        serveStaticFile(url.pathname, res, shimScript)
      }
    })

    wss = new WebSocketServer({ noServer: true, maxPayload: 10 * 1024 * 1024 })

    httpServer.on('upgrade', (req, socket, head) => {
      // Network access check for WebSocket
      if (!isAllowedRemote(req.socket.remoteAddress)) {
        socket.destroy()
        return
      }

      const url = new URL(req.url || '/', `http://localhost:${port}`)
      if (url.pathname === '/ws') {
        wss!.handleUpgrade(req, socket, head, (wsClient) => {
          wss!.emit('connection', wsClient, req)
        })
      } else if (devUrl) {
        // Proxy Vite HMR WebSocket to dev server
        const target = new URL(devUrl)
        const proxyReq = http.request({
          hostname: target.hostname,
          port: target.port,
          path: req.url,
          headers: req.headers,
          method: req.method,
        })
        proxyReq.on('upgrade', (_proxyRes, proxySocket, proxyHead) => {
          // Forward upstream 101 response with correct Sec-WebSocket-Accept
          let response = 'HTTP/1.1 101 Switching Protocols\r\n'
          for (let i = 0; i < _proxyRes.rawHeaders.length; i += 2) {
            response += _proxyRes.rawHeaders[i] + ': ' + _proxyRes.rawHeaders[i + 1] + '\r\n'
          }
          response += '\r\n'
          socket.write(response)
          if (proxyHead.length) socket.write(proxyHead)
          if (head.length) proxySocket.write(head)
          proxySocket.pipe(socket)
          socket.pipe(proxySocket)
          socket.on('error', () => proxySocket.destroy())
          proxySocket.on('error', () => socket.destroy())
        })
        proxyReq.on('error', () => socket.destroy())
        proxyReq.end()
      } else {
        socket.destroy()
      }
    })

    wss.on('connection', (wsClient) => {
      wsClient.on('message', (data) => {
        handleWsMessage(wsClient, data.toString())
      })
      wsClient.on('close', () => {
        authenticatedClients.delete(wsClient)
      })
      wsClient.on('error', () => {
        authenticatedClients.delete(wsClient)
      })
    })

    // Wire broadcast handler
    setBroadcastHandler(broadcastEvent)

    httpServer.on('error', (err) => {
      console.error('[webServer] Server error:', err.message)
      reject(err)
    })

    // HTTP→HTTPS redirect server (never exposed on its own port)
    const redirectServer = http.createServer((req, res) => {
      const host = req.headers.host || `localhost:${port}`
      // Strip port from host if present, re-add the same port for HTTPS
      const hostname = host.replace(/:\d+$/, '')
      res.writeHead(301, { Location: `https://${hostname}:${port}${req.url || '/'}` })
      res.end()
    })

    // TCP wrapper: peek first byte to detect TLS (0x16) vs plain HTTP
    tcpServer = net.createServer((socket) => {
      socket.once('readable', () => {
        const buf = socket.read(1)
        if (!buf || buf.length === 0) return
        socket.unshift(buf)
        // TLS handshake starts with 0x16 (ContentType.Handshake)
        const target = buf[0] === 0x16 ? httpServer! : redirectServer
        target.emit('connection', socket)
      })
      socket.on('error', () => {}) // ignore connection resets
    })

    tcpServer.on('error', (err) => {
      console.error('[webServer] TCP server error:', err.message)
      reject(err)
    })

    tcpServer.listen(port, '0.0.0.0', () => {
      const ip = getLanIp()
      const shortUrl = `https://${ip}:${port}/s/${serverShortCode}`
      console.log(`[webServer] Listening on ${shortUrl} (HTTP→HTTPS redirect enabled)`)
      resolve({ url: shortUrl, token: serverToken! })
    })
  })
}

export async function stopServer(): Promise<void> {
  setBroadcastHandler(() => {})

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

  // httpServer never calls .listen() (tcpServer owns the port) — just null it
  httpServer = null

  if (tcpServer) {
    await new Promise<void>((resolve) => {
      tcpServer!.close(() => {
        tcpServer = null
        serverToken = null
        serverPort = null
        serverShortCode = null
        resolve()
      })
    })
  }
}

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
    ? `https://${ip}:${serverPort}/s/${serverShortCode}`
    : `https://${ip}:${serverPort}?token=${serverToken}`
  const shortUrlHostname = serverShortCode
    ? `https://${host}:${serverPort}/s/${serverShortCode}`
    : `https://${host}:${serverPort}?token=${serverToken}`
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

// ─── Short URL serving (index.html with token injection) ─────

// Inject <base href="/"> so relative asset paths resolve from root (not /s/)
const BASE_TAG = '<base href="/">'

function serveStaticFileWithTokenInjection(
  _reqPath: string,
  res: http.ServerResponse,
  shimScript: string,
  tokenScript: string,
): void {
  const rendererDir = getRendererDir()
  const filePath = path.join(rendererDir, 'index.html')

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    let html = data.toString('utf-8')
    html = html.replace('<head>', `<head>${BASE_TAG}`)
    html = html.replace('</head>', `${tokenScript}<script>${shimScript}</script>\n</head>`)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
  })
}

function proxyToDevWithTokenInjection(
  devUrl: string,
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  shimScript: string,
  tokenScript: string,
): void {
  const target = new URL('/', devUrl)
  const proto = target.protocol === 'https:' ? require('https') : require('http')

  proto.get(target.href, (proxyRes: http.IncomingMessage) => {
    const chunks: Buffer[] = []
    proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
    proxyRes.on('end', () => {
      const body = Buffer.concat(chunks)
      let html = body.toString('utf-8')
      html = html.replace('<head>', `<head>${BASE_TAG}`)
      html = html.replace('</head>', `${tokenScript}<script>${shimScript}</script>\n</head>`)
      res.writeHead(proxyRes.statusCode || 200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    })
  }).on('error', (err: Error) => {
    console.error('[webServer] Dev proxy error:', err.message)
    res.writeHead(502)
    res.end('Dev server not reachable')
  })
}

// ─── Dev proxy ──────────────────────────────────────

function proxyToDev(
  devUrl: string,
  pathname: string,
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  shimScript: string,
): void {
  const target = new URL(pathname, devUrl)
  const proto = target.protocol === 'https:' ? require('https') : require('http')

  proto.get(target.href, (proxyRes: http.IncomingMessage) => {
    const chunks: Buffer[] = []
    proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
    proxyRes.on('end', () => {
      const body = Buffer.concat(chunks)
      const contentType = proxyRes.headers['content-type'] || ''

      // Inject shim into HTML responses
      if (contentType.includes('text/html')) {
        let html = body.toString('utf-8')
        html = html.replace('</head>', `<script>${shimScript}</script>\n</head>`)
        res.writeHead(proxyRes.statusCode || 200, { 'Content-Type': contentType })
        res.end(html)
      } else {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers)
        res.end(body)
      }
    })
  }).on('error', (err: Error) => {
    console.error('[webServer] Dev proxy error:', err.message)
    res.writeHead(502)
    res.end('Dev server not reachable')
  })
}

// ─── IPC handlers ───────────────────────────────────

export function registerHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('server:start', async (_event, port?: number, options?: ServerStartOptions) => {
    const p = typeof port === 'number' && port > 0 ? port : 3484
    return startServer(p, options)
  })

  ipcMain.handle('server:stop', async () => {
    await stopServer()
  })

  ipcMain.handle('server:getStatus', async () => {
    return getServerStatus()
  })
}
