import { create } from 'zustand'

interface TtsState {
  speakingMessageId: number | null
  playMessage: (messageId: number, content: string, conversationId: number) => void
  stopPlayback: () => void
}

export const useTtsStore = create<TtsState>((set) => ({
  speakingMessageId: null,
  playMessage: (messageId, content, conversationId) => {
    set({ speakingMessageId: messageId })
    window.agent.tts.speakMessage(content, conversationId, messageId).catch(() => {
      set({ speakingMessageId: null })
    })
  },
  stopPlayback: () => {
    window.agent.tts.stop().catch(() => {})
  },
}))

// Module-level listener (same pattern as other stores)
window.agent.tts.onStateChange((state) => {
  if (!state.speaking) {
    useTtsStore.setState({ speakingMessageId: null })
  } else if (state.messageId != null) {
    useTtsStore.setState({ speakingMessageId: state.messageId })
  }
})
