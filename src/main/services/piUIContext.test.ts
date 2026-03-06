import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('crypto', () => {
  let counter = 0
  return {
    randomUUID: vi.fn(() => `test-uuid-${++counter}`),
  }
})

import { PiUIContext } from './piUIContext'

/** Extract the request ID from the most recent pi:uiRequest send call */
function lastRequestId(send: ReturnType<typeof vi.fn>): string {
  const calls = send.mock.calls.filter((c: unknown[]) => c[0] === 'pi:uiRequest')
  const last = calls[calls.length - 1]
  return (last[1] as { id: string }).id
}

describe('PiUIContext', () => {
  let mockWebContents: { send: ReturnType<typeof vi.fn> }
  let mockWin: { webContents: typeof mockWebContents; isDestroyed: () => boolean }
  let ctx: PiUIContext

  beforeEach(() => {
    mockWebContents = { send: vi.fn() }
    mockWin = { webContents: mockWebContents, isDestroyed: () => false }
    ctx = new PiUIContext(mockWin, 42)
  })

  describe('select', () => {
    it('sends pi:uiRequest with correct params', () => {
      ctx.select('Pick one', ['A', 'B'])
      expect(mockWebContents.send).toHaveBeenCalledWith('pi:uiRequest', expect.objectContaining({
        method: 'select',
        title: 'Pick one',
        options: ['A', 'B'],
      }))
      ctx.handleResponse({ id: lastRequestId(mockWebContents.send), value: 'A' })
    })

    it('resolves with selected value', async () => {
      const promise = ctx.select('Pick', ['A', 'B'])
      ctx.handleResponse({ id: lastRequestId(mockWebContents.send), value: 'A' })
      expect(await promise).toBe('A')
    })

    it('resolves with undefined on cancel', async () => {
      const promise = ctx.select('Pick', ['A'])
      ctx.handleResponse({ id: lastRequestId(mockWebContents.send), cancelled: true })
      expect(await promise).toBeUndefined()
    })
  })

  describe('confirm', () => {
    it('sends pi:uiRequest with correct params', () => {
      ctx.confirm('Sure?', 'Delete file?')
      expect(mockWebContents.send).toHaveBeenCalledWith('pi:uiRequest', expect.objectContaining({
        method: 'confirm',
        title: 'Sure?',
        message: 'Delete file?',
      }))
      ctx.handleResponse({ id: lastRequestId(mockWebContents.send), confirmed: true })
    })

    it('resolves with boolean', async () => {
      const promise = ctx.confirm('Sure?', 'msg')
      ctx.handleResponse({ id: lastRequestId(mockWebContents.send), confirmed: false })
      expect(await promise).toBe(false)
    })

    it('resolves with false on cancel', async () => {
      const promise = ctx.confirm('Sure?', 'msg')
      ctx.handleResponse({ id: lastRequestId(mockWebContents.send), cancelled: true })
      expect(await promise).toBe(false)
    })
  })

  describe('input', () => {
    it('resolves with entered text', async () => {
      const promise = ctx.input('Name', 'placeholder')
      ctx.handleResponse({ id: lastRequestId(mockWebContents.send), value: 'Claude' })
      expect(await promise).toBe('Claude')
    })

    it('resolves with undefined on cancel', async () => {
      const promise = ctx.input('Name')
      ctx.handleResponse({ id: lastRequestId(mockWebContents.send), cancelled: true })
      expect(await promise).toBeUndefined()
    })
  })

  describe('editor', () => {
    it('resolves with edited text', async () => {
      const promise = ctx.editor('Edit code', 'original')
      ctx.handleResponse({ id: lastRequestId(mockWebContents.send), value: 'modified' })
      expect(await promise).toBe('modified')
    })

    it('resolves with undefined on cancel', async () => {
      const promise = ctx.editor('Edit code', 'original')
      ctx.handleResponse({ id: lastRequestId(mockWebContents.send), cancelled: true })
      expect(await promise).toBeUndefined()
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

  describe('setTitle', () => {
    it('sends title event', () => {
      ctx.setTitle('My Extension')
      expect(mockWebContents.send).toHaveBeenCalledWith('pi:uiEvent', {
        method: 'setTitle',
        title: 'My Extension',
      })
    })
  })

  describe('custom (headless TUI bridge)', () => {
    it('calls factory with mock TUI, theme, keybindings, and done callback', async () => {
      const factory = vi.fn((_tui: unknown, _theme: unknown, _kb: unknown, done: (r: string) => void) => {
        done('result')
        return { render: () => ['line'], handleInput: vi.fn() }
      })
      const result = await ctx.custom(factory)
      expect(factory).toHaveBeenCalledTimes(1)
      expect(result).toBe('result')
    })

    it('sends pi:uiRequest with method custom_tui and rendered html', async () => {
      const factory = vi.fn((_tui: unknown, _theme: unknown, _kb: unknown, done: (r: string) => void) => {
        setTimeout(() => done('ok'), 10)
        return { render: () => ['hello'] }
      })
      const promise = ctx.custom(factory)
      await new Promise(r => setTimeout(r, 0))
      expect(mockWebContents.send).toHaveBeenCalledWith('pi:uiRequest', expect.objectContaining({
        method: 'custom_tui',
      }))
      const call = mockWebContents.send.mock.calls.find(
        (c: unknown[]) => (c[1] as { method: string }).method === 'custom_tui'
      )
      expect((call![1] as { html: string }).html).toContain('hello')
      await promise
    })

    it('handleTuiInput forwards data to component.handleInput', async () => {
      const handleInput = vi.fn()
      const factory = vi.fn((_tui: unknown, _theme: unknown, _kb: unknown, done: (r: string) => void) => {
        setTimeout(() => done('ok'), 50)
        return { render: () => ['line'], handleInput }
      })
      const promise = ctx.custom(factory)
      await new Promise(r => setTimeout(r, 0))
      const id = lastRequestId(mockWebContents.send)
      ctx.handleTuiInput(id, '\x1b[A')
      expect(handleInput).toHaveBeenCalledWith('\x1b[A')
      await promise
    })

    it('requestRender on mock TUI triggers pi:tuiRender', async () => {
      let mockTui: { requestRender: () => void } | undefined
      const factory = vi.fn((tui: { requestRender: () => void }, _theme: unknown, _kb: unknown, done: (r: string) => void) => {
        mockTui = tui
        setTimeout(() => done('ok'), 50)
        return { render: () => ['updated'] }
      })
      const promise = ctx.custom(factory)
      await new Promise(r => setTimeout(r, 0))
      mockTui!.requestRender()
      expect(mockWebContents.send).toHaveBeenCalledWith('pi:tuiRender', expect.objectContaining({
        html: expect.stringContaining('updated'),
      }))
      await promise
    })

    it('sends pi:tuiDone when done() fires', async () => {
      const factory = vi.fn((_tui: unknown, _theme: unknown, _kb: unknown, done: (r: string) => void) => {
        setTimeout(() => done('result'), 10)
        return { render: () => ['line'] }
      })
      await ctx.custom(factory)
      expect(mockWebContents.send).toHaveBeenCalledWith('pi:tuiDone', expect.objectContaining({
        id: expect.any(String),
      }))
    })

    it('resolves with undefined on cancel via handleResponse', async () => {
      const factory = vi.fn((_tui: unknown, _theme: unknown, _kb: unknown, _done: (r: string) => void) => {
        return { render: () => ['line'] }
      })
      const promise = ctx.custom(factory)
      await new Promise(r => setTimeout(r, 0))
      const id = lastRequestId(mockWebContents.send)
      ctx.handleResponse({ id, cancelled: true })
      expect(await promise).toBeUndefined()
    })

    it('dispose resolves pending custom with undefined and calls component.dispose', async () => {
      const disposeFn = vi.fn()
      const factory = vi.fn((_tui: unknown, _theme: unknown, _kb: unknown, _done: (r: string) => void) => {
        return { render: () => ['line'], dispose: disposeFn }
      })
      const promise = ctx.custom(factory)
      await new Promise(r => setTimeout(r, 0))
      ctx.dispose()
      expect(await promise).toBeUndefined()
      expect(disposeFn).toHaveBeenCalled()
    })

    it('handles async factory (returns Promise)', async () => {
      const factory = vi.fn(async (_tui: unknown, _theme: unknown, _kb: unknown, done: (r: string) => void) => {
        await new Promise(r => setTimeout(r, 5))
        done('async-result')
        return { render: () => ['async'] }
      })
      const result = await ctx.custom(factory)
      expect(result).toBe('async-result')
    })

    it('ignores handleTuiInput for unknown id', () => {
      // Should not throw
      ctx.handleTuiInput('nonexistent', '\x1b[A')
    })
  })

  describe('dispose', () => {
    it('resolves pending dialogs with defaults', async () => {
      const selectPromise = ctx.select('Pick', ['A'])
      const selectId = lastRequestId(mockWebContents.send)
      const confirmPromise = ctx.confirm('Sure?', 'msg')
      const confirmId = lastRequestId(mockWebContents.send)

      // IDs must be different for both to be pending
      expect(selectId).not.toBe(confirmId)

      ctx.dispose()
      expect(await selectPromise).toBeUndefined()
      expect(await confirmPromise).toBe(false)
    })

    it('makes subsequent send calls no-op', () => {
      ctx.dispose()
      ctx.notify('Hello')
      expect(mockWebContents.send).not.toHaveBeenCalled()
    })

    it('ignores responses after dispose', () => {
      ctx.dispose()
      // Should not throw
      ctx.handleResponse({ id: 'nonexistent', value: 'A' })
    })
  })

  describe('destroyed window', () => {
    it('does not send when window is destroyed', () => {
      const destroyedWin = {
        webContents: { send: vi.fn() },
        isDestroyed: () => true,
      }
      const destroyedCtx = new PiUIContext(destroyedWin, 1)
      destroyedCtx.notify('Hello')
      expect(destroyedWin.webContents.send).not.toHaveBeenCalled()
    })
  })
})
