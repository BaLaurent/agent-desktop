import { useShortcutsStore } from './shortcutsStore'
import { mockAgent } from '../__tests__/setup'
import { act } from '@testing-library/react'

const makeShortcut = (id: number, action: string, keybinding: string) => ({
  id,
  action,
  keybinding,
  label: action,
  default_keybinding: keybinding,
})

describe('shortcutsStore', () => {
  beforeEach(() => {
    ;(window.agent as any).quickChat = {
      ...(window.agent as any).quickChat,
      reregisterShortcuts: vi.fn().mockResolvedValue(undefined),
    }
    act(() => {
      useShortcutsStore.setState({ shortcuts: [], isLoading: false })
    })
  })

  describe('loadShortcuts', () => {
    it('fetches and sets shortcuts', async () => {
      const shortcuts = [makeShortcut(1, 'quick_chat', 'Ctrl+Space')]
      mockAgent.shortcuts.list.mockResolvedValueOnce(shortcuts)

      await act(async () => {
        await useShortcutsStore.getState().loadShortcuts()
      })

      expect(useShortcutsStore.getState().shortcuts).toEqual(shortcuts)
      expect(useShortcutsStore.getState().isLoading).toBe(false)
    })

    it('keeps empty list on error', async () => {
      mockAgent.shortcuts.list.mockRejectedValueOnce(new Error('fail'))

      await act(async () => {
        await useShortcutsStore.getState().loadShortcuts()
      })

      expect(useShortcutsStore.getState().shortcuts).toEqual([])
      expect(useShortcutsStore.getState().isLoading).toBe(false)
    })

    it('sets isLoading during fetch', async () => {
      let resolve: (v: unknown) => void
      const pending = new Promise((r) => { resolve = r })
      mockAgent.shortcuts.list.mockReturnValueOnce(pending)

      const promise = act(async () => {
        const p = useShortcutsStore.getState().loadShortcuts()
        expect(useShortcutsStore.getState().isLoading).toBe(true)
        resolve!([])
        await p
      })

      await promise
      expect(useShortcutsStore.getState().isLoading).toBe(false)
    })
  })

  describe('updateShortcut', () => {
    it('calls update then reloads', async () => {
      const shortcuts = [makeShortcut(1, 'copy', 'Ctrl+C')]
      mockAgent.shortcuts.list.mockResolvedValueOnce(shortcuts)

      await act(async () => {
        await useShortcutsStore.getState().updateShortcut(1, 'Ctrl+C')
      })

      expect(mockAgent.shortcuts.update).toHaveBeenCalledWith(1, 'Ctrl+C')
      expect(useShortcutsStore.getState().shortcuts).toEqual(shortcuts)
    })

    it('re-registers global shortcuts for quick_chat action', async () => {
      const shortcuts = [makeShortcut(1, 'quick_chat', 'Ctrl+Space')]
      mockAgent.shortcuts.list.mockResolvedValueOnce(shortcuts)

      await act(async () => {
        await useShortcutsStore.getState().updateShortcut(1, 'Ctrl+Space')
      })

      expect((window.agent as any).quickChat.reregisterShortcuts).toHaveBeenCalled()
    })

    it('re-registers global shortcuts for quick_voice action', async () => {
      const shortcuts = [makeShortcut(2, 'quick_voice', 'Ctrl+Shift+V')]
      mockAgent.shortcuts.list.mockResolvedValueOnce(shortcuts)

      await act(async () => {
        await useShortcutsStore.getState().updateShortcut(2, 'Ctrl+Shift+V')
      })

      expect((window.agent as any).quickChat.reregisterShortcuts).toHaveBeenCalled()
    })

    it('does NOT re-register for non-global action', async () => {
      const shortcuts = [makeShortcut(3, 'copy_code', 'Ctrl+Shift+C')]
      mockAgent.shortcuts.list.mockResolvedValueOnce(shortcuts)

      await act(async () => {
        await useShortcutsStore.getState().updateShortcut(3, 'Ctrl+Shift+C')
      })

      expect((window.agent as any).quickChat.reregisterShortcuts).not.toHaveBeenCalled()
    })

    it('silently handles error', async () => {
      mockAgent.shortcuts.update.mockRejectedValueOnce(new Error('fail'))

      await act(async () => {
        await useShortcutsStore.getState().updateShortcut(1, 'Ctrl+X')
      })

      // No throw, state unchanged
      expect(useShortcutsStore.getState().shortcuts).toEqual([])
    })
  })
})
