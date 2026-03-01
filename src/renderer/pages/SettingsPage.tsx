import { useState, useEffect } from 'react'
import { GeneralSettings } from '../components/settings/GeneralSettings'
import { AISettings } from '../components/settings/AISettings'
import { AppearanceSettings } from '../components/settings/AppearanceSettings'
import { ShortcutSettings } from '../components/settings/ShortcutSettings'
import { StorageSettings } from '../components/settings/StorageSettings'
import { AboutSection } from '../components/settings/AboutSection'
import { ToolList } from '../components/tools/ToolList'
import { McpServerList } from '../components/mcp/McpServerList'
import { KnowledgeManager } from '../components/knowledge/KnowledgeManager'
import { VoiceInputSettings } from '../components/settings/VoiceInputSettings'
import { TTSSettings } from '../components/settings/TTSSettings'
import { QuickChatSettings } from '../components/settings/QuickChatSettings'
import { OpenSCADSettings } from '../components/settings/OpenSCADSettings'
import { WebServerSettings } from '../components/settings/WebServerSettings'
import { useMobileMode, useCompactMode } from '../hooks/useMobileMode'

interface SettingsPageProps {
  onClose: () => void
}

const categories = [
  'General',
  'AI / Model',
  'Appearance',
  'Shortcuts',
  'Voice Input',
  'Text-to-Speech',
  'Quick Chat',
  'OpenSCAD',
  'MCP Servers',
  'Allowed Tools',
  'Knowledge Base',
  'Web Server',
  'Storage',
  'About',
] as const

type Category = (typeof categories)[number]

const categoryComponents: Record<Category, React.FC | null> = {
  General: GeneralSettings,
  'AI / Model': AISettings,
  Appearance: AppearanceSettings,
  Shortcuts: ShortcutSettings,
  'Voice Input': VoiceInputSettings,
  'Text-to-Speech': TTSSettings,
  'Quick Chat': QuickChatSettings,
  'OpenSCAD': OpenSCADSettings,
  'MCP Servers': McpServerList,
  'Allowed Tools': ToolList,
  'Knowledge Base': KnowledgeManager,
  'Web Server': WebServerSettings,
  Storage: StorageSettings,
  About: AboutSection,
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const [activeCategory, setActiveCategory] = useState<Category>('General')
  const mobile = useMobileMode()
  const compact = useCompactMode()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const ActiveComponent = categoryComponents[activeCategory]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full max-w-4xl rounded-lg shadow-xl flex overflow-hidden max-h-[80vh] compact:flex-col compact:max-h-[100dvh] compact:h-full"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        {compact ? (
          /* Compact/mobile: horizontal scrollable tab band at top */
          <div
            className="flex-shrink-0 border-b border-[var(--color-text-muted)]/10"
            style={{ backgroundColor: 'var(--color-deep)' }}
          >
            <div className="flex items-center justify-between px-4 py-3">
              <h2
                className="text-lg font-semibold"
                style={{ color: 'var(--color-text)' }}
              >
                Settings
              </h2>
              <button
                onClick={onClose}
                className="w-11 h-11 flex items-center justify-center rounded hover:bg-[var(--color-bg)] transition-colors"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                  <path d="M1.05 1.05a.5.5 0 01.707 0L7 6.293l5.243-5.243a.5.5 0 11.707.707L7.707 7l5.243 5.243a.5.5 0 11-.707.707L7 7.707l-5.243 5.243a.5.5 0 01-.707-.707L6.293 7 1.05 1.757a.5.5 0 010-.707z" />
                </svg>
              </button>
            </div>
            <nav className="flex flex-row overflow-x-auto gap-1 px-2 pb-2">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className="whitespace-nowrap px-4 py-2.5 rounded text-sm transition-colors flex-shrink-0"
                  style={{
                    backgroundColor:
                      activeCategory === cat ? 'var(--color-primary)' : 'transparent',
                    color:
                      activeCategory === cat ? '#fff' : 'var(--color-text-muted)',
                  }}
                >
                  {cat}
                </button>
              ))}
            </nav>
          </div>
        ) : (
          /* Wide desktop: sidebar */
          <div
            className="w-[200px] flex-shrink-0 flex flex-col py-4 border-r border-[var(--color-text-muted)]/10"
            style={{ backgroundColor: 'var(--color-deep)' }}
          >
            <h2
              className="px-4 pb-3 text-lg font-semibold"
              style={{ color: 'var(--color-text)' }}
            >
              Settings
            </h2>
            <nav className="flex flex-col gap-0.5 px-2">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className="text-left px-3 py-2 rounded text-sm transition-colors"
                  style={{
                    backgroundColor:
                      activeCategory === cat ? 'var(--color-primary)' : 'transparent',
                    color:
                      activeCategory === cat ? '#fff' : 'var(--color-text-muted)',
                  }}
                >
                  {cat}
                </button>
              ))}
            </nav>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Header with close button (desktop only — mobile has it in the tab band) */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-text-muted)]/10 compact:hidden">
            <h2
              className="text-lg font-semibold"
              style={{ color: 'var(--color-text)' }}
            >
              {activeCategory}
            </h2>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-[var(--color-bg)] transition-colors"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="currentColor"
              >
                <path d="M1.05 1.05a.5.5 0 01.707 0L7 6.293l5.243-5.243a.5.5 0 11.707.707L7.707 7l5.243 5.243a.5.5 0 11-.707.707L7 7.707l-5.243 5.243a.5.5 0 01-.707-.707L6.293 7 1.05 1.757a.5.5 0 010-.707z" />
              </svg>
            </button>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 compact:px-4 py-4">
            {ActiveComponent ? (
              <ActiveComponent />
            ) : (
              <p
                className="text-sm"
                style={{ color: 'var(--color-text-muted)' }}
              >
                This section is managed elsewhere in the app.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
