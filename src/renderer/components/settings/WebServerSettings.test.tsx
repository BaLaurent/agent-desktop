import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WebServerSettings } from './WebServerSettings'

// Mock window.agent
const mockGetStatus = vi.fn().mockResolvedValue({
  running: false,
  port: null,
  url: null,
  urlHostname: null,
  lanIp: null,
  hostname: null,
  token: null,
  clients: 0,
  firewallWarning: null,
})

const mockStart = vi.fn().mockResolvedValue({ url: 'http://192.168.1.10:3484?token=abc', token: 'abc' })
const mockStop = vi.fn().mockResolvedValue(undefined)
const mockSettingsGet = vi.fn().mockResolvedValue({})
const mockSettingsSet = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  vi.clearAllMocks()
  ;(window.agent as Record<string, unknown>).server = {
    start: mockStart,
    stop: mockStop,
    getStatus: mockGetStatus,
  }
})

describe('WebServerSettings', () => {
  it('renders the enable toggle', () => {
    render(<WebServerSettings />)
    expect(screen.getByText('Enable Web Server')).toBeDefined()
  })

  it('renders port input', () => {
    render(<WebServerSettings />)
    expect(screen.getByText('Port')).toBeDefined()
  })

  it('renders auto-start toggle', () => {
    render(<WebServerSettings />)
    expect(screen.getByText('Auto-start on launch')).toBeDefined()
  })

  it('renders info text', () => {
    render(<WebServerSettings />)
    expect(screen.getByText(/serves the same interface/i)).toBeDefined()
  })
})
