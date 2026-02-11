import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatStatusLine } from './ChatStatusLine'
import type { McpServerEntry } from './ChatStatusLine'

const noMcp: McpServerEntry[] = []
const twoMcp: McpServerEntry[] = [
  { name: 'server-a', active: true },
  { name: 'server-b', active: true },
]
const mixedMcp: McpServerEntry[] = [
  { name: 'server-a', active: true },
  { name: 'server-b', active: false },
]

describe('ChatStatusLine', () => {
  it('renders simplified model name', () => {
    render(<ChatStatusLine model="claude-sonnet-4-5-20250929" permissionMode="bypassPermissions" mcpServers={noMcp} />)
    expect(screen.getByText('sonnet-4-5')).toBeDefined()
  })

  it('renders permission mode label', () => {
    render(<ChatStatusLine model="claude-opus-4-6" permissionMode="bypassPermissions" mcpServers={noMcp} />)
    expect(screen.getByText('Bypass')).toBeDefined()
  })

  it('renders acceptEdits label', () => {
    render(<ChatStatusLine model="test" permissionMode="acceptEdits" mcpServers={noMcp} />)
    expect(screen.getByText('Accept Edits')).toBeDefined()
  })

  it('renders dontAsk label', () => {
    render(<ChatStatusLine model="test" permissionMode="dontAsk" mcpServers={noMcp} />)
    expect(screen.getByText("Don't Ask")).toBeDefined()
  })

  it('renders plan label', () => {
    render(<ChatStatusLine model="test" permissionMode="plan" mcpServers={noMcp} />)
    expect(screen.getByText('Plan Only')).toBeDefined()
  })

  it('falls back to raw mode string for unknown modes', () => {
    render(<ChatStatusLine model="test" permissionMode="customMode" mcpServers={noMcp} />)
    expect(screen.getByText('customMode')).toBeDefined()
  })

  it('hides MCP section when no servers', () => {
    render(<ChatStatusLine model="test" permissionMode="default" mcpServers={noMcp} />)
    expect(screen.queryByText(/MCP/)).toBeNull()
  })

  it('shows active/total MCP count', () => {
    render(<ChatStatusLine model="test" permissionMode="default" mcpServers={twoMcp} />)
    expect(screen.getByText('2/2 MCP')).toBeDefined()
  })

  it('shows partial count when some servers disabled', () => {
    render(<ChatStatusLine model="test" permissionMode="default" mcpServers={mixedMcp} />)
    expect(screen.getByText('1/2 MCP')).toBeDefined()
  })

  it('has aria-label for accessibility', () => {
    render(<ChatStatusLine model="test" permissionMode="default" mcpServers={noMcp} />)
    expect(screen.getByLabelText('Chat status')).toBeDefined()
  })

  // Model dropdown tests
  it('shows chevron when onModelChange is provided', () => {
    render(<ChatStatusLine model="claude-opus-4-6" permissionMode="default" mcpServers={noMcp} onModelChange={() => {}} />)
    const btn = screen.getByLabelText('Change model')
    expect(btn.querySelector('svg')).toBeDefined()
  })

  it('does not show chevron without onModelChange', () => {
    render(<ChatStatusLine model="claude-opus-4-6" permissionMode="default" mcpServers={noMcp} />)
    const btn = screen.getByLabelText('Change model')
    expect(btn.querySelector('svg')).toBeNull()
  })

  it('opens model dropdown on click and lists models', () => {
    render(<ChatStatusLine model="claude-opus-4-6" permissionMode="default" mcpServers={noMcp} onModelChange={() => {}} />)
    fireEvent.click(screen.getByLabelText('Change model'))
    expect(screen.getByText('Sonnet 4.5')).toBeDefined()
    expect(screen.getByText('Opus 4.6')).toBeDefined()
    expect(screen.getByText('Haiku 4.5')).toBeDefined()
  })

  it('calls onModelChange when a model is selected', () => {
    const onChange = vi.fn()
    render(<ChatStatusLine model="claude-opus-4-6" permissionMode="default" mcpServers={noMcp} onModelChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Change model'))
    fireEvent.click(screen.getByText('Haiku 4.5'))
    expect(onChange).toHaveBeenCalledWith('claude-haiku-4-5-20251001')
  })

  it('closes model dropdown after selection', () => {
    render(<ChatStatusLine model="claude-opus-4-6" permissionMode="default" mcpServers={noMcp} onModelChange={() => {}} />)
    fireEvent.click(screen.getByLabelText('Change model'))
    fireEvent.click(screen.getByText('Sonnet 4.5'))
    expect(screen.queryByText('Haiku 4.5')).toBeNull()
  })

  it('highlights current model in dropdown', () => {
    render(<ChatStatusLine model="claude-opus-4-6" permissionMode="default" mcpServers={noMcp} onModelChange={() => {}} />)
    fireEvent.click(screen.getByLabelText('Change model'))
    const opusOption = screen.getByRole('option', { selected: true })
    expect(opusOption.textContent).toContain('Opus 4.6')
  })

  // MCP dropdown tests
  it('opens MCP dropdown on click and lists servers', () => {
    render(<ChatStatusLine model="test" permissionMode="default" mcpServers={twoMcp} onMcpServerToggle={() => {}} />)
    fireEvent.click(screen.getByLabelText('MCP servers'))
    expect(screen.getByText('server-a')).toBeDefined()
    expect(screen.getByText('server-b')).toBeDefined()
  })

  it('calls onMcpServerToggle with server name on click', () => {
    const onToggle = vi.fn()
    render(<ChatStatusLine model="test" permissionMode="default" mcpServers={twoMcp} onMcpServerToggle={onToggle} />)
    fireEvent.click(screen.getByLabelText('MCP servers'))
    fireEvent.click(screen.getByText('server-b'))
    expect(onToggle).toHaveBeenCalledWith('server-b')
  })

  it('shows checkboxes with active state', () => {
    render(<ChatStatusLine model="test" permissionMode="default" mcpServers={mixedMcp} onMcpServerToggle={() => {}} />)
    fireEvent.click(screen.getByLabelText('MCP servers'))
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes[0].getAttribute('aria-checked')).toBe('true')
    expect(checkboxes[1].getAttribute('aria-checked')).toBe('false')
  })

  it('keeps MCP dropdown open after toggling a server', () => {
    render(<ChatStatusLine model="test" permissionMode="default" mcpServers={twoMcp} onMcpServerToggle={() => {}} />)
    fireEvent.click(screen.getByLabelText('MCP servers'))
    fireEvent.click(screen.getByText('server-a'))
    // Dropdown should still be open
    expect(screen.getByText('server-b')).toBeDefined()
  })
})
