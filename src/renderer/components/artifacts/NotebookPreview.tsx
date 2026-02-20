import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import DOMPurify from 'dompurify'
import Editor from '@monaco-editor/react'
import { MarkdownArtifact } from './MarkdownArtifact'
import { useFileExplorerStore } from '../../stores/fileExplorerStore'
import type { JupyterOutputChunk } from '../../../shared/types'

// ── Types ──────────────────────────────────────

interface CellOutput {
  output_type: 'stream' | 'execute_result' | 'display_data' | 'error'
  text?: string | string[]
  data?: Record<string, string | string[]>
  name?: string
  ename?: string
  evalue?: string
  traceback?: string[]
  execution_count?: number
}

interface NotebookCell {
  cell_type: 'code' | 'markdown' | 'raw'
  source: string | string[]
  outputs?: CellOutput[]
  execution_count?: number | null
  metadata?: Record<string, unknown>
}

export interface EditableCell {
  _id: number
  cell_type: 'code' | 'markdown' | 'raw'
  source: string // always normalized to string
  outputs?: CellOutput[]
  execution_count?: number | null
  metadata?: Record<string, unknown>
}

interface NotebookData {
  cells: NotebookCell[]
  metadata?: { kernelspec?: { language?: string; name?: string }; [key: string]: unknown }
  nbformat?: number
  nbformat_minor?: number
}

interface NotebookMeta {
  metadata?: Record<string, unknown>
  nbformat?: number
  nbformat_minor?: number
}

type KernelStatus = 'off' | 'starting' | 'idle' | 'busy' | 'dead'

// ── Helpers ────────────────────────────────────

const COLLAPSE_THRESHOLD = 20

function normalizeSource(source: string | string[]): string {
  return Array.isArray(source) ? source.join('') : source
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'style'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
  })
}

function parseNotebook(json: string): NotebookData | null {
  try {
    const parsed = JSON.parse(json)
    if (!parsed || !Array.isArray(parsed.cells)) return null
    return parsed as NotebookData
  } catch {
    return null
  }
}

/** Split a source string into nbformat 4 convention: each line ends with \n except the last */
function splitSource(source: string): string[] {
  if (!source) return ['']
  const lines = source.split('\n')
  return lines.map((line, i) => (i < lines.length - 1 ? line + '\n' : line))
}

/** Serialize notebook back to .ipynb JSON */
export function serializeNotebook(
  cells: EditableCell[],
  meta: NotebookMeta,
  liveOutputs: Map<number, CellOutput[]>,
  liveExecCounts: Map<number, number>,
): string {
  const nbCells = cells.map((cell) => {
    const source = splitSource(cell.source)
    const base: Record<string, unknown> = {
      cell_type: cell.cell_type,
      source,
      metadata: cell.metadata || {},
    }
    if (cell.cell_type === 'code') {
      base.outputs = liveOutputs.get(cell._id) ?? cell.outputs ?? []
      base.execution_count =
        liveExecCounts.get(cell._id) ?? cell.execution_count ?? null
    }
    return base
  })

  return JSON.stringify(
    {
      cells: nbCells,
      metadata: meta.metadata || {},
      nbformat: meta.nbformat || 4,
      nbformat_minor: meta.nbformat_minor || 5,
    },
    null,
    1,
  )
}

// ── CollapsibleOutput ──────────────────────────

