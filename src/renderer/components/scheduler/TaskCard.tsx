import type { ScheduledTask } from '../../../shared/types'
import { useConversationsStore } from '../../stores/conversationsStore'

interface Props {
  task: ScheduledTask
  onEdit: (task: ScheduledTask) => void
  onToggle: (id: number, enabled: boolean) => void
  onRunNow: (id: number) => void
  onDelete: (id: number) => void
}

function formatSchedule(task: ScheduledTask): string {
  const v = task.interval_value
  const u = task.interval_unit
  const label = v === 1 ? u.slice(0, -1) : `${v} ${u}`
  const prefix = v === 1 ? 'Every' : 'Every'
  let str = `${prefix} ${label}`
  if (u === 'days' && task.schedule_time) {
    str += ` at ${task.schedule_time}`
  }
  return str
}

function formatNextRun(nextRun: string | null): string {
  if (!nextRun) return 'Not scheduled'
  const d = new Date(nextRun)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()

  if (diffMs < 0) return 'Overdue'
  if (diffMs < 60_000) return 'Less than a minute'

  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`

  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function StatusBadge({ status }: { status: ScheduledTask['last_status'] }) {
  if (!status) return null

  const colors: Record<string, { bg: string; text: string }> = {
    success: { bg: 'color-mix(in srgb, var(--color-success, #22c55e) 20%, transparent)', text: 'var(--color-success, #22c55e)' },
    error: { bg: 'color-mix(in srgb, var(--color-error) 20%, transparent)', text: 'var(--color-error)' },
    running: { bg: 'color-mix(in srgb, var(--color-primary) 20%, transparent)', text: 'var(--color-primary)' },
  }

  const c = colors[status] || colors.error

  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {status === 'running' ? 'Running...' : status}
    </span>
  )
}

export function TaskCard({ task, onEdit, onToggle, onRunNow, onDelete }: Props) {
  const { setActiveConversation } = useConversationsStore()

  return (
    <div
      className="rounded-lg p-4 transition-colors"
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-bg)',
        opacity: task.enabled ? 1 : 0.6,
      }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <h3
            className="text-sm font-semibold truncate"
            style={{ color: 'var(--color-text)' }}
          >
            {task.name}
          </h3>
          <StatusBadge status={task.last_status} />
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Run now */}
          <button
            onClick={() => onRunNow(task.id)}
            disabled={task.last_status === 'running'}
            title="Run now"
            className="p-1.5 rounded transition-colors disabled:opacity-40"
            style={{ color: 'var(--color-text-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-bg)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            aria-label="Run task now"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>

          {/* Toggle enabled */}
          <button
            onClick={() => onToggle(task.id, !task.enabled)}
            title={task.enabled ? 'Disable' : 'Enable'}
            className="p-1.5 rounded transition-colors"
            style={{ color: task.enabled ? 'var(--color-primary)' : 'var(--color-text-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-bg)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            aria-label={task.enabled ? 'Disable task' : 'Enable task'}
          >
            {task.enabled ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </button>

          {/* Edit */}
          <button
            onClick={() => onEdit(task)}
            title="Edit"
            className="p-1.5 rounded transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-bg)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            aria-label="Edit task"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>

          {/* Delete */}
          <button
            onClick={() => onDelete(task.id)}
            title="Delete"
            className="p-1.5 rounded transition-colors"
            style={{ color: 'var(--color-error)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-bg)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            aria-label="Delete task"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Schedule info */}
      <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        <span>{formatSchedule(task)}</span>
        <span>·</span>
        <span>Next: {task.enabled ? formatNextRun(task.next_run_at) : 'disabled'}</span>
        {task.run_count > 0 && (
          <>
            <span>·</span>
            <span>{task.run_count} run{task.run_count !== 1 ? 's' : ''}</span>
          </>
        )}
      </div>

      {/* Prompt preview */}
      <div
        className="text-xs mt-2 line-clamp-2"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {task.prompt}
      </div>

      {/* Conversation link */}
      {task.conversation_title && (
        <button
          onClick={() => setActiveConversation(task.conversation_id)}
          className="text-xs mt-2 hover:underline cursor-pointer"
          style={{ color: 'var(--color-primary)' }}
        >
          → {task.conversation_title}
        </button>
      )}

      {/* Error display */}
      {task.last_status === 'error' && task.last_error && (
        <div
          className="text-xs mt-2 p-2 rounded"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
            color: 'var(--color-error)',
          }}
        >
          {task.last_error}
        </div>
      )}
    </div>
  )
}
