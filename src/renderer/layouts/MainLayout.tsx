import { useRef, useCallback, useEffect } from 'react'
import { useUiStore } from '../stores/uiStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useConversationsStore } from '../stores/conversationsStore'
import { Sidebar } from '../components/sidebar/Sidebar'
import { ChatView } from '../pages/ChatView'
import { FileExplorerPanel } from '../components/panel/FileExplorerPanel'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { useMobileMode, useCompactMode } from '../hooks/useMobileMode'
import { useEdgeSwipe, useSwipeDismiss } from '../hooks/useEdgeSwipe'

const DEFAULT_RADIUS_PCT = 10

function PanelEdgeButton({ side, isOpen, onClick, radiusPct, alwaysVisible, mobile }: {
  side: 'left' | 'right'; isOpen: boolean; onClick: () => void; radiusPct: number; alwaysVisible: boolean; mobile?: boolean
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const radiusRef = useRef(radiusPct)
  radiusRef.current = radiusPct

  // Desktop-only: proximity-based opacity (skipped in mobile — no mousemove on touch)
  useEffect(() => {
    if (mobile) return
    const btn = btnRef.current
    if (!btn) return

    if (alwaysVisible) {
      btn.style.opacity = '1'
      return
    }

    btn.style.opacity = '0'
    const onMove = (e: MouseEvent) => {
      const r = btn.getBoundingClientRect()
      const dist = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2))
      const pxRadius = (radiusRef.current / 100) * window.innerWidth
      btn.style.opacity = pxRadius > 0
        ? String(Math.max(0, Math.min(1, 1 - dist / pxRadius)))
        : '0'
    }
    document.addEventListener('mousemove', onMove)
    return () => document.removeEventListener('mousemove', onMove)
  }, [alwaysVisible, mobile])

  // Mobile: hide the panel (right) button entirely
  if (mobile && side === 'right') return null

  // Mobile: render a hamburger button at top-left of chat
  if (mobile && side === 'left') {
    return (
      <button
        onClick={onClick}
        className="absolute top-2 left-2 z-10 flex items-center justify-center cursor-pointer rounded-md"
        style={{
          width: 44,
          height: 44,
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-text)',
        }}
        aria-label={isOpen ? 'Close sidebar' : 'Open sidebar'}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M3 5H17M3 10H17M3 15H17" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" />
        </svg>
      </button>
    )
  }

  // Left open → chevron left (collapse). Left closed → chevron right (expand).
  // Right open → chevron right (collapse). Right closed → chevron left (expand).
  const pointsRight = (side === 'left') !== isOpen

  return (
    <button
      ref={btnRef}
      onClick={onClick}
      className={`absolute top-1/2 -translate-y-1/2 z-10 flex items-center justify-center cursor-pointer
        ${side === 'left' ? 'left-0 rounded-r-md' : 'right-0 rounded-l-md'}`}
      style={{
        opacity: 0,
        width: 20,
        height: 48,
        backgroundColor: 'var(--color-surface)',
        color: 'var(--color-text)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor =
          'color-mix(in srgb, var(--color-primary) 25%, var(--color-surface))'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--color-surface)'
      }}
      aria-label={side === 'left'
        ? (isOpen ? 'Collapse sidebar' : 'Expand sidebar')
        : (isOpen ? 'Collapse panel' : 'Expand panel')}
    >
      <svg width="10" height="16" viewBox="0 0 10 16" fill="none"
        style={{ transform: pointsRight ? undefined : 'scaleX(-1)' }}>
        <path d="M2 2L8 8L2 14" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