function CollapsibleOutput({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const lines = text.split('\n')
  const needsCollapse = lines.length > COLLAPSE_THRESHOLD

  if (!needsCollapse) {
    return (
      <pre
        className="whitespace-pre-wrap text-xs"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        {text}
      </pre>
    )
  }

  const visible = expanded
    ? text
    : lines.slice(0, COLLAPSE_THRESHOLD).join('\n')
  const hiddenCount = lines.length - COLLAPSE_THRESHOLD

  return (
    <div>
      <pre
        className="whitespace-pre-wrap text-xs"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        {visible}
      </pre>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs mt-1 hover:underline"
        style={{ color: 'var(--color-primary)' }}
      >
        {expanded ? 'Show less' : `Show ${hiddenCount} more lines`}
      </button>
    </div>
  )
}

// ── CellOutputView ─────────────────────────────

function CellOutputView({ output }: { output: CellOutput }) {
  if (output.output_type === 'stream') {
    const text = normalizeSource(output.text || '')
    const isStderr = output.name === 'stderr'
    return (
      <div
        className="px-3 py-1"
        style={isStderr ? { color: 'var(--color-error)' } : undefined}
      >
        <CollapsibleOutput text={text} />
      </div>
    )
  }

  if (output.output_type === 'error') {
    const tb = (output.traceback || []).map(stripAnsi).join('\n')
    const fallback =
      tb || `${output.ename || 'Error'}: ${output.evalue || ''}`
    return (
      <div className="px-3 py-1" style={{ color: 'var(--color-error)' }}>
        <CollapsibleOutput text={fallback} />
      </div>
    )
  }

  // execute_result / display_data — pick richest mime type
  const data = output.data
  if (!data) return null

  // Image outputs (base64)
  for (const mime of ['image/png', 'image/jpeg', 'image/svg+xml']) {
    const img = data[mime]
    if (img) {
      const raw = normalizeSource(img)
      if (mime === 'image/svg+xml') {
        return (
          <div
            className="px-3 py-1"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(raw) }}
          />
        )
      }
      return (
        <div className="px-3 py-1">
          <img
            src={`data:${mime};base64,${raw.trim()}`}
            alt="Cell output"
            style={{ maxWidth: '100%' }}
          />
        </div>
      )
    }
  }

  // HTML output
  const html = data['text/html']
  if (html) {
    const raw = normalizeSource(html)
    return (
      <div
        className="px-3 py-1 overflow-x-auto text-sm"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(raw) }}
      />
    )
  }

  // Plain text fallback
  const plain = data['text/plain']
  if (plain) {
    return (
      <div className="px-3 py-1">
        <CollapsibleOutput text={normalizeSource(plain)} />
      </div>
    )
  }

  return null
}

// ── Kernel Toolbar ────────────────────────────

function KernelToolbar({
  status,
  onStart,
  onInterrupt,
  onRestart,
  onShutdown,
  onRunAll,
}: {
  status: KernelStatus
  onStart: () => void
  onInterrupt: () => void
  onRestart: () => void
  onShutdown: () => void
  onRunAll: () => void
}) {
  const statusColor = {
    off: 'var(--color-text-muted)',
    starting: 'var(--color-warning)',
    idle: 'var(--color-success)',
    busy: 'var(--color-warning)',
    dead: 'var(--color-error)',
  }[status]

  const statusLabel = {
    off: 'Kernel Off',
    starting: 'Starting...',
    idle: 'Idle',
    busy: 'Busy',
    dead: 'Disconnected',
  }[status]

  const btnClass =
    'px-2 py-0.5 rounded text-xs hover:opacity-80 disabled:opacity-40'

  return (
    <div
      className="flex items-center gap-2 px-4 py-1.5 border-b"
      style={{
        borderColor:
          'color-mix(in srgb, var(--color-text-muted) 20%, transparent)',
      }}
    >
      {/* Status indicator */}
      <div className="flex items-center gap-1.5 mr-2">
        <div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: statusColor }}
        />
        <span
          className="text-xs"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {statusLabel}
        </span>
      </div>

      {status === 'off' || status === 'dead' ? (
        <button
          onClick={onStart}
          className={btnClass}
          style={{
            backgroundColor: 'var(--color-primary)',
            color: 'var(--color-base)',
          }}
        >
          Start Kernel
        </button>
      ) : (
        <>
          <button
            onClick={onRunAll}
            className={btnClass}
            disabled={status !== 'idle'}
            style={{ backgroundColor: 'var(--color-surface)' }}
            title="Run All Cells"
          >
            Run All
          </button>
          <button
            onClick={onInterrupt}
            className={btnClass}
            disabled={status !== 'busy'}
            style={{ backgroundColor: 'var(--color-surface)' }}
            title="Interrupt Kernel"
          >
            Interrupt
          </button>
          <button
            onClick={onRestart}
            className={btnClass}
            disabled={status === 'starting'}
            style={{ backgroundColor: 'var(--color-surface)' }}
            title="Restart Kernel"
          >
            Restart
          </button>
          <button
            onClick={onShutdown}
            className={btnClass}
            style={{ backgroundColor: 'var(--color-surface)' }}
            title="Shutdown Kernel"
          >
            Shutdown
          </button>
        </>
      )}
    </div>
  )
}

