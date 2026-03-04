import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ──────────────────────────────────────────

const mockLogin = vi.fn()
const mockDestroy = vi.fn()
const mockIsReady = vi.fn(() => false)
const mockOn = vi.fn()
const mockOnce = vi.fn()
const eventHandlers = new Map<string, Function>()

const mockGuildsCache = { size: 3 }
const mockUser = { tag: 'TestBot#1234', id: '999' }

function MockClient() {
  const instance = {
    login: mockLogin,
    destroy: mockDestroy,
    isReady: mockIsReady,
    on: vi.fn((event: string, handler: Function) => {
      eventHandlers.set(event, handler)
      return instance
    }),
    once: vi.fn((event: string, handler: Function) => {
      eventHandlers.set(`once:${event}`, handler)
      return instance
    }),
    user: mockUser,
    guilds: { cache: mockGuildsCache },
  }
  return instance
}

const mockRestSetToken = vi.fn().mockReturnThis()
const mockRestPut = vi.fn().mockResolvedValue(undefined)

function MockREST() {
  return { setToken: mockRestSetToken, put: mockRestPut }
}

vi.mock('discord.js', () => ({
  Client: vi.fn(MockClient),
  GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 4 },
  MessageFlags: { Ephemeral: 64 },
  SlashCommandBuilder: vi.fn(() => {
    const builder = {
      setName: vi.fn().mockReturnThis(),
      setDescription: vi.fn().mockReturnThis(),
      addStringOption: vi.fn((fn: Function) => { fn(builder); return builder }),
      addIntegerOption: vi.fn((fn: Function) => { fn(builder); return builder }),
      setRequired: vi.fn().mockReturnThis(),
      setAutocomplete: vi.fn().mockReturnThis(),
      toJSON: vi.fn(() => ({})),
    }
    return builder
  }),
  REST: vi.fn(MockREST),
  Routes: { applicationCommands: vi.fn((id: string) => `/applications/${id}/commands`) },
  Events: {
    ClientReady: 'ready',
    InteractionCreate: 'interactionCreate',
    MessageCreate: 'messageCreate',
  },
}))

vi.mock('../ipc', () => ({
  ipcDispatch: new Map(),
}))

// ─── Imports (after mocks) ──────────────────────────

import {
  registerHandlers,
  startBot,
  stopBot,
  getBotStatus,
  splitMessage,
  getChannelConversations,
} from './discord'
import { ipcDispatch } from '../ipc'

// ─── Helpers ────────────────────────────────────────

function createMockIpcMain() {
  const handlers = new Map<string, (...args: any[]) => any>()
  return {
    handle: (channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler)
    },
    invoke: async (channel: string, ...args: any[]) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`No handler for ${channel}`)
      return handler({} as any, ...args)
    },
    handlers,
  }
}

// ─── Tests ──────────────────────────────────────────

