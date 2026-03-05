import { randomUUID } from 'crypto'
import type { PiUIResponse } from '../../shared/piUITypes'

interface PendingDialog {
  resolve: (value: unknown) => void
  method: string
}

type WinLike = {
  webContents: { send: (channel: string, data: unknown) => void }
  isDestroyed: () => boolean
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
  private win: WinLike
  private conversationId: number | undefined

  constructor(win: WinLike, conversationId?: number) {
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
    return this.request<string | undefined>('select', {
      title,
      options,
      ...(opts?.timeout ? { timeout: opts.timeout } : {}),
    })
  }

  async confirm(title: string, message: string, opts?: { timeout?: number }): Promise<boolean> {
    return this.request<boolean>('confirm', {
      title,
      message,
      ...(opts?.timeout ? { timeout: opts.timeout } : {}),
    })
  }

  async input(title: string, placeholder?: string, opts?: { timeout?: number }): Promise<string | undefined> {
    return this.request<string | undefined>('input', {
      title,
      placeholder,
      ...(opts?.timeout ? { timeout: opts.timeout } : {}),
    })
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
  get theme(): Record<string, unknown> {
    // Stub theme — fg/bg/bold/etc. just pass through the text (no ANSI codes in Electron)
    const passthrough = (_color: string, text: string) => text
    return { fg: passthrough, bg: passthrough, bold: passthrough, dim: passthrough, italic: passthrough, underline: passthrough, strikethrough: passthrough }
  }
  getAllThemes(): { name: string; path: string | undefined }[] { return [] }
  getTheme(): unknown { return undefined }
  setTheme(): { success: boolean; error?: string } { return { success: false, error: 'Not supported in Electron' } }
  getToolsExpanded(): boolean { return false }
  setToolsExpanded(): void {}

  // ─── Lifecycle ─────────────────────────────────────────────

  dispose(): void {
    this.disposed = true
    for (const [, entry] of this.pending) {
      entry.resolve(entry.method === 'confirm' ? false : undefined)
    }
    this.pending.clear()
  }
}
