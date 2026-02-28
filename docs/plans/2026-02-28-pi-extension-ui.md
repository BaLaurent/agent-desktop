# Pi Extension UI Support — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable Pi extensions to inject UI elements (dialogs, notifications, status, widgets, custom components) into Agent Desktop, rendered natively in React via an IPC bridge.

**Architecture:** Custom `PiUIContext` (main process) implements the Pi SDK's `ExtensionUIContext` interface, bridges to renderer via IPC events. A Zustand store (`piExtensionUIStore`) manages all extension UI state. React components render dialogs as modals, notifications as toasts, status in the ChatStatusLine, and widgets around the MessageInput.

**Tech Stack:** TypeScript, Electron IPC, Zustand, React, Pi SDK `ExtensionUIContext` interface

**Design Doc:** `docs/plans/2026-02-28-pi-extension-ui-design.md`

---

## Task 0: Setup — Worktree + Dependencies

**Files:**
- None (setup only)

**Step 1: Create worktree**

```bash
# Use superpowers:using-git-worktrees skill
```

**Step 2: Verify build passes**

Run: `npm run build`
Expected: 0 errors, 0 warnings

**Step 3: Verify tests pass**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

No commit needed — setup only.

---

## Task 1: Shared Types — `PiUITypes`

**Files:**
- Create: `src/shared/piUITypes.ts`
- Test: `src/shared/piUITypes.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import type { PiUIRequest, PiUIEvent, PiUIResponse, PiUINode, PiUIDialog, PiUINotification, PiUIWidget } from './piUITypes'

describe('PiUITypes', () => {
  it('PiUIRequest has required fields', () => {
    const req: PiUIRequest = { id: 'abc', method: 'select', title: 'Pick', options: ['A', 'B'] }
    expect(req.id).toBe('abc')
    expect(req.method).toBe('select')
  })

  it('PiUIEvent has method field', () => {
    const evt: PiUIEvent = { method: 'notify', message: 'hello', level: 'info' }
    expect(evt.method).toBe('notify')
  })

  it('PiUIResponse can be value or confirmed or cancelled', () => {
    const valResp: PiUIResponse = { id: 'x', value: 'A' }
    const confirmResp: PiUIResponse = { id: 'y', confirmed: true }
    const cancelResp: PiUIResponse = { id: 'z', cancelled: true }
    expect(valResp.value).toBe('A')
    expect(confirmResp.confirmed).toBe(true)
    expect(cancelResp.cancelled).toBe(true)
  })

  it('PiUINode supports all node types', () => {
    const text: PiUINode = { type: 'text', content: 'hello' }
    const btn: PiUINode = { type: 'button', label: 'Go', action: 'run' }
    const stack: PiUINode = { type: 'vstack', children: [text, btn] }
    expect(stack.type).toBe('vstack')
    expect((stack as { children: PiUINode[] }).children).toHaveLength(2)
  })

  it('PiUIDialog has all dialog variants', () => {
    const sel: PiUIDialog = { id: '1', method: 'select', title: 'Pick', options: ['A'] }
    const conf: PiUIDialog = { id: '2', method: 'confirm', title: 'Sure?', message: 'Delete?' }
    const inp: PiUIDialog = { id: '3', method: 'input', title: 'Name' }
    const edit: PiUIDialog = { id: '4', method: 'editor', title: 'Edit', prefill: 'code' }
    expect(sel.method).toBe('select')
    expect(conf.method).toBe('confirm')
    expect(inp.method).toBe('input')
    expect(edit.method).toBe('editor')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/piUITypes.test.ts`
Expected: FAIL — module not found

**Step 3: Write the types**

```typescript
// src/shared/piUITypes.ts

// ─── JSON Declarative UI Schema ───────────────────────────────

export type PiUINode =
  | { type: 'text'; content: string; style?: 'bold' | 'muted' | 'error' | 'accent' }
  | { type: 'button'; label: string; action: string }
  | { type: 'input'; placeholder?: string; id: string }
  | { type: 'select'; options: string[]; id: string }
  | { type: 'progress'; value: number; max?: number }
  | { type: 'divider' }
  | { type: 'hstack' | 'vstack'; children: PiUINode[]; gap?: number }
  | { type: 'badge'; text: string; color?: string }

// ─── IPC Protocol Types ───────────────────────────────────────

// Dialog requests (main → renderer, expect response)
export type PiUIDialog =
  | { id: string; method: 'select'; title: string; options: string[]; timeout?: number }
  | { id: string; method: 'confirm'; title: string; message: string; timeout?: number }
  | { id: string; method: 'input'; title: string; placeholder?: string; timeout?: number }
  | { id: string; method: 'editor'; title: string; prefill?: string; timeout?: number }
  | { id: string; method: 'custom'; title?: string; component: PiUINode; timeout?: number }

// Fire-and-forget events (main → renderer)
export type PiUIEvent =
  | { method: 'notify'; message: string; level?: 'info' | 'warning' | 'error' }
  | { method: 'setStatus'; key: string; text?: string }
  | { method: 'setWidget'; key: string; content?: string[]; placement?: 'aboveEditor' | 'belowEditor' }
  | { method: 'setWorkingMessage'; message?: string }
  | { method: 'setTitle'; title: string }
  | { method: 'setHeader'; component?: PiUINode }
  | { method: 'setFooter'; component?: PiUINode }

// UI request = dialog (needs response)
export type PiUIRequest = PiUIDialog

// UI response (renderer → main)
export interface PiUIResponse {
  id: string
  value?: string
  confirmed?: boolean
  cancelled?: boolean
}

// Component action (renderer → main, for interactive JSON components)
export interface PiUIComponentAction {
  id: string
  actionId: string
  data?: unknown
}

// ─── Renderer State Types ────────────────────────────────────

export interface PiUINotification {
  id: string
  message: string
  level: 'info' | 'warning' | 'error'
  timestamp: number
}

export interface PiUIWidget {
  key: string
  content: string[]
  placement: 'aboveEditor' | 'belowEditor'
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/piUITypes.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/shared/piUITypes.ts src/shared/piUITypes.test.ts
git commit -m "feat(pi-ui): add shared types for extension UI protocol"
```