describe('Discord service', () => {
  let ipc: ReturnType<typeof createMockIpcMain>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    eventHandlers.clear()
    ipcDispatch.clear()
    getChannelConversations().clear()
    ipc = createMockIpcMain()

    // Set up settings:get so auto-start check doesn't throw
    ipcDispatch.set('settings:get', vi.fn(async () => ({})))
    // Set up settings:set so persistBindings doesn't throw
    ipcDispatch.set('settings:set', vi.fn(async () => {}))
  })

  afterEach(async () => {
    await stopBot()
    vi.useRealTimers()
  })

  describe('registerHandlers', () => {
    it('registers 3 IPC channels', () => {
      registerHandlers(ipc as any)
      expect(ipc.handlers.has('discord:connect')).toBe(true)
      expect(ipc.handlers.has('discord:disconnect')).toBe(true)
      expect(ipc.handlers.has('discord:status')).toBe(true)
      expect(ipc.handlers.size).toBe(3)
    })
  })

  describe('discord:connect', () => {
    it('starts bot with token from settings', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_botToken: 'test-token-123' })),
      )
      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')
      expect(mockLogin).toHaveBeenCalledWith('test-token-123')
    })

    it('throws when token not configured', async () => {
      ipcDispatch.set('settings:get', vi.fn(async () => ({})))
      registerHandlers(ipc as any)
      await expect(ipc.invoke('discord:connect')).rejects.toThrow(
        'Discord bot token not configured',
      )
    })
  })

  describe('discord:disconnect', () => {
    it('destroys client', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_botToken: 'tok' })),
      )
      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')
      await ipc.invoke('discord:disconnect')
      expect(mockDestroy).toHaveBeenCalled()
    })
  })

  describe('discord:status', () => {
    it('returns disconnected when no client', async () => {
      registerHandlers(ipc as any)
      const status = await ipc.invoke('discord:status')
      expect(status).toEqual({ connected: false })
    })

    it('returns connected with info when client is ready', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_botToken: 'tok' })),
      )
      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')
      mockIsReady.mockReturnValue(true)
      const status = await ipc.invoke('discord:status')
      expect(status).toEqual({
        connected: true,
        username: 'TestBot#1234',
        guildCount: 3,
      })
    })
  })

  describe('auto-start', () => {
    it('auto-starts when enabled with token', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_enabled: 'true', discord_botToken: 'auto-token' })),
      )
      registerHandlers(ipc as any)
      // Flush the setTimeout(fn, 0)
      await vi.advanceTimersByTimeAsync(0)
      expect(mockLogin).toHaveBeenCalledWith('auto-token')
    })

    it('does not auto-start when disabled', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_enabled: 'false', discord_botToken: 'tok' })),
      )
      registerHandlers(ipc as any)
      await vi.advanceTimersByTimeAsync(0)
      expect(mockLogin).not.toHaveBeenCalled()
    })

    it('does not auto-start when token missing', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_enabled: 'true' })),
      )
      registerHandlers(ipc as any)
      await vi.advanceTimersByTimeAsync(0)
      expect(mockLogin).not.toHaveBeenCalled()
    })
  })

  describe('splitMessage', () => {
    it('returns single chunk for short messages', () => {
      expect(splitMessage('hello')).toEqual(['hello'])
    })

    it('returns single chunk at exactly 2000 chars', () => {
      const text = 'a'.repeat(2000)
      expect(splitMessage(text)).toEqual([text])
    })

    it('splits on last newline before limit', () => {
      // 1500 + \n + 1500 = 3001 chars total
      // First 2000 chars: 'a'*1500 + '\n' + 'a'*498 — lastNewline at 1500
      // Chunk 1: 'a'*1500 (1500 chars), remaining: 'a'*1500 (1500 chars)
      const part = 'a'.repeat(1500)
      const text = `${part}\n${part}`
      const chunks = splitMessage(text)
      expect(chunks.length).toBe(2)
      expect(chunks[0]).toBe(part)
      expect(chunks[1]).toBe(part)
    })

    it('hard splits when no newline found', () => {
      const text = 'a'.repeat(5000)
      const chunks = splitMessage(text)
      expect(chunks.length).toBe(3)
      expect(chunks[0].length).toBe(2000)
      expect(chunks[1].length).toBe(2000)
      expect(chunks[2].length).toBe(1000)
    })

    it('handles empty string', () => {
      expect(splitMessage('')).toEqual([''])
    })
  })

  describe('channel conversation tracking', () => {
    it('tracks per channel', () => {
      const map = getChannelConversations()
      map.set('channel1', 10)
      map.set('channel2', 20)
      expect(map.get('channel1')).toBe(10)
      expect(map.get('channel2')).toBe(20)
    })
  })

  describe('command handlers via interaction events', () => {
    it('set-conversation stores active conversation', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_botToken: 'tok' })),
      )
      ipcDispatch.set(
        'conversations:get',
        vi.fn(async (id: number) => ({ id, title: 'Test Convo' })),
      )

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      // Get the interactionCreate handler
      const handler = eventHandlers.get('interactionCreate')
      expect(handler).toBeDefined()

      const mockReply = vi.fn()
      const mockInteraction = {
        isAutocomplete: () => false,
        isChatInputCommand: () => true,
        commandName: 'set-conversation',
        channelId: 'channel-1',
        user: { id: 'discord-user-1' },
        options: {
          getString: vi.fn((name: string) => (name === 'conversation' ? '42' : null)),
          getInteger: vi.fn(() => null),
        },
        reply: mockReply,
      }

      await handler!(mockInteraction)
      expect(mockReply).toHaveBeenCalledWith('Active conversation for this channel set to: Test Convo')
      expect(getChannelConversations().get('channel-1')).toBe(42)
    })

    it('get-messages formats and returns messages', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_botToken: 'tok' })),
      )
      ipcDispatch.set(
        'conversations:get',
        vi.fn(async () => ({
          messages: [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' },
          ],
        })),
      )

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      getChannelConversations().set('channel-3', 55)

      const handler = eventHandlers.get('interactionCreate')
      const mockReply = vi.fn()
      const mockInteraction = {
        isAutocomplete: () => false,
        isChatInputCommand: () => true,
        commandName: 'get-messages',
        channelId: 'channel-3',
        user: { id: 'discord-user-3' },
        options: {
          getString: vi.fn(() => null),
          getInteger: vi.fn(() => 10),
        },
        reply: mockReply,
        followUp: vi.fn(),
      }

      await handler!(mockInteraction)
      expect(mockReply).toHaveBeenCalledWith('**user**: hi\n\n**assistant**: hello')
    })

    it('new-conversation creates and sets as active', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_botToken: 'tok' })),
      )
      ipcDispatch.set(
        'conversations:create',
        vi.fn(async () => ({ id: 77, title: 'My Discord Chat' })),
      )

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      const handler = eventHandlers.get('interactionCreate')
      const mockReply = vi.fn()
      const mockInteraction = {
        isAutocomplete: () => false,
        isChatInputCommand: () => true,
        commandName: 'new-conversation',
        channelId: 'channel-4',
        user: { id: 'discord-user-4' },
        options: {
          getString: vi.fn((name: string) => {
            if (name === 'folder') return '5'
            if (name === 'title') return 'My Discord Chat'
            return null
          }),
        },
        reply: mockReply,
      }

      await handler!(mockInteraction)
      expect(ipcDispatch.get('conversations:create')).toHaveBeenCalledWith('My Discord Chat', 5)
      expect(mockReply).toHaveBeenCalledWith(
        'Created conversation "My Discord Chat" (ID: 77) and set as active for this channel.',
      )
      expect(getChannelConversations().get('channel-4')).toBe(77)
    })

    it('check-conversation shows full folder path', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_botToken: 'tok' })),
      )
      ipcDispatch.set(
        'conversations:get',
        vi.fn(async () => ({ id: 42, title: 'My Chat', folder_id: 3 })),
      )
      ipcDispatch.set(
        'folders:list',
        vi.fn(async () => [
          { id: 1, name: 'Root', parent_id: null },
          { id: 2, name: 'Projects', parent_id: 1 },
          { id: 3, name: 'Work', parent_id: 2 },
        ]),
      )

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      getChannelConversations().set('channel-check', 42)

      const handler = eventHandlers.get('interactionCreate')
      const mockReply = vi.fn()
      const mockInteraction = {
        isAutocomplete: () => false,
        isChatInputCommand: () => true,
        commandName: 'check-conversation',
        channelId: 'channel-check',
        user: { id: 'user-check' },
        options: {},
        reply: mockReply,
      }

      await handler!(mockInteraction)
      expect(mockReply).toHaveBeenCalledWith('**Root / Projects / Work / My Chat** (ID: 42)')
    })

    it('check-conversation replies error when no binding', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_botToken: 'tok' })),
      )

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      const handler = eventHandlers.get('interactionCreate')
      const mockReply = vi.fn()
      const mockInteraction = {
        isAutocomplete: () => false,
        isChatInputCommand: () => true,
        commandName: 'check-conversation',
        channelId: 'channel-unbound',
        user: { id: 'user-check' },
        options: {},
        reply: mockReply,
      }

      await handler!(mockInteraction)
      expect(mockReply).toHaveBeenCalledWith({
        content: 'No conversation bound to this channel.',
        flags: 64,
      })
    })

    it('clear sets cleared_at on bound conversation', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_botToken: 'tok' })),
      )
      const mockUpdate = vi.fn(async () => {})
      ipcDispatch.set('conversations:update', mockUpdate)

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      getChannelConversations().set('channel-clear', 42)

      const handler = eventHandlers.get('interactionCreate')
      const mockReply = vi.fn()
      const mockInteraction = {
        isAutocomplete: () => false,
        isChatInputCommand: () => true,
        commandName: 'clear',
        channelId: 'channel-clear',
        user: { id: 'user-clear' },
        options: {},
        reply: mockReply,
      }

      await handler!(mockInteraction)
      expect(mockUpdate).toHaveBeenCalledWith(42, expect.objectContaining({
        cleared_at: expect.any(String),
        compact_summary: null,
      }))
      expect(mockReply).toHaveBeenCalledWith('Context cleared.')
    })

    it('clear replies error when no channel binding', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_botToken: 'tok' })),
      )

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      const handler = eventHandlers.get('interactionCreate')
      const mockReply = vi.fn()
      const mockInteraction = {
        isAutocomplete: () => false,
        isChatInputCommand: () => true,
        commandName: 'clear',
        channelId: 'channel-unbound',
        user: { id: 'user-clear' },
        options: {},
        reply: mockReply,
      }

      await handler!(mockInteraction)
      expect(mockReply).toHaveBeenCalledWith({
        content: 'No conversation bound to this channel.',
        flags: 64,
      })
    })

    it('compact defers reply and returns summary', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_botToken: 'tok' })),
      )
      ipcDispatch.set(
        'messages:compact',
        vi.fn(async () => ({ summary: 'This is a summary', clearedAt: '2026-01-01T00:00:00.000Z' })),
      )

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      getChannelConversations().set('channel-compact', 55)

      const handler = eventHandlers.get('interactionCreate')
      const mockDeferReply = vi.fn()
      const mockEditReply = vi.fn()
      const mockInteraction = {
        isAutocomplete: () => false,
        isChatInputCommand: () => true,
        commandName: 'compact',
        channelId: 'channel-compact',
        user: { id: 'user-compact' },
        options: {},
        reply: vi.fn(),
        deferReply: mockDeferReply,
        editReply: mockEditReply,
        followUp: vi.fn(),
      }

      await handler!(mockInteraction)
      expect(mockDeferReply).toHaveBeenCalled()
      expect(ipcDispatch.get('messages:compact')).toHaveBeenCalledWith(55)
      expect(mockEditReply).toHaveBeenCalledWith(
        'Context compacted.\n\n**Summary:**\nThis is a summary',
      )
    })

    it('compact replies error when no channel binding', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_botToken: 'tok' })),
      )

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      const handler = eventHandlers.get('interactionCreate')
      const mockReply = vi.fn()
      const mockInteraction = {
        isAutocomplete: () => false,
        isChatInputCommand: () => true,
        commandName: 'compact',
        channelId: 'channel-unbound',
        user: { id: 'user-compact' },
        options: {},
        reply: mockReply,
      }

      await handler!(mockInteraction)
      expect(mockReply).toHaveBeenCalledWith({
        content: 'No conversation bound to this channel.',
        flags: 64,
      })
    })

    it('compact handles empty summary', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_botToken: 'tok' })),
      )
      ipcDispatch.set(
        'messages:compact',
        vi.fn(async () => ({ summary: '', clearedAt: '2026-01-01T00:00:00.000Z' })),
      )

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      getChannelConversations().set('channel-compact', 55)

      const handler = eventHandlers.get('interactionCreate')
      const mockEditReply = vi.fn()
      const mockInteraction = {
        isAutocomplete: () => false,
        isChatInputCommand: () => true,
        commandName: 'compact',
        channelId: 'channel-compact',
        user: { id: 'user-compact' },
        options: {},
        reply: vi.fn(),
        deferReply: vi.fn(),
        editReply: mockEditReply,
        followUp: vi.fn(),
      }

      await handler!(mockInteraction)
      expect(mockEditReply).toHaveBeenCalledWith('Context compacted (no summary generated).')
    })

  })

  describe('channel binding persistence', () => {
    it('loads bindings from settings on startBot', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({
          discord_botToken: 'tok',
          discord_channelBindings: '{"ch-1":10,"ch-2":20}',
        })),
      )
      ipcDispatch.set('settings:set', vi.fn(async () => {}))

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      expect(getChannelConversations().get('ch-1')).toBe(10)
      expect(getChannelConversations().get('ch-2')).toBe(20)
    })

    it('persists bindings when set-conversation is used', async () => {
      const mockSettingsSet = vi.fn(async () => {})
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_botToken: 'tok' })),
      )
      ipcDispatch.set('settings:set', mockSettingsSet)
      ipcDispatch.set(
        'conversations:get',
        vi.fn(async (id: number) => ({ id, title: 'Test' })),
      )

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      const handler = eventHandlers.get('interactionCreate')
      await handler!({
        isAutocomplete: () => false,
        isChatInputCommand: () => true,
        commandName: 'set-conversation',
        channelId: 'ch-persist',
        user: { id: 'user-1' },
        options: { getString: vi.fn(() => '42') },
        reply: vi.fn(),
      })

      expect(mockSettingsSet).toHaveBeenCalledWith(
        'discord_channelBindings',
        expect.stringContaining('"ch-persist":42'),
      )
    })

    it('persists bindings when new-conversation is used', async () => {
      const mockSettingsSet = vi.fn(async () => {})
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_botToken: 'tok' })),
      )
      ipcDispatch.set('settings:set', mockSettingsSet)
      ipcDispatch.set(
        'conversations:create',
        vi.fn(async () => ({ id: 99, title: 'New' })),
      )

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      const handler = eventHandlers.get('interactionCreate')
      await handler!({
        isAutocomplete: () => false,
        isChatInputCommand: () => true,
        commandName: 'new-conversation',
        channelId: 'ch-new',
        user: { id: 'user-1' },
        options: {
          getString: vi.fn((name: string) => {
            if (name === 'folder') return '1'
            if (name === 'title') return 'New'
            return null
          }),
        },
        reply: vi.fn(),
      })

      expect(mockSettingsSet).toHaveBeenCalledWith(
        'discord_channelBindings',
        expect.stringContaining('"ch-new":99'),
      )
    })

    it('handles missing bindings gracefully', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_botToken: 'tok' })),
      )
      ipcDispatch.set('settings:set', vi.fn(async () => {}))

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      expect(getChannelConversations().size).toBe(0)
    })
  })

  describe('autocomplete handling', () => {
    it('responds with filtered conversation list', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_botToken: 'tok' })),
      )
      ipcDispatch.set(
        'conversations:list',
        vi.fn(async () => [
          { id: 1, title: 'Alpha Chat' },
          { id: 2, title: 'Beta Chat' },
          { id: 3, title: 'Gamma Talk' },
        ]),
      )

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      const handler = eventHandlers.get('interactionCreate')
      const mockRespond = vi.fn()
      const mockInteraction = {
        isAutocomplete: () => true,
        isChatInputCommand: () => false,
        commandName: 'set-conversation',
        user: { id: 'autocomplete-user' },
        options: {
          getFocused: vi.fn(() => 'chat'),
        },
        respond: mockRespond,
      }

      await handler!(mockInteraction)
      expect(mockRespond).toHaveBeenCalledWith([
        { name: 'Alpha Chat', value: '1' },
        { name: 'Beta Chat', value: '2' },
      ])
    })

    it('responds with filtered folder list for new-conversation', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_botToken: 'tok' })),
      )
      ipcDispatch.set(
        'folders:list',
        vi.fn(async () => [
          { id: 1, name: 'Work' },
          { id: 2, name: 'Personal' },
          { id: 3, name: 'Work Projects' },
        ]),
      )

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      const handler = eventHandlers.get('interactionCreate')
      const mockRespond = vi.fn()
      const mockInteraction = {
        isAutocomplete: () => true,
        isChatInputCommand: () => false,
        commandName: 'new-conversation',
        user: { id: 'autocomplete-user' },
        options: {
          getFocused: vi.fn((...args: any[]) => {
            if (args[0] === true) return { name: 'folder', value: 'work' }
            return 'work'
          }),
        },
        respond: mockRespond,
      }

      await handler!(mockInteraction)
      expect(mockRespond).toHaveBeenCalledWith([
        { name: 'Work', value: '1' },
        { name: 'Work Projects', value: '3' },
      ])
    })

    it('limits autocomplete to 25 results', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_botToken: 'tok' })),
      )
      const manyConversations = Array.from({ length: 50 }, (_, i) => ({
        id: i,
        title: `Conversation ${i}`,
      }))
      ipcDispatch.set(
        'conversations:list',
        vi.fn(async () => manyConversations),
      )

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      const handler = eventHandlers.get('interactionCreate')
      const mockRespond = vi.fn()
      const mockInteraction = {
        isAutocomplete: () => true,
        isChatInputCommand: () => false,
        commandName: 'set-conversation',
        user: { id: 'autocomplete-user' },
        options: {
          getFocused: vi.fn(() => 'Conversation'),
        },
        respond: mockRespond,
      }

      await handler!(mockInteraction)
      expect(mockRespond.mock.calls[0][0].length).toBe(25)
    })
  })

  describe('user whitelist', () => {
    it('blocks unauthorized users from commands', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({
          discord_botToken: 'tok',
          discord_userWhitelist: '["allowed-user-1"]',
        })),
      )

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      const handler = eventHandlers.get('interactionCreate')
      const mockReply = vi.fn()
      const mockInteraction = {
        isAutocomplete: () => false,
        isChatInputCommand: () => true,
        commandName: 'set-conversation',
        user: { id: 'blocked-user' },
        options: { getString: vi.fn(() => '1') },
        reply: mockReply,
      }

      await handler!(mockInteraction)
      expect(mockReply).toHaveBeenCalledWith({
        content: 'You are not authorized to use this bot.',
        flags: 64,
      })
    })

    it('allows whitelisted users', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({
          discord_botToken: 'tok',
          discord_userWhitelist: '["allowed-user-1"]',
        })),
      )
      ipcDispatch.set(
        'conversations:get',
        vi.fn(async (id: number) => ({ id, title: 'Test' })),
      )

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      const handler = eventHandlers.get('interactionCreate')
      const mockReply = vi.fn()
      const mockInteraction = {
        isAutocomplete: () => false,
        isChatInputCommand: () => true,
        commandName: 'set-conversation',
        channelId: 'channel-allowed',
        user: { id: 'allowed-user-1' },
        options: { getString: vi.fn(() => '42') },
        reply: mockReply,
      }

      await handler!(mockInteraction)
      expect(mockReply).toHaveBeenCalledWith('Active conversation for this channel set to: Test')
    })

    it('allows everyone when whitelist is empty', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({
          discord_botToken: 'tok',
          discord_userWhitelist: '[]',
        })),
      )
      ipcDispatch.set(
        'conversations:get',
        vi.fn(async (id: number) => ({ id, title: 'Open' })),
      )

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      const handler = eventHandlers.get('interactionCreate')
      const mockReply = vi.fn()
      const mockInteraction = {
        isAutocomplete: () => false,
        isChatInputCommand: () => true,
        commandName: 'set-conversation',
        channelId: 'channel-anyone',
        user: { id: 'anyone' },
        options: { getString: vi.fn(() => '1') },
        reply: mockReply,
      }

      await handler!(mockInteraction)
      expect(mockReply).toHaveBeenCalledWith('Active conversation for this channel set to: Open')
    })

    it('returns empty autocomplete for blocked users', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({
          discord_botToken: 'tok',
          discord_userWhitelist: '["allowed-only"]',
        })),
      )

      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')

      const handler = eventHandlers.get('interactionCreate')
      const mockRespond = vi.fn()
      const mockInteraction = {
        isAutocomplete: () => true,
        isChatInputCommand: () => false,
        commandName: 'set-conversation',
        user: { id: 'blocked-user' },
        options: { getFocused: vi.fn(() => '') },
        respond: mockRespond,
      }

      await handler!(mockInteraction)
      expect(mockRespond).toHaveBeenCalledWith([])
    })
  })

  describe('startBot / stopBot lifecycle', () => {
    it('startBot creates client and logs in', async () => {
      await startBot('my-token')
      expect(mockLogin).toHaveBeenCalledWith('my-token')
    })

    it('stopBot destroys client', async () => {
      await startBot('my-token')
      await stopBot()
      expect(mockDestroy).toHaveBeenCalled()
    })

    it('stopBot is safe to call without client', async () => {
      await expect(stopBot()).resolves.toBeUndefined()
    })

    it('startBot destroys existing client before creating new one', async () => {
      await startBot('token-1')
      await startBot('token-2')
      expect(mockDestroy).toHaveBeenCalledTimes(1)
      expect(mockLogin).toHaveBeenCalledTimes(2)
    })
  })

  describe('getBotStatus', () => {
    it('returns disconnected when no client exists', () => {
      expect(getBotStatus()).toEqual({ connected: false })
    })

    it('returns connected with details when client is ready', async () => {
      await startBot('tok')
      mockIsReady.mockReturnValue(true)
      expect(getBotStatus()).toEqual({
        connected: true,
        username: 'TestBot#1234',
        guildCount: 3,
      })
    })
  })

  describe('messageCreate handler', () => {
    async function setupBot() {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({ discord_botToken: 'tok' })),
      )
      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')
      return eventHandlers.get('messageCreate')!
    }

    function createMockMessage(overrides: Record<string, any> = {}) {
      return {
        author: { bot: false, id: 'user-1' },
        mentions: {
          has: vi.fn(() => true),
          repliedUser: null,
        },
        reference: null,
        channelId: 'channel-1',
        content: '<@999> hello world',
        reply: vi.fn(),
        channel: {
          send: vi.fn(),
          sendTyping: vi.fn().mockResolvedValue(undefined),
        },
        ...overrides,
      }
    }

    it('ignores bot messages', async () => {
      const handler = await setupBot()
      const msg = createMockMessage({ author: { bot: true, id: 'bot-1' } })
      await handler(msg)
      expect(msg.reply).not.toHaveBeenCalled()
    })

    it('ignores messages without mention or reply', async () => {
      const handler = await setupBot()
      const msg = createMockMessage({
        mentions: { has: vi.fn(() => false), repliedUser: null },
        reference: null,
      })
      await handler(msg)
      expect(msg.reply).not.toHaveBeenCalled()
    })

    it('responds to bot mention', async () => {
      const handler = await setupBot()
      getChannelConversations().set('channel-1', 42)
      ipcDispatch.set('messages:send', vi.fn(async () => ({ content: 'AI says hi' })))

      const msg = createMockMessage()
      await handler(msg)
      expect(msg.reply).toHaveBeenCalledWith('AI says hi')
    })

    it('responds to reply-to-bot', async () => {
      const handler = await setupBot()
      getChannelConversations().set('channel-1', 42)
      ipcDispatch.set('messages:send', vi.fn(async () => ({ content: 'reply response' })))

      const msg = createMockMessage({
        content: 'hello world',
        mentions: {
          has: vi.fn(() => false),
          repliedUser: { id: '999' },
        },
        reference: {},
      })
      await handler(msg)
      expect(msg.reply).toHaveBeenCalledWith('reply response')
    })

    it('silently ignores non-whitelisted users', async () => {
      ipcDispatch.set(
        'settings:get',
        vi.fn(async () => ({
          discord_botToken: 'tok',
          discord_userWhitelist: '["allowed-only"]',
        })),
      )
      registerHandlers(ipc as any)
      await ipc.invoke('discord:connect')
      const handler = eventHandlers.get('messageCreate')!

      const msg = createMockMessage({ author: { bot: false, id: 'blocked-user' } })
      await handler(msg)
      expect(msg.reply).not.toHaveBeenCalled()
    })

    it('replies with error when no channel binding', async () => {
      const handler = await setupBot()
      const msg = createMockMessage()
      await handler(msg)
      expect(msg.reply).toHaveBeenCalledWith(
        'No conversation bound to this channel. Use `/set-conversation` first.',
      )
    })

    it('strips bot mention from content', async () => {
      const handler = await setupBot()
      getChannelConversations().set('channel-1', 42)
      const mockSend = vi.fn(async () => ({ content: 'ok' }))
      ipcDispatch.set('messages:send', mockSend)

      const msg = createMockMessage({ content: '<@999> what is 2+2' })
      await handler(msg)
      expect(mockSend).toHaveBeenCalledWith(42, 'what is 2+2')
    })

    it('sends typing indicator and handles AI response', async () => {
      const handler = await setupBot()
      getChannelConversations().set('channel-1', 42)
      ipcDispatch.set('messages:send', vi.fn(async () => ({ content: 'response' })))

      const msg = createMockMessage()
      await handler(msg)
      expect(msg.channel.sendTyping).toHaveBeenCalled()
      expect(msg.reply).toHaveBeenCalledWith('response')
    })
  })
})
