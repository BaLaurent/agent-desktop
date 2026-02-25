import { useSyncExternalStore } from 'react'

export const MOBILE_BREAKPOINT = 768
export const COMPACT_BREAKPOINT = 1024

function getIsMobile(): boolean {
  if (typeof window === 'undefined') return false
  if ((window as any).__AGENT_WEB_MODE__) return true
  return window.innerWidth < MOBILE_BREAKPOINT
}

function getIsCompact(): boolean {
  if (typeof window === 'undefined') return false
  return getIsMobile() || window.innerWidth < COMPACT_BREAKPOINT
}

// Keep .mobile and .compact classes on <html> in sync
function syncClasses() {
  document.documentElement.classList.toggle('mobile', getIsMobile())
  document.documentElement.classList.toggle('compact', getIsCompact())
}

// Module-level: sync immediately + on every resize
if (typeof window !== 'undefined') {
  syncClasses()
  window.addEventListener('resize', syncClasses)
}

// useSyncExternalStore plumbing — single global subscription
function subscribe(cb: () => void): () => void {
  window.addEventListener('resize', cb)
  return () => window.removeEventListener('resize', cb)
}

/** True when touch-friendly UI needed: web mode OR viewport < 768px */
export function useMobileMode(): boolean {
  return useSyncExternalStore(subscribe, getIsMobile)
}

/** True when sidebar/panel should use overlay: mobile OR viewport < 1024px */
export function useCompactMode(): boolean {
  return useSyncExternalStore(subscribe, getIsCompact)
}
