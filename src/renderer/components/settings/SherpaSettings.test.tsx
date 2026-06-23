import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SherpaSettings } from './SherpaSettings'
import { useSettingsStore } from '../../stores/settingsStore'

const mockSetSetting = vi.fn()

beforeEach(() => {
  mockSetSetting.mockClear()
  useSettingsStore.setState({
    settings: {
      sherpa_modelPath: '',
      sherpa_hotwordsSensitivity: 'normal',
      sherpa_hotwordsScoreOverride: '',
    } as any,
    setSetting: mockSetSetting,
  } as any)
  ;(window as any).agent = {
    system: { selectFolder: vi.fn(async () => '/models/sherpa') },
    sherpa: {
      validateConfig: vi.fn(async () => ({ modelPath: '/m', files: ['encoder.onnx'], detected: 'transducer', ok: true })),
      downloadModel: vi.fn(async () => ({ modelPath: '/m' })),
      listInstalledModels: vi.fn(async () => []),
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

describe('SherpaSettings hotwords sensitivity', () => {
  it('renders the three sensitivity options', () => {
    render(<SherpaSettings />)
    expect(screen.getByRole('button', { name: 'Soft' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Normal' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Strong' })).toBeDefined()
  })

  it('writes the chosen sensitivity', () => {
    render(<SherpaSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Strong' }))
    expect(mockSetSetting).toHaveBeenCalledWith('sherpa_hotwordsSensitivity', 'strong')
  })

  it('writes a custom override score', () => {
    render(<SherpaSettings />)
    const input = screen.getByLabelText('Custom Boost score')
    fireEvent.change(input, { target: { value: '8' } })
    expect(mockSetSetting).toHaveBeenCalledWith('sherpa_hotwordsScoreOverride', '8')
  })
})
