import { render, screen, fireEvent } from '@testing-library/react'

import { McpStatusBlock } from './McpStatusBlock'

describe('McpStatusBlock', () => {
  it('shows connected summary when all servers connected', () => {
    const servers = [
      { name: 'spotify', status: 'connected' as const },
      { name: 'github', status: 'connected' as const },
    ]
    render(<McpStatusBlock servers={servers} />)
    expect(screen.getByText(/2 MCP servers connected/)).toBeInTheDocument()
  })

  it('shows singular for one server', () => {
    const servers = [{ name: 'spotify', status: 'connected' as const }]
    render(<McpStatusBlock servers={servers} />)
    expect(screen.getByText(/1 MCP server connected/)).toBeInTheDocument()
  })

  it('shows error summary when any server has errors', () => {
    const servers = [
      { name: 'spotify', status: 'connected' as const },
      { name: 'github', status: 'error' as const, error: 'binary not found' },
    ]
    render(<McpStatusBlock servers={servers} />)
    expect(screen.getByText(/MCP connection issues/)).toBeInTheDocument()
  })

  it('shows connecting summary when servers are connecting', () => {
    const servers = [{ name: 'spotify', status: 'connecting' as const }]
    render(<McpStatusBlock servers={servers} />)
    expect(screen.getByText(/Connecting to MCP servers/)).toBeInTheDocument()
  })

  it('expands to show individual server statuses', () => {
    const servers = [
      { name: 'spotify', status: 'connected' as const },
      { name: 'github', status: 'error' as const, error: 'command not found' },
    ]
    render(<McpStatusBlock servers={servers} />)

    // Initially collapsed — server names not visible
    expect(screen.queryByText('spotify')).not.toBeInTheDocument()

    // Click to expand
    fireEvent.click(screen.getByRole('button', { name: /Toggle MCP server status/ }))

    // Now visible
    expect(screen.getByText('spotify')).toBeInTheDocument()
    expect(screen.getByText('github')).toBeInTheDocument()
    expect(screen.getByText('command not found')).toBeInTheDocument()
  })
})
