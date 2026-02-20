import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOverrideDraft } from './useOverrideDraft'

const fallback: Record<string, string> = {
  ai_model: 'claude-sonnet-4-6',
  ai_maxTurns: '10',
  ai_mcpDisabled: '["server-a"]',
}

describe('useOverrideDraft', () => {
  it('initialises draft from provided overrides', () => {
    const { result } = renderHook(() =>
      useOverrideDraft({ ai_model: 'claude-haiku-4-5-20251001' }, fallback),
    )
    expect(result.current.draft.ai_model).toBe('claude-haiku-4-5-20251001')
    expect(result.current.draft.ai_maxTurns).toBeUndefined()
  })

  it('toggleOverride adds key with fallback value', () => {
    const { result } = renderHook(() => useOverrideDraft({}, fallback))
    act(() => result.current.toggleOverride('ai_maxTurns'))
    expect(result.current.draft.ai_maxTurns).toBe('10')
  })

  it('toggleOverride removes key if already present', () => {
    const { result } = renderHook(() =>
      useOverrideDraft({ ai_maxTurns: '5' }, fallback),
    )
    act(() => result.current.toggleOverride('ai_maxTurns'))
    expect(result.current.draft.ai_maxTurns).toBeUndefined()
  })

  it('setValue updates draft value', () => {
    const { result } = renderHook(() =>
      useOverrideDraft({ ai_model: 'claude-sonnet-4-6' }, fallback),
    )
    act(() => result.current.setValue('ai_model', 'claude-haiku-4-5-20251001'))
    expect(result.current.draft.ai_model).toBe('claude-haiku-4-5-20251001')
  })

  it('toggleMcpOverride enables with fallback', () => {
    const { result } = renderHook(() => useOverrideDraft({}, fallback))
    expect(result.current.mcpOverridden).toBe(false)
    act(() => result.current.toggleMcpOverride())
    expect(result.current.mcpOverridden).toBe(true)
    expect(result.current.mcpDisabledDraft).toEqual(['server-a'])
  })

  it('toggleMcpOverride disables when already present', () => {
    const { result } = renderHook(() =>
      useOverrideDraft({ ai_mcpDisabled: '["x"]' }, fallback),
    )
    expect(result.current.mcpOverridden).toBe(true)
    act(() => result.current.toggleMcpOverride())
    expect(result.current.mcpOverridden).toBe(false)
    expect(result.current.draft.ai_mcpDisabled).toBeUndefined()
  })

  it('toggleMcpServer adds server to disabled list', () => {
    const { result } = renderHook(() =>
      useOverrideDraft({ ai_mcpDisabled: '[]' }, fallback),
    )
    act(() => result.current.toggleMcpServer('new-server'))
    expect(result.current.mcpDisabledDraft).toEqual(['new-server'])
  })

  it('toggleMcpServer removes server from disabled list', () => {
    const { result } = renderHook(() =>
      useOverrideDraft({ ai_mcpDisabled: '["srv"]' }, fallback),
    )
    act(() => result.current.toggleMcpServer('srv'))
    expect(result.current.mcpDisabledDraft).toEqual([])
  })

  it('mcpDisabledInherited derives from fallback', () => {
    const { result } = renderHook(() => useOverrideDraft({}, fallback))
    expect(result.current.mcpDisabledInherited).toEqual(['server-a'])
  })

  it('cleanDraft strips undefined and empty values', () => {
    const { result } = renderHook(() =>
      useOverrideDraft({ ai_model: 'claude-sonnet-4-6' }, fallback),
    )
    act(() => result.current.setValue('ai_model', ''))
    expect(result.current.cleanDraft()).toEqual({})
  })

  it('cleanDraft returns non-empty overrides', () => {
    const { result } = renderHook(() =>
      useOverrideDraft({ ai_model: 'claude-sonnet-4-6', ai_mcpDisabled: '["a"]' }, fallback),
    )
    const cleaned = result.current.cleanDraft()
    expect(cleaned).toEqual({ ai_model: 'claude-sonnet-4-6', ai_mcpDisabled: '["a"]' })
  })

  it('toggleMcpOverride uses empty array when no fallback', () => {
    const { result } = renderHook(() => useOverrideDraft({}, {}))
    act(() => result.current.toggleMcpOverride())
    expect(result.current.draft.ai_mcpDisabled).toBe('[]')
  })

  it('toggleOverride uses empty string when no fallback', () => {
    const { result } = renderHook(() => useOverrideDraft({}, {}))
    act(() => result.current.toggleOverride('ai_model'))
    expect(result.current.draft.ai_model).toBe('')
  })
})
