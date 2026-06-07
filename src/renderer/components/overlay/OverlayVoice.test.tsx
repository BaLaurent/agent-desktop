import { render, act } from '@testing-library/react'
import { vi } from 'vitest'
import { mockAgent } from '../../__tests__/setup'

// Isolate the component from the real voice-input store: startRecording() touches
// navigator.mediaDevices / MediaRecorder which jsdom does not provide. We only care
// here about the onOverlayStopRecording event wiring (the contract the global mock
// now exposes), so a controllable stub store is the right boundary.
const { storeState } = vi.hoisted(() => ({
  storeState: {
    isRecording: true,
    isTranscribing: false,
    error: null as string | null,
    lastTranscription: null as { id: number; text: string } | null,
    startRecording: vi.fn(),
    stopAndTranscribe: vi.fn(),
    cancelRecording: vi.fn(),
  },
}))

vi.mock('../../stores/voiceInputStore', () => ({
  useVoiceInputStore: () => storeState,
}))

vi.mock('../../utils/notificationSound', () => ({
  playListeningSound: vi.fn(),
  playProcessingSound: vi.fn(),
}))

import { OverlayVoice } from './OverlayVoice'
import { playListeningSound, playProcessingSound } from '../../utils/notificationSound'

describe('OverlayVoice', () => {
  beforeEach(() => {
    storeState.isRecording = true
    storeState.lastTranscription = null
    storeState.startRecording.mockClear()
    storeState.stopAndTranscribe.mockClear()
    storeState.cancelRecording.mockClear()
    vi.mocked(playListeningSound).mockClear()
    vi.mocked(playProcessingSound).mockClear()
  })

  it('subscribes to onOverlayStopRecording on mount and unsubscribes on unmount', () => {
    const unsub = vi.fn()
    mockAgent.events.onOverlayStopRecording.mockReturnValueOnce(unsub)

    const { unmount } = render(<OverlayVoice onTranscription={vi.fn()} />)

    expect(mockAgent.events.onOverlayStopRecording).toHaveBeenCalledTimes(1)

    unmount()
    expect(unsub).toHaveBeenCalledTimes(1)
  })

  it('stops and transcribes when the main-process stop event fires while recording', () => {
    render(<OverlayVoice onTranscription={vi.fn()} />)

    const handler = mockAgent.events.onOverlayStopRecording.mock.calls.at(-1)![0] as () => void
    act(() => { handler() })

    expect(storeState.stopAndTranscribe).toHaveBeenCalledTimes(1)
  })

  it('ignores the stop event when not currently recording', () => {
    storeState.isRecording = false
    render(<OverlayVoice onTranscription={vi.fn()} />)

    const handler = mockAgent.events.onOverlayStopRecording.mock.calls.at(-1)![0] as () => void
    act(() => { handler() })

    expect(storeState.stopAndTranscribe).not.toHaveBeenCalled()
  })

  it('plays the listening cue when recording starts', () => {
    render(<OverlayVoice onTranscription={vi.fn()} />)

    expect(playListeningSound).toHaveBeenCalledTimes(1)
    expect(playProcessingSound).not.toHaveBeenCalled()
  })

  it('plays the processing cue when recording stops', () => {
    const { rerender } = render(<OverlayVoice onTranscription={vi.fn()} />)
    expect(playListeningSound).toHaveBeenCalledTimes(1)

    storeState.isRecording = false
    act(() => { rerender(<OverlayVoice onTranscription={vi.fn()} />) })

    expect(playProcessingSound).toHaveBeenCalledTimes(1)
  })
})
