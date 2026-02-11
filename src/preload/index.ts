import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AgentAPI } from './api'

function withTimeout<T>(promise: Promise<T>, ms = 30000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`IPC timeout after ${ms}ms`)), ms)
    ),
  ])
}

const api: AgentAPI = {
  auth: {
    getStatus: () => withTimeout(ipcRenderer.invoke('auth:getStatus')),
    login: () => withTimeout(ipcRenderer.invoke('auth:login')),
    logout: () => withTimeout(ipcRenderer.invoke('auth:logout')),
  },
  conversations: {
    list: () => withTimeout(ipcRenderer.invoke('conversations:list')),
    get: (id) => withTimeout(ipcRenderer.invoke('conversations:get', id)),
    create: (title?) => withTimeout(ipcRenderer.invoke('conversations:create', title)),
    update: (id, data) => withTimeout(ipcRenderer.invoke('conversations:update', id, data)),
    delete: (id) => withTimeout(ipcRenderer.invoke('conversations:delete', id)),
    export: (id, format) => withTimeout(ipcRenderer.invoke('conversations:export', id, format)),
    import: (data) => withTimeout(ipcRenderer.invoke('conversations:import', data)),
    search: (query) => withTimeout(ipcRenderer.invoke('conversations:search', query)),
    generateTitle: (id) => withTimeout(ipcRenderer.invoke('conversations:generateTitle', id)),
  },
  messages: {
    send: (conversationId, content, attachments?) =>
      withTimeout(ipcRenderer.invoke('messages:send', conversationId, content, attachments), 300000),
    stop: () => withTimeout(ipcRenderer.invoke('messages:stop')),
    regenerate: (conversationId) => withTimeout(ipcRenderer.invoke('messages:regenerate', conversationId), 300000),
    edit: (messageId, content) => withTimeout(ipcRenderer.invoke('messages:edit', messageId, content), 300000),
    respondToApproval: (requestId, response) =>
      withTimeout(ipcRenderer.invoke('messages:respondToApproval', requestId, response)),
    onStream: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, chunk: unknown) => callback(chunk as never)
      ipcRenderer.on('messages:stream', handler)
      return () => {
        ipcRenderer.removeListener('messages:stream', handler)
      }
    },
  },
  files: {
    listTree: (basePath: string) => withTimeout(ipcRenderer.invoke('files:listTree', basePath)),
    listDir: (dirPath: string) => withTimeout(ipcRenderer.invoke('files:listDir', dirPath)),
    readFile: (filePath: string) => withTimeout(ipcRenderer.invoke('files:readFile', filePath)),
    writeFile: (filePath: string, content: string) => withTimeout(ipcRenderer.invoke('files:writeFile', filePath, content)),
    savePastedFile: (data: Uint8Array, mimeType: string) => withTimeout(ipcRenderer.invoke('files:savePastedFile', data, mimeType)),
    revealInFileManager: (filePath: string) => withTimeout(ipcRenderer.invoke('files:revealInFileManager', filePath)),
    openWithDefault: (filePath: string) => withTimeout(ipcRenderer.invoke('files:openWithDefault', filePath)),
    trash: (filePath: string) => withTimeout(ipcRenderer.invoke('files:trash', filePath)),
    rename: (filePath: string, newName: string) => withTimeout(ipcRenderer.invoke('files:rename', filePath, newName)),
    duplicate: (filePath: string) => withTimeout(ipcRenderer.invoke('files:duplicate', filePath)),
    move: (sourcePath: string, destDir: string) => withTimeout(ipcRenderer.invoke('files:move', sourcePath, destDir)),
    createFile: (dirPath: string, name: string) => withTimeout(ipcRenderer.invoke('files:createFile', dirPath, name)),
    createFolder: (dirPath: string, name: string) => withTimeout(ipcRenderer.invoke('files:createFolder', dirPath, name)),
  },
  folders: {
    list: () => withTimeout(ipcRenderer.invoke('folders:list')),
    create: (name, parentId?) => withTimeout(ipcRenderer.invoke('folders:create', name, parentId)),
    update: (id, data) => withTimeout(ipcRenderer.invoke('folders:update', id, data)),
    delete: (id, mode?) => withTimeout(ipcRenderer.invoke('folders:delete', id, mode)),
    reorder: (ids) => withTimeout(ipcRenderer.invoke('folders:reorder', ids)),
  },
  mcp: {
    listServers: () => withTimeout(ipcRenderer.invoke('mcp:listServers')),
    addServer: (config) => withTimeout(ipcRenderer.invoke('mcp:addServer', config)),
    updateServer: (id, config) => withTimeout(ipcRenderer.invoke('mcp:updateServer', id, config)),
    removeServer: (id) => withTimeout(ipcRenderer.invoke('mcp:removeServer', id)),
    toggleServer: (id) => withTimeout(ipcRenderer.invoke('mcp:toggleServer', id)),
    testConnection: (id) => withTimeout(ipcRenderer.invoke('mcp:testConnection', id), 15000),
  },
  tools: {
    listAvailable: () => withTimeout(ipcRenderer.invoke('tools:listAvailable')),
    setEnabled: (value) => withTimeout(ipcRenderer.invoke('tools:setEnabled', value)),
    toggle: (toolName) => withTimeout(ipcRenderer.invoke('tools:toggle', toolName)),
  },
  kb: {
    listCollections: () => withTimeout(ipcRenderer.invoke('kb:listCollections')),
    getCollectionFiles: (collectionName: string) =>
      withTimeout(ipcRenderer.invoke('kb:getCollectionFiles', collectionName)),
    openKnowledgesFolder: () => withTimeout(ipcRenderer.invoke('kb:openKnowledgesFolder')),
  },
  settings: {
    get: () => withTimeout(ipcRenderer.invoke('settings:get')),
    set: (key, value) => withTimeout(ipcRenderer.invoke('settings:set', key, value)),
  },
  themes: {
    list: () => withTimeout(ipcRenderer.invoke('themes:list')),
    read: (filename) => withTimeout(ipcRenderer.invoke('themes:read', filename)),
    create: (filename, css) => withTimeout(ipcRenderer.invoke('themes:create', filename, css)),
    save: (filename, css) => withTimeout(ipcRenderer.invoke('themes:save', filename, css)),
    delete: (filename) => withTimeout(ipcRenderer.invoke('themes:delete', filename)),
    getDir: () => withTimeout(ipcRenderer.invoke('themes:getDir')),
    refresh: () => withTimeout(ipcRenderer.invoke('themes:refresh')),
  },
  shortcuts: {
    list: () => withTimeout(ipcRenderer.invoke('shortcuts:list')),
    update: (id, keybinding) => withTimeout(ipcRenderer.invoke('shortcuts:update', id, keybinding)),
  },
  whisper: {
    transcribe: (wavBuffer) => withTimeout(ipcRenderer.invoke('whisper:transcribe', wavBuffer), 45000),
    validateConfig: () => withTimeout(ipcRenderer.invoke('whisper:validateConfig')),
  },
  system: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    getInfo: () => withTimeout(ipcRenderer.invoke('system:getInfo')),
    getLogs: (limit?) => withTimeout(ipcRenderer.invoke('system:getLogs', limit)),
    clearCache: () => withTimeout(ipcRenderer.invoke('system:clearCache')),
    openExternal: (url) => withTimeout(ipcRenderer.invoke('system:openExternal', url)),
    selectFolder: () => withTimeout(ipcRenderer.invoke('system:selectFolder')),
    selectFile: () => withTimeout(ipcRenderer.invoke('system:selectFile')),
    showNotification: (title: string, body: string) => withTimeout(ipcRenderer.invoke('system:showNotification', title, body)),
    purgeConversations: () => withTimeout(ipcRenderer.invoke('system:purgeConversations')),
    purgeAll: () => withTimeout(ipcRenderer.invoke('system:purgeAll')),
  },
  events: {
    onTrayNewConversation: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('tray:newConversation', handler)
      return () => { ipcRenderer.removeListener('tray:newConversation', handler) }
    },
    onDeeplinkNavigate: (callback: (conversationId: number) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, id: number) => callback(id)
      ipcRenderer.on('deeplink:navigate', handler)
      return () => { ipcRenderer.removeListener('deeplink:navigate', handler) }
    },
    onConversationTitleUpdated: (callback: (data: { id: number; title: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { id: number; title: string }) => callback(data)
      ipcRenderer.on('conversations:titleUpdated', handler)
      return () => { ipcRenderer.removeListener('conversations:titleUpdated', handler) }
    },
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
}

contextBridge.exposeInMainWorld('agent', api)
