import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  SlashCommandBuilder,
  REST,
  Routes,
  Events,
} from 'discord.js'
import type { IpcMain } from 'electron'
import type { ChatInputCommandInteraction, AutocompleteInteraction, Message } from 'discord.js'
import { ipcDispatch } from '../ipc'

// ─── State ───────────────────────────────────────────

let client: Client | null = null
const channelConversations = new Map<string, number>() // channelId → conversationId

// ─── Binding persistence ─────────────────────────────

async function loadBindings(): Promise<void> {
  try {
    const settings = (await ipcDispatch.get('settings:get')!()) as Record<string, string>
    const raw = settings.discord_channelBindings
    if (!raw) return
    const entries = JSON.parse(raw) as Record<string, number>
    channelConversations.clear()
    for (const [channelId, conversationId] of Object.entries(entries)) {
      channelConversations.set(channelId, conversationId)
    }
  } catch {
    // Parse error or missing — start with empty bindings
  }
}

async function persistBindings(): Promise<void> {
  try {
    const obj: Record<string, number> = {}
    for (const [k, v] of channelConversations) obj[k] = v
    await ipcDispatch.get('settings:set')!('discord_channelBindings', JSON.stringify(obj))
  } catch (err) {
    console.error('[discord] Failed to persist channel bindings:', err)
  }
}

// ─── Message splitting ──────────────────────────────

const DISCORD_MAX_LENGTH = 2000

export function splitMessage(text: string): string[] {
  if (text.length <= DISCORD_MAX_LENGTH) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MAX_LENGTH) {
      chunks.push(remaining)
      break
    }
    // Try to split on the last newline before the limit
    const slice = remaining.slice(0, DISCORD_MAX_LENGTH)
    const lastNewline = slice.lastIndexOf('\n')
    const splitAt = lastNewline > 0 ? lastNewline : DISCORD_MAX_LENGTH
    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt === lastNewline ? splitAt + 1 : splitAt)
  }
  return chunks
}

// ─── Slash command definitions ──────────────────────

function buildSlashCommands() {
  return [
    new SlashCommandBuilder()
      .setName('set-conversation')
      .setDescription('Set the active conversation for this channel')
      .addStringOption((opt) =>
        opt
          .setName('conversation')
          .setDescription('Conversation to set as active')
          .setRequired(true)
          .setAutocomplete(true),
      ),
    new SlashCommandBuilder()
      .setName('get-messages')
      .setDescription('Get recent messages from a conversation')
      .addStringOption((opt) =>
        opt
          .setName('conversation')
          .setDescription('Conversation to get messages from (uses active if not set)')
          .setRequired(false)
          .setAutocomplete(true),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('count')
          .setDescription('Number of messages to retrieve (default: 10)')
          .setRequired(false),
      ),
    new SlashCommandBuilder()
      .setName('check-conversation')
      .setDescription('Show the conversation bound to this channel'),
    new SlashCommandBuilder()
      .setName('clear')
      .setDescription('Clear AI context for the active conversation (messages stay visible)'),
    new SlashCommandBuilder()
      .setName('compact')
      .setDescription('Summarize and compact the active conversation context'),
    new SlashCommandBuilder()
      .setName('new-conversation')
      .setDescription('Create a new conversation')
      .addStringOption((opt) =>
        opt
          .setName('folder')
          .setDescription('Folder to create conversation in')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((opt) =>
        opt
          .setName('title')
          .setDescription('Conversation title (optional)')
          .setRequired(false),
      ),
  ]
}

// ─── Autocomplete helpers ───────────────────────────

async function handleConversationAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  try {
    const focused = interaction.options.getFocused()
    const conversations = (await ipcDispatch.get('conversations:list')!()) as Array<{
      id: number
      title: string
    }>
    const filtered = conversations
      .filter((c) => c.title.toLowerCase().includes(focused.toLowerCase()))
      .slice(0, 25)
      .map((c) => ({ name: c.title.slice(0, 100), value: String(c.id) }))
    await interaction.respond(filtered)
  } catch (err) {
    console.error('[discord] Autocomplete error:', err)
    await interaction.respond([])
  }
}

