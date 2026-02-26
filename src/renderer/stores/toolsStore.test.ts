import { useToolsStore } from './toolsStore'
import { mockAgent } from '../__tests__/setup'
import { act } from '@testing-library/react'

const makeTool = (name: string, enabled: boolean) => ({
  name,
  enabled,
  description: `Tool ${name}`,
})

describe('toolsStore', () => {
  beforeEach(() => {
    act(() => {
      useToolsStore.setState({ tools: [], isLoading: false, allEnabled: true })
    })
  })

  describe('loadTools', () => {
    it('fetches and sets tools', async () => {
      const tools = [makeTool('Read', true), makeTool('Write', true)]
      mockAgent.tools.listAvailable.mockResolvedValueOnce(tools)

      await act(async () => {
        await useToolsStore.getState().loadTools()
      })

      expect(useToolsStore.getState().tools).toEqual(tools)
      expect(useToolsStore.getState().isLoading).toBe(false)
    })

    it('sets allEnabled true when all tools are enabled', async () => {
      const tools = [makeTool('Read', true), makeTool('Write', true)]
      mockAgent.tools.listAvailable.mockResolvedValueOnce(tools)

      await act(async () => {
        await useToolsStore.getState().loadTools()
      })

      expect(useToolsStore.getState().allEnabled).toBe(true)
    })

    it('sets allEnabled false when some tools are disabled', async () => {
      const tools = [makeTool('Read', true), makeTool('Write', false)]
      mockAgent.tools.listAvailable.mockResolvedValueOnce(tools)

      await act(async () => {
        await useToolsStore.getState().loadTools()
      })

      expect(useToolsStore.getState().allEnabled).toBe(false)
    })

    it('keeps empty list on error', async () => {
      mockAgent.tools.listAvailable.mockRejectedValueOnce(new Error('fail'))

      await act(async () => {
        await useToolsStore.getState().loadTools()
      })

      expect(useToolsStore.getState().tools).toEqual([])
      expect(useToolsStore.getState().isLoading).toBe(false)
    })
  })

  describe('toggleTool', () => {
    it('calls toggle then reloads', async () => {
      const tools = [makeTool('Read', false)]
      mockAgent.tools.listAvailable.mockResolvedValueOnce(tools)

      await act(async () => {
        await useToolsStore.getState().toggleTool('Read')
      })

      expect(mockAgent.tools.toggle).toHaveBeenCalledWith('Read')
      expect(useToolsStore.getState().tools).toEqual(tools)
    })

    it('silently handles error', async () => {
      mockAgent.tools.toggle.mockRejectedValueOnce(new Error('fail'))

      await act(async () => {
        await useToolsStore.getState().toggleTool('Read')
      })

      // No throw, state unchanged
      expect(useToolsStore.getState().tools).toEqual([])
    })
  })

  describe('enableAll', () => {
    it('calls setEnabled with preset then reloads', async () => {
      const tools = [makeTool('Read', true), makeTool('Write', true)]
      mockAgent.tools.listAvailable.mockResolvedValueOnce(tools)

      await act(async () => {
        await useToolsStore.getState().enableAll()
      })

      expect(mockAgent.tools.setEnabled).toHaveBeenCalledWith('preset:claude_code')
      expect(useToolsStore.getState().tools).toEqual(tools)
      expect(useToolsStore.getState().allEnabled).toBe(true)
    })
  })

  describe('disableAll', () => {
    it('calls setEnabled with empty list then reloads', async () => {
      const tools = [makeTool('Read', false), makeTool('Write', false)]
      mockAgent.tools.listAvailable.mockResolvedValueOnce(tools)

      await act(async () => {
        await useToolsStore.getState().disableAll()
      })

      expect(mockAgent.tools.setEnabled).toHaveBeenCalledWith('[]')
      expect(useToolsStore.getState().tools).toEqual(tools)
      expect(useToolsStore.getState().allEnabled).toBe(false)
    })
  })
})
