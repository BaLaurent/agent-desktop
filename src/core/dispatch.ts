import { createLogger } from './utils/logger'

const log = createLogger('dispatch')

/**
 * Interface for registering IPC-style handlers.
 * Satisfied by both DispatchRegistry (headless) and Electron's IpcMain (via bridge).
 */
export interface HandleRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

/**
 * Engine-owned dispatch registry.
 * Canonical source of truth for all callable operations.
 * Replaces the side-effect-based ipcDispatch Map.
 */
export class DispatchRegistry implements HandleRegistrar {
  private handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    if (this.handlers.has(channel)) {
      log.warn(`duplicate handler registration for "${channel}" — second registration overrides first`, { channel })
    }
    this.handlers.set(channel, async (...args: unknown[]) => listener(null, ...args))
  }

  get(channel: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
    return this.handlers.get(channel)
  }

  // public registry surface; consumed by src/main/ipc.ts
  has(channel: string): boolean {
    return this.handlers.has(channel)
  }

  // public registry surface; consumed by src/main/ipc.ts
  entries(): IterableIterator<[string, (...args: unknown[]) => Promise<unknown>]> {
    return this.handlers.entries()
  }
}