// ── AddCellBar ─────────────────────────────────

function AddCellBar({
  onAdd,
}: {
  onAdd: (type: 'code' | 'markdown') => void
}) {
  return (
    <div className="group/add flex items-center justify-center py-0.5 opacity-0 hover:opacity-100 transition-opacity">
      <div
        className="flex-1 h-px"
        style={{
          backgroundColor:
            'color-mix(in srgb, var(--color-primary) 30%, transparent)',
        }}
      />
      <div className="flex gap-1 px-2">
        <button
          onClick={() => onAdd('code')}
          className="text-[10px] px-2 py-0.5 rounded hover:opacity-80"
          style={{
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-primary)',
          }}
        >
          + Code
        </button>
        <button
          onClick={() => onAdd('markdown')}
          className="text-[10px] px-2 py-0.5 rounded hover:opacity-80"
          style={{
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-primary)',
          }}
        >
          + Markdown
        </button>
      </div>
      <div
        className="flex-1 h-px"
        style={{
          backgroundColor:
            'color-mix(in srgb, var(--color-primary) 30%, transparent)',
        }}
      />
    </div>
  )
}

// ── CellToolbar ────────────────────────────────

function CellToolbar({
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  canMoveUp: boolean
  canMoveDown: boolean
}) {
  const btnClass = 'p-0.5 px-1 rounded hover:opacity-80 disabled:opacity-30 text-xs'
  return (
    <div
      className="absolute top-1 right-1 flex gap-0.5 rounded opacity-0 group-hover/cell:opacity-100 transition-opacity z-10"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      <button
        onClick={onMoveUp}
        disabled={!canMoveUp}
        className={btnClass}
        title="Move up"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {'\u2191'}
      </button>
      <button
        onClick={onMoveDown}
        disabled={!canMoveDown}
        className={btnClass}
        title="Move down"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {'\u2193'}
      </button>
      <button
        onClick={onDelete}
        className={btnClass}
        title="Delete cell"
        style={{ color: 'var(--color-error)' }}
      >
        {'\u2715'}
      </button>
    </div>
  )
}

// ── NotebookCellView ───────────────────────────

