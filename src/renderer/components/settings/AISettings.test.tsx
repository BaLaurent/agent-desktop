import { render, screen } from '@testing-library/react'
import { useSettingsStore } from '../../stores/settingsStore'
import { AISettings } from './AISettings'

beforeEach(() => {
  ;(window.agent as Record<string, unknown>).commands = {
    list: vi.fn().mockResolvedValue([]),
  }

  useSettingsStore.setState({
    settings: {},
    setSetting: vi.fn().mockResolvedValue(undefined),
    loadSettings: vi.fn().mockResolvedValue(undefined),
  })
})

describe('AISettings — Claude backend (default)', () => {
  it('shows Claude-only sections when backend is claude-agent-sdk', () => {
    useSettingsStore.setState({
      settings: { ai_sdkBackend: 'claude-agent-sdk' },
      setSetting: vi.fn().mockResolvedValue(undefined),
      loadSettings: vi.fn().mockResolvedValue(undefined),
    })

    render(<AISettings />)

    expect(screen.getByLabelText('API key')).toBeInTheDocument()
    expect(screen.getByLabelText('Maximum budget in USD')).toBeInTheDocument()
    expect(screen.getByLabelText('Select permission mode')).toBeInTheDocument()
    expect(screen.getByLabelText('Select setting sources')).toBeInTheDocument()
    expect(screen.getByLabelText('Toggle skills')).toBeInTheDocument()
    expect(screen.getByLabelText('Toggle CWD write restriction')).toBeInTheDocument()
    expect(screen.getByLabelText('Share Claude config across backends')).toBeInTheDocument()
  })

  it('shows Claude-only sections when backend is unset (defaults to claude)', () => {
    render(<AISettings />)

    expect(screen.getByLabelText('API key')).toBeInTheDocument()
    expect(screen.getByLabelText('Select permission mode')).toBeInTheDocument()
  })
})

describe('AISettings — PI backend', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: { ai_sdkBackend: 'pi' },
      setSetting: vi.fn().mockResolvedValue(undefined),
      loadSettings: vi.fn().mockResolvedValue(undefined),
    })
  })

  it('hides API Key when PI is selected', () => {
    render(<AISettings />)
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument()
  })

  it('hides Base URL when PI is selected', () => {
    render(<AISettings />)
    expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument()
  })

  it('hides Max Budget when PI is selected', () => {
    render(<AISettings />)
    expect(screen.queryByLabelText('Maximum budget in USD')).not.toBeInTheDocument()
  })

  it('hides Permission Mode when PI is selected', () => {
    render(<AISettings />)
    expect(screen.queryByLabelText('Select permission mode')).not.toBeInTheDocument()
  })

  it('hides Setting Sources when PI is selected', () => {
    render(<AISettings />)
    expect(screen.queryByLabelText('Select setting sources')).not.toBeInTheDocument()
  })

  it('hides Skills toggle when PI is selected', () => {
    render(<AISettings />)
    expect(screen.queryByLabelText('Toggle skills')).not.toBeInTheDocument()
  })

  it('hides CWD Restriction when PI is selected', () => {
    render(<AISettings />)
    expect(screen.queryByLabelText('Toggle CWD write restriction')).not.toBeInTheDocument()
  })

  it('still shows Share Claude Config when PI is selected', () => {
    render(<AISettings />)
    expect(screen.getByLabelText('Share Claude config across backends')).toBeInTheDocument()
  })

  it('still shows shared settings (Backend, Model, Max Turns, Thinking Tokens, System Prompt)', () => {
    render(<AISettings />)

    expect(screen.getByLabelText('Select SDK backend')).toBeInTheDocument()
    expect(screen.getByLabelText('Select AI model')).toBeInTheDocument()
    expect(screen.getByLabelText('Maximum agentic turns')).toBeInTheDocument()
    expect(screen.getByLabelText('Maximum thinking tokens')).toBeInTheDocument()
    expect(screen.getByLabelText('Default system prompt')).toBeInTheDocument()
  })
})
