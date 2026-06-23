import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'

// Stub the orchestrator hook so mounting the overlay does not touch getUserMedia; keep the real store.
vi.mock('../../services/continuousVoice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/continuousVoice')>()
  return {
    ...actual,
    useContinuousVoice: () => ({ start: vi.fn(), notifyExchangeComplete: vi.fn(), levelRef: { current: 0 } }),
  }
})
vi.mock('../../stores/chatStore', () => ({
  useChatStore: (sel: (s: { isStreaming: boolean; streamingContent: string; sendMessage: () => void }) => unknown) =>
    sel({ isStreaming: false, streamingContent: '', sendMessage: vi.fn() }),
}))

import { OverlayContinuousVoice } from './OverlayContinuousVoice'
import { useContinuousVoiceStore } from '../../services/continuousVoice'

beforeEach(() => useContinuousVoiceStore.getState().reset())

describe('OverlayContinuousVoice processing labels', () => {
  it('shows the classifying label when processing is "classifying"', () => {
    render(<OverlayContinuousVoice conversationId={1} />)
    act(() => useContinuousVoiceStore.getState().setProcessing('classifying'))
    expect(screen.getByText("Checking if you're talking to me…")).toBeInTheDocument()
  })

  it('shows the replying label when processing is "replying"', () => {
    render(<OverlayContinuousVoice conversationId={1} />)
    act(() => useContinuousVoiceStore.getState().setProcessing('replying'))
    expect(screen.getByText('✓ Got it — replying…')).toBeInTheDocument()
  })

  it('falls back to the phase label when processing is null', () => {
    render(<OverlayContinuousVoice conversationId={1} />)
    act(() => {
      useContinuousVoiceStore.getState().setProcessing(null)
      useContinuousVoiceStore.getState().setPhase('listening')
    })
    expect(screen.getByText('Listening…')).toBeInTheDocument()
  })
})
