import { describe, it, expect } from 'vitest'
import type {
  PiUINode,
  PiUIDialog,
  PiUIEvent,
  PiUIRequest,
  PiUIResponse,
  PiUIComponentAction,
  PiUINotification,
  PiUIWidget,
} from './piUITypes'

describe('PiUITypes', () => {
  describe('PiUINode', () => {
    it('supports all node types', () => {
      const nodes: PiUINode[] = [
        { type: 'text', content: 'hello' },
        { type: 'text', content: 'bold', style: 'bold' },
        { type: 'text', content: 'muted', style: 'muted' },
        { type: 'text', content: 'err', style: 'error' },
        { type: 'text', content: 'accent', style: 'accent' },
        { type: 'button', label: 'Click', action: 'do-thing' },
        { type: 'input', id: 'name', placeholder: 'Enter name' },
        { type: 'select', id: 'lang', options: ['en', 'fr'] },
        { type: 'progress', value: 50 },
        { type: 'progress', value: 3, max: 10 },
        { type: 'divider' },
        { type: 'badge', text: 'New' },
        { type: 'badge', text: 'Hot', color: '#ff0000' },
      ]
      expect(nodes).toHaveLength(13)
    })

    it('supports nested hstack and vstack', () => {
      const layout: PiUINode = {
        type: 'vstack',
        gap: 8,
        children: [
          { type: 'text', content: 'Title', style: 'bold' },
          {
            type: 'hstack',
            gap: 4,
            children: [
              { type: 'button', label: 'OK', action: 'ok' },
              { type: 'button', label: 'Cancel', action: 'cancel' },
            ],
          },
          { type: 'divider' },
          { type: 'progress', value: 75, max: 100 },
        ],
      }
      expect(layout.type).toBe('vstack')
      expect(layout.children).toHaveLength(4)
    })
  })

  describe('PiUIDialog', () => {
    it('has all dialog variants with required fields', () => {
      const dialogs: PiUIDialog[] = [
        { id: '1', method: 'select', title: 'Pick one', options: ['a', 'b'] },
        { id: '2', method: 'confirm', title: 'Sure?', message: 'Delete this?' },
        { id: '3', method: 'input', title: 'Name', placeholder: 'Enter...' },
        { id: '4', method: 'editor', title: 'Edit', prefill: 'code here' },
        { id: '5', method: 'custom', title: 'Custom', component: { type: 'text', content: 'hi' } },
      ]
      for (const d of dialogs) {
        expect(d.id).toBeTruthy()
        expect(d.method).toBeTruthy()
      }
    })

    it('supports optional timeout on all variants', () => {
      const withTimeout: PiUIDialog = {
        id: 't1',
        method: 'confirm',
        title: 'Quick',
        message: 'Hurry',
        timeout: 5000,
      }
      expect(withTimeout.timeout).toBe(5000)
    })
  })

  describe('PiUIRequest', () => {
    it('is a PiUIDialog (same type)', () => {
      const request: PiUIRequest = {
        id: 'r1',
        method: 'select',
        title: 'Choose',
        options: ['x', 'y'],
      }
      // PiUIRequest = PiUIDialog — same required fields
      expect(request.id).toBe('r1')
      expect(request.method).toBe('select')
    })
  })

  describe('PiUIEvent', () => {
    it('has method field on all variants', () => {
      const events: PiUIEvent[] = [
        { method: 'notify', message: 'Done', level: 'info' },
        { method: 'notify', message: 'Oops', level: 'error' },
        { method: 'notify', message: 'Hmm', level: 'warning' },
        { method: 'setStatus', key: 'build', text: 'Building...' },
        { method: 'setStatus', key: 'build' }, // text optional = clear
        { method: 'setWidget', key: 'w1', content: ['line1'], placement: 'aboveEditor' },
        { method: 'setWidget', key: 'w1' }, // content optional = remove
        { method: 'setWorkingMessage', message: 'Thinking...' },
        { method: 'setWorkingMessage' }, // message optional = clear
        { method: 'setTitle', title: 'My Chat' },
        { method: 'setHeader', component: { type: 'text', content: 'Header' } },
        { method: 'setHeader' }, // component optional = clear
        { method: 'setFooter', component: { type: 'badge', text: 'v1.0' } },
        { method: 'setFooter' }, // component optional = clear
      ]
      for (const e of events) {
        expect(e.method).toBeTruthy()
      }
    })
  })

  describe('PiUIResponse', () => {
    it('supports value variant', () => {
      const r: PiUIResponse = { id: 'r1', value: 'hello' }
      expect(r.id).toBe('r1')
      expect(r.value).toBe('hello')
      expect(r.confirmed).toBeUndefined()
      expect(r.cancelled).toBeUndefined()
    })

    it('supports confirmed variant', () => {
      const r: PiUIResponse = { id: 'r2', confirmed: true }
      expect(r.confirmed).toBe(true)
    })

    it('supports cancelled variant', () => {
      const r: PiUIResponse = { id: 'r3', cancelled: true }
      expect(r.cancelled).toBe(true)
    })
  })

  describe('PiUIComponentAction', () => {
    it('has required id and actionId', () => {
      const action: PiUIComponentAction = { id: 'c1', actionId: 'submit' }
      expect(action.id).toBe('c1')
      expect(action.actionId).toBe('submit')
      expect(action.data).toBeUndefined()
    })

    it('supports optional data', () => {
      const action: PiUIComponentAction = { id: 'c2', actionId: 'select', data: { idx: 3 } }
      expect(action.data).toEqual({ idx: 3 })
    })
  })

  describe('PiUINotification', () => {
    it('has all required fields', () => {
      const n: PiUINotification = { id: 'n1', message: 'Hello', level: 'info', timestamp: Date.now() }
      expect(n.id).toBe('n1')
      expect(n.message).toBe('Hello')
      expect(n.level).toBe('info')
      expect(typeof n.timestamp).toBe('number')
    })
  })

  describe('PiUIWidget', () => {
    it('has all required fields', () => {
      const w: PiUIWidget = { key: 'status', content: ['line 1', 'line 2'], placement: 'belowEditor' }
      expect(w.key).toBe('status')
      expect(w.content).toEqual(['line 1', 'line 2'])
      expect(w.placement).toBe('belowEditor')
    })
  })
})