---

## Task 2: Main Process — `PiUIContext`

**Files:**
- Create: `src/main/services/piUIContext.ts`
- Test: `src/main/services/piUIContext.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
}))

// Mock crypto
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-123'),
}))

import { PiUIContext } from './piUIContext'

describe('PiUIContext', () => {
  let mockWebContents: { send: ReturnType<typeof vi.fn> }
  let mockWin: { webContents: typeof mockWebContents; isDestroyed: () => boolean }
  let ctx: PiUIContext

  beforeEach(() => {
    mockWebContents = { send: vi.fn() }
    mockWin = { webContents: mockWebContents, isDestroyed: () => false }
    ctx = new PiUIContext(mockWin as never, 42)
  })

  describe('select', () => {
    it('sends pi:uiRequest with method select', () => {
      // Don't await — just fire
      const promise = ctx.select('Pick one', ['A', 'B'])
      expect(mockWebContents.send).toHaveBeenCalledWith('pi:uiRequest', {
        id: 'test-uuid-123',
        method: 'select',
        title: 'Pick one',
        options: ['A', 'B'],
      })
      // Resolve to avoid hanging
      ctx.handleResponse({ id: 'test-uuid-123', value: 'A' })
    })

    it('resolves with selected value', async () => {
      const promise = ctx.select('Pick', ['A', 'B'])
      ctx.handleResponse({ id: 'test-uuid-123', value: 'A' })
      expect(await promise).toBe('A')
    })

    it('resolves with undefined on cancel', async () => {
      const promise = ctx.select('Pick', ['A'])
      ctx.handleResponse({ id: 'test-uuid-123', cancelled: true })
      expect(await promise).toBeUndefined()
    })
  })

  describe('confirm', () => {
    it('sends pi:uiRequest with method confirm', () => {
      ctx.confirm('Sure?', 'Delete file?')
      expect(mockWebContents.send).toHaveBeenCalledWith('pi:uiRequest', expect.objectContaining({
        method: 'confirm',
        title: 'Sure?',
        message: 'Delete file?',
      }))
      ctx.handleResponse({ id: 'test-uuid-123', confirmed: true })
    })

    it('resolves with boolean', async () => {
      const promise = ctx.confirm('Sure?', 'msg')
      ctx.handleResponse({ id: 'test-uuid-123', confirmed: false })
      expect(await promise).toBe(false)
    })
  })

  describe('input', () => {
    it('resolves with entered text', async () => {
      const promise = ctx.input('Name', 'placeholder')
      ctx.handleResponse({ id: 'test-uuid-123', value: 'Claude' })
      expect(await promise).toBe('Claude')
    })
  })

  describe('editor', () => {
    it('resolves with edited text', async () => {
      const promise = ctx.editor('Edit code', 'original')
      ctx.handleResponse({ id: 'test-uuid-123', value: 'modified' })
      expect(await promise).toBe('modified')
    })
  })

  describe('notify', () => {
    it('sends pi:uiEvent with method notify', () => {
      ctx.notify('Hello', 'warning')
      expect(mockWebContents.send).toHaveBeenCalledWith('pi:uiEvent', {
        method: 'notify',
        message: 'Hello',
        level: 'warning',
      })
    })
  })

  describe('setStatus', () => {
    it('sends pi:uiEvent with key and text', () => {
      ctx.setStatus('ext-1', 'Running...')
      expect(mockWebContents.send).toHaveBeenCalledWith('pi:uiEvent', {
        method: 'setStatus',
        key: 'ext-1',
        text: 'Running...',
      })
    })

    it('clears status with undefined text', () => {
      ctx.setStatus('ext-1', undefined)
      expect(mockWebContents.send).toHaveBeenCalledWith('pi:uiEvent', {
        method: 'setStatus',
        key: 'ext-1',
        text: undefined,
      })
    })
  })

  describe('setWidget', () => {
    it('sends widget content with placement', () => {
      ctx.setWidget('info', ['Line 1', 'Line 2'], { placement: 'aboveEditor' })
      expect(mockWebContents.send).toHaveBeenCalledWith('pi:uiEvent', {
        method: 'setWidget',
        key: 'info',
        content: ['Line 1', 'Line 2'],
        placement: 'aboveEditor',
      })
    })
  })

  describe('setWorkingMessage', () => {
    it('sends working message', () => {
      ctx.setWorkingMessage('Processing...')
      expect(mockWebContents.send).toHaveBeenCalledWith('pi:uiEvent', {
        method: 'setWorkingMessage',
        message: 'Processing...',
      })
    })
  })

  describe('dispose', () => {
    it('resolves pending dialogs with defaults', async () => {
      const selectPromise = ctx.select('Pick', ['A'])
      const confirmPromise = ctx.confirm('Sure?', 'msg')
      ctx.dispose()
      expect(await selectPromise).toBeUndefined()
      expect(await confirmPromise).toBe(false)
    })

    it('ignores responses after dispose', () => {
      ctx.dispose()
      // Should not throw
      ctx.handleResponse({ id: 'test-uuid-123', value: 'A' })
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/services/piUIContext.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/main/services/piUIContext.ts
import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import type { PiUIResponse } from '../../shared/piUITypes'

interface PendingDialog {
  resolve: (value: unknown) => void
  method: string
}

/**
 * Implements the Pi SDK ExtensionUIContext interface by bridging
 * extension UI calls to Electron renderer via IPC events.
 *
 * Dialog methods (select/confirm/input/editor) create a Promise and
 * send a pi:uiRequest to the renderer. The renderer shows the dialog
 * and responds via pi:uiResponse, which resolves the Promise.
 *
 * Fire-and-forget methods (notify/setStatus/setWidget/etc.) send
 * pi:uiEvent immediately with no response expected.
 */
export class PiUIContext {
  private pending = new Map<string, PendingDialog>()
  private disposed = false
  private win: { webContents: { send: (channel: string, data: unknown) => void }; isDestroyed: () => boolean }
  private conversationId: number | undefined

  constructor(win: BrowserWindow | { webContents: { send: (channel: string, data: unknown) => void }; isDestroyed: () => boolean }, conversationId?: number) {
    this.win = win
    this.conversationId = conversationId
  }

  private send(channel: string, data: unknown): void {
    if (!this.disposed && !this.win.isDestroyed()) {
      this.win.webContents.send(channel, data)
    }
  }

  private request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = randomUUID()
    this.send('pi:uiRequest', { id, method, ...params })
    return new Promise<T>((resolve) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, method })
    })
  }

  handleResponse(response: PiUIResponse): void {
    const entry = this.pending.get(response.id)
    if (!entry) return
    this.pending.delete(response.id)

    if (response.cancelled) {
      // Resolve with SDK defaults for cancelled dialogs
      entry.resolve(entry.method === 'confirm' ? false : undefined)
      return
    }

    if (entry.method === 'confirm') {
      entry.resolve(response.confirmed ?? false)
    } else {
      entry.resolve(response.value)
    }
  }

  // ─── Dialog Methods (blocking) ─────────────────────────────

  async select(title: string, options: string[], opts?: { timeout?: number }): Promise<string | undefined> {
    return this.request<string | undefined>('select', { title, options, ...(opts?.timeout ? { timeout: opts.timeout } : {}) })
  }

  async confirm(title: string, message: string, opts?: { timeout?: number }): Promise<boolean> {
    return this.request<boolean>('confirm', { title, message, ...(opts?.timeout ? { timeout: opts.timeout } : {}) })
  }

  async input(title: string, placeholder?: string, opts?: { timeout?: number }): Promise<string | undefined> {
    return this.request<string | undefined>('input', { title, placeholder, ...(opts?.timeout ? { timeout: opts.timeout } : {}) })
  }

  async editor(title: string, prefill?: string): Promise<string | undefined> {
    return this.request<string | undefined>('editor', { title, prefill })
  }

  // ─── Fire-and-forget Methods ───────────────────────────────

  notify(message: string, type?: 'info' | 'warning' | 'error'): void {
    this.send('pi:uiEvent', { method: 'notify', message, level: type })
  }

  setStatus(key: string, text: string | undefined): void {
    this.send('pi:uiEvent', { method: 'setStatus', key, text })
  }

  setWorkingMessage(message?: string): void {
    this.send('pi:uiEvent', { method: 'setWorkingMessage', message })
  }

  setWidget(key: string, content: string[] | undefined, options?: { placement?: 'aboveEditor' | 'belowEditor' }): void {
    this.send('pi:uiEvent', {
      method: 'setWidget',
      key,
      content,
      placement: options?.placement,
    })
  }

  setTitle(title: string): void {
    this.send('pi:uiEvent', { method: 'setTitle', title })
  }

  setHeader(factory: unknown): void {
    // TUI factory not executable — log and send no-op event
    if (factory == null) {
      this.send('pi:uiEvent', { method: 'setHeader', component: undefined })
    } else {
      console.log('[PiUIContext] setHeader called with TUI factory — not renderable in Electron')
    }
  }

  setFooter(factory: unknown): void {
    if (factory == null) {
      this.send('pi:uiEvent', { method: 'setFooter', component: undefined })
    } else {
      console.log('[PiUIContext] setFooter called with TUI factory — not renderable in Electron')
    }
  }

  async custom<T>(): Promise<T> {
    console.log('[PiUIContext] custom() called — TUI components not supported in Electron')
    return undefined as T
  }

  // ─── No-op / Stub Methods ─────────────────────────────────

  onTerminalInput(): () => void { return () => {} }
  setEditorText(): void {}
  getEditorText(): string { return '' }
  pasteToEditor(): void {}
  setEditorComponent(): void {}
  get theme(): unknown { return {} }
  getAllThemes(): { name: string; path: string | undefined }[] { return [] }
  getTheme(): unknown { return undefined }
  setTheme(): { success: boolean; error?: string } { return { success: false, error: 'Not supported in Electron' } }
  getToolsExpanded(): boolean { return false }
  setToolsExpanded(): void {}

  // ─── Lifecycle ─────────────────────────────────────────────

  dispose(): void {
    this.disposed = true
    // Resolve all pending dialogs with defaults
    for (const [id, entry] of this.pending) {
      entry.resolve(entry.method === 'confirm' ? false : undefined)
    }
    this.pending.clear()
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/services/piUIContext.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/services/piUIContext.ts src/main/services/piUIContext.test.ts
git commit -m "feat(pi-ui): add PiUIContext bridging extension UI to renderer via IPC"
```

