import { describe, it, expect, beforeEach } from 'vitest'
import { useContinuousVoiceStore } from './continuousVoiceStore'

describe('continuousVoiceStore.processing', () => {
  beforeEach(() => useContinuousVoiceStore.getState().reset())

  it('starts null', () => {
    expect(useContinuousVoiceStore.getState().processing).toBeNull()
  })

  it('setProcessing updates the field', () => {
    useContinuousVoiceStore.getState().setProcessing('classifying')
    expect(useContinuousVoiceStore.getState().processing).toBe('classifying')
    useContinuousVoiceStore.getState().setProcessing('replying')
    expect(useContinuousVoiceStore.getState().processing).toBe('replying')
  })

  it('reset clears processing back to null', () => {
    useContinuousVoiceStore.getState().setProcessing('replying')
    useContinuousVoiceStore.getState().reset()
    expect(useContinuousVoiceStore.getState().processing).toBeNull()
  })
})
