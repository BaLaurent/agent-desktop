import { useState, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { useSettingsStore } from '../../stores/settingsStore'
import type { ThemeFile } from '../../../shared/types'

const TEMPLATE_CSS = `/* My Custom Theme */
:root {
  --color-bg: #1a1a2e;
  --color-surface: #16213e;
  --color-deep: #0f3460;
  --color-primary: #e94560;
  --color-text: #eaeaea;
  --color-text-muted: #a0a0a0;
  --color-accent: #533483;
  --color-success: #00d26a;
  --color-error: #ff4757;
  --color-warning: #ffc107;
  --color-tool: #00bcd4;
  --color-text-contrast: #fff;
  --color-overlay: rgba(0, 0, 0, 0.5);
}
`

function extractColors(css: string): string[] {
  const matches = css.matchAll(/--color-\w+:\s*(#[0-9a-fA-F]{3,8})/g)
  return [...matches].map((m) => m[1]).slice(0, 6)
}

export function AppearanceSettings() {
  const { themes, activeTheme, settings, loadThemes, loadSettings, applyTheme, setSetting } = useSettingsStore()

  const [editing, setEditing] = useState<'create' | 'edit' | null>(null)
  const [editFilename, setEditFilename] = useState('')
  const [cssContent, setCssContent] = useState('')
  const [newFilename, setNewFilename] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [themesDir, setThemesDir] = useState<string | null>(null)

  useEffect(() => {
    loadThemes()
    loadSettings()
  }, [loadThemes, loadSettings])

  const currentFontSize = settings.fontSize ?? '14'
  const showTitlebar = (settings.showTitlebar ?? 'true') === 'true'
  const alwaysVisible = (settings.panelButtonAlwaysVisible ?? 'false') === 'true'
  useEffect(() => {
    document.documentElement.style.fontSize = currentFontSize + 'px'
  }, [currentFontSize])

  const handleSelectTheme = (theme: ThemeFile) => {
    applyTheme(theme)
  }

  const handleStartCreate = () => {
    setEditing('create')
    setNewFilename('my-theme.css')
    setCssContent(TEMPLATE_CSS)
    setError(null)
  }

  const handleStartEdit = (theme: ThemeFile) => {
    setEditing('edit')
    setEditFilename(theme.filename)
    setCssContent(theme.css)
    setError(null)
  }

  const handleSave = async () => {
    try {
      setError(null)
      if (editing === 'create') {
        const filename = newFilename.trim()
        if (!filename) { setError('Filename is required'); return }
        const safeName = filename.endsWith('.css') ? filename : filename + '.css'
        await window.agent.themes.create(safeName, cssContent)
      } else if (editing === 'edit') {
        await window.agent.themes.save(editFilename, cssContent)
      }
      await loadThemes()
      setEditing(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleDelete = async (filename: string) => {
    try {
      await window.agent.themes.delete(filename)
      await loadThemes()
      setDeleteConfirm(null)
      // If deleted theme was active, apply first available
      if (activeTheme === filename && themes.length > 0) {
        const fallback = themes.find((t) => t.filename !== filename)
        if (fallback) applyTheme(fallback)
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const handleOpenFolder = async () => {
    try {
      const dir = await window.agent.themes.getDir()
      setThemesDir(dir)
      await window.agent.files.revealInFileManager(dir)
    } catch (err) {
      // Fallback: just show the path
      const dir = await window.agent.themes.getDir()
      setThemesDir(dir)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Interface Settings */}
      <div className="rounded-lg overflow-hidden border border-deep">
        {/* Show Title Bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-deep">
          <span className="text-sm text-body">Show Title Bar</span>
          <button
            onClick={() => setSetting('showTitlebar', showTitlebar ? 'false' : 'true')}
            role="switch"
            aria-checked={showTitlebar}
            aria-label="Toggle title bar visibility"
            className="relative w-9 h-5 rounded-full flex-shrink-0 transition-colors"
            style={{
              backgroundColor: showTitlebar ? 'var(--color-primary)' : 'var(--color-text-muted)',
              opacity: showTitlebar ? 1 : 0.3,
            }}
          >
            <span
              className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
              style={{ transform: showTitlebar ? 'translateX(16px)' : 'translateX(0px)' }}
            />
          </button>
        </div>

        {/* Font Size */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-deep">
          <span className="text-sm text-body">Font Size</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={8}
              max={32}
              value={currentFontSize}
              onChange={(e) => {
                const v = e.target.value
                if (v !== '' && Number(v) >= 8 && Number(v) <= 32) setSetting('fontSize', v)
              }}
              className="w-16 bg-surface text-body border border-muted rounded px-2 py-1 text-sm text-center outline-none focus:border-primary"
              aria-label="Font size in pixels"
            />
            <span className="text-xs text-muted">px</span>
          </div>
        </div>

        {/* Chat Layout */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-deep">
          <span className="text-sm text-body">Chat Layout</span>
          <div className="flex gap-1">
            {(['tight', 'wide'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setSetting('chatLayout', mode)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  (settings.chatLayout ?? 'tight') === mode
                    ? 'bg-primary text-contrast'
                    : 'bg-surface text-body'
                }`}
              >
                {mode === 'tight' ? 'Tight' : 'Wide'}
              </button>
            ))}
          </div>
        </div>

        {/* Panel Buttons — Always Visible */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-deep">
          <span className="text-sm text-body">Panel Buttons</span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">Always visible</span>
            <button
              onClick={() => setSetting('panelButtonAlwaysVisible', alwaysVisible ? 'false' : 'true')}
              role="switch"
              aria-checked={alwaysVisible}
              aria-label="Toggle always visible panel buttons"
              className="relative w-9 h-5 rounded-full flex-shrink-0 transition-colors"
              style={{
                backgroundColor: alwaysVisible ? 'var(--color-primary)' : 'var(--color-text-muted)',
                opacity: alwaysVisible ? 1 : 0.3,
              }}
            >
              <span
                className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                style={{ transform: alwaysVisible ? 'translateX(16px)' : 'translateX(0px)' }}
              />
            </button>
          </div>
        </div>

        {/* Panel Buttons — Proximity Radius */}
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-muted pl-4">Proximity radius</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={50}
              step={1}
              value={settings.panelButtonRadius ?? '10'}
              onChange={(e) => {
                const v = e.target.value
                if (v !== '' && Number(v) >= 0 && Number(v) <= 50) setSetting('panelButtonRadius', v)
              }}
              className="w-16 bg-surface text-body border border-muted rounded px-2 py-1 text-sm text-center outline-none focus:border-primary"
              aria-label="Panel button proximity radius"
            />
            <span className="text-xs text-muted">%</span>
          </div>
        </div>
      </div>

      {/* Theme Selection */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-body">
            Themes
          </h3>
          <div className="flex gap-2">
            <button
              onClick={handleOpenFolder}
              className="px-3 py-1.5 rounded text-xs font-medium transition-opacity hover:opacity-90 bg-deep text-body"
            >
              Open Themes Folder
            </button>
            <button
              onClick={handleStartCreate}
              className="px-3 py-1.5 rounded text-xs font-medium transition-opacity hover:opacity-90 bg-primary text-contrast"
            >
              Create New Theme
            </button>
          </div>
        </div>
        {themesDir && (
          <p className="text-xs mb-2 font-mono text-muted">
            {themesDir}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          {themes.map((theme) => {
            const swatches = extractColors(theme.css)
            const isActive = theme.filename === activeTheme
            return (
              <button
                key={theme.filename}
                onClick={() => handleSelectTheme(theme)}
                className={`relative p-3 rounded-lg text-left transition-colors bg-base ${
                  isActive
                    ? 'border-2 border-primary'
                    : 'border border-muted opacity-[0.85]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-body">
                    {theme.name}
                  </span>
                  <div className="flex items-center gap-1">
                    {isActive && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-primary text-contrast">
                        Active
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1.5 mb-2">
                  {swatches.map((c, i) => (
                    <span
                      key={i}
                      className="w-4 h-4 rounded-full border border-muted"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                {!theme.isBuiltin && (
                  <div className="flex gap-1 absolute top-2 right-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleStartEdit(theme) }}
                      className="w-6 h-6 rounded flex items-center justify-center text-xs hover:bg-surface transition-colors text-muted"
                      title="Edit theme"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M9.1.9a1.5 1.5 0 012.12 2.12L3.88 10.37l-2.83.71.71-2.83L9.1.9z" />
                      </svg>
                    </button>
                    {deleteConfirm === theme.filename ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(theme.filename) }}
                        className="w-6 h-6 rounded flex items-center justify-center text-xs transition-colors bg-error text-contrast"
                        title="Confirm delete"
                      >
                        !
                      </button>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirm(theme.filename) }}
                        className="w-6 h-6 rounded flex items-center justify-center text-xs hover:bg-surface transition-colors text-muted"
                        title="Delete theme"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                          <path d="M3 3h6v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3zm-1-1h8M5 1h2" stroke="currentColor" fill="none" strokeWidth="1" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Monaco CSS Editor */}
      {editing && (
        <div className="rounded-lg p-4 flex flex-col gap-4 bg-base">
          <h3 className="text-sm font-semibold text-body">
            {editing === 'create' ? 'Create Theme' : `Edit: ${editFilename}`}
          </h3>

          {editing === 'create' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted">
                Filename
              </label>
              <input
                className="w-full max-w-xs bg-surface text-body border border-muted rounded px-3 py-2 text-sm outline-none focus:border-primary"
                value={newFilename}
                onChange={(e) => setNewFilename(e.target.value)}
                placeholder="my-theme.css"
              />
            </div>
          )}

          <div className="rounded overflow-hidden border border-muted">
            <Editor
              height="400px"
              language="css"
              theme="vs-dark"
              value={cssContent}
              onChange={(val) => setCssContent(val ?? '')}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: 'on',
                wordWrap: 'on',
                scrollBeyondLastLine: false,
              }}
            />
          </div>

          {error && (
            <p className="text-xs text-error">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-90 bg-primary text-contrast"
            >
              {editing === 'create' ? 'Create Theme' : 'Save Theme'}
            </button>
            <button
              onClick={() => { setEditing(null); setError(null) }}
              className="px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80 bg-deep text-body"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