---

## Task 3: IPC Wiring — Preload + Handlers

**Files:**
- Modify: `src/preload/api.d.ts:103-105` (extend pi section)
- Modify: `src/preload/index.ts:100-102` (extend pi section)
- Modify: `src/main/services/piExtensions.ts:26-34` (add IPC handler for responses)

**Step 1: Extend `api.d.ts` with new PI UI methods**

Add after existing `listExtensions()` in the `pi` section:

```typescript
pi: {
  listExtensions(): Promise<PIExtensionInfo[]>
  onUIEvent(callback: (event: PiUIEvent) => void): () => void
  onUIRequest(callback: (request: PiUIRequest) => void): () => void
  respondUI(id: string, response: PiUIResponse): void
}
```

Import `PiUIEvent`, `PiUIRequest`, `PiUIResponse` from `'../shared/piUITypes'`.

**Step 2: Extend `index.ts` preload with IPC listeners**

Add the 3 new methods to the `pi:` section:

```typescript
pi: {
  listExtensions: () => withTimeout(ipcRenderer.invoke('pi:listExtensions')),
  onUIEvent: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, event: unknown) => callback(event as never)
    ipcRenderer.on('pi:uiEvent', handler)
    return () => { ipcRenderer.removeListener('pi:uiEvent', handler) }
  },
  onUIRequest: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, request: unknown) => callback(request as never)
    ipcRenderer.on('pi:uiRequest', handler)
    return () => { ipcRenderer.removeListener('pi:uiRequest', handler) }
  },
  respondUI: (id, response) => {
    ipcRenderer.send('pi:uiResponse', { id, ...response })
  },
},
```

