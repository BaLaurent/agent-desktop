import { useRef, useCallback, useEffect } from 'react'
import { useUiStore } from '../stores/uiStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useConversationsStore } from '../stores/conversationsStore'
import { Sidebar } from '../components/sidebar/Sidebar'
import { ChatView } from '../pages/ChatView'
import { FileExplorerPanel } from '../components/panel/FileExplorerPanel'
import { ErrorBoundary } from '../components/ErrorBoundary'

const DEFAULT_RADIUS_PCT = 10

function PanelEdgeButton({ side, isOpen, onClick, radiusPct, alwaysVisible }: {
  side: 'left' | 'right'; isOpen: boolean; onClick: () => void; radiusPct: number; alwaysVisible: boolean
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const radiusRef = useRef(radiusPct)
  radiusRef.current = radiusPct

  useEffect(() => {
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
  }, [alwaysVisible])

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

export function MainLayout({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const { sidebarVisible, panelVisible, toggleSidebar, togglePanel } = useUiStore()
  const panelButtonRadiusPct = Number(useSettingsStore((s) => s.settings.panelButtonRadius)) || DEFAULT_RADIUS_PCT
  const panelButtonAlwaysVisible = useSettingsStore((s) => s.settings.panelButtonAlwaysVisible) === 'true'
  const { activeConversationId, conversations } = useConversationsStore()
  const sidebarRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const activeConversation = conversations.find((c) => c.id === activeConversationId) ?? null

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
    <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      {sidebarVisible && (
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
              <Sidebar onOpenSettings={onOpenSettings} />
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
        className="flex-1 flex flex-col overflow-hidden relative"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <PanelEdgeButton side="left" isOpen={sidebarVisible} onClick={toggleSidebar} radiusPct={panelButtonRadiusPct} alwaysVisible={panelButtonAlwaysVisible} />
        <PanelEdgeButton side="right" isOpen={panelVisible} onClick={togglePanel} radiusPct={panelButtonRadiusPct} alwaysVisible={panelButtonAlwaysVisible} />
        <ErrorBoundary>
          <ChatView
            conversationId={activeConversationId}
            conversationTitle={activeConversation?.title}
            conversationModel={activeConversation?.model}
            conversationCwd={activeConversation?.cwd}
          />
        </ErrorBoundary>
      </div>

      {/* Right panel — Artifacts */}
      {panelVisible && (
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
