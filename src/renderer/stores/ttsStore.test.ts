import { describe, it, expect, vi, beforeEach } from 'vitest'
import { capturedTtsStateListener } from '../__tests__/setup'

// Must import store AFTER setup has installed the mock
import { useTtsStore } from './ttsStore'

describe('ttsStore', () => {
  beforeEach(() => {
    useTtsStore.setState({ speakingMessageId: null })
  })

  it('initial state has speakingMessageId null', () => {
    expect(useTtsStore.getState().speakingMessageId).toBeNull()
  })

  it('playMessage sets speakingMessageId and calls tts.speakMessage', () => {
    useTtsStore.getState().playMessage(42, 'hello world', 1)

    expect(useTtsStore.getState().speakingMessageId).toBe(42)
    expect(window.agent.tts.speakMessage).toHaveBeenCalledWith('hello world', 1, 42)
  })

  it('playMessage clears speakingMessageId on error', async () => {
    ;(window.agent.tts.speakMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'))

    useTtsStore.getState().playMessage(42, 'hello', 1)

    // Wait for the catch to fire
    await new Promise((r) => setTimeout(r, 0))

    expect(useTtsStore.getState().speakingMessageId).toBeNull()
  })

  it('stopPlayback calls tts.stop', () => {
    useTtsStore.getState().stopPlayback()

    expect(window.agent.tts.stop).toHaveBeenCalled()
  })

  describe('onStateChange listener', () => {
    it('clears speakingMessageId when speaking is false', () => {
      useTtsStore.setState({ speakingMessageId: 42 })

      capturedTtsStateListener?.({ speaking: false })

      expect(useTtsStore.getState().speakingMessageId).toBeNull()
    })

    it('sets speakingMessageId when speaking with messageId', () => {
      capturedTtsStateListener?.({ speaking: true, messageId: 99 })

      expect(useTtsStore.getState().speakingMessageId).toBe(99)
    })

    it('does not change speakingMessageId when speaking without messageId', () => {
      useTtsStore.setState({ speakingMessageId: 42 })

      capturedTtsStateListener?.({ speaking: true })

      // Should not change — messageId is undefined
      expect(useTtsStore.getState().speakingMessageId).toBe(42)
    })
  })
})