**Step 3: Add IPC handler in `piExtensions.ts` to route responses**

In `registerHandlers`, add a listener for `pi:uiResponse` that routes to the active `PiUIContext`. We need a module-level registry for active contexts:

```typescript
// Module-level registry of active PiUIContext instances (keyed by conversationId)
const activeContexts = new Map<number, { handleResponse: (r: PiUIResponse) => void }>()

export function registerPiUIContext(conversationId: number, ctx: { handleResponse: (r: PiUIResponse) => void }): void {
  activeContexts.set(conversationId, ctx)
}

export function unregisterPiUIContext(conversationId: number): void {
  activeContexts.delete(conversationId)
}
```

Add in `registerHandlers`:

```typescript
ipcMain.on('pi:uiResponse', (_event, response: PiUIResponse) => {
  // Route to all active contexts (response.id is unique per dialog)
  for (const ctx of activeContexts.values()) {
    ctx.handleResponse(response)
  }
})
```

**Step 4: Run build to verify types**

Run: `npm run build`
Expected: 0 errors

**Step 5: Commit**

```bash
git add src/preload/api.d.ts src/preload/index.ts src/main/services/piExtensions.ts
git commit -m "feat(pi-ui): wire IPC channels for extension UI events and responses"
```

---

## Task 4: Integration — Wire `PiUIContext` into `streamMessagePI.ts`

**Files:**
- Modify: `src/main/services/streamingPI.ts:61-67` (add bindExtensions after createAgentSession)

**Step 1: Import and wire**

After `createAgentSession()` (line 67), add:

```typescript
import { PiUIContext } from './piUIContext'
import { registerPiUIContext, unregisterPiUIContext } from './piExtensions'
```

After line 67 (`const { session } = await pi.createAgentSession({...})`):

```typescript
// Create UI context and bind to session for extension UI support
const uiContext = new PiUIContext(
  getMainWindow() || { webContents: { send: () => {} }, isDestroyed: () => true },
  convKey
)
registerPiUIContext(convKey, uiContext)
try {
  await session.bindExtensions({ uiContext: uiContext as never })
} catch (err) {
  console.log('[streamingPI] bindExtensions not available (PI SDK version may not support it)')
}
```

In the `finally` block (after `session.dispose()`), add:

```typescript
uiContext.dispose()
unregisterPiUIContext(convKey)
```

**Step 2: Import `getMainWindow`**

Add to imports at top of `streamingPI.ts`:

```typescript
import { getMainWindow } from '../index'
```

**Step 3: Run build to verify**

Run: `npm run build`
Expected: 0 errors

**Step 4: Run existing PI tests**

Run: `npx vitest run src/main/services/streamingPI.test.ts`
Expected: PASS (existing tests still pass)

**Step 5: Commit**

```bash
git add src/main/services/streamingPI.ts
git commit -m "feat(pi-ui): bind PiUIContext to Pi sessions for extension UI support"
```