export function MainLayout({ onOpenSettings, onOpenScheduler }: { onOpenSettings?: () => void; onOpenScheduler?: () => void }) {
  const { sidebarVisible, panelVisible, toggleSidebar, togglePanel } = useUiStore()
  const panelButtonRadiusPct = Number(useSettingsStore((s) => s.settings.panelButtonRadius)) || DEFAULT_RADIUS_PCT
  const panelButtonAlwaysVisible = useSettingsStore((s) => s.settings.panelButtonAlwaysVisible) === 'true'
  const { activeConversationId, conversations } = useConversationsStore()
  const sidebarRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const mobile = useMobileMode()
  const compact = useCompactMode()

  const activeConversation = conversations.find((c) => c.id === activeConversationId) ?? null

  // Compact/mobile: auto-close sidebar when user selects a conversation
  useEffect(() => {
    if (compact && activeConversationId && sidebarVisible) {
      useUiStore.setState({ sidebarVisible: false })
    }
  }, [compact, activeConversationId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-close sidebar+panel when viewport shrinks into compact mode
  const prevCompact = useRef(compact)
  useEffect(() => {
    if (compact && !prevCompact.current) {
      if (sidebarVisible) useUiStore.setState({ sidebarVisible: false })
      if (panelVisible) useUiStore.setState({ panelVisible: false })
    }
    prevCompact.current = compact
  }, [compact]) // eslint-disable-line react-hooks/exhaustive-deps

  const closeSidebar = useCallback(() => {
    useUiStore.setState({ sidebarVisible: false })
  }, [])

  const closePanel = useCallback(() => {
    useUiStore.setState({ panelVisible: false })
  }, [])

  // Mobile: swipe from left edge → open sidebar; swipe from right edge → open file explorer
  const openSidebar = useCallback(() => {
    useUiStore.setState({ sidebarVisible: true })
  }, [])
  const openPanel = useCallback(() => {
    useUiStore.setState({ panelVisible: true })
  }, [])
  useEdgeSwipe(
    mobile && !sidebarVisible && !panelVisible ? openSidebar : null,
    mobile && !panelVisible && !sidebarVisible ? openPanel : null,
  )
  // Swipe to dismiss: swipe left closes sidebar, swipe right closes file explorer
  useSwipeDismiss(
    mobile && sidebarVisible ? 'left' : null,
    closeSidebar,
  )
  useSwipeDismiss(
    mobile && panelVisible ? 'right' : null,
    closePanel,
  )

  const onSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarRef.current?.offsetWidth ?? 280

    const onMove = (moveEvent: MouseEvent) => {
      if (!sidebarRef.current) return
      const newWidth = Math.max(200, Math.min(500, startWidth + moveEvent.clientX - startX))
      sidebarRef.current.style.width = `${newWidth}px`
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const onPanelResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = panelRef.current?.offsetWidth ?? 400

    const onMove = (moveEvent: MouseEvent) => {
      if (!panelRef.current) return
      const newWidth = Math.max(300, Math.min(700, startWidth - (moveEvent.clientX - startX)))
      panelRef.current.style.width = `${newWidth}px`
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  return (
    <div className="flex flex-1 overflow-hidden relative">
      {/* Compact/mobile sidebar overlay: backdrop + fixed sidebar */}
      {compact && sidebarVisible && (
        <>
          {/* Semi-transparent backdrop */}
          <div
            className="fixed inset-0 z-30"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
            onClick={closeSidebar}
          />
          {/* Sidebar panel */}
          <div
            className="fixed top-0 left-0 z-40 h-full overflow-y-auto"
            style={{
              width: mobile ? 'min(280px, calc(100vw - 60px))' : 280,
              backgroundColor: 'var(--color-surface)',
              borderRight: '1px solid var(--color-bg)',
            }}
          >
            <ErrorBoundary>
              <Sidebar onOpenSettings={onOpenSettings} onOpenScheduler={onOpenScheduler} />
            </ErrorBoundary>
          </div>
        </>
      )}

      {/* Wide desktop sidebar: inline in flex layout */}
      {!compact && sidebarVisible && (
        <>
          <div
            ref={sidebarRef}
            className="flex-shrink-0 overflow-y-auto"
            style={{
              width: 280,
              backgroundColor: 'var(--color-surface)',
              borderRight: '1px solid var(--color-bg)',
            }}
          >
            <ErrorBoundary>
              <Sidebar onOpenSettings={onOpenSettings} onOpenScheduler={onOpenScheduler} />
            </ErrorBoundary>
          </div>

          {/* Resize handle */}
          <div
            onMouseDown={onSidebarResize}
            className="w-[3px] cursor-col-resize hover:bg-[var(--color-primary)] transition-colors flex-shrink-0"
            style={{ backgroundColor: 'var(--color-bg)' }}
          />
        </>
      )}

      {/* Main content — ChatView */}
      <div
        className="flex-1 flex flex-col overflow-hidden relative mobile-safe-bottom"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <PanelEdgeButton side="left" isOpen={sidebarVisible} onClick={toggleSidebar} radiusPct={panelButtonRadiusPct} alwaysVisible={panelButtonAlwaysVisible} mobile={mobile} />
        <PanelEdgeButton side="right" isOpen={panelVisible} onClick={togglePanel} radiusPct={panelButtonRadiusPct} alwaysVisible={panelButtonAlwaysVisible} mobile={mobile} />
        <ErrorBoundary>
          <ChatView
            conversationId={activeConversationId}
            conversationTitle={activeConversation?.title}
            conversationModel={activeConversation?.model}
            conversationCwd={activeConversation?.cwd}
          />
        </ErrorBoundary>
      </div>

      {/* Right panel — overlay in compact/mobile, inline in wide desktop */}
      {compact && panelVisible && (
        <>
          {/* Semi-transparent backdrop */}
          <div
            className="fixed inset-0 z-30"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
            onClick={closePanel}
          />
          {/* Panel overlay */}
          <div
            className="fixed top-0 right-0 z-40 h-full overflow-y-auto"
            style={{
              width: mobile ? 'min(100vw, 360px)' : 400,
              backgroundColor: 'var(--color-surface)',
              borderLeft: '1px solid var(--color-bg)',
            }}
          >
            <ErrorBoundary>
              <FileExplorerPanel />
            </ErrorBoundary>
          </div>
        </>
      )}
      {!compact && panelVisible && (
        <>
          {/* Resize handle */}
          <div
            onMouseDown={onPanelResize}
            className="w-[3px] cursor-col-resize hover:bg-[var(--color-primary)] transition-colors flex-shrink-0"
            style={{ backgroundColor: 'var(--color-bg)' }}
          />

          <div
            ref={panelRef}
            className="flex-shrink-0 overflow-y-auto"
            style={{
              width: 400,
              backgroundColor: 'var(--color-surface)',
              borderLeft: '1px solid var(--color-bg)',
            }}
          >
            <ErrorBoundary>
              <FileExplorerPanel />
            </ErrorBoundary>
          </div>
        </>
      )}
    </div>
  )
}