async function handleFolderAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  try {
    const focused = interaction.options.getFocused()
    const folders = (await ipcDispatch.get('folders:list')!()) as Array<{
      id: number
      name: string
    }>
    const filtered = folders
      .filter((f) => f.name.toLowerCase().includes(focused.toLowerCase()))
      .slice(0, 25)
      .map((f) => ({ name: f.name.slice(0, 100), value: String(f.id) }))
    await interaction.respond(filtered)
  } catch (err) {
    console.error('[discord] Folder autocomplete error:', err)
    await interaction.respond([])
  }
}

// ─── Whitelist check ────────────────────────────────

async function isUserAllowed(userId: string): Promise<boolean> {
  try {
    const settings = (await ipcDispatch.get('settings:get')!()) as Record<string, string>
    const raw = settings.discord_userWhitelist
    if (!raw) return true // no whitelist = everyone allowed
    const whitelist = JSON.parse(raw) as string[]
    if (whitelist.length === 0) return true
    return whitelist.includes(userId)
  } catch {
    return true // on parse error, fail open
  }
}

// ─── Command handlers ───────────────────────────────

async function handleSetConversation(interaction: ChatInputCommandInteraction): Promise<void> {
  const conversationId = parseInt(interaction.options.getString('conversation', true), 10)
  if (isNaN(conversationId)) {
    await interaction.reply({ content: 'Invalid conversation ID.', flags: MessageFlags.Ephemeral })
    return
  }
  try {
    const conversation = (await ipcDispatch.get('conversations:get')!(conversationId)) as {
      id: number
      title: string
    }
    channelConversations.set(interaction.channelId, conversation.id)
    await persistBindings()
    await interaction.reply(`Active conversation for this channel set to: ${conversation.title}`)
  } catch (err) {
    await interaction.reply({
      content: `Error: ${err instanceof Error ? err.message : String(err)}`,
      flags: MessageFlags.Ephemeral,
    })
  }
}