---

## Task 5: Renderer Store — `piExtensionUIStore`

**Files:**
- Create: `src/renderer/stores/piExtensionUIStore.ts`
- Test: `src/renderer/stores/piExtensionUIStore.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { usePiExtensionUIStore } from './piExtensionUIStore'

describe('piExtensionUIStore', () => {
  beforeEach(() => {
    usePiExtensionUIStore.getState().reset()
  })

  describe('dialogs', () => {
    it('enqueues a dialog', () => {
      const store = usePiExtensionUIStore.getState()
      store.enqueueDialog({ id: '1', method: 'select', title: 'Pick', options: ['A'] })
      expect(store.activeDialog).toEqual({ id: '1', method: 'select', title: 'Pick', options: ['A'] })
    })

    it('queues second dialog when one is active', () => {
      const store = usePiExtensionUIStore.getState()
      store.enqueueDialog({ id: '1', method: 'select', title: 'Pick', options: ['A'] })
      store.enqueueDialog({ id: '2', method: 'confirm', title: 'Sure?', message: 'msg' })
      expect(usePiExtensionUIStore.getState().activeDialog?.id).toBe('1')
      expect(usePiExtensionUIStore.getState().dialogQueue).toHaveLength(1)
    })

    it('advances to next dialog on dismiss', () => {
      const store = usePiExtensionUIStore.getState()
      store.enqueueDialog({ id: '1', method: 'select', title: 'Pick', options: ['A'] })
      store.enqueueDialog({ id: '2', method: 'confirm', title: 'Sure?', message: 'msg' })
      store.dismissDialog()
      expect(usePiExtensionUIStore.getState().activeDialog?.id).toBe('2')
      expect(usePiExtensionUIStore.getState().dialogQueue).toHaveLength(0)
    })
  })

  describe('notifications', () => {
    it('adds a notification', () => {
      const store = usePiExtensionUIStore.getState()
      store.addNotification('hello', 'info')
      expect(usePiExtensionUIStore.getState().notifications).toHaveLength(1)
      expect(usePiExtensionUIStore.getState().notifications[0].message).toBe('hello')
    })

    it('removes a notification by id', () => {
      const store = usePiExtensionUIStore.getState()
      store.addNotification('hello', 'info')
      const id = usePiExtensionUIStore.getState().notifications[0].id
      store.removeNotification(id)
      expect(usePiExtensionUIStore.getState().notifications).toHaveLength(0)
    })

    it('limits to 5 notifications', () => {
      const store = usePiExtensionUIStore.getState()
      for (let i = 0; i < 7; i++) store.addNotification(`msg${i}`, 'info')
      expect(usePiExtensionUIStore.getState().notifications).toHaveLength(5)
    })
  })

  describe('status', () => {
    it('sets a status entry', () => {
      usePiExtensionUIStore.getState().setStatusEntry('ext1', 'Running')
      expect(usePiExtensionUIStore.getState().statusEntries).toEqual({ ext1: 'Running' })
    })

    it('clears a status entry', () => {
      usePiExtensionUIStore.getState().setStatusEntry('ext1', 'Running')
      usePiExtensionUIStore.getState().clearStatusEntry('ext1')
      expect(usePiExtensionUIStore.getState().statusEntries).toEqual({})
    })
  })

  describe('widgets', () => {
    it('sets a widget', () => {
      usePiExtensionUIStore.getState().setWidget('info', ['line1'], 'aboveEditor')
      expect(usePiExtensionUIStore.getState().widgets).toEqual({
        info: { key: 'info', content: ['line1'], placement: 'aboveEditor' },
      })
    })

    it('clears a widget', () => {
      usePiExtensionUIStore.getState().setWidget('info', ['line1'], 'aboveEditor')
      usePiExtensionUIStore.getState().clearWidget('info')
      expect(usePiExtensionUIStore.getState().widgets).toEqual({})
    })
  })

  describe('working message', () => {
    it('sets and clears', () => {
      usePiExtensionUIStore.getState().setWorkingMessage('Processing...')
      expect(usePiExtensionUIStore.getState().workingMessage).toBe('Processing...')
      usePiExtensionUIStore.getState().setWorkingMessage(undefined)
      expect(usePiExtensionUIStore.getState().workingMessage).toBeNull()
    })
  })

  describe('reset', () => {
    it('clears all state', () => {
      const store = usePiExtensionUIStore.getState()
      store.enqueueDialog({ id: '1', method: 'select', title: 'Pick', options: ['A'] })
      store.addNotification('hello', 'info')
      store.setStatusEntry('x', 'y')
      store.setWidget('w', ['l'], 'belowEditor')
      store.setWorkingMessage('busy')
      store.reset()
      const s = usePiExtensionUIStore.getState()
      expect(s.activeDialog).toBeNull()
      expect(s.dialogQueue).toEqual([])
      expect(s.notifications).toEqual([])
      expect(s.statusEntries).toEqual({})
      expect(s.widgets).toEqual({})
      expect(s.workingMessage).toBeNull()
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/stores/piExtensionUIStore.test.ts`
Expected: FAIL — module not found

**Step 3: Write the store**

