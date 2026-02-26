import { useSchedulerStore } from './schedulerStore'
import { act } from '@testing-library/react'

const makeTask = (id: number, name: string, enabled = true) => ({
  id,
  name,
  enabled,
  schedule: '0 * * * *',
  prompt: 'test prompt',
  conversation_id: null,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
  last_run_at: null,
  next_run_at: null,
})

describe('schedulerStore', () => {
  beforeEach(() => {
    ;(window.agent as any).scheduler = {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(makeTask(1, 'New Task')),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      toggle: vi.fn().mockResolvedValue(undefined),
      runNow: vi.fn().mockResolvedValue(undefined),
      onTaskUpdate: vi.fn().mockReturnValue(() => {}),
    }
    act(() => {
      useSchedulerStore.setState({ tasks: [], loading: false, error: null })
    })
  })

  describe('fetchTasks', () => {
    it('sets tasks on success', async () => {
      const tasks = [makeTask(1, 'Task A'), makeTask(2, 'Task B')]
      ;(window.agent as any).scheduler.list.mockResolvedValueOnce(tasks)

      await act(async () => {
        await useSchedulerStore.getState().fetchTasks()
      })

      const state = useSchedulerStore.getState()
      expect(state.tasks).toEqual(tasks)
      expect(state.loading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('sets error message on Error failure', async () => {
      ;(window.agent as any).scheduler.list.mockRejectedValueOnce(new Error('DB error'))

      await act(async () => {
        await useSchedulerStore.getState().fetchTasks()
      })

      const state = useSchedulerStore.getState()
      expect(state.error).toBe('DB error')
      expect(state.loading).toBe(false)
    })

    it('sets stringified error for non-Error failure', async () => {
      ;(window.agent as any).scheduler.list.mockRejectedValueOnce('string error')

      await act(async () => {
        await useSchedulerStore.getState().fetchTasks()
      })

      expect(useSchedulerStore.getState().error).toBe('string error')
    })
  })

  describe('createTask', () => {
    it('prepends task to list and returns it', async () => {
      const existing = makeTask(10, 'Existing')
      act(() => {
        useSchedulerStore.setState({ tasks: [existing] })
      })

      const newTask = makeTask(1, 'New Task')
      ;(window.agent as any).scheduler.create.mockResolvedValueOnce(newTask)

      let returned: unknown
      await act(async () => {
        returned = await useSchedulerStore.getState().createTask({ name: 'New Task', schedule: '0 * * * *', prompt: 'p' } as any)
      })

      expect(returned).toEqual(newTask)
      const tasks = useSchedulerStore.getState().tasks
      expect(tasks[0]).toEqual(newTask)
      expect(tasks[1]).toEqual(existing)
    })
  })

  describe('updateTask', () => {
    it('calls update then refetches', async () => {
      const updated = [makeTask(1, 'Updated')]
      ;(window.agent as any).scheduler.list.mockResolvedValueOnce(updated)

      await act(async () => {
        await useSchedulerStore.getState().updateTask(1, { name: 'Updated' } as any)
      })

      expect((window.agent as any).scheduler.update).toHaveBeenCalledWith(1, { name: 'Updated' })
      expect(useSchedulerStore.getState().tasks).toEqual(updated)
    })
  })

  describe('deleteTask', () => {
    it('removes task from list', async () => {
      const tasks = [makeTask(1, 'A'), makeTask(2, 'B')]
      act(() => {
        useSchedulerStore.setState({ tasks })
      })

      await act(async () => {
        await useSchedulerStore.getState().deleteTask(1)
      })

      expect((window.agent as any).scheduler.delete).toHaveBeenCalledWith(1)
      expect(useSchedulerStore.getState().tasks).toEqual([makeTask(2, 'B')])
    })
  })

  describe('toggleTask', () => {
    it('updates enabled flag and refetches', async () => {
      const tasks = [makeTask(1, 'Task', true)]
      act(() => {
        useSchedulerStore.setState({ tasks })
      })

      const refetched = [makeTask(1, 'Task', false)]
      ;(window.agent as any).scheduler.list.mockResolvedValueOnce(refetched)

      await act(async () => {
        await useSchedulerStore.getState().toggleTask(1, false)
      })

      expect((window.agent as any).scheduler.toggle).toHaveBeenCalledWith(1, false)
      // After refetch, state matches server response
      expect(useSchedulerStore.getState().tasks).toEqual(refetched)
    })
  })

  describe('runNow', () => {
    it('calls scheduler.runNow', async () => {
      await act(async () => {
        await useSchedulerStore.getState().runNow(5)
      })

      expect((window.agent as any).scheduler.runNow).toHaveBeenCalledWith(5)
    })
  })
})
