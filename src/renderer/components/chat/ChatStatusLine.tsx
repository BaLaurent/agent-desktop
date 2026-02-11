import { useState, useRef, useEffect } from 'react'
import { MODEL_OPTIONS, PERMISSION_OPTIONS, PERMISSION_LABELS, shortenModelName } from '../../../shared/constants'
import { CheckIcon } from '../icons/CheckIcon'
import { ChevronDownIcon } from '../icons/ChevronDownIcon'
import { Checkbox } from '../ui/Checkbox'

export interface McpServerEntry {
  name: string
  active: boolean
}

export interface KbCollectionEntry {
  name: string
  selected: boolean
  access: 'read' | 'readwrite'
}


interface ChatStatusLineProps {
  model: string
  permissionMode: string
  mcpServers: McpServerEntry[]
  onModelChange?: (model: string) => void
  onPermissionModeChange?: (mode: string) => void
  onMcpServerToggle?: (serverName: string) => void
  kbCollections?: KbCollectionEntry[]
  onKbCollectionToggle?: (name: string) => void
  onKbAccessToggle?: (name: string) => void
}

export function ChatStatusLine({ model, permissionMode, mcpServers, onModelChange, onPermissionModeChange, onMcpServerToggle, kbCollections, onKbCollectionToggle, onKbAccessToggle }: ChatStatusLineProps) {
  const shortModel = shortenModelName(model)
  const modeLabel = PERMISSION_LABELS[permissionMode] || permissionMode
  const [modelOpen, setModelOpen] = useState(false)
  const [modeOpen, setModeOpen] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)
  const [kbOpen, setKbOpen] = useState(false)
  const modelRef = useRef<HTMLDivElement>(null)
  const modeRef = useRef<HTMLDivElement>(null)
  const mcpRef = useRef<HTMLDivElement>(null)
  const kbRef = useRef<HTMLDivElement>(null)

  const activeCount = mcpServers.filter((s) => s.active).length
  const kbSelectedCount = (kbCollections || []).filter((c) => c.selected).length

  useEffect(() => {
    if (!modelOpen && !modeOpen && !mcpOpen && !kbOpen) return
    const handleClick = (e: MouseEvent) => {
      if (modelOpen && modelRef.current && !modelRef.current.contains(e.target as Node)) {
        setModelOpen(false)
      }
      if (modeOpen && modeRef.current && !modeRef.current.contains(e.target as Node)) {
        setModeOpen(false)
      }
      if (mcpOpen && mcpRef.current && !mcpRef.current.contains(e.target as Node)) {
        setMcpOpen(false)
      }
      if (kbOpen && kbRef.current && !kbRef.current.contains(e.target as Node)) {
        setKbOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [modelOpen, modeOpen, mcpOpen, kbOpen])

  return (
    <div
      className="text-[10px] px-1 mt-1 flex items-center gap-1.5"
      style={{ color: 'var(--color-text-muted)' }}
      aria-label="Chat status"
    >
      {/* Model dropdown */}
      <div className="relative" ref={modelRef}>
        <button
          onClick={() => onModelChange && setModelOpen((v) => !v)}
          className="hover:opacity-70 transition-opacity inline-flex items-center gap-0.5"
          style={{ cursor: onModelChange ? 'pointer' : 'default' }}
          aria-label="Change model"
          aria-expanded={modelOpen}
          aria-haspopup="listbox"
        >
          <span>{shortModel}</span>
          {onModelChange && <ChevronDownIcon className="opacity-60" />}
        </button>
        {modelOpen && (
          <div
            className="absolute bottom-full left-0 mb-1 rounded shadow-lg text-xs min-w-[140px] py-1 z-50"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-text-muted)',
            }}
            role="listbox"
            aria-label="Model selection"
          >
            {MODEL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                role="option"
                aria-selected={opt.value === model}
                onClick={() => {
                  onModelChange!(opt.value)
                  setModelOpen(false)
                }}
                className="w-full text-left px-3 py-1.5 hover:opacity-80 transition-opacity flex items-center justify-between"
                style={{
                  color: opt.value === model ? 'var(--color-primary)' : 'var(--color-text)',
                  backgroundColor: opt.value === model ? 'var(--color-bg)' : 'transparent',
                }}
              >
                <span>{opt.label}</span>
                {opt.value === model && <CheckIcon size={10} />}
              </button>
            ))}
          </div>
        )}
      </div>
      <span aria-hidden="true">&middot;</span>
      {/* Permission mode dropdown */}
      <div className="relative" ref={modeRef}>
        <button
          onClick={() => onPermissionModeChange && setModeOpen((v) => !v)}
          className="hover:opacity-70 transition-opacity inline-flex items-center gap-0.5"
          style={{ cursor: onPermissionModeChange ? 'pointer' : 'default' }}
          aria-label="Change permission mode"
          aria-expanded={modeOpen}
          aria-haspopup="listbox"
        >
          <span>{modeLabel}</span>
          {onPermissionModeChange && <ChevronDownIcon className="opacity-60" />}
        </button>
        {modeOpen && (
          <div
            className="absolute bottom-full left-0 mb-1 rounded shadow-lg text-xs min-w-[130px] py-1 z-50"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-text-muted)',
            }}
            role="listbox"
            aria-label="Permission mode selection"
          >
            {PERMISSION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                role="option"
                aria-selected={opt.value === permissionMode}
                onClick={() => {
                  onPermissionModeChange!(opt.value)
                  setModeOpen(false)
                }}
                className="w-full text-left px-3 py-1.5 hover:opacity-80 transition-opacity flex items-center justify-between"
                style={{
                  color: opt.value === permissionMode ? 'var(--color-primary)' : 'var(--color-text)',
                  backgroundColor: opt.value === permissionMode ? 'var(--color-bg)' : 'transparent',
                }}
              >
                <span>{opt.label}</span>
                {opt.value === permissionMode && <CheckIcon size={10} />}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* MCP server dropdown */}
      {mcpServers.length > 0 && (
        <>
          <span aria-hidden="true">&middot;</span>
          <div className="relative" ref={mcpRef}>
            <button
              onClick={() => onMcpServerToggle && setMcpOpen((v) => !v)}
              className="inline-flex items-center gap-0.5 hover:opacity-70 transition-opacity"
              style={{
                cursor: onMcpServerToggle ? 'pointer' : 'default',
                opacity: activeCount === mcpServers.length ? 1 : 0.7,
              }}
              title="Manage MCP servers for this conversation"
              aria-label="MCP servers"
              aria-expanded={mcpOpen}
              aria-haspopup="true"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M11.42 1.58a1.5 1.5 0 00-2.12 0L6.17 4.71a1.5 1.5 0 000 2.12l.71.71-3.17 3.17a1.5 1.5 0 000 2.12l.71.71a1.5 1.5 0 002.12 0l3.17-3.17.71.71a1.5 1.5 0 002.12 0l3.13-3.13a1.5 1.5 0 000-2.12L11.42 1.58zM10.36 2.64l4.24 4.24-3.13 3.13-4.24-4.24 3.13-3.13zM6.93 11.07L3.76 7.9l-.71.71 3.17 3.17-.71.71-3.17-3.17.71-.71 3.17 3.17-.29-.71z" />
              </svg>
              {activeCount}/{mcpServers.length} MCP
              {onMcpServerToggle && <ChevronDownIcon className="opacity-60" />}
            </button>
            {mcpOpen && (
              <div
                className="absolute bottom-full left-0 mb-1 rounded shadow-lg text-xs min-w-[160px] py-1 z-50"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-text-muted)',
                }}
                role="group"
                aria-label="MCP server selection"
              >
                {mcpServers.map((server) => (
                  <button
                    key={server.name}
                    onClick={() => onMcpServerToggle!(server.name)}
                    className="w-full text-left px-3 py-1.5 hover:opacity-80 transition-opacity flex items-center gap-2"
                    style={{ color: 'var(--color-text)' }}
                    role="checkbox"
                    aria-checked={server.active}
                  >
                    <Checkbox checked={server.active} />
                    <span style={{ opacity: server.active ? 1 : 0.5 }}>{server.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      {/* KB collection dropdown */}
      {kbCollections && kbCollections.length > 0 && (
        <>
          <span aria-hidden="true">&middot;</span>
          <div className="relative" ref={kbRef}>
            <button
              onClick={() => onKbCollectionToggle && setKbOpen((v) => !v)}
              className="inline-flex items-center gap-0.5 hover:opacity-70 transition-opacity"
              style={{
                cursor: onKbCollectionToggle ? 'pointer' : 'default',
                opacity: kbSelectedCount > 0 ? 1 : 0.7,
              }}
              title="Manage Knowledge Base collections for this conversation"
              aria-label="Knowledge Base"
              aria-expanded={kbOpen}
              aria-haspopup="true"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811V2.828zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492V2.687zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 000 2.5v11a.5.5 0 00.707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 00.78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0016 13.5v-11a.5.5 0 00-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.81 8.985.936 8 1.783z" />
              </svg>
              {kbSelectedCount} KB
              {onKbCollectionToggle && <ChevronDownIcon className="opacity-60" />}
            </button>
            {kbOpen && (
              <div
                className="absolute bottom-full left-0 mb-1 rounded shadow-lg text-xs min-w-[200px] py-1 z-50"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-text-muted)',
                }}
                role="group"
                aria-label="Knowledge Base collection selection"
              >
                {kbCollections.map((col) => (
                  <div
                    key={col.name}
                    className="flex items-center gap-2 px-3 py-1.5"
                    style={{ color: 'var(--color-text)' }}
                  >
                    <button
                      onClick={() => onKbCollectionToggle!(col.name)}
                      className="flex items-center gap-2 flex-1 hover:opacity-80 transition-opacity text-left"
                      role="checkbox"
                      aria-checked={col.selected}
                    >
                      <Checkbox checked={col.selected} />
                      <span style={{ opacity: col.selected ? 1 : 0.5 }}>{col.name}</span>
                    </button>
                    {col.selected && onKbAccessToggle && (
                      <button
                        onClick={() => onKbAccessToggle(col.name)}
                        className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold transition-opacity hover:opacity-80"
                        style={{
                          backgroundColor: col.access === 'readwrite' ? 'var(--color-warning)' : 'var(--color-primary)',
                          color: 'var(--color-text-contrast)',
                        }}
                        title={col.access === 'readwrite' ? 'Read-Write access (click to toggle)' : 'Read-only access (click to toggle)'}
                        aria-label={`Toggle access mode for ${col.name}`}
                      >
                        {col.access === 'readwrite' ? 'RW' : 'R'}
                      </button>
                    )}
                  </div>
                ))}
                <hr style={{ borderColor: 'var(--color-text-muted)', opacity: 0.3, margin: '2px 0' }} />
                <button
                  onClick={() => { window.agent.kb.openKnowledgesFolder(); setKbOpen(false) }}
                  className="w-full text-left px-3 py-1.5 hover:opacity-80 transition-opacity"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  Open Knowledges Folder
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
