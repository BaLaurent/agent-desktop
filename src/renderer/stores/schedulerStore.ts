import { create } from 'zustand'
import type { ScheduledTask, CreateScheduledTask } from '../../shared/types'

interface SchedulerState {
  tasks: ScheduledTask[]
  loading: boolean
  error: string | null

  fetchTasks: () => Promise<void>
  createTask: (data: CreateScheduledTask) => Promise<ScheduledTask>
  updateTask: (id: number, data: Partial<CreateScheduledTask>) => Promise<void>
  deleteTask: (id: number) => Promise<void>
  toggleTask: (id: number, enabled: boolean) => Promise<void>
  runNow: (id: number) => Promise<void>
}

export const useSchedulerStore = create<SchedulerState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,

  fetchTasks: async () => {
    set({ loading: true, error: null })
    try {
      const tasks = await window.agent.scheduler.list()
      set({ tasks, loading: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false })
    }
  },

  createTask: async (data) => {
    const task = await window.agent.scheduler.create(data)
    set((s) => ({ tasks: [task, ...s.tasks] }))
    return task
  },

  updateTask: async (id, data) => {
    await window.agent.scheduler.update(id, data)
    await get().fetchTasks()
  },

  deleteTask: async (id) => {
    await window.agent.scheduler.delete(id)
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }))
  },

  toggleTask: async (id, enabled) => {
    await window.agent.scheduler.toggle(id, enabled)
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, enabled } : t)),
    }))
    // Refetch to get updated next_run_at
    await get().fetchTasks()
  },

  runNow: async (id) => {
    await window.agent.scheduler.runNow(id)
  },
}))

// Listen for real-time task updates from the scheduler engine
if (typeof window !== 'undefined' && window.agent?.scheduler?.onTaskUpdate) {
  window.agent.scheduler.onTaskUpdate((task) => {
    useSchedulerStore.setState((s) => ({
      tasks: s.tasks.map((t) => (t.id === task.id ? task : t)),
    }))
  })
}
