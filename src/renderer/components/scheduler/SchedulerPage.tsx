import { useState, useEffect, useCallback } from 'react'
import { useSchedulerStore } from '../../stores/schedulerStore'
import { TaskCard } from './TaskCard'
import { TaskFormModal } from './TaskFormModal'
import type { ScheduledTask, CreateScheduledTask } from '../../../shared/types'

interface Props {
  onClose: () => void
}

export function SchedulerPage({ onClose }: Props) {
  const { tasks, loading, fetchTasks, createTask, updateTask, deleteTask, toggleTask, runNow } = useSchedulerStore()
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showCreateModal && !editingTask) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, showCreateModal, editingTask])

  const handleCreate = useCallback(async (data: CreateScheduledTask) => {
    await createTask(data)
  }, [createTask])

  const handleUpdate = useCallback(async (data: CreateScheduledTask) => {
    if (!editingTask) return
    await updateTask(editingTask.id, data)
    setEditingTask(null)
  }, [editingTask, updateTask])

  const handleDelete = useCallback((id: number) => {
    const task = tasks.find((t) => t.id === id)
    if (task && confirm(`Delete "${task.name}"?`)) {
      deleteTask(id)
    }
  }, [tasks, deleteTask])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-3xl max-h-[80vh] rounded-lg shadow-xl flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-text-muted)]/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5" style={{ color: 'var(--color-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
              Scheduled Tasks
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-muted)' }}>
              {tasks.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors"
              style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}
              aria-label="Create new scheduled task"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Task
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-[var(--color-bg)] transition-colors"
              style={{ color: 'var(--color-text-muted)' }}
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path d="M1.05 1.05a.5.5 0 01.707 0L7 6.293l5.243-5.243a.5.5 0 11.707.707L7.707 7l5.243 5.243a.5.5 0 11-.707.707L7 7.707l-5.243 5.243a.5.5 0 01-.707-.707L6.293 7 1.05 1.757a.5.5 0 010-.707z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && tasks.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading...</span>
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <svg className="w-12 h-12" style={{ color: 'var(--color-text-muted)', opacity: 0.4 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                No scheduled tasks yet
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="text-sm font-medium hover:underline"
                style={{ color: 'var(--color-primary)' }}
              >
                Create your first task
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onEdit={setEditingTask}
                  onToggle={toggleTask}
                  onRunNow={runNow}
                  onDelete={handleDelete}
                  onClose={onClose}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create modal */}
      {showCreateModal && (
        <TaskFormModal
          onSave={handleCreate}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {/* Edit modal */}
      {editingTask && (
        <TaskFormModal
          task={editingTask}
          onSave={handleUpdate}
          onClose={() => setEditingTask(null)}
        />
      )}
    </div>
  )
}
