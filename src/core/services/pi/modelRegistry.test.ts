import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockGetAvailable = vi.fn()
const mockFind = vi.fn()
const mockAuthCreate = vi.fn()
const mockModelRegistryCtor = vi.fn()

vi.mock('./sdkLoader', () => ({
  loadPISdk: vi.fn().mockResolvedValue({
    AuthStorage: {
      create: (...args: unknown[]) => mockAuthCreate(...args),
    },
    ModelRegistry: function ModelRegistry(...args: unknown[]) {
      mockModelRegistryCtor(...args)
      return {
        getAvailable: mockGetAvailable,
        find: mockFind,
      }
    },
  }),
}))

import { discoverPIModels, resolvePIModel } from './modelRegistry'

describe('piModels', () => {
  beforeEach(() => {
    mockGetAvailable.mockReset()
    mockFind.mockReset()
    mockAuthCreate.mockReset()
    mockModelRegistryCtor.mockReset()
  })

  describe('discoverPIModels', () => {
    it('returns available models as provider/id values', async () => {
      mockGetAvailable.mockResolvedValueOnce([
        { provider: 'openai', id: 'gpt-4o', name: 'GPT-4o' },
        { provider: 'anthropic', id: 'claude-sonnet-4-6', name: undefined },
      ])

      await expect(discoverPIModels()).resolves.toEqual([
        { value: 'openai/gpt-4o', label: 'openai/gpt-4o' },
        { value: 'anthropic/claude-sonnet-4-6', label: 'anthropic/claude-sonnet-4-6' },
      ])
    })

    it('uses canonical provider/id labels even when models share the same display name', async () => {
      mockGetAvailable.mockResolvedValueOnce([
        { provider: 'codex', id: 'gpt-5.4', name: 'GPT 5.4' },
        { provider: 'openrouter', id: 'openai/gpt-5.4', name: 'GPT 5.4' },
        { provider: 'claude-code', id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5' },
      ])

      await expect(discoverPIModels()).resolves.toEqual([
        { value: 'codex/gpt-5.4', label: 'codex/gpt-5.4' },
        { value: 'openrouter/openai/gpt-5.4', label: 'openrouter/openai/gpt-5.4' },
        { value: 'claude-code/claude-haiku-4.5', label: 'claude-code/claude-haiku-4.5' },
      ])
    })

    it('returns empty array when registry has no available models', async () => {
      mockGetAvailable.mockResolvedValueOnce([])
      await expect(discoverPIModels()).resolves.toEqual([])
    })
  })

  describe('resolvePIModel', () => {
    it('resolves canonical provider/id values through the registry', async () => {
      const resolved = { provider: 'openrouter', id: 'openai/gpt-4o-mini' }
      mockFind.mockReturnValueOnce(resolved)

      await expect(resolvePIModel('openrouter/openai/gpt-4o-mini')).resolves.toBe(resolved)
      expect(mockFind).toHaveBeenCalledWith('openrouter', 'openai/gpt-4o-mini')
    })

    it('resolves legacy bare ids when a unique available model matches', async () => {
      const resolved = { provider: 'anthropic', id: 'claude-sonnet-4-6' }
      mockGetAvailable.mockResolvedValueOnce([
        resolved,
        { provider: 'openai', id: 'gpt-4o' },
      ])

      await expect(resolvePIModel('claude-sonnet-4-6')).resolves.toBe(resolved)
    })

    it('throws when the selected model is not available', async () => {
      mockFind.mockReturnValueOnce(undefined)

      await expect(resolvePIModel('openai/gpt-4o')).rejects.toThrow(
        'PI model not available: openai/gpt-4o',
      )
    })

    it('throws when a bare id matches multiple available models', async () => {
      mockGetAvailable.mockResolvedValueOnce([
        { provider: 'anthropic', id: 'claude-sonnet-4-6' },
        { provider: 'github-copilot', id: 'claude-sonnet-4-6' },
      ])

      await expect(resolvePIModel('claude-sonnet-4-6')).rejects.toThrow(
        'PI model is ambiguous: claude-sonnet-4-6',
      )
    })
  })
})
