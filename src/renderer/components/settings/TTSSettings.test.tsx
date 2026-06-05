import { render, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { mockAgent } from '../../__tests__/setup'

// The three section components are presentational; stub them so the test exercises
// only TTSSettings' own mount effects (player detection + platform-gated voice fetch).
vi.mock('./tts/ProviderSection', () => ({ ProviderSection: () => <div data-testid="provider-section" /> }))
vi.mock('./tts/ResponseModeSection', () => ({ ResponseModeSection: () => <div data-testid="response-mode" /> }))
vi.mock('./tts/SummaryPromptSection', () => ({ SummaryPromptSection: () => <div data-testid="summary-prompt" /> }))

import { TTSSettings } from './TTSSettings'

const setUserAgent = (ua: string) => {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
}

describe('TTSSettings', () => {
  it('fetches macOS "say" voices on mount when running on macOS', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    mockAgent.tts.listSayVoices.mockResolvedValueOnce([{ name: 'Samantha', locale: 'en_US' }])

    render(<TTSSettings />)

    await waitFor(() => expect(mockAgent.tts.listSayVoices).toHaveBeenCalledTimes(1))
  })

  it('does not fetch "say" voices on non-macOS platforms', async () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64)')

    render(<TTSSettings />)

    // detectPlayers runs unconditionally — wait for it to confirm the mount effect ran,
    // then assert the platform gate kept listSayVoices from firing.
    await waitFor(() => expect(mockAgent.tts.detectPlayers).toHaveBeenCalled())
    expect(mockAgent.tts.listSayVoices).not.toHaveBeenCalled()
  })
})
