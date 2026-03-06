import { create } from 'zustand'
import type { PiUIDialog, PiUINode, PiUINotification, PiUIWidget } from '../../shared/piUITypes'

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

const MAX_NOTIFICATIONS = 5

interface PiExtensionUIState {
  // State
  activeDialog: PiUIDialog | null
  dialogQueue: PiUIDialog[]
  notifications: PiUINotification[]
  statusEntries: Record<string, string>
  widgets: Record<string, PiUIWidget>
  workingMessage: string | null
  headerComponent: PiUINode | null
  footerComponent: PiUINode | null
  titleOverride: string | null

  // Actions
  enqueueDialog: (dialog: PiUIDialog) => void
  dismissDialog: () => void
  dismissDialogById: (id: string) => void
  addNotification: (message: string, level: 'info' | 'warning' | 'error') => void
  removeNotification: (id: string) => void
  setStatusEntry: (key: string, text: string) => void
  clearStatusEntry: (key: string) => void
  setWidget: (key: string, content: string[], placement: 'aboveEditor' | 'belowEditor') => void
  clearWidget: (key: string) => void
  setWorkingMessage: (message: string | undefined) => void
  setHeaderComponent: (component: PiUINode | null) => void
  setFooterComponent: (component: PiUINode | null) => void
  setTitleOverride: (title: string | null) => void
  reset: () => void
}

const initialState = {
  activeDialog: null as PiUIDialog | null,
  dialogQueue: [] as PiUIDialog[],
  notifications: [] as PiUINotification[],
  statusEntries: {} as Record<string, string>,
  widgets: {} as Record<string, PiUIWidget>,
  workingMessage: null as string | null,
  headerComponent: null as PiUINode | null,
  footerComponent: null as PiUINode | null,
  titleOverride: null as string | null,
}

export const usePiExtensionUIStore = create<PiExtensionUIState>((set) => ({
  ...initialState,

  enqueueDialog: (dialog) =>
    set((s) => {
      if (!s.activeDialog) return { activeDialog: dialog }
      return { dialogQueue: [...s.dialogQueue, dialog] }
    }),

  dismissDialog: () =>
    set((s) => {
      const [next, ...rest] = s.dialogQueue
      return { activeDialog: next ?? null, dialogQueue: rest }
    }),

  dismissDialogById: (id) =>
    set((s) => {
      if (s.activeDialog?.id === id) {
        const [next, ...rest] = s.dialogQueue
        return { activeDialog: next ?? null, dialogQueue: rest }
      }
      return { dialogQueue: s.dialogQueue.filter((d) => d.id !== id) }
    }),

  addNotification: (message, level) =>
    set((s) => {
      const notification: PiUINotification = { id: uid(), message, level, timestamp: Date.now() }
      const updated = [...s.notifications, notification]
      return { notifications: updated.slice(-MAX_NOTIFICATIONS) }
    }),

  removeNotification: (id) =>
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),

  setStatusEntry: (key, text) =>
    set((s) => ({ statusEntries: { ...s.statusEntries, [key]: text } })),

  clearStatusEntry: (key) =>
    set((s) => {
      const next = { ...s.statusEntries }
      delete next[key]
      return { statusEntries: next }
    }),

  setWidget: (key, content, placement) =>
    set((s) => ({ widgets: { ...s.widgets, [key]: { key, content, placement } } })),

  clearWidget: (key) =>
    set((s) => {
      const next = { ...s.widgets }
      delete next[key]
      return { widgets: next }
    }),

  setWorkingMessage: (message) => set({ workingMessage: message ?? null }),

  setHeaderComponent: (component) => set({ headerComponent: component }),

  setFooterComponent: (component) => set({ footerComponent: component }),

  setTitleOverride: (title) => set({ titleOverride: title }),

  reset: () => set(initialState),
}))