function NotebookCellView({
  cell,
  liveOutputs,
  liveExecCount,
  isExecuting,
  kernelStatus,
  onRun,
  isEditing,
  isReadOnly,
  onStartEdit,
  onSourceChange,
  onCommitEdit,
  onSave,
  language,
}: {
  cell: EditableCell
  liveOutputs: CellOutput[] | null
  liveExecCount: number | null
  isExecuting: boolean
  kernelStatus: KernelStatus
  onRun: () => void
  isEditing: boolean
  isReadOnly: boolean
  onStartEdit: () => void
  onSourceChange: (source: string) => void
  onCommitEdit: () => void
  onSave: () => void
  language: string
}) {
  const source = cell.source

  if (cell.cell_type === 'markdown') {
    if (isEditing) {
      return (
        <div className="py-2 px-3">
          <textarea
            autoFocus
            value={source}
            onChange={(e) => onSourceChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                onCommitEdit()
              }
              if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                onSave()
              }
            }}
            onBlur={onCommitEdit}
            className="w-full rounded p-2 text-xs resize-none outline-none"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-text)',
              minHeight: '60px',
              height: `${Math.max(60, source.split('\n').length * 20)}px`,
            }}
          />
        </div>
      )
    }
    return (
      <div
        className="py-2 px-3"
        onDoubleClick={!isReadOnly ? onStartEdit : undefined}
        style={!isReadOnly ? { cursor: 'text' } : undefined}
      >
        <MarkdownArtifact content={source} />
      </div>
    )
  }

  if (cell.cell_type === 'raw') {
    if (isEditing) {
      return (
        <div className="py-2 px-3">
          <textarea
            autoFocus
            value={source}
            onChange={(e) => onSourceChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                onCommitEdit()
              }
              if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                onSave()
              }
            }}
            onBlur={onCommitEdit}
            className="w-full rounded p-2 text-xs resize-none outline-none"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-text-muted)',
              minHeight: '60px',
              height: `${Math.max(60, source.split('\n').length * 20)}px`,
            }}
          />
        </div>
      )
    }
    return (
      <div
        className="py-2 px-3"
        onDoubleClick={!isReadOnly ? onStartEdit : undefined}
        style={!isReadOnly ? { cursor: 'text' } : undefined}
      >
        <pre
          className="text-xs whitespace-pre-wrap"
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            color: 'var(--color-text-muted)',
          }}
        >
          {source}
        </pre>
      </div>
    )
  }

  // code cell
  const outputs = liveOutputs ?? cell.outputs ?? []
  const execCount = liveExecCount ?? cell.execution_count
  const canRun = kernelStatus === 'idle' || kernelStatus === 'busy'

  const lineCount = source.split('\n').length

  return (
    <div className="py-2">
      {/* Source */}
      <div className="flex gap-2 px-3">
        {/* Run button + execution count */}
        <div className="flex items-start shrink-0 w-10">
          {canRun ? (
            <button
              onClick={onRun}
              disabled={isExecuting}
              className="w-full text-xs text-right pt-0.5 hover:opacity-70 disabled:opacity-40"
              style={{
                color: isExecuting
                  ? 'var(--color-warning)'
                  : 'var(--color-primary)',
                fontFamily: "'JetBrains Mono', monospace",
              }}
              title={isExecuting ? 'Running...' : 'Run cell'}
            >
              {isExecuting ? '[*]' : `[${execCount ?? ' '}]`}
            </button>
          ) : (
            <span
              className="select-none text-xs shrink-0 w-full text-right pt-0.5"
              style={{
                color: 'var(--color-text-muted)',
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              [{execCount ?? ' '}]
            </span>
          )}
        </div>
        {isEditing ? (
          <div
            className="flex-1 rounded overflow-hidden"
            style={{ backgroundColor: 'var(--color-surface)' }}
          >
            <Editor
              height={`${Math.min(Math.max(lineCount * 19, 57), 400)}px`}
              language={language === 'python' ? 'python' : language}
              theme="vs-dark"
              value={source}
              onChange={(val) => onSourceChange(val ?? '')}
              onMount={(editor, monaco) => {
                editor.focus()
                editor.addCommand(monaco.KeyCode.Escape, () => {
                  onCommitEdit()
                })
                editor.addCommand(
                  monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
                  () => {
                    onCommitEdit()
                    onRun()
                  },
                )
                editor.addCommand(
                  monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
                  () => {
                    onSave()
                  },
                )
              }}
              options={{
                minimap: { enabled: false },
                wordWrap: 'on',
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                fontSize: 12,
                tabSize: 4,
                renderLineHighlight: 'none',
                overviewRulerLanes: 0,
                hideCursorInOverviewRuler: true,
                scrollbar: { vertical: 'hidden', horizontal: 'auto' },
              }}
            />
          </div>
        ) : (
          <pre
            className="flex-1 rounded p-2 text-xs overflow-x-auto"
            style={{
              backgroundColor: 'var(--color-surface)',
              fontFamily: "'JetBrains Mono', monospace",
              cursor: isReadOnly ? undefined : 'text',
            }}
            onClick={!isReadOnly ? onStartEdit : undefined}
          >
            {source}
          </pre>
        )}
      </div>

      {/* Outputs */}
      {outputs.length > 0 && (
        <div
          className="ml-14 mt-1 border-l-2 pl-2"
          style={{
            borderColor:
              'color-mix(in srgb, var(--color-text-muted) 30%, transparent)',
          }}
        >
          {outputs.map((output, i) => (
            <CellOutputView key={i} output={output} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── NotebookPreview (main export) ──────────────

interface NotebookPreviewProps {
  content: string
  filePath?: string
}

export function NotebookPreview({ content, filePath }: NotebookPreviewProps) {
  const isReadOnly = !filePath

  // ── Stable ID generator ──────────────────
  const nextIdRef = useRef(1)
  const nextId = () => nextIdRef.current++

  // ── Notebook metadata ref ────────────────
  const notebookMetaRef = useRef<NotebookMeta>({})

  // ── Parse & init cells from content ──────
  const [cells, setCells] = useState<EditableCell[]>(() => {
    const parsed = parseNotebook(content)
    if (!parsed) return []
    notebookMetaRef.current = {
      metadata: parsed.metadata,
      nbformat: parsed.nbformat,
      nbformat_minor: parsed.nbformat_minor,
    }
    return parsed.cells.map((c) => ({
      _id: nextId(),
      cell_type: c.cell_type,
      source: normalizeSource(c.source),
      outputs: c.outputs,
      execution_count: c.execution_count,
      metadata: c.metadata,
    }))
  })

  // Track whether the initial parse failed
  const [parseOk, setParseOk] = useState(() => parseNotebook(content) !== null)

  // ── Loop prevention refs ─────────────────
  const lastSerializedRef = useRef<string | null>(null)
  const lastContentRef = useRef(content)

  // Initialize lastSerializedRef from initial cells
  useEffect(() => {
    if (cells.length > 0 && lastSerializedRef.current === null) {
      lastSerializedRef.current = serializeNotebook(
        cells,
        notebookMetaRef.current,
        new Map(),
        new Map(),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Detect external content changes ──────
  useEffect(() => {
    if (content === lastContentRef.current) return
    lastContentRef.current = content

    // If this is our own save coming back, don't re-init
    if (lastSerializedRef.current !== null && content === lastSerializedRef.current) return

    const parsed = parseNotebook(content)
    if (!parsed) {
      setParseOk(false)
      setCells([])
      return
    }
    setParseOk(true)
    notebookMetaRef.current = {
      metadata: parsed.metadata,
      nbformat: parsed.nbformat,
      nbformat_minor: parsed.nbformat_minor,
    }
    const newCells = parsed.cells.map((c) => ({
      _id: nextId(),
      cell_type: c.cell_type as 'code' | 'markdown' | 'raw',
      source: normalizeSource(c.source),
      outputs: c.outputs,
      execution_count: c.execution_count,
      metadata: c.metadata,
    }))
    setCells(newCells)
    lastSerializedRef.current = serializeNotebook(
      newCells,
      notebookMetaRef.current,
      new Map(),
      new Map(),
    )
    // Clear editing state on external change
    setEditingCellId(null)
  }, [content])

  // ── Store integration (dirty tracking) ───
  const { setEditorContent } = useFileExplorerStore()
  const serializeTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const skipInitialSyncRef = useRef(true)

  const cellsRef = useRef(cells)
  cellsRef.current = cells

  useEffect(() => {
    // Skip the initial render — no edits have happened yet
    if (skipInitialSyncRef.current) {
      skipInitialSyncRef.current = false
      return
    }
    if (isReadOnly) return

    clearTimeout(serializeTimerRef.current)
    serializeTimerRef.current = setTimeout(() => {
      const serialized = serializeNotebook(
        cellsRef.current,
        notebookMetaRef.current,
        cellOutputs,
        cellExecCounts,
      )
      if (serialized === lastSerializedRef.current) return
      lastSerializedRef.current = serialized
      lastContentRef.current = serialized
      setEditorContent(serialized)
    }, 300)

    return () => clearTimeout(serializeTimerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, isReadOnly])

  // ── Editing state ────────────────────────
  const [editingCellId, setEditingCellId] = useState<number | null>(null)

  const handleStartEdit = useCallback(
    (cellId: number) => {
      if (isReadOnly) return
      setEditingCellId(cellId)
    },
    [isReadOnly],
  )

  const handleCommitEdit = useCallback(() => {
    setEditingCellId(null)
  }, [])

  const handleSourceChange = useCallback(
    (cellId: number, newSource: string) => {
      setCells((prev) =>
        prev.map((c) => (c._id === cellId ? { ...c, source: newSource } : c)),
      )
    },
    [],
  )

  const handleSave = useCallback(() => {
    // Flush pending serialization immediately, then save
    clearTimeout(serializeTimerRef.current)
    const serialized = serializeNotebook(
      cellsRef.current,
      notebookMetaRef.current,
      cellOutputs,
      cellExecCounts,
    )
    lastSerializedRef.current = serialized
    lastContentRef.current = serialized
    useFileExplorerStore.getState().setEditorContent(serialized)
    useFileExplorerStore.getState().saveFile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Cell operations ──────────────────────
  const handleAddCell = useCallback(
    (afterIndex: number, type: 'code' | 'markdown') => {
      if (isReadOnly) return
      const newCell: EditableCell = {
        _id: nextId(),
        cell_type: type,
        source: '',
        outputs: type === 'code' ? [] : undefined,
        execution_count: type === 'code' ? null : undefined,
        metadata: {},
      }
      setCells((prev) => {
        const next = [...prev]
        next.splice(afterIndex + 1, 0, newCell)
        return next
      })
      // Auto-open in edit mode
      setEditingCellId(newCell._id)
    },
    [isReadOnly],
  )

  const handleDeleteCell = useCallback(
    (cellId: number) => {
      if (isReadOnly) return
      setCells((prev) => prev.filter((c) => c._id !== cellId))
      if (editingCellId === cellId) setEditingCellId(null)
    },
    [isReadOnly, editingCellId],
  )

  const handleMoveCell = useCallback(
    (cellId: number, direction: 'up' | 'down') => {
      if (isReadOnly) return
      setCells((prev) => {
        const idx = prev.findIndex((c) => c._id === cellId)
        if (idx === -1) return prev
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1
        if (targetIdx < 0 || targetIdx >= prev.length) return prev
        const next = [...prev]
        ;[next[idx], next[targetIdx]] = [next[targetIdx], next[idx]]
        return next
      })
    },
    [isReadOnly],
  )

  // ── Kernel state ────────────────────────
  const [kernelStatus, setKernelStatus] = useState<KernelStatus>('off')
  const [cellOutputs, setCellOutputs] = useState<Map<number, CellOutput[]>>(
    new Map(),
  )
  const [cellExecCounts, setCellExecCounts] = useState<Map<number, number>>(
    new Map(),
  )
  const [executingCells, setExecutingCells] = useState<Set<string>>(new Set()) // request IDs
  const [jupyterError, setJupyterError] = useState<string | null>(null)

  // Map request ID to cell _id for routing outputs
  const reqToCellRef = useRef<Map<string, number>>(new Map())
  const kernelStatusRef = useRef<KernelStatus>('off')
  kernelStatusRef.current = kernelStatus

  // ── Jupyter output listener ─────────────
  useEffect(() => {
    if (!filePath) return

    const unsub = window.agent.jupyter.onOutput(
      (chunk: JupyterOutputChunk) => {
        if (chunk.filePath !== filePath) return

        // Handle ready
        if (chunk.type === 'ready') {
          setKernelStatus('idle')
          setJupyterError(null)
          return
        }

        // Handle kernel death
        if (chunk.type === 'status' && chunk.state === 'dead') {
          setKernelStatus('dead')
          setExecutingCells(new Set())
          return
        }

        // Handle status changes
        if (chunk.type === 'status') {
          if (chunk.state === 'idle') {
            setKernelStatus('idle')
            if (chunk.id) {
              setExecutingCells((prev) => {
                const next = new Set(prev)
                next.delete(chunk.id!)
                return next
              })
            }
          } else if (chunk.state === 'busy') {
            setKernelStatus('busy')
          } else if (chunk.state === 'restarted') {
            setKernelStatus('idle')
            setCellOutputs(new Map())
            setCellExecCounts(new Map())
            setExecutingCells(new Set())
          }
          return
        }

        // Route output to the correct cell (by _id)
        if (!chunk.id) return
        const cellId = reqToCellRef.current.get(chunk.id)
        if (cellId == null) return

        const output: CellOutput = chunkToCellOutput(chunk)

        setCellOutputs((prev) => {
          const next = new Map(prev)
          const existing = next.get(cellId) || []
          next.set(cellId, [...existing, output])
          return next
        })

        if (
          chunk.type === 'execute_result' &&
          chunk.execution_count != null
        ) {
          setCellExecCounts((prev) => {
            const next = new Map(prev)
            next.set(cellId, chunk.execution_count!)
            return next
          })
        }
      },
    )

    return unsub
  }, [filePath])

  // Cleanup kernel on unmount only
  useEffect(() => {
    return () => {
      if (filePath && kernelStatusRef.current !== 'off') {
        window.agent.jupyter.shutdownKernel(filePath).catch(() => {})
      }
    }
  }, [filePath])

  // ── Actions ─────────────────────────────
  const handleStartKernel = useCallback(async () => {
    if (!filePath) return
    setJupyterError(null)

    try {
      const result = await window.agent.jupyter.detectJupyter()
      if (!result.found) {
        setJupyterError(
          result.error ||
            'Jupyter not found. Install with: pip install jupyter ipykernel',
        )
        return
      }

      setKernelStatus('starting')
      const kernelName =
        notebookMetaRef.current.metadata &&
        (notebookMetaRef.current.metadata as any).kernelspec?.name
      await window.agent.jupyter.startKernel(
        filePath,
        kernelName || undefined,
      )
    } catch (err) {
      setKernelStatus('off')
      setJupyterError(err instanceof Error ? err.message : String(err))
    }
  }, [filePath])

  const handleRunCell = useCallback(
    async (cellId: number) => {
      if (!filePath) return
      const cell = cellsRef.current.find((c) => c._id === cellId)
      if (!cell || cell.cell_type !== 'code') return

      const code = cell.source
      if (!code.trim()) return

      // Clear previous outputs for this cell
      setCellOutputs((prev) => {
        const next = new Map(prev)
        next.set(cellId, [])
        return next
      })

      try {
        const reqId = await window.agent.jupyter.executeCell(filePath, code)
        reqToCellRef.current.set(reqId, cellId)
        setExecutingCells((prev) => new Set(prev).add(reqId))
      } catch (err) {
        setCellOutputs((prev) => {
          const next = new Map(prev)
          next.set(cellId, [
            {
              output_type: 'error',
              ename: 'ExecutionError',
              evalue: err instanceof Error ? err.message : String(err),
              traceback: [],
            },
          ])
          return next
        })
      }
    },
    [filePath],
  )

  const handleRunAll = useCallback(async () => {
    const currentCells = cellsRef.current
    for (const cell of currentCells) {
      if (cell.cell_type === 'code') {
        await handleRunCell(cell._id)
        await waitForIdle(filePath!)
      }
    }
  }, [handleRunCell, filePath])

  const handleInterrupt = useCallback(() => {
    if (!filePath) return
    window.agent.jupyter.interruptKernel(filePath).catch(() => {})
  }, [filePath])

  const handleRestart = useCallback(() => {
    if (!filePath) return
    setKernelStatus('starting')
    window.agent.jupyter.restartKernel(filePath).catch(() => {})
  }, [filePath])

  const handleShutdown = useCallback(() => {
    if (!filePath) return
    window.agent.jupyter.shutdownKernel(filePath).catch(() => {})
    setKernelStatus('off')
    setCellOutputs(new Map())
    setCellExecCounts(new Map())
    setExecutingCells(new Set())
    reqToCellRef.current.clear()
  }, [filePath])

  // ── Derived state ───────────────────────
  const language = useMemo(() => {
    const meta = notebookMetaRef.current.metadata as any
    return meta?.kernelspec?.language || 'python'
  }, [cells]) // re-derive when cells change (meta might have been updated)

  // Find which cells are currently executing (by _id)
  const executingCellIds = useMemo(() => {
    const ids = new Set<number>()
    for (const reqId of executingCells) {
      const cellId = reqToCellRef.current.get(reqId)
      if (cellId != null) ids.add(cellId)
    }
    return ids
  }, [executingCells])

  // ── Render ──────────────────────────────
  if (!parseOk) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-sm" style={{ color: 'var(--color-error)' }}>
          Failed to parse notebook — invalid JSON or missing cells array
        </div>
      </div>
    )
  }

  return (
    <div
      className="h-full overflow-auto"
      style={{ color: 'var(--color-text)' }}
    >
      {/* Kernel toolbar (only when filePath is available) */}
      {filePath && (
        <KernelToolbar
          status={kernelStatus}
          onStart={handleStartKernel}
          onInterrupt={handleInterrupt}
          onRestart={handleRestart}
          onShutdown={handleShutdown}
          onRunAll={handleRunAll}
        />
      )}

      {/* Jupyter error banner */}
      {jupyterError && (
        <div
          className="mx-4 mt-2 px-3 py-2 rounded text-xs"
          style={{
            backgroundColor:
              'color-mix(in srgb, var(--color-error) 15%, transparent)',
            color: 'var(--color-error)',
          }}
        >
          {jupyterError}
        </div>
      )}

      {/* Header badge */}
      <div
        className="px-4 py-2 flex items-center gap-2 text-xs"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <span
          className="px-2 py-0.5 rounded"
          style={{ backgroundColor: 'var(--color-surface)' }}
        >
          {language}
        </span>
        <span>
          {cells.length} cell{cells.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Cells */}
      <div className="pb-8">
        {cells.map((cell, i) => (
          <div key={cell._id}>
            <div
              className="group/cell relative border-b"
              style={{
                borderColor:
                  'color-mix(in srgb, var(--color-text-muted) 15%, transparent)',
              }}
            >
              {/* Cell toolbar (editable mode only) */}
              {!isReadOnly && (
                <CellToolbar
                  onDelete={() => handleDeleteCell(cell._id)}
                  onMoveUp={() => handleMoveCell(cell._id, 'up')}
                  onMoveDown={() => handleMoveCell(cell._id, 'down')}
                  canMoveUp={i > 0}
                  canMoveDown={i < cells.length - 1}
                />
              )}
              <NotebookCellView
                cell={cell}
                liveOutputs={cellOutputs.get(cell._id) ?? null}
                liveExecCount={cellExecCounts.get(cell._id) ?? null}
                isExecuting={executingCellIds.has(cell._id)}
                kernelStatus={kernelStatus}
                onRun={() => handleRunCell(cell._id)}
                isEditing={editingCellId === cell._id}
                isReadOnly={isReadOnly}
                onStartEdit={() => handleStartEdit(cell._id)}
                onSourceChange={(src) => handleSourceChange(cell._id, src)}
                onCommitEdit={handleCommitEdit}
                onSave={handleSave}
                language={language}
              />
            </div>
            {/* Add cell bar between cells */}
            {!isReadOnly && (
              <AddCellBar onAdd={(type) => handleAddCell(i, type)} />
            )}
          </div>
        ))}
        {/* Add cell bar at the end when empty */}
        {!isReadOnly && cells.length === 0 && (
          <AddCellBar onAdd={(type) => handleAddCell(-1, type)} />
        )}
      </div>
    </div>
  )
}

// ── Utility: convert JupyterOutputChunk to CellOutput ──

function chunkToCellOutput(chunk: JupyterOutputChunk): CellOutput {
  switch (chunk.type) {
    case 'stream':
      return {
        output_type: 'stream',
        name: chunk.name || 'stdout',
        text: chunk.text || '',
      }
    case 'execute_result':
      return {
        output_type: 'execute_result',
        data: chunk.data || {},
        execution_count: chunk.execution_count,
      }
    case 'display_data':
      return {
        output_type: 'display_data',
        data: chunk.data || {},
      }
    case 'error':
      return {
        output_type: 'error',
        ename: chunk.ename || 'Error',
        evalue: chunk.evalue || '',
        traceback: chunk.traceback || [],
      }
    default:
      return {
        output_type: 'stream',
        name: 'stdout',
        text: '',
      }
  }
}

// ── Utility: wait for kernel to become idle ──

function waitForIdle(filePath: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      window.agent.jupyter
        .getStatus(filePath)
        .then((status) => {
          if (status === 'idle' || status === null) {
            resolve()
          } else {
            setTimeout(check, 200)
          }
        })
        .catch(() => resolve())
    }
    // Small delay to let the execute request get sent first
    setTimeout(check, 100)
  })
}
