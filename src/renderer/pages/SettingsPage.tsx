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
import { QuickChatSettings } from '../components/settings/QuickChatSettings'

interface SettingsPageProps {
  onClose: () => void
}

const categories = [
  'General',
  'AI / Model',
  'Appearance',
  'Shortcuts',
  'Voice Input',
  'Quick Chat',
  'MCP Servers',
  'Allowed Tools',
  'Knowledge Base',
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
  'Quick Chat': QuickChatSettings,
  'MCP Servers': McpServerList,
  'Allowed Tools': ToolList,
  'Knowledge Base': KnowledgeManager,
  Storage: StorageSettings,
  About: AboutSection,
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const [activeCategory, setActiveCategory] = useState<Category>('General')

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
        className="w-full max-w-4xl max-h-[80vh] rounded-lg shadow-xl flex overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        {/* Sidebar */}
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

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header with close button */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-text-muted)]/10">
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
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-4">
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
