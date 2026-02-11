import { vi } from 'vitest'

export function createMockIpcMain() {
  const handlers = new Map<string, Function>()
  return {
    handle: vi.fn((channel: string, handler: Function) => {
      handlers.set(channel, handler)
    }),
    invoke: async (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`No handler for ${channel}`)
      return handler({}, ...args)
    },
  }
}
