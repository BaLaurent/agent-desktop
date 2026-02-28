import { usePiExtensionUIStore } from './piExtensionUIStore'
import type { PiUIDialog } from '../../shared/piUITypes'

beforeEach(() => {
  usePiExtensionUIStore.getState().reset()
})

const dialog = (id: string): PiUIDialog => ({
  id,
  method: 'confirm',
  title: `Dialog ${id}`,
  message: 'Are you sure?',
})

describe('piExtensionUIStore', () => {
  describe('enqueueDialog', () => {
    it('sets active when none exists', () => {
      const d = dialog('d1')
      usePiExtensionUIStore.getState().enqueueDialog(d)
      expect(usePiExtensionUIStore.getState().activeDialog).toEqual(d)
      expect(usePiExtensionUIStore.getState().dialogQueue).toEqual([])
    })

    it('queues when active exists', () => {
      const d1 = dialog('d1')
      const d2 = dialog('d2')
      usePiExtensionUIStore.getState().enqueueDialog(d1)
      usePiExtensionUIStore.getState().enqueueDialog(d2)
      expect(usePiExtensionUIStore.getState().activeDialog).toEqual(d1)
      expect(usePiExtensionUIStore.getState().dialogQueue).toEqual([d2])
    })
  })

  describe('dismissDialog', () => {
    it('promotes next from queue (FIFO)', () => {
      const d1 = dialog('d1')
      const d2 = dialog('d2')
      const d3 = dialog('d3')
      usePiExtensionUIStore.getState().enqueueDialog(d1)
      usePiExtensionUIStore.getState().enqueueDialog(d2)
      usePiExtensionUIStore.getState().enqueueDialog(d3)

      usePiExtensionUIStore.getState().dismissDialog()
      expect(usePiExtensionUIStore.getState().activeDialog).toEqual(d2)
      expect(usePiExtensionUIStore.getState().dialogQueue).toEqual([d3])
    })

    it('clears active when queue is empty', () => {
      usePiExtensionUIStore.getState().enqueueDialog(dialog('d1'))
      usePiExtensionUIStore.getState().dismissDialog()
      expect(usePiExtensionUIStore.getState().activeDialog).toBeNull()
      expect(usePiExtensionUIStore.getState().dialogQueue).toEqual([])
    })
  })

  describe('addNotification', () => {
    it('creates with id and timestamp', () => {
      usePiExtensionUIStore.getState().addNotification('hello', 'info')
      const [n] = usePiExtensionUIStore.getState().notifications
      expect(n.id).toBeTruthy()
      expect(n.message).toBe('hello')
      expect(n.level).toBe('info')
      expect(n.timestamp).toBeGreaterThan(0)
    })

    it('limits to 5 notifications (trims oldest)', () => {
      for (let i = 0; i < 7; i++) {
        usePiExtensionUIStore.getState().addNotification(`msg-${i}`, 'info')
      }
      const notes = usePiExtensionUIStore.getState().notifications
      expect(notes).toHaveLength(5)
      expect(notes[0].message).toBe('msg-2')
      expect(notes[4].message).toBe('msg-6')
    })
  })

  describe('removeNotification', () => {
    it('removes by id', () => {
      usePiExtensionUIStore.getState().addNotification('a', 'info')
      usePiExtensionUIStore.getState().addNotification('b', 'warning')
      const [first] = usePiExtensionUIStore.getState().notifications
      usePiExtensionUIStore.getState().removeNotification(first.id)
      const remaining = usePiExtensionUIStore.getState().notifications
      expect(remaining).toHaveLength(1)
      expect(remaining[0].message).toBe('b')
    })
  })

  describe('setStatusEntry / clearStatusEntry', () => {
    it('sets a key-value pair', () => {
      usePiExtensionUIStore.getState().setStatusEntry('build', 'running')
      expect(usePiExtensionUIStore.getState().statusEntries).toEqual({ build: 'running' })
    })

    it('clears a key', () => {
      usePiExtensionUIStore.getState().setStatusEntry('build', 'running')
      usePiExtensionUIStore.getState().clearStatusEntry('build')
      expect(usePiExtensionUIStore.getState().statusEntries).toEqual({})
    })
  })

  describe('setWidget / clearWidget', () => {
    it('sets a widget with key, content, placement', () => {
      usePiExtensionUIStore.getState().setWidget('logs', ['line1', 'line2'], 'belowEditor')
      expect(usePiExtensionUIStore.getState().widgets).toEqual({
        logs: { key: 'logs', content: ['line1', 'line2'], placement: 'belowEditor' },
      })
    })

    it('clears a widget by key', () => {
      usePiExtensionUIStore.getState().setWidget('logs', ['line1'], 'aboveEditor')
      usePiExtensionUIStore.getState().clearWidget('logs')
      expect(usePiExtensionUIStore.getState().widgets).toEqual({})
    })
  })

  describe('setWorkingMessage', () => {
    it('sets a working message', () => {
      usePiExtensionUIStore.getState().setWorkingMessage('Thinking...')
      expect(usePiExtensionUIStore.getState().workingMessage).toBe('Thinking...')
    })

    it('clears when undefined', () => {
      usePiExtensionUIStore.getState().setWorkingMessage('Thinking...')
      usePiExtensionUIStore.getState().setWorkingMessage(undefined)
      expect(usePiExtensionUIStore.getState().workingMessage).toBeNull()
    })
  })

  describe('setHeaderComponent / setFooterComponent', () => {
    it('sets header component', () => {
      const node = { type: 'text' as const, content: 'Header' }
      usePiExtensionUIStore.getState().setHeaderComponent(node)
      expect(usePiExtensionUIStore.getState().headerComponent).toEqual(node)
    })

    it('sets footer component', () => {
      const node = { type: 'text' as const, content: 'Footer' }
      usePiExtensionUIStore.getState().setFooterComponent(node)
      expect(usePiExtensionUIStore.getState().footerComponent).toEqual(node)
    })
  })

  describe('setTitleOverride', () => {
    it('sets and clears title override', () => {
      usePiExtensionUIStore.getState().setTitleOverride('Custom Title')
      expect(usePiExtensionUIStore.getState().titleOverride).toBe('Custom Title')
      usePiExtensionUIStore.getState().setTitleOverride(null)
      expect(usePiExtensionUIStore.getState().titleOverride).toBeNull()
    })
  })

  describe('reset', () => {
    it('clears everything back to initial state', () => {
      usePiExtensionUIStore.getState().enqueueDialog(dialog('d1'))
      usePiExtensionUIStore.getState().addNotification('msg', 'error')
      usePiExtensionUIStore.getState().setStatusEntry('k', 'v')
      usePiExtensionUIStore.getState().setWidget('w', ['c'], 'aboveEditor')
      usePiExtensionUIStore.getState().setWorkingMessage('busy')
      usePiExtensionUIStore.getState().setHeaderComponent({ type: 'text', content: 'h' })
      usePiExtensionUIStore.getState().setFooterComponent({ type: 'text', content: 'f' })
      usePiExtensionUIStore.getState().setTitleOverride('title')

      usePiExtensionUIStore.getState().reset()

      const s = usePiExtensionUIStore.getState()
      expect(s.activeDialog).toBeNull()
      expect(s.dialogQueue).toEqual([])
      expect(s.notifications).toEqual([])
      expect(s.statusEntries).toEqual({})
      expect(s.widgets).toEqual({})
      expect(s.workingMessage).toBeNull()
      expect(s.headerComponent).toBeNull()
      expect(s.footerComponent).toBeNull()
      expect(s.titleOverride).toBeNull()
    })
  })
})