```typescript
// src/renderer/stores/piExtensionUIStore.ts
import { create } from 'zustand'
import { randomUUID } from '../../shared/utils'
import type { PiUIDialog, PiUINotification, PiUIWidget } from '../../shared/piUITypes'

// Simple UUID fallback for renderer (crypto.randomUUID may not be available)
function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

interface PiExtensionUIState {
  activeDialog: PiUIDialog | null
  dialogQueue: PiUIDialog[]
  notifications: PiUINotification[]
  statusEntries: Record<string, string>
  widgets: Record<string, PiUIWidget>
  workingMessage: string | null
  headerComponent: unknown | null
  footerComponent: unknown | null
  titleOverride: string | null

  // Actions
  enqueueDialog: (dialog: PiUIDialog) => void
  dismissDialog: () => void
  addNotification: (message: string, level: 'info' | 'warning' | 'error') => void
  removeNotification: (id: string) => void
  setStatusEntry: (key: string, text: string) => void
  clearStatusEntry: (key: string) => void
  setWidget: (key: string, content: string[], placement: 'aboveEditor' | 'belowEditor') => void
  clearWidget: (key: string) => void
  setWorkingMessage: (message: string | undefined) => void
  setHeaderComponent: (component: unknown | null) => void
  setFooterComponent: (component: unknown | null) => void
  setTitleOverride: (title: string | null) => void
  reset: () => void
}

const INITIAL_STATE = {
  activeDialog: null,
  dialogQueue: [],
  notifications: [],
  statusEntries: {},
  widgets: {},
  workingMessage: null,
  headerComponent: null,
  footerComponent: null,
  titleOverride: null,
}

const MAX_NOTIFICATIONS = 5

export const usePiExtensionUIStore = create<PiExtensionUIState>((set) => ({
  ...INITIAL_STATE,

  enqueueDialog: (dialog) =>
    set((s) => {
      if (s.activeDialog === null) {
        return { activeDialog: dialog }
      }
      return { dialogQueue: [...s.dialogQueue, dialog] }
    }),

  dismissDialog: () =>
    set((s) => {
      const [next, ...rest] = s.dialogQueue
      return { activeDialog: next ?? null, dialogQueue: rest }
    }),

  addNotification: (message, level) =>
    set((s) => {
      const notification: PiUINotification = { id: uid(), message, level, timestamp: Date.now() }
      const updated = [...s.notifications, notification]
      return { notifications: updated.slice(-MAX_NOTIFICATIONS) }
    }),

  removeNotification: (id) =>
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),

  setStatusEntry: (key, text) =>
    set((s) => ({ statusEntries: { ...s.statusEntries, [key]: text } })),

  clearStatusEntry: (key) =>
    set((s) => {
      const { [key]: _, ...rest } = s.statusEntries
      return { statusEntries: rest }
    }),

  setWidget: (key, content, placement) =>
    set((s) => ({ widgets: { ...s.widgets, [key]: { key, content, placement } } })),

  clearWidget: (key) =>
    set((s) => {
      const { [key]: _, ...rest } = s.widgets
      return { statusEntries: rest }
    }),

  setWorkingMessage: (message) =>
    set({ workingMessage: message ?? null }),

  setHeaderComponent: (component) =>
    set({ headerComponent: component }),

  setFooterComponent: (component) =>
    set({ footerComponent: component }),

  setTitleOverride: (title) =>
    set({ titleOverride: title }),

  reset: () => set(INITIAL_STATE),
}))
```

Note: The `clearWidget` action has a bug (sets `statusEntries` instead of `widgets`). Fix it:

```typescript
  clearWidget: (key) =>
    set((s) => {
      const { [key]: _, ...rest } = s.widgets
      return { widgets: rest }
    }),
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/stores/piExtensionUIStore.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/stores/piExtensionUIStore.ts src/renderer/stores/piExtensionUIStore.test.ts
git commit -m "feat(pi-ui): add Zustand store for extension UI state"
```

---

## Task 6: IPC Listener Hook — `usePiExtensionUI`

**Files:**
- Create: `src/renderer/hooks/usePiExtensionUI.ts`

**Step 1: Write the hook**

This hook subscribes to `pi:uiRequest` and `pi:uiEvent` IPC channels and routes them to the Zustand store. Should be mounted once in the top-level `ChatView`.

```typescript
// src/renderer/hooks/usePiExtensionUI.ts
import { useEffect } from 'react'
import { usePiExtensionUIStore } from '../stores/piExtensionUIStore'
import type { PiUIRequest, PiUIEvent } from '../../shared/piUITypes'

export function usePiExtensionUI(): void {
  const enqueueDialog = usePiExtensionUIStore((s) => s.enqueueDialog)
  const addNotification = usePiExtensionUIStore((s) => s.addNotification)
  const setStatusEntry = usePiExtensionUIStore((s) => s.setStatusEntry)
  const clearStatusEntry = usePiExtensionUIStore((s) => s.clearStatusEntry)
  const setWidget = usePiExtensionUIStore((s) => s.setWidget)
  const clearWidget = usePiExtensionUIStore((s) => s.clearWidget)
  const setWorkingMessage = usePiExtensionUIStore((s) => s.setWorkingMessage)
  const setHeaderComponent = usePiExtensionUIStore((s) => s.setHeaderComponent)
  const setFooterComponent = usePiExtensionUIStore((s) => s.setFooterComponent)
  const setTitleOverride = usePiExtensionUIStore((s) => s.setTitleOverride)

  useEffect(() => {
    const unsubRequest = window.agent.pi.onUIRequest((request: PiUIRequest) => {
      enqueueDialog(request)
    })

    const unsubEvent = window.agent.pi.onUIEvent((event: PiUIEvent) => {
      switch (event.method) {
        case 'notify':
          addNotification(event.message, event.level || 'info')
          break
        case 'setStatus':
          if (event.text != null) setStatusEntry(event.key, event.text)
          else clearStatusEntry(event.key)
          break
        case 'setWidget':
          if (event.content != null) setWidget(event.key, event.content, event.placement || 'belowEditor')
          else clearWidget(event.key)
          break
        case 'setWorkingMessage':
          setWorkingMessage(event.message)
          break
        case 'setTitle':
          setTitleOverride(event.title)
          break
        case 'setHeader':
          setHeaderComponent(event.component ?? null)
          break
        case 'setFooter':
          setFooterComponent(event.component ?? null)
          break
      }
    })

    return () => {
      unsubRequest()
      unsubEvent()
    }
  }, []) // Empty deps: subscribe once
}
```

