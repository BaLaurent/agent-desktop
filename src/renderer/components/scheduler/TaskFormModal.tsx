import { useState, useEffect } from 'react'
import type { ScheduledTask, CreateScheduledTask, IntervalUnit } from '../../../shared/types'
import { useConversationsStore } from '../../stores/conversationsStore'

interface Props {
  task?: ScheduledTask | null
  onSave: (data: CreateScheduledTask) => Promise<void>
  onClose: () => void
}

export function TaskFormModal({ task, onSave, onClose }: Props) {
  const { conversations, loadConversations } = useConversationsStore()

  const [name, setName] = useState(task?.name || '')
  const [prompt, setPrompt] = useState(task?.prompt || '')
  const [conversationId, setConversationId] = useState<number | 'new'>(task?.conversation_id || 'new')
  const [intervalValue, setIntervalValue] = useState(task?.interval_value || 1)
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(task?.interval_unit || 'hours')
  const [scheduleTime, setScheduleTime] = useState(task?.schedule_time || '')
  const [catchUp, setCatchUp] = useState(task?.catch_up !== false)
  const [notifyDesktop, setNotifyDesktop] = useState(task?.notify_desktop !== false)
  const [notifyVoice, setNotifyVoice] = useState(task?.notify_voice || false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    if (!prompt.trim()) { setError('Prompt is required'); return }
    if (intervalValue < 1) { setError('Interval must be at least 1'); return }

    setSaving(true)
    setError(null)
    try {
      await onSave({
        name: name.trim(),
        prompt: prompt.trim(),
        conversation_id: conversationId === 'new' ? undefined : conversationId,
        interval_value: intervalValue,
        interval_unit: intervalUnit,
        schedule_time: intervalUnit === 'days' && scheduleTime ? scheduleTime : undefined,
        catch_up: catchUp,
        notify_desktop: notifyDesktop,
        notify_voice: notifyVoice,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-lg rounded-lg shadow-xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-text-muted)]/10">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
            {task ? 'Edit Task' : 'New Scheduled Task'}
          </h2>
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="text-sm p-2 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)', color: 'var(--color-error)' }}>
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
              Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. News summary"
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-text-muted)/20',
              }}
              autoFocus
            />
          </div>

          {/* Prompt */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
              Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="The message sent to the conversation each time..."
              rows={4}
              className="w-full px-3 py-2 rounded text-sm outline-none resize-y"
              style={{
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-text-muted)/20',
              }}
            />
          </div>

          {/* Conversation */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
              Conversation
            </label>
            <select
              value={conversationId}
              onChange={(e) => setConversationId(e.target.value === 'new' ? 'new' : Number(e.target.value))}
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-text-muted)/20',
              }}
            >
              <option value="new">+ Create new conversation</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </div>

          {/* Schedule */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
              Frequency
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Every</span>
              <input
                type="number"
                min={1}
                value={intervalValue}
                onChange={(e) => setIntervalValue(Math.max(1, Number(e.target.value)))}
                className="w-20 px-3 py-2 rounded text-sm outline-none"
                style={{
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-text-muted)/20',
                }}
              />
              <select
                value={intervalUnit}
                onChange={(e) => setIntervalUnit(e.target.value as IntervalUnit)}
                className="px-3 py-2 rounded text-sm outline-none"
                style={{
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-text-muted)/20',
                }}
              >
                <option value="minutes">minute(s)</option>
                <option value="hours">hour(s)</option>
                <option value="days">day(s)</option>
              </select>
            </div>
          </div>

          {/* Time of day — shown for daily tasks */}
          {intervalUnit === 'days' && (
            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
                Time of day
              </label>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={scheduleTime ? scheduleTime.split(':')[0] : ''}
                    onChange={(e) => {
                      const h = Math.max(0, Math.min(23, Number(e.target.value)))
                      const m = scheduleTime ? scheduleTime.split(':')[1] || '00' : '00'
                      setScheduleTime(`${String(h).padStart(2, '0')}:${m}`)
                    }}
                    placeholder="HH"
                    className="w-16 px-3 py-2 rounded text-sm outline-none text-center"
                    style={{
                      backgroundColor: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      border: '1px solid var(--color-text-muted)/20',
                    }}
                  />
                  <span className="text-sm font-bold" style={{ color: 'var(--color-text-muted)' }}>:</span>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={scheduleTime ? scheduleTime.split(':')[1] : ''}
                    onChange={(e) => {
                      const m = Math.max(0, Math.min(59, Number(e.target.value)))
                      const h = scheduleTime ? scheduleTime.split(':')[0] || '00' : '00'
                      setScheduleTime(`${h}:${String(m).padStart(2, '0')}`)
                    }}
                    placeholder="MM"
                    className="w-16 px-3 py-2 rounded text-sm outline-none text-center"
                    style={{
                      backgroundColor: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      border: '1px solid var(--color-text-muted)/20',
                    }}
                  />
                </div>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  24h format — leave empty for interval from last run
                </span>
              </div>
            </div>
          )}

          {/* Toggles */}
          <div className="space-y-2">
            <Toggle label="Catch up missed runs" checked={catchUp} onChange={setCatchUp} />
            <Toggle label="Desktop notification" checked={notifyDesktop} onChange={setNotifyDesktop} />
            <Toggle label="Voice notification (TTS)" checked={notifyVoice} onChange={setNotifyVoice} />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded text-sm transition-colors"
              style={{ color: 'var(--color-text-muted)' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-bg)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}
            >
              {saving ? 'Saving...' : task ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <div
        className="relative w-9 h-5 rounded-full transition-colors"
        style={{ backgroundColor: checked ? 'var(--color-primary)' : 'var(--color-bg)' }}
        onClick={() => onChange(!checked)}
      >
        <div
          className="absolute top-0.5 w-4 h-4 rounded-full transition-transform"
          style={{
            backgroundColor: '#fff',
            transform: checked ? 'translateX(18px)' : 'translateX(2px)',
          }}
        />
      </div>
      <span className="text-sm" style={{ color: 'var(--color-text)' }}>{label}</span>
    </label>
  )
}
