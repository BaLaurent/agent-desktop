import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import DOMPurify from 'dompurify'
import { MarkdownArtifact } from './MarkdownArtifact'
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
}

interface NotebookData {
  cells: NotebookCell[]
  metadata?: { kernelspec?: { language?: string; name?: string } }
  nbformat?: number
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

// ── CollapsibleOutput ──────────────────────────

function CollapsibleOutput({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const lines = text.split('\n')
  const needsCollapse = lines.length > COLLAPSE_THRESHOLD

  if (!needsCollapse) {
    return (
      <pre className="whitespace-pre-wrap text-xs" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        {text}
      </pre>
    )
  }

  const visible = expanded ? text : lines.slice(0, COLLAPSE_THRESHOLD).join('\n')
  const hiddenCount = lines.length - COLLAPSE_THRESHOLD

  return (
    <div>
      <pre className="whitespace-pre-wrap text-xs" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
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
    const fallback = tb || `${output.ename || 'Error'}: ${output.evalue || ''}`
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
          <img src={`data:${mime};base64,${raw.trim()}`} alt="Cell output" style={{ maxWidth: '100%' }} />
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

  const btnClass = 'px-2 py-0.5 rounded text-xs hover:opacity-80 disabled:opacity-40'

  return (
    <div
      className="flex items-center gap-2 px-4 py-1.5 border-b"
      style={{ borderColor: 'color-mix(in srgb, var(--color-text-muted) 20%, transparent)' }}
    >
      {/* Status indicator */}
      <div className="flex items-center gap-1.5 mr-2">
        <div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: statusColor }}
        />
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {statusLabel}
        </span>
      </div>

      {status === 'off' || status === 'dead' ? (
        <button
          onClick={onStart}
          className={btnClass}
          style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-base)' }}
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

// ── NotebookCellView ───────────────────────────

function NotebookCellView({
  cell,
  cellIndex,
  liveOutputs,
  liveExecCount,
  isExecuting,
  kernelStatus,
  onRun,
}: {
  cell: NotebookCell
  cellIndex: number
  liveOutputs: CellOutput[] | null
  liveExecCount: number | null
  isExecuting: boolean
  kernelStatus: KernelStatus
  onRun: (cellIndex: number) => void
}) {
  const source = normalizeSource(cell.source)

  if (cell.cell_type === 'markdown') {
    return (
      <div className="py-2 px-3">
        <MarkdownArtifact content={source} />
      </div>
    )
  }

  if (cell.cell_type === 'raw') {
    return (
      <div className="py-2 px-3">
        <pre
          className="text-xs whitespace-pre-wrap"
          style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--color-text-muted)' }}
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

  return (
    <div className="py-2">
      {/* Source */}
      <div className="flex gap-2 px-3">
        {/* Run button + execution count */}
        <div className="flex items-start shrink-0 w-10">
          {canRun ? (
            <button
              onClick={() => onRun(cellIndex)}
              disabled={isExecuting}
              className="w-full text-xs text-right pt-0.5 hover:opacity-70 disabled:opacity-40"
              style={{ color: isExecuting ? 'var(--color-warning)' : 'var(--color-primary)', fontFamily: "'JetBrains Mono', monospace" }}
              title={isExecuting ? 'Running...' : 'Run cell'}
            >
              {isExecuting ? '[*]' : `[${execCount ?? ' '}]`}
            </button>
          ) : (
            <span
              className="select-none text-xs shrink-0 w-full text-right pt-0.5"
              style={{ color: 'var(--color-text-muted)', fontFamily: "'JetBrains Mono', monospace" }}
            >
              [{execCount ?? ' '}]
            </span>
          )}
        </div>
        <pre
          className="flex-1 rounded p-2 text-xs overflow-x-auto"
          style={{
            backgroundColor: 'var(--color-surface)',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {source}
        </pre>
      </div>

      {/* Outputs */}
      {outputs.length > 0 && (
        <div
          className="ml-14 mt-1 border-l-2 pl-2"
          style={{ borderColor: 'color-mix(in srgb, var(--color-text-muted) 30%, transparent)' }}
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
  const notebook = useMemo<NotebookData | null>(() => {
    try {
      const parsed = JSON.parse(content)
      if (!parsed || !Array.isArray(parsed.cells)) return null
      return parsed as NotebookData
    } catch {
      return null
    }
  }, [content])

  // ── Kernel state ────────────────────────
  const [kernelStatus, setKernelStatus] = useState<KernelStatus>('off')
  const [cellOutputs, setCellOutputs] = useState<Map<number, CellOutput[]>>(new Map())
  const [cellExecCounts, setCellExecCounts] = useState<Map<number, number>>(new Map())
  const [executingCells, setExecutingCells] = useState<Set<string>>(new Set()) // request IDs
  const [jupyterError, setJupyterError] = useState<string | null>(null)

  // Map request ID to cell index for routing outputs
  const reqToCellRef = useRef<Map<string, number>>(new Map())
  const kernelStatusRef = useRef<KernelStatus>('off')
  kernelStatusRef.current = kernelStatus

  // ── Jupyter output listener ─────────────
  useEffect(() => {
    if (!filePath) return

    const unsub = window.agent.jupyter.onOutput((chunk: JupyterOutputChunk) => {
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
          // Mark execution complete for this request
          if (chunk.id) {
            setExecutingCells(prev => {
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

      // Route output to the correct cell
      if (!chunk.id) return
      const cellIndex = reqToCellRef.current.get(chunk.id)
      if (cellIndex == null) return

      const output: CellOutput = chunkToCellOutput(chunk)

      setCellOutputs(prev => {
        const next = new Map(prev)
        const existing = next.get(cellIndex) || []
        next.set(cellIndex, [...existing, output])
        return next
      })

      if (chunk.type === 'execute_result' && chunk.execution_count != null) {
        setCellExecCounts(prev => {
          const next = new Map(prev)
          next.set(cellIndex, chunk.execution_count!)
          return next
        })
      }
    })

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
        setJupyterError(result.error || 'Jupyter not found. Install with: pip install jupyter ipykernel')
        return
      }

      setKernelStatus('starting')
      const kernelName = notebook?.metadata?.kernelspec?.name
      await window.agent.jupyter.startKernel(filePath, kernelName || undefined)
    } catch (err) {
      setKernelStatus('off')
      setJupyterError(err instanceof Error ? err.message : String(err))
    }
  }, [filePath, notebook])

  const handleRunCell = useCallback(async (cellIndex: number) => {
    if (!filePath || !notebook) return
    const cell = notebook.cells[cellIndex]
    if (!cell || cell.cell_type !== 'code') return

    const code = normalizeSource(cell.source)
    if (!code.trim()) return

    // Clear previous outputs for this cell
    setCellOutputs(prev => {
      const next = new Map(prev)
      next.set(cellIndex, [])
      return next
    })

    try {
      const reqId = await window.agent.jupyter.executeCell(filePath, code)
      reqToCellRef.current.set(reqId, cellIndex)
      setExecutingCells(prev => new Set(prev).add(reqId))
    } catch (err) {
      setCellOutputs(prev => {
        const next = new Map(prev)
        next.set(cellIndex, [{
          output_type: 'error',
          ename: 'ExecutionError',
          evalue: err instanceof Error ? err.message : String(err),
          traceback: [],
        }])
        return next
      })
    }
  }, [filePath, notebook])

  const handleRunAll = useCallback(async () => {
    if (!notebook) return
    for (let i = 0; i < notebook.cells.length; i++) {
      if (notebook.cells[i].cell_type === 'code') {
        await handleRunCell(i)
        // Wait for execution to complete before running next cell
        await waitForIdle(filePath!)
      }
    }
  }, [notebook, handleRunCell, filePath])

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

  // ── Render ──────────────────────────────
  if (!notebook) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-sm" style={{ color: 'var(--color-error)' }}>
          Failed to parse notebook — invalid JSON or missing cells array
        </div>
      </div>
    )
  }

  const language = notebook.metadata?.kernelspec?.language || 'python'

  // Find which cells are currently executing
  const executingCellIndices = new Set<number>()
  for (const reqId of executingCells) {
    const idx = reqToCellRef.current.get(reqId)
    if (idx != null) executingCellIndices.add(idx)
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
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 15%, transparent)', color: 'var(--color-error)' }}
        >
          {jupyterError}
        </div>
      )}

      {/* Header badge */}
      <div className="px-4 py-2 flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        <span className="px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surface)' }}>
          {language}
        </span>
        <span>{notebook.cells.length} cell{notebook.cells.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Cells */}
      <div className="pb-8">
        {notebook.cells.map((cell, i) => (
          <div
            key={i}
            className="border-b"
            style={{ borderColor: 'color-mix(in srgb, var(--color-text-muted) 15%, transparent)' }}
          >
            <NotebookCellView
              cell={cell}
              cellIndex={i}
              liveOutputs={cellOutputs.get(i) ?? null}
              liveExecCount={cellExecCounts.get(i) ?? null}
              isExecuting={executingCellIndices.has(i)}
              kernelStatus={kernelStatus}
              onRun={handleRunCell}
            />
          </div>
        ))}
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
      window.agent.jupyter.getStatus(filePath).then((status) => {
        if (status === 'idle' || status === null) {
          resolve()
        } else {
          setTimeout(check, 200)
        }
      }).catch(() => resolve())
    }
    // Small delay to let the execute request get sent first
    setTimeout(check, 100)
  })
}
