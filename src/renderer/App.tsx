import { useEffect, useState, useCallback } from 'react'
import { useUiStore } from './stores/uiStore'
import { useSettingsStore } from './stores/settingsStore'
import { useShortcutsStore } from './stores/shortcutsStore'
import { useConversationsStore } from './stores/conversationsStore'
import { useChatStore } from './stores/chatStore'
import { useVoiceInputStore } from './stores/voiceInputStore'
import { Titlebar } from './components/Titlebar'
import { AuthGuard } from './components/auth/AuthGuard'
import { MainLayout } from './layouts/MainLayout'
import { SettingsPage } from './pages/SettingsPage'
import { parseAccelerator, matchesEvent } from './utils/shortcutMatcher'
import { parseOverrides, resolveEffectiveSettings } from './utils/resolveAISettings'
import { OverlayChat } from './components/overlay/OverlayChat'

const params = new URLSearchParams(window.location.search)
const isOverlay = params.get('mode') === 'overlay'
const isVoiceMode = params.get('voice') === 'true'

export default function App() {
  if (isOverlay) {
    return <OverlayChat voiceMode={isVoiceMode} />
  }

  const [settingsOpen, setSettingsOpen] = useState(false)

  const openSettings = useCallback(() => setSettingsOpen(true), [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])

  // Initial data loading + apply saved theme
  useEffect(() => {
    const init = async () => {
      const settingsStore = useSettingsStore.getState()
      await settingsStore.loadSettings()
      await settingsStore.loadThemes()
      // Apply saved theme if one exists
      const { themes, activeTheme } = useSettingsStore.getState()
      if (activeTheme) {
        const theme = themes.find((t) => t.filename === activeTheme)
        if (theme) settingsStore.applyTheme(theme)
      } else if (themes.length > 0) {
        settingsStore.applyTheme(themes[0])
      }
      // Apply saved font size
      const { settings } = useSettingsStore.getState()
      if (settings.fontSize) {
        document.documentElement.style.fontSize = settings.fontSize + 'px'
      }
    }
    init()
    useShortcutsStore.getState().loadShortcuts()

    // Wire tray and deep link events
    const unsubTray = window.agent.events.onTrayNewConversation(() => {
      useConversationsStore.getState().createConversation()
    })
    const unsubDeeplink = window.agent.events.onDeeplinkNavigate((id) => {
      useConversationsStore.getState().setActiveConversation(id)
    })
    return () => {
      unsubTray()
      unsubDeeplink()
    }
  }, [])

  // Dynamic keyboard shortcuts driven by the shortcuts store
  useEffect(() => {
    const PERMISSION_MODES = ['bypassPermissions', 'acceptEdits', 'default', 'dontAsk', 'plan'] as const

    const cyclePermissionMode = () => {
      const { activeConversationId, conversations, folders, updateConversation } = useConversationsStore.getState()
      if (!activeConversationId) return
      const conv = conversations.find((c) => c.id === activeConversationId)
      if (!conv) return
      const folder = conv.folder_id ? folders.find((f) => f.id === conv.folder_id) : undefined
      const convOv = parseOverrides(conv.ai_overrides)
      const folderOv = parseOverrides(folder?.ai_overrides)
      const globalSettings = useSettingsStore.getState().settings
      const effective = resolveEffectiveSettings(globalSettings, folderOv, convOv)
      const current = effective['ai_permissionMode'] || 'bypassPermissions'
      const idx = PERMISSION_MODES.indexOf(current as typeof PERMISSION_MODES[number])
      const next = PERMISSION_MODES[(idx + 1) % PERMISSION_MODES.length]
      const newOverrides = { ...convOv, ai_permissionMode: next }
      const json = Object.keys(newOverrides).length > 0 ? JSON.stringify(newOverrides) : null
      updateConversation(activeConversationId, { ai_overrides: json } as any)
    }

    const actionHandlers: Record<string, () => void> = {
      new_conversation: () => useConversationsStore.getState().createConversation(),
      toggle_sidebar: () => useUiStore.getState().toggleSidebar(),
      toggle_panel: () => useUiStore.getState().togglePanel(),
      settings: () => setSettingsOpen((prev) => !prev),
      focus_search: () => document.querySelector<HTMLInputElement>('[data-search-input]')?.focus(),
      stop_generation: () => useChatStore.getState().stopGeneration(),
      voice_input: () => useVoiceInputStore.getState().toggleRecording(),
      cycle_permission_mode: cyclePermissionMode,
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const shortcuts = useShortcutsStore.getState().shortcuts
      for (const shortcut of shortcuts) {
        if (!shortcut.enabled) continue
        // send_message is handled by MessageInput directly
        if (shortcut.action === 'send_message') continue

        const parsed = parseAccelerator(shortcut.keybinding)
        if (matchesEvent(e, parsed)) {
          const handler = actionHandlers[shortcut.action]
          if (handler) {
            e.preventDefault()
            handler()
          }
          return
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const showTitlebar = useSettingsStore((s) => s.settings.showTitlebar) !== 'false'

  return (
    <div className="flex flex-col h-screen">
      {showTitlebar ? (
        <Titlebar onOpenSettings={openSettings} />
      ) : (
        <div
          className="flex-shrink-0"
          style={{ height: 6, WebkitAppRegion: 'drag' } as React.CSSProperties}
        />
      )}
      <AuthGuard>
        <MainLayout onOpenSettings={!showTitlebar ? openSettings : undefined} />
      </AuthGuard>
      {settingsOpen && <SettingsPage onClose={closeSettings} />}
    </div>
  )
}
