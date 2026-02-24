export function useMobileMode(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__AGENT_WEB_MODE__
}