async function handleGetMessages(interaction: ChatInputCommandInteraction): Promise<void> {
  const conversationOpt = interaction.options.getString('conversation')
  const count = interaction.options.getInteger('count') ?? 10
  const conversationId = conversationOpt
    ? parseInt(conversationOpt, 10)
    : channelConversations.get(interaction.channelId)

  if (!conversationId) {
    await interaction.reply({
      content: 'No active conversation. Use `/set-conversation` first or specify one.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  try {
    const conversation = (await ipcDispatch.get('conversations:get')!(conversationId)) as {
      messages: Array<{ role: string; content: string }>
    }
    const messages = conversation.messages.slice(-count)
    if (messages.length === 0) {
      await interaction.reply('No messages in this conversation.')
      return
    }

    const formatted = messages
      .map((m) => `**${m.role}**: ${m.content}`)
      .join('\n\n')

    const chunks = splitMessage(formatted)
    await interaction.reply(chunks[0])
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp(chunks[i])
    }
  } catch (err) {
    await interaction.reply({
      content: `Error: ${err instanceof Error ? err.message : String(err)}`,
      flags: MessageFlags.Ephemeral,
    })
  }
}

async function handleCheckConversation(interaction: ChatInputCommandInteraction): Promise<void> {
  const conversationId = channelConversations.get(interaction.channelId)
  if (!conversationId) {
    await interaction.reply({ content: 'No conversation bound to this channel.', flags: MessageFlags.Ephemeral })
    return
  }

  try {
    const conversation = (await ipcDispatch.get('conversations:get')!(conversationId)) as {
      id: number
      title: string
      folder_id: number | null
    }
    const folders = (await ipcDispatch.get('folders:list')!()) as Array<{
      id: number
      name: string
      parent_id: number | null
    }>
    const foldersById = new Map(folders.map((f) => [f.id, f]))

    // Walk folder hierarchy up to root
    const path: string[] = []
    let currentFolderId = conversation.folder_id
    while (currentFolderId) {
      const folder = foldersById.get(currentFolderId)
      if (!folder) break
      path.unshift(folder.name)
      currentFolderId = folder.parent_id
    }
    path.push(conversation.title)

    await interaction.reply(`**${path.join(' / ')}** (ID: ${conversation.id})`)
  } catch (err) {
    await interaction.reply({
      content: `Error: ${err instanceof Error ? err.message : String(err)}`,
      flags: MessageFlags.Ephemeral,
    })
  }
}

async function handleNewConversation(interaction: ChatInputCommandInteraction): Promise<void> {
  const folderId = parseInt(interaction.options.getString('folder', true), 10)
  const title = interaction.options.getString('title') || 'Discord conversation'

  if (isNaN(folderId)) {
    await interaction.reply({ content: 'Invalid folder ID.', flags: MessageFlags.Ephemeral })
    return
  }

  try {
    const conversation = (await ipcDispatch.get('conversations:create')!(title, folderId)) as {
      id: number
      title: string
    }
    channelConversations.set(interaction.channelId, conversation.id)
    await persistBindings()
    await interaction.reply(
      `Created conversation "${conversation.title}" (ID: ${conversation.id}) and set as active for this channel.`,
    )
  } catch (err) {
    await interaction.reply({
      content: `Error: ${err instanceof Error ? err.message : String(err)}`,
      flags: MessageFlags.Ephemeral,
    })
  }
}

async function handleClear(interaction: ChatInputCommandInteraction): Promise<void> {
  const conversationId = channelConversations.get(interaction.channelId)
  if (!conversationId) {
    await interaction.reply({ content: 'No conversation bound to this channel.', flags: MessageFlags.Ephemeral })
    return
  }

  try {
    const clearedAt = new Date().toISOString()
    await ipcDispatch.get('conversations:update')!(conversationId, { cleared_at: clearedAt, compact_summary: null })
    await interaction.reply('Context cleared.')
  } catch (err) {
    await interaction.reply({
      content: `Error: ${err instanceof Error ? err.message : String(err)}`,
      flags: MessageFlags.Ephemeral,
    })
  }
}

async function handleCompact(interaction: ChatInputCommandInteraction): Promise<void> {
  const conversationId = channelConversations.get(interaction.channelId)
  if (!conversationId) {
    await interaction.reply({ content: 'No conversation bound to this channel.', flags: MessageFlags.Ephemeral })
    return
  }

  try {
    await interaction.deferReply()
    const result = (await ipcDispatch.get('messages:compact')!(conversationId)) as {
      summary: string
      clearedAt: string
    }
    const text = result.summary
      ? `Context compacted.\n\n**Summary:**\n${result.summary}`
      : 'Context compacted (no summary generated).'
    const chunks = splitMessage(text)
    await interaction.editReply(chunks[0])
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp(chunks[i])
    }
  } catch (err) {
    await interaction.editReply(`Error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ─── Message handler ────────────────────────────────

async function handleMessage(message: Message): Promise<void> {
  // Ignore bots (including self)
  if (message.author.bot) return

  // Only respond to mentions or replies to bot
  const isMention = client?.user != null && message.mentions.has(client.user)
  const isReplyToBot =
    message.reference != null && message.mentions.repliedUser?.id === client?.user?.id
  if (!isMention && !isReplyToBot) return

  // Whitelist guard — block silently
  if (!(await isUserAllowed(message.author.id))) return

  // Lookup channel binding
  const conversationId = channelConversations.get(message.channelId)
  if (!conversationId) {
    await message.reply('No conversation bound to this channel. Use `/set-conversation` first.')
    return
  }

  // Strip bot mention from content
  const botId = client?.user?.id
  const content = botId
    ? message.content.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim()
    : message.content.trim()

  if (!content) {
    await message.reply('Please include a message after the mention.')
    return
  }

  // Typing indicator — sendTyping expires after ~10s, refresh every 8s
  const typingInterval = setInterval(() => {
    message.channel.sendTyping().catch(() => {})
  }, 8000)
  await message.channel.sendTyping().catch(() => {})

  try {
    const result = (await ipcDispatch.get('messages:send')!(conversationId, content)) as {
      content: string
    } | null
    const responseText = result?.content || '(No response)'
    const chunks = splitMessage(responseText)
    await message.reply(chunks[0])
    for (let i = 1; i < chunks.length; i++) {
      await message.channel.send(chunks[i])
    }
  } catch (err) {
    await message.reply(`Error: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearInterval(typingInterval)
  }
}

// ─── Bot lifecycle ──────────────────────────────────

export async function startBot(token: string): Promise<void> {
  if (client) {
    await stopBot()
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  })

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[discord] Bot logged in as ${readyClient.user.tag}`)

    // Register global slash commands
    const rest = new REST({ version: '10' }).setToken(token)
    const commands = buildSlashCommands().map((c) => c.toJSON())
    try {
      await rest.put(Routes.applicationCommands(readyClient.user.id), { body: commands })
      console.log(`[discord] Registered ${commands.length} slash commands`)
    } catch (err) {
      console.error('[discord] Failed to register slash commands:', err)
    }
  })

  client.on(Events.InteractionCreate, async (interaction) => {
    // Whitelist guard — block unauthorized users from all interactions
    if (!(await isUserAllowed(interaction.user.id))) {
      if (interaction.isAutocomplete()) {
        await interaction.respond([])
        return
      }
      if (interaction.isChatInputCommand()) {
        await interaction.reply({ content: 'You are not authorized to use this bot.', flags: MessageFlags.Ephemeral })
        return
      }
      return
    }

    if (interaction.isAutocomplete()) {
      const commandName = interaction.commandName
      if (commandName === 'new-conversation') {
        const focused = interaction.options.getFocused(true)
        if (focused.name === 'folder') {
          await handleFolderAutocomplete(interaction)
        } else {
          await handleConversationAutocomplete(interaction)
        }
      } else {
        await handleConversationAutocomplete(interaction)
      }
      return
    }

    if (!interaction.isChatInputCommand()) return

    switch (interaction.commandName) {
      case 'set-conversation':
        await handleSetConversation(interaction)
        break
      case 'get-messages':
        await handleGetMessages(interaction)
        break
      case 'check-conversation':
        await handleCheckConversation(interaction)
        break
      case 'new-conversation':
        await handleNewConversation(interaction)
        break
      case 'clear':
        await handleClear(interaction)
        break
      case 'compact':
        await handleCompact(interaction)
        break
    }
  })

  client.on(Events.MessageCreate, handleMessage)

  await client.login(token)
  await loadBindings()
}

export async function stopBot(): Promise<void> {
  if (client) {
    client.destroy()
    client = null
  }
}

export function getBotStatus(): { connected: boolean; username?: string; guildCount?: number } {
  if (!client || !client.isReady()) {
    return { connected: false }
  }
  return {
    connected: true,
    username: client.user?.tag,
    guildCount: client.guilds.cache.size,
  }
}

// Exported for testing
export function getChannelConversations(): Map<string, number> {
  return channelConversations
}

// ─── IPC handlers ───────────────────────────────────

export function registerHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('discord:connect', async () => {
    const settings = (await ipcDispatch.get('settings:get')!()) as Record<string, string>
    const token = settings.discord_botToken
    if (!token) {
      throw new Error('Discord bot token not configured')
    }
    await startBot(token)
  })

  ipcMain.handle('discord:disconnect', async () => {
    await stopBot()
  })

  ipcMain.handle('discord:status', async () => {
    return getBotStatus()
  })

  // Auto-start if enabled (TASK-043)
  setTimeout(async () => {
    try {
      const getSettings = ipcDispatch.get('settings:get')
      if (!getSettings) return
      const settings = (await getSettings()) as Record<string, string>
      if (settings.discord_enabled === 'true' && settings.discord_botToken) {
        await startBot(settings.discord_botToken)
      }
    } catch (err) {
      console.error('[discord] Auto-start failed:', err)
    }
  }, 0)
}