**Step 2: Run build**

Run: `npm run build`
Expected: 0 errors

**Step 3: Commit**

```bash
git add src/renderer/hooks/usePiExtensionUI.ts
git commit -m "feat(pi-ui): add hook to route IPC extension UI events to Zustand store"
```

---

## Task 7: React Components — Dialogs

**Files:**
- Create: `src/renderer/components/extensions/ExtensionDialog.tsx`
- Test: `src/renderer/components/extensions/ExtensionDialog.test.tsx`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExtensionDialog } from './ExtensionDialog'

describe('ExtensionDialog', () => {
  const onRespond = vi.fn()

  beforeEach(() => {
    onRespond.mockClear()
  })

  it('renders select dialog with options', () => {
    render(<ExtensionDialog dialog={{ id: '1', method: 'select', title: 'Pick one', options: ['A', 'B', 'C'] }} onRespond={onRespond} />)
    expect(screen.getByText('Pick one')).toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
  })

  it('calls onRespond with selected value', () => {
    render(<ExtensionDialog dialog={{ id: '1', method: 'select', title: 'Pick', options: ['A', 'B'] }} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('B'))
    expect(onRespond).toHaveBeenCalledWith({ id: '1', value: 'B' })
  })

  it('renders confirm dialog with Yes/No', () => {
    render(<ExtensionDialog dialog={{ id: '2', method: 'confirm', title: 'Sure?', message: 'Delete file?' }} onRespond={onRespond} />)
    expect(screen.getByText('Sure?')).toBeInTheDocument()
    expect(screen.getByText('Delete file?')).toBeInTheDocument()
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(screen.getByText('No')).toBeInTheDocument()
  })

  it('confirm Yes sends confirmed: true', () => {
    render(<ExtensionDialog dialog={{ id: '2', method: 'confirm', title: 'Sure?', message: 'msg' }} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('Yes'))
    expect(onRespond).toHaveBeenCalledWith({ id: '2', confirmed: true })
  })

  it('renders input dialog with text field', () => {
    render(<ExtensionDialog dialog={{ id: '3', method: 'input', title: 'Name', placeholder: 'Enter name' }} onRespond={onRespond} />)
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter name')).toBeInTheDocument()
  })

  it('renders editor dialog with textarea', () => {
    render(<ExtensionDialog dialog={{ id: '4', method: 'editor', title: 'Edit', prefill: 'hello' }} onRespond={onRespond} />)
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByDisplayValue('hello')).toBeInTheDocument()
  })

  it('ESC sends cancelled response', () => {
    render(<ExtensionDialog dialog={{ id: '1', method: 'select', title: 'Pick', options: ['A'] }} onRespond={onRespond} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onRespond).toHaveBeenCalledWith({ id: '1', cancelled: true })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/extensions/ExtensionDialog.test.tsx`
Expected: FAIL — module not found

**Step 3: Write the component**

Create `src/renderer/components/extensions/ExtensionDialog.tsx` — a modal overlay that renders the appropriate dialog variant based on `dialog.method`. Uses CSS variables for theming, keyboard ESC to cancel, and calls `onRespond` with the appropriate `PiUIResponse`.

The component renders:
- **select**: Title + clickable option buttons (vertical list)
- **confirm**: Title + message text + Yes/No buttons
- **input**: Title + single-line text input + Submit/Cancel
- **editor**: Title + multi-line textarea + Submit/Cancel

All share a common modal wrapper: semi-transparent backdrop, centered card with `var(--color-surface)` background.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/extensions/ExtensionDialog.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/components/extensions/ExtensionDialog.tsx src/renderer/components/extensions/ExtensionDialog.test.tsx
git commit -m "feat(pi-ui): add ExtensionDialog component for select/confirm/input/editor"
```

---

## Task 8: React Components — Toasts, Status, Widgets

**Files:**
- Create: `src/renderer/components/extensions/ExtensionToast.tsx`
- Create: `src/renderer/components/extensions/ExtensionWidget.tsx`

**Step 1: Write `ExtensionToast`**

A toast notification component. Receives `notifications` array from the store. Each notification renders as a floating card in the top-right corner. Auto-dismiss via `setTimeout(5000)` calling `removeNotification`. Color-coded by level: info=accent, warning=orange, error=red.

**Step 2: Write `ExtensionWidget`**

Renders widgets (text blocks) above or below the message input. Receives `widgets` record from the store. Each widget has a left accent border and monospace text content (similar to ToolUseBlock styling).

**Step 3: Run build**

Run: `npm run build`
Expected: 0 errors

**Step 4: Commit**

```bash
git add src/renderer/components/extensions/ExtensionToast.tsx src/renderer/components/extensions/ExtensionWidget.tsx
git commit -m "feat(pi-ui): add ExtensionToast and ExtensionWidget components"
```

---

## Task 9: Integration — Mount in ChatView

**Files:**
- Modify: `src/renderer/pages/ChatView.tsx` (add hook + render extension components)
- Modify: `src/renderer/components/chat/ChatStatusLine.tsx` (add extension status entries)

**Step 1: Mount `usePiExtensionUI` hook in ChatView**

At top of `ChatView` function, add:

```typescript
import { usePiExtensionUI } from '../hooks/usePiExtensionUI'
import { usePiExtensionUIStore } from '../stores/piExtensionUIStore'
import { ExtensionDialog } from '../components/extensions/ExtensionDialog'
import { ExtensionToast } from '../components/extensions/ExtensionToast'
import { ExtensionWidget } from '../components/extensions/ExtensionWidget'
```

Call `usePiExtensionUI()` at top of component.

Read store state:
```typescript
const activeDialog = usePiExtensionUIStore((s) => s.activeDialog)
const notifications = usePiExtensionUIStore((s) => s.notifications)
const widgets = usePiExtensionUIStore((s) => s.widgets)
const statusEntries = usePiExtensionUIStore((s) => s.statusEntries)
const workingMessage = usePiExtensionUIStore((s) => s.workingMessage)
const dismissDialog = usePiExtensionUIStore((s) => s.dismissDialog)
const removeNotification = usePiExtensionUIStore((s) => s.removeNotification)
```

**Step 2: Render components**

- `ExtensionDialog`: render when `activeDialog !== null`, on respond: `window.agent.pi.respondUI(...)` then `dismissDialog()`
- `ExtensionToast`: render when `notifications.length > 0`
- `ExtensionWidget` (aboveEditor): render widgets with placement `'aboveEditor'` above the MessageInput
- `ExtensionWidget` (belowEditor): render widgets with placement `'belowEditor'` below the MessageInput

**Step 3: Reset extension UI on conversation change**

In the existing `useEffect` that watches `conversationId`, add:
```typescript
usePiExtensionUIStore.getState().reset()
```

**Step 4: Pass statusEntries to ChatStatusLine**

Extend `ChatStatusLine` props with `extensionStatus?: Record<string, string>` and render them as small badges after the KB section.

**Step 5: Run build + tests**

Run: `npm run build && npm test`
Expected: 0 errors, all tests pass

**Step 6: Commit**

```bash
git add src/renderer/pages/ChatView.tsx src/renderer/components/chat/ChatStatusLine.tsx
git commit -m "feat(pi-ui): mount extension UI components in ChatView and status line"
```

---

## Task 10: End-to-End Verification

**Files:**
- None (manual testing)

**Step 1: Build**

Run: `npm run build`
Expected: 0 errors

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass (existing + new)

**Step 3: Manual smoke test**

1. Start dev server: `npm run dev`
2. Switch backend to PI
3. Use a Pi extension that calls `ctx.ui.select()` or `ctx.ui.confirm()`
4. Verify dialog renders as a modal overlay
5. Verify selecting an option resolves and the extension proceeds
6. Test notification toast (if extension calls `ctx.ui.notify()`)
7. Test ESC to cancel a dialog

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(pi-ui): complete Pi extension UI support — dialogs, toasts, status, widgets"
```

---

## Summary of Files

| File | Action | Task |
|------|--------|------|
| `src/shared/piUITypes.ts` | Create | 1 |
| `src/shared/piUITypes.test.ts` | Create | 1 |
| `src/main/services/piUIContext.ts` | Create | 2 |
| `src/main/services/piUIContext.test.ts` | Create | 2 |
| `src/preload/api.d.ts` | Modify (pi section) | 3 |
| `src/preload/index.ts` | Modify (pi section) | 3 |
| `src/main/services/piExtensions.ts` | Modify (add response handler) | 3 |
| `src/main/services/streamingPI.ts` | Modify (bind PiUIContext) | 4 |
| `src/renderer/stores/piExtensionUIStore.ts` | Create | 5 |
| `src/renderer/stores/piExtensionUIStore.test.ts` | Create | 5 |
| `src/renderer/hooks/usePiExtensionUI.ts` | Create | 6 |
| `src/renderer/components/extensions/ExtensionDialog.tsx` | Create | 7 |
| `src/renderer/components/extensions/ExtensionDialog.test.tsx` | Create | 7 |
| `src/renderer/components/extensions/ExtensionToast.tsx` | Create | 8 |
| `src/renderer/components/extensions/ExtensionWidget.tsx` | Create | 8 |
| `src/renderer/pages/ChatView.tsx` | Modify | 9 |
| `src/renderer/components/chat/ChatStatusLine.tsx` | Modify | 9 |

**File ownership:** Each task has exclusive WRITE ownership of its files. Tasks 3, 4, and 9 modify existing files but touch non-overlapping sections.
