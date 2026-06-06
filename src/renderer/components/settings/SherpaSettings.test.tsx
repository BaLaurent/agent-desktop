import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SherpaSettings } from './SherpaSettings'
import { useSettingsStore } from '../../stores/settingsStore'

beforeEach(() => {
  useSettingsStore.setState({ settings: { sherpa_modelPath: '' } as any, setSetting: vi.fn() } as any)
  ;(window as any).agent = {
    system: { selectFolder: vi.fn(async () => '/models/parakeet') },
    sherpa: {
      validateConfig: vi.fn(async () => ({ modelPath: '/m', files: ['encoder.onnx'], detected: 'transducer', ok: true })),
      downloadModel: vi.fn(async () => ({ modelPath: '/m' })),
      onDownloadProgress: vi.fn(() => () => {}),
    },
  }
})

describe('SherpaSettings', () => {
  it('lists the Parakeet preset', () => {
    render(<SherpaSettings />)
    expect(screen.getAllByText(/Parakeet/i).length).toBeGreaterThan(0)
  })

  it('shows the detected architecture after Test Configuration', async () => {
    render(<SherpaSettings />)
    fireEvent.click(screen.getByText(/Test Configuration/i))
    await waitFor(() => expect(screen.getByText(/transducer/i)).toBeInTheDocument())
  })
})
