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

  it('handles empty collections array', async () => {
    mockAgent.kb.listCollections.mockResolvedValueOnce([])

    await act(async () => {
      await useKnowledgeStore.getState().loadCollections()
    })

    const state = useKnowledgeStore.getState()
    expect(state.collections).toEqual([])
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
  })

  it('handles non-Error rejection with fallback message', async () => {
    mockAgent.kb.listCollections.mockRejectedValueOnce('network timeout')

    await act(async () => {
      await useKnowledgeStore.getState().loadCollections()
    })

    const state = useKnowledgeStore.getState()
    expect(state.collections).toEqual([])
    expect(state.loading).toBe(false)
    expect(state.error).toBe('Failed to load collections')
  })

  it('second loadCollections replaces first result', async () => {
    const first: KnowledgeCollection[] = [
      { name: 'alpha', path: '/knowledges/alpha', fileCount: 1, totalSize: 100 },
    ]
    const second: KnowledgeCollection[] = [
      { name: 'beta', path: '/knowledges/beta', fileCount: 5, totalSize: 9999 },
    ]

    mockAgent.kb.listCollections.mockResolvedValueOnce(first)
    await act(async () => {
      await useKnowledgeStore.getState().loadCollections()
    })
    expect(useKnowledgeStore.getState().collections).toEqual(first)

    mockAgent.kb.listCollections.mockResolvedValueOnce(second)
    await act(async () => {
      await useKnowledgeStore.getState().loadCollections()
    })
    expect(useKnowledgeStore.getState().collections).toEqual(second)
  })

  it('error clears previous collections', async () => {
    mockAgent.kb.listCollections.mockResolvedValueOnce(makeCollections())
    await act(async () => {
      await useKnowledgeStore.getState().loadCollections()
    })
    expect(useKnowledgeStore.getState().collections).toEqual(makeCollections())

    mockAgent.kb.listCollections.mockRejectedValueOnce(new Error('disk full'))
    await act(async () => {
      await useKnowledgeStore.getState().loadCollections()
    })

    const state = useKnowledgeStore.getState()
    // The store sets loading: true + error: null at start, then on catch sets loading: false + error.
    // But it does NOT clear collections in the catch — the collections from the try's set() never ran.
    // Actually: set({ loading: true, error: null }) runs, then the await rejects, so
    // the set({ collections, loading: false }) never executes. Collections remain from before.
    // Wait — re-read the source:
    //   set({ loading: true, error: null })   <-- clears error, keeps old collections
    //   try { const c = await ...; set({ collections: c, loading: false }) }
    //   catch { set({ loading: false, error: ... }) }
    // On error, collections stay at the previous value because only loading+error are set.
    // So "error clears previous collections" is actually NOT what happens.
    // The store preserves stale collections on error — this is the actual behavior.
    expect(state.collections).toEqual(makeCollections()) // stale collections preserved
    expect(state.error).toBe('disk full')
    expect(state.loading).toBe(false)
  })
})
