type BroadcastFn = (channel: string, ...args: unknown[]) => void

let broadcastFn: BroadcastFn | null = null

export function setBroadcastHandler(fn: BroadcastFn): void {
  broadcastFn = fn
}

export function broadcast(channel: string, ...args: unknown[]): void {
  broadcastFn?.(channel, ...args)
}
