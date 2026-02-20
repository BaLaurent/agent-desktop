import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn() })),
  app: {
    getPath: vi.fn(() => '/tmp/test-agent'),
  },
}))

vi.mock('../index', () => ({
  getMainWindow: vi.fn(() => null),
}))

vi.mock('./messages', () => ({
  buildMessageHistory: vi.fn(),
  getAISettings: vi.fn(() => ({})),
  getSystemPrompt: vi.fn().mockResolvedValue(''),
  saveMessage: vi.fn(),
}))

vi.mock('./streaming', () => ({
  streamMessage: vi.fn().mockResolvedValue({ content: '', toolCalls: [], aborted: false }),
  injectApiKeyEnv: vi.fn(() => null),
  registerStreamWindow: vi.fn(),
}))

vi.mock('./tts', () => ({
  speak: vi.fn().mockResolvedValue(undefined),
}))

import { computeNextRun } from './scheduler'

const BASE = new Date('2025-01-15T10:00:00.000Z')

describe('computeNextRun', () => {
  describe('minutes', () => {
    it('adds 30 minutes', () => {
      const result = computeNextRun(30, 'minutes', null, BASE)
      expect(result).toBe('2025-01-15T10:30:00.000Z')
    })

    it('adds 1 minute', () => {
      const result = computeNextRun(1, 'minutes', null, BASE)
      expect(result).toBe('2025-01-15T10:01:00.000Z')
    })
  })

  describe('hours', () => {
    it('adds 2 hours', () => {
      const result = computeNextRun(2, 'hours', null, BASE)
      expect(result).toBe('2025-01-15T12:00:00.000Z')
    })

    it('adds 1 hour', () => {
      const result = computeNextRun(1, 'hours', null, BASE)
      expect(result).toBe('2025-01-15T11:00:00.000Z')
    })
  })

  describe('days without scheduleTime', () => {
    it('adds 1 day', () => {
      const result = computeNextRun(1, 'days', null, BASE)
      expect(result).toBe('2025-01-16T10:00:00.000Z')
    })

    it('adds 7 days', () => {
      const result = computeNextRun(7, 'days', null, BASE)
      expect(result).toBe('2025-01-22T10:00:00.000Z')
    })
  })

  describe('days with scheduleTime', () => {
    it('returns today at scheduleTime when it is in the future', () => {
      // BASE is 10:00 local time — pick a scheduleTime after local hour
      // Use a fromTime where we know the local hour, then pick scheduleTime after it
      const localHour = BASE.getHours()
      const futureHour = String(localHour + 2).padStart(2, '0')
      const scheduleTime = `${futureHour}:30`

      const result = computeNextRun(1, 'days', scheduleTime, BASE)

      // Should be today at that local time
      const expected = new Date(BASE)
      expected.setHours(localHour + 2, 30, 0, 0)
      expect(result).toBe(expected.toISOString())
    })

    it('advances by intervalValue days when scheduleTime already passed', () => {
      // Pick a scheduleTime before the local hour of BASE
      const localHour = BASE.getHours()
      // If localHour is 0, we'd need a negative hour — use a time guaranteed to be in the past
      const pastHour = localHour > 0 ? localHour - 1 : 0
      const scheduleTime = `${String(pastHour).padStart(2, '0')}:00`

      // If localHour is 0 and pastHour is also 0, the time is equal (<=), so it still advances
      const result = computeNextRun(3, 'days', scheduleTime, BASE)

      const expected = new Date(BASE)
      expected.setHours(pastHour, 0, 0, 0)
      // Time is <= now, so advance by intervalValue days
      expected.setDate(expected.getDate() + 3)
      expect(result).toBe(expected.toISOString())
    })
  })

  describe('edge cases', () => {
    it('falls through to simple day addition for invalid scheduleTime format', () => {
      const result = computeNextRun(1, 'days', '9:00', BASE)
      // "9:00" does not match /^\d{2}:\d{2}$/ (needs "09:00")
      expect(result).toBe(new Date(BASE.getTime() + 86_400_000).toISOString())
    })

    it('falls through for completely invalid scheduleTime', () => {
      const result = computeNextRun(2, 'days', 'noon', BASE)
      expect(result).toBe(new Date(BASE.getTime() + 2 * 86_400_000).toISOString())
    })

    it('falls through for empty string scheduleTime', () => {
      const result = computeNextRun(1, 'days', '', BASE)
      expect(result).toBe(new Date(BASE.getTime() + 86_400_000).toISOString())
    })
  })
})
