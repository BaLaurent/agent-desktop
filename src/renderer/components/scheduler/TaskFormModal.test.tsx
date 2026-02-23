vi.mock('../../stores/conversationsStore', () => ({
  useConversationsStore: () => ({
    conversations: [
      { id: 10, title: 'Test Conversation' },
      { id: 20, title: 'Another Conversation' },
    ],
    loadConversations: vi.fn(),
  }),
}))

import { render, screen } from '@testing-library/react'
import { TaskFormModal } from './TaskFormModal'

describe('TaskFormModal', () => {
  const defaultProps = {
    onSave: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
  }

  it('renders empty form when no props provided', () => {
    render(<TaskFormModal {...defaultProps} />)
    const nameInput = screen.getByPlaceholderText('e.g. News summary') as HTMLInputElement
    expect(nameInput.value).toBe('')
    const promptTextarea = screen.getByPlaceholderText(/The message sent/) as HTMLTextAreaElement
    expect(promptTextarea.value).toBe('')
  })

  it('pre-fills prompt from initialPrompt', () => {
    render(<TaskFormModal {...defaultProps} initialPrompt="Summarize the news" />)
    const promptTextarea = screen.getByPlaceholderText(/The message sent/) as HTMLTextAreaElement
    expect(promptTextarea.value).toBe('Summarize the news')
  })

  it('auto-generates name from initialPrompt', () => {
    render(<TaskFormModal {...defaultProps} initialPrompt="Summarize the news every morning" />)
    const nameInput = screen.getByPlaceholderText('e.g. News summary') as HTMLInputElement
    expect(nameInput.value).toBe('Summarize the news every morning')
  })

  it('truncates auto-generated name at 50 chars', () => {
    const longPrompt = 'A'.repeat(80)
    render(<TaskFormModal {...defaultProps} initialPrompt={longPrompt} />)
    const nameInput = screen.getByPlaceholderText('e.g. News summary') as HTMLInputElement
    expect(nameInput.value).toBe('A'.repeat(50) + '...')
  })

  it('pre-selects conversation from initialConversationId', () => {
    render(<TaskFormModal {...defaultProps} initialConversationId={10} />)
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    const conversationSelect = selects.find(s => s.querySelector('option[value="new"]'))!
    expect(conversationSelect.value).toBe('10')
  })

  it('defaults to "new" conversation when no initialConversationId', () => {
    render(<TaskFormModal {...defaultProps} />)
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    const conversationSelect = selects.find(s => s.querySelector('option[value="new"]'))!
    expect(conversationSelect.value).toBe('new')
  })

  it('initialPrompt takes priority over task.prompt', () => {
    const task = { prompt: 'old prompt', name: 'old name' } as any
    render(<TaskFormModal {...defaultProps} task={task} initialPrompt="new prompt" />)
    const promptTextarea = screen.getByPlaceholderText(/The message sent/) as HTMLTextAreaElement
    expect(promptTextarea.value).toBe('new prompt')
  })

  it('initialConversationId takes priority over task.conversation_id', () => {
    const task = { conversation_id: 20 } as any
    render(<TaskFormModal {...defaultProps} task={task} initialConversationId={10} />)
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[]
    const conversationSelect = selects.find(s => s.querySelector('option[value="new"]'))!
    expect(conversationSelect.value).toBe('10')
  })
})
