import { render, screen, fireEvent } from '@testing-library/react'
import { SlashCommandDropdown } from './SlashCommandDropdown'
import type { SlashCommand } from '../../../shared/types'

const builtinCommands: SlashCommand[] = [
  { name: 'compact', description: 'Compact conversation history', source: 'builtin' },
  { name: 'clear', description: 'Clear conversation', source: 'builtin' },
  { name: 'help', description: 'Show available commands', source: 'builtin' },
]

const mixedCommands: SlashCommand[] = [
  ...builtinCommands,
  { name: 'review', description: 'Code review', source: 'project' },
  { name: 'refactor', description: 'Refactor code', source: 'user' },
  { name: 'weather-wttr', description: 'Weather info', source: 'skill' },
]

describe('SlashCommandDropdown', () => {
  it('renders all commands when filter is empty', () => {
    render(
      <SlashCommandDropdown
        commands={builtinCommands}
        filter=""
        selectedIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('compact')).toBeInTheDocument()
    expect(screen.getByText('clear')).toBeInTheDocument()
    expect(screen.getByText('help')).toBeInTheDocument()
  })

  it('filters commands by name with fuzzy match', () => {
    render(
      <SlashCommandDropdown
        commands={builtinCommands}
        filter="comp"
        selectedIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.queryByText('clear')).not.toBeInTheDocument()
    expect(screen.queryByText('help')).not.toBeInTheDocument()
  })

  it('shows "No commands found" when filter matches nothing', () => {
    render(
      <SlashCommandDropdown
        commands={builtinCommands}
        filter="zzzzz"
        selectedIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('No commands found')).toBeInTheDocument()
  })

  it('calls onSelect when a command is clicked', () => {
    const onSelect = vi.fn()
    render(
      <SlashCommandDropdown
        commands={builtinCommands}
        filter=""
        selectedIndex={0}
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('clear'))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'clear' }))
  })

  it('shows source badge for non-builtin commands', () => {
    render(
      <SlashCommandDropdown
        commands={mixedCommands}
        filter=""
        selectedIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('project')).toBeInTheDocument()
    expect(screen.getByText('user')).toBeInTheDocument()
    expect(screen.getByText('skill')).toBeInTheDocument()
  })

  it('does not show source badge for builtin commands', () => {
    render(
      <SlashCommandDropdown
        commands={builtinCommands}
        filter=""
        selectedIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.queryByText('builtin')).not.toBeInTheDocument()
  })

  it('has correct ARIA roles', () => {
    render(
      <SlashCommandDropdown
        commands={builtinCommands}
        filter=""
        selectedIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    const options = screen.getAllByRole('option')
    expect(options.length).toBe(3)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')
  })

  it('calls onClose when clicking outside', () => {
    const onClose = vi.fn()
    render(
      <div>
        <button data-testid="outside">Outside</button>
        <SlashCommandDropdown
          commands={builtinCommands}
          filter=""
          selectedIndex={0}
          onSelect={vi.fn()}
          onClose={onClose}
        />
      </div>
    )
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows descriptions for commands', () => {
    render(
      <SlashCommandDropdown
        commands={builtinCommands}
        filter=""
        selectedIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Compact conversation history')).toBeInTheDocument()
    expect(screen.getByText('Clear conversation')).toBeInTheDocument()
  })
})
