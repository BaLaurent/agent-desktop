import { describe, it, expect, beforeEach } from 'vitest'
import { useKnowledgeStore } from './knowledgeStore'
import { mockAgent } from '../__tests__/setup'
import { act } from '@testing-library/react'
import type { KnowledgeCollection } from '../../shared/types'

const makeCollections = (): KnowledgeCollection[] => [
  { name: 'docs', path: '/knowledges/docs', fileCount: 3, totalSize: 1024 },
  { name: 'notes', path: '/knowledges/notes', fileCount: 1, totalSize: 256 },
]

describe('knowledgeStore', () => {
  beforeEach(() => {
    act(() => {
      useKnowledgeStore.setState({ collections: [], loading: false, error: null })
    })
  })

  it('loadCollections fetches and sets collections', async () => {
    mockAgent.kb.listCollections.mockResolvedValueOnce(makeCollections())

    await act(async () => {
      await useKnowledgeStore.getState().loadCollections()
    })

    const state = useKnowledgeStore.getState()
    expect(state.collections).toEqual(makeCollections())
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
  })

  it('loadCollections sets error on failure', async () => {
    mockAgent.kb.listCollections.mockRejectedValueOnce(new Error('Permission denied'))

    await act(async () => {
      await useKnowledgeStore.getState().loadCollections()
    })

    const state = useKnowledgeStore.getState()
    expect(state.collections).toEqual([])
    expect(state.loading).toBe(false)
    expect(state.error).toBe('Permission denied')
  })

  it('loadCollections sets loading during fetch', async () => {
    let resolvePromise: (v: KnowledgeCollection[]) => void
    const pending = new Promise<KnowledgeCollection[]>((r) => { resolvePromise = r })
    mockAgent.kb.listCollections.mockReturnValueOnce(pending)

    const promise = act(async () => {
      const p = useKnowledgeStore.getState().loadCollections()
      // Check loading state mid-flight
      expect(useKnowledgeStore.getState().loading).toBe(true)
      resolvePromise!(makeCollections())
      await p
    })

    await promise
    expect(useKnowledgeStore.getState().loading).toBe(false)
  })
})
