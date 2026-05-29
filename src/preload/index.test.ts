import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted above module-level vars — capture the exposed
// API and the invoke spy through vi.hoisted so the factory can reach them.
const h = vi.hoisted(() => ({
  store: { api: null as unknown },
  invoke: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_key: string, api: unknown) => {
      h.store.api = api
    },
  },
  ipcRenderer: {
    invoke: (...args: unknown[]) => h.invoke(...args),
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
  },
  webUtils: { getPathForFile: vi.fn() },
}))

// Importing the preload runs contextBridge.exposeInMainWorld synchronously,
// populating h.store.api.
import './index'

type StreamingApi = {
  messages: {
    send: (c: number, content: string) => Promise<unknown>
    regenerate: (c: number) => Promise<unknown>
    edit: (m: number, content: string) => Promise<unknown>
    compact: (c: number) => Promise<unknown>
  }
}

function callStreaming(method: 'send' | 'regenerate' | 'edit' | 'compact'): Promise<unknown> {
  const m = (h.store.api as StreamingApi).messages
  switch (method) {
    case 'send': return m.send(1, 'x')
    case 'regenerate': return m.regenerate(1)
    case 'edit': return m.edit(1, 'x')
    case 'compact': return m.compact(1)
  }
}

describe('preload streaming RPCs', () => {
  beforeEach(() => {
    h.invoke.mockReset()
  })

  // Issue #8 (Timeout Bug): a long agentic turn that runs silently for minutes
  // must not be killed by a client-side timeout. The IPC promise resolves only
  // when the whole turn completes, so any fixed total-duration cap turns a
  // healthy-but-slow turn into a false "server not responding" + lost work.
  it.each(['send', 'regenerate', 'edit', 'compact'] as const)(
    'does not impose a client-side timeout on messages:%s',
    async (method) => {
      vi.useFakeTimers()
      try {
        let resolveInvoke!: (v: unknown) => void
        h.invoke.mockReturnValueOnce(new Promise((res) => { resolveInvoke = res }))

        const call = callStreaming(method)
        let settled = false
        void call.then(() => { settled = true }, () => { settled = true })

        // Advance far beyond the old 300s total-duration cap.
        await vi.advanceTimersByTimeAsync(600_000)
        expect(settled).toBe(false)

        // Completion is driven purely by the underlying IPC resolving.
        resolveInvoke({ ok: true })
        await vi.advanceTimersByTimeAsync(0)
        await expect(call).resolves.toEqual({ ok: true })
      } finally {
        vi.useRealTimers()
      }
    }
  )
})
