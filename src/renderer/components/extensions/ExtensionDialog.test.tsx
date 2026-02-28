import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExtensionDialog } from './ExtensionDialog'
import type { PiUIDialog, PiUIResponse } from '../../../shared/piUITypes'

describe('ExtensionDialog', () => {
  const onRespond = vi.fn<(r: PiUIResponse) => void>()

  beforeEach(() => {
    onRespond.mockClear()
  })

  // ─── Select ────────────────────────────────────────────────

  describe('select variant', () => {
    const dialog: PiUIDialog = {
      id: 'dlg-1',
      method: 'select',
      title: 'Pick a color',
      options: ['Red', 'Green', 'Blue'],
    }

    it('renders title and all options', () => {
      render(<ExtensionDialog dialog={dialog} onRespond={onRespond} />)
      expect(screen.getByText('Pick a color')).toBeInTheDocument()
      expect(screen.getByText('Red')).toBeInTheDocument()
      expect(screen.getByText('Green')).toBeInTheDocument()
      expect(screen.getByText('Blue')).toBeInTheDocument()
    })

    it('calls onRespond with selected option value', () => {
      render(<ExtensionDialog dialog={dialog} onRespond={onRespond} />)
      fireEvent.click(screen.getByText('Green'))
      expect(onRespond).toHaveBeenCalledWith({ id: 'dlg-1', value: 'Green' })
    })
  })

  // ─── Confirm ───────────────────────────────────────────────

  describe('confirm variant', () => {
    const dialog: PiUIDialog = {
      id: 'dlg-2',
      method: 'confirm',
      title: 'Delete file?',
      message: 'This action cannot be undone.',
    }

    it('renders title, message, and Yes/No buttons', () => {
      render(<ExtensionDialog dialog={dialog} onRespond={onRespond} />)
      expect(screen.getByText('Delete file?')).toBeInTheDocument()
      expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument()
      expect(screen.getByText('Yes')).toBeInTheDocument()
      expect(screen.getByText('No')).toBeInTheDocument()
    })

    it('Yes sends confirmed: true', () => {
      render(<ExtensionDialog dialog={dialog} onRespond={onRespond} />)
      fireEvent.click(screen.getByText('Yes'))
      expect(onRespond).toHaveBeenCalledWith({ id: 'dlg-2', confirmed: true })
    })

    it('No sends confirmed: false', () => {
      render(<ExtensionDialog dialog={dialog} onRespond={onRespond} />)
      fireEvent.click(screen.getByText('No'))
      expect(onRespond).toHaveBeenCalledWith({ id: 'dlg-2', confirmed: false })
    })
  })

  // ─── Input ─────────────────────────────────────────────────

  describe('input variant', () => {
    const dialog: PiUIDialog = {
      id: 'dlg-3',
      method: 'input',
      title: 'Enter name',
      placeholder: 'Type here...',
    }

    it('renders title, input with placeholder, and Submit/Cancel', () => {
      render(<ExtensionDialog dialog={dialog} onRespond={onRespond} />)
      expect(screen.getByText('Enter name')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Type here...')).toBeInTheDocument()
      expect(screen.getByText('Submit')).toBeInTheDocument()
      expect(screen.getByText('Cancel')).toBeInTheDocument()
    })

    it('auto-focuses the input on mount', () => {
      render(<ExtensionDialog dialog={dialog} onRespond={onRespond} />)
      expect(screen.getByPlaceholderText('Type here...')).toHaveFocus()
    })

    it('Submit sends typed value', () => {
      render(<ExtensionDialog dialog={dialog} onRespond={onRespond} />)
      fireEvent.change(screen.getByPlaceholderText('Type here...'), { target: { value: 'Alice' } })
      fireEvent.click(screen.getByText('Submit'))
      expect(onRespond).toHaveBeenCalledWith({ id: 'dlg-3', value: 'Alice' })
    })

    it('Enter key in input triggers Submit', () => {
      render(<ExtensionDialog dialog={dialog} onRespond={onRespond} />)
      const input = screen.getByPlaceholderText('Type here...')
      fireEvent.change(input, { target: { value: 'Bob' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onRespond).toHaveBeenCalledWith({ id: 'dlg-3', value: 'Bob' })
    })

    it('Cancel sends cancelled response', () => {
      render(<ExtensionDialog dialog={dialog} onRespond={onRespond} />)
      fireEvent.click(screen.getByText('Cancel'))
      expect(onRespond).toHaveBeenCalledWith({ id: 'dlg-3', cancelled: true })
    })
  })

  // ─── Editor ────────────────────────────────────────────────

  describe('editor variant', () => {
    const dialog: PiUIDialog = {
      id: 'dlg-4',
      method: 'editor',
      title: 'Edit config',
      prefill: 'key: value',
    }

    it('renders title, textarea with prefill, and Submit/Cancel', () => {
      render(<ExtensionDialog dialog={dialog} onRespond={onRespond} />)
      expect(screen.getByText('Edit config')).toBeInTheDocument()
      expect(screen.getByDisplayValue('key: value')).toBeInTheDocument()
      expect(screen.getByText('Submit')).toBeInTheDocument()
      expect(screen.getByText('Cancel')).toBeInTheDocument()
    })

    it('textarea has min-height 120px', () => {
      render(<ExtensionDialog dialog={dialog} onRespond={onRespond} />)
      const textarea = screen.getByDisplayValue('key: value')
      expect(textarea.style.minHeight).toBe('120px')
    })

    it('Submit sends edited value', () => {
      render(<ExtensionDialog dialog={dialog} onRespond={onRespond} />)
      fireEvent.change(screen.getByDisplayValue('key: value'), { target: { value: 'new: data' } })
      fireEvent.click(screen.getByText('Submit'))
      expect(onRespond).toHaveBeenCalledWith({ id: 'dlg-4', value: 'new: data' })
    })

    it('Cancel sends cancelled response', () => {
      render(<ExtensionDialog dialog={dialog} onRespond={onRespond} />)
      fireEvent.click(screen.getByText('Cancel'))
      expect(onRespond).toHaveBeenCalledWith({ id: 'dlg-4', cancelled: true })
    })
  })

  // ─── ESC key ───────────────────────────────────────────────

  it('ESC key sends cancelled response for any variant', () => {
    const dialog: PiUIDialog = {
      id: 'dlg-5',
      method: 'select',
      title: 'Pick one',
      options: ['A'],
    }
    render(<ExtensionDialog dialog={dialog} onRespond={onRespond} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onRespond).toHaveBeenCalledWith({ id: 'dlg-5', cancelled: true })
  })
})
