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
    stopWebAudio()
    window.agent.tts.stop().catch(() => {})
  },
}))

// ─── Web-mode browser playback ──────────────────────────────
//
// In web mode the server cannot play audio on the listener's device, so the
// core TTS pipeline ships the generated audio over WS (tts:audio). Decode it
// and play it in the browser. Desktop (Electron) never receives this event.

let webAudio: HTMLAudioElement | null = null

function stopWebAudio(): void {
  if (webAudio) {
    webAudio.pause()
    webAudio.src = ''
    webAudio = null
  }
}

function base64ToBlob(data: string, mime: string): Blob {
  const bytes = atob(data)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

window.agent.tts.onAudio((audio) => {
  stopWebAudio()
  const url = URL.createObjectURL(base64ToBlob(audio.data, audio.mime))
  const el = new Audio(url)
  webAudio = el
  const messageId = audio.messageId
  if (messageId != null) useTtsStore.setState({ speakingMessageId: messageId })
  const cleanup = () => {
    URL.revokeObjectURL(url)
    if (webAudio === el) {
      webAudio = null
      useTtsStore.setState({ speakingMessageId: null })
    }
  }
  el.addEventListener('ended', cleanup)
  el.addEventListener('error', cleanup)
  el.play().catch(() => cleanup())
})

// Module-level listener (same pattern as other stores)
window.agent.tts.onStateChange((state) => {
  if (!state.speaking) {
    // A web-mode audio element drives its own lifecycle; don't clear mid-playback.
    if (!webAudio) useTtsStore.setState({ speakingMessageId: null })
  } else if (state.messageId != null) {
    useTtsStore.setState({ speakingMessageId: state.messageId })
  }
})
