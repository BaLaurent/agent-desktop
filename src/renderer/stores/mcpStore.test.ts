import { useMcpStore } from './mcpStore'
import { mockAgent } from '../__tests__/setup'
import { act } from '@testing-library/react'

const makeServer = (id: number, name: string) => ({
  id,
  name,
  command: 'node',
  args: ['server.js'],
  enabled: true,
})

describe('mcpStore', () => {
  beforeEach(() => {
    act(() => {
      useMcpStore.setState({ servers: [], isLoading: false, testResults: {} })
    })
  })

  describe('loadServers', () => {
    it('fetches and sets servers', async () => {
      const servers = [makeServer(1, 'srv1'), makeServer(2, 'srv2')]
      mockAgent.mcp.listServers.mockResolvedValueOnce(servers)

      await act(async () => {
        await useMcpStore.getState().loadServers()
      })

      expect(useMcpStore.getState().servers).toEqual(servers)
      expect(useMcpStore.getState().isLoading).toBe(false)
    })

    it('keeps empty list on error', async () => {
      mockAgent.mcp.listServers.mockRejectedValueOnce(new Error('fail'))

      await act(async () => {
        await useMcpStore.getState().loadServers()
      })

      expect(useMcpStore.getState().servers).toEqual([])
      expect(useMcpStore.getState().isLoading).toBe(false)
    })

    it('sets isLoading during fetch', async () => {
      let resolve: (v: unknown) => void
      const pending = new Promise((r) => { resolve = r })
      mockAgent.mcp.listServers.mockReturnValueOnce(pending)

      const promise = act(async () => {
        const p = useMcpStore.getState().loadServers()
        expect(useMcpStore.getState().isLoading).toBe(true)
        resolve!([])
        await p
      })

      await promise
      expect(useMcpStore.getState().isLoading).toBe(false)
    })
  })

  describe('addServer', () => {
    it('calls addServer then reloads', async () => {
      const servers = [makeServer(1, 'new')]
      mockAgent.mcp.listServers.mockResolvedValueOnce(servers)
      const config = { name: 'new', command: 'node', args: ['s.js'] }

      await act(async () => {
        await useMcpStore.getState().addServer(config as any)
      })

      expect(mockAgent.mcp.addServer).toHaveBeenCalledWith(config)
      expect(mockAgent.mcp.listServers).toHaveBeenCalled()
      expect(useMcpStore.getState().servers).toEqual(servers)
    })

    it('silently handles error', async () => {
      mockAgent.mcp.addServer.mockRejectedValueOnce(new Error('fail'))

      await act(async () => {
        await useMcpStore.getState().addServer({ name: 'x' } as any)
      })

      // No throw, servers unchanged
      expect(useMcpStore.getState().servers).toEqual([])
    })
  })

  describe('updateServer', () => {
    it('calls updateServer then reloads', async () => {
      const servers = [makeServer(1, 'updated')]
      mockAgent.mcp.listServers.mockResolvedValueOnce(servers)

      await act(async () => {
        await useMcpStore.getState().updateServer(1, { name: 'updated' })
      })

      expect(mockAgent.mcp.updateServer).toHaveBeenCalledWith(1, { name: 'updated' })
      expect(useMcpStore.getState().servers).toEqual(servers)
    })
  })

  describe('removeServer', () => {
    it('calls removeServer then reloads', async () => {
      mockAgent.mcp.listServers.mockResolvedValueOnce([])

      await act(async () => {
        await useMcpStore.getState().removeServer(1)
      })

      expect(mockAgent.mcp.removeServer).toHaveBeenCalledWith(1)
      expect(mockAgent.mcp.listServers).toHaveBeenCalled()
    })
  })

  describe('toggleServer', () => {
    it('calls toggleServer then reloads', async () => {
      const toggled = [makeServer(1, 'srv')]
      toggled[0].enabled = false
      mockAgent.mcp.listServers.mockResolvedValueOnce(toggled)

      await act(async () => {
        await useMcpStore.getState().toggleServer(1)
      })

      expect(mockAgent.mcp.toggleServer).toHaveBeenCalledWith(1)
      expect(useMcpStore.getState().servers).toEqual(toggled)
    })
  })

  describe('testConnection', () => {
    it('sets loading then result on success', async () => {
      const result = { success: true, output: 'OK' }
      mockAgent.mcp.testConnection.mockResolvedValueOnce(result)

      await act(async () => {
        await useMcpStore.getState().testConnection(1)
      })

      const tr = useMcpStore.getState().testResults[1]
      expect(tr.loading).toBe(false)
      expect(tr.result).toEqual(result)
    })

    it('sets error result on failure', async () => {
      mockAgent.mcp.testConnection.mockRejectedValueOnce(new Error('Connection refused'))

      await act(async () => {
        await useMcpStore.getState().testConnection(1)
      })

      const tr = useMcpStore.getState().testResults[1]
      expect(tr.loading).toBe(false)
      expect(tr.result).toEqual({ success: false, output: 'Connection refused' })
    })
  })

  describe('clearTestResult', () => {
    it('removes specific test result', () => {
      act(() => {
        useMcpStore.setState({
          testResults: { 1: { loading: false, result: { success: true, output: '' } } },
        })
      })

      act(() => {
        useMcpStore.getState().clearTestResult(1)
      })

      expect(useMcpStore.getState().testResults[1]).toBeUndefined()
    })

    it('leaves other results intact', () => {
      act(() => {
        useMcpStore.setState({
          testResults: {
            1: { loading: false, result: { success: true, output: 'a' } },
            2: { loading: false, result: { success: true, output: 'b' } },
          },
        })
      })

      act(() => {
        useMcpStore.getState().clearTestResult(1)
      })

      expect(useMcpStore.getState().testResults[1]).toBeUndefined()
      expect(useMcpStore.getState().testResults[2]).toEqual({
        loading: false,
        result: { success: true, output: 'b' },
      })
    })
  })
})
