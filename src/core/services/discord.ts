import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  SlashCommandBuilder,
  REST,
  Routes,
  Events,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  ComponentType,
} from 'discord.js'
import type {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  Message,
  TextChannel,
  StringSelectMenuInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js'
import type { DispatchRegistry } from '../dispatch'
import type { HandleRegistrar } from '../dispatch'
import type { AskUserQuestion, AskUserResponse } from '../types'
import { addBroadcastHandler } from '../utils/broadcast'
import { createLogger } from '../utils/logger'

const log = createLogger('discord')

// ─── State ───────────────────────────────────────────

let client: Client | null = null
let botDispatch: DispatchRegistry | null = null
let unsubscribeBroadcast: (() => void) | null = null
const channelConversations = new Map<string, number>() // channelId → conversationId

// ─── Binding persistence ─────────────────────────────

async function loadBindings(): Promise<void> {
  try {
    const settings = (await botDispatch!.get('settings:get')!()) as Record<string, string>
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
    await botDispatch!.get('settings:set')!('discord_channelBindings', JSON.stringify(obj))
  } catch (err) {
    log.error('Failed to persist channel bindings', err)
  }
}

// ─── Message splitting ──────────────────────────────

const DISCORD_MAX_LENGTH = 2000

// consumed by discord.test.ts + main/services/discord.test.ts (excluded). (suppressed below)
// fallow-ignore-next-line unused-export
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
    const conversations = (await botDispatch!.get('conversations:list')!()) as Array<{
      id: number
      title: string
    }>
    const filtered = conversations
      .filter((c) => c.title.toLowerCase().includes(focused.toLowerCase()))
      .slice(0, 25)
      .map((c) => ({ name: c.title.slice(0, 100), value: String(c.id) }))
    await interaction.respond(filtered)
  } catch (err) {
    log.error('Autocomplete error', err)
    await interaction.respond([])
  }
}

async function handleFolderAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  try {
    const focused = interaction.options.getFocused()
    const folders = (await botDispatch!.get('folders:list')!()) as Array<{
      id: number
      name: string
    }>
    const filtered = folders
      .filter((f) => f.name.toLowerCase().includes(focused.toLowerCase()))
      .slice(0, 25)
      .map((f) => ({ name: f.name.slice(0, 100), value: String(f.id) }))
    await interaction.respond(filtered)
  } catch (err) {
    log.error('Folder autocomplete error', err)
    await interaction.respond([])
  }
}

// ─── Whitelist check ────────────────────────────────

async function isUserAllowed(userId: string): Promise<boolean> {
  const settings = (await botDispatch!.get('settings:get')!()) as Record<string, string>
  const raw = settings.discord_userWhitelist
  if (!raw) return true // no whitelist configured = everyone allowed
  try {
    const whitelist = JSON.parse(raw) as string[]
    if (whitelist.length === 0) return true
    if (whitelist.includes('*')) return true // explicit wildcard = everyone allowed
    return whitelist.includes(userId)
  } catch {
    return false // malformed whitelist = fail closed, refuse everyone
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
    const conversation = (await botDispatch!.get('conversations:get')!(conversationId)) as {
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
    const conversation = (await botDispatch!.get('conversations:get')!(conversationId)) as {
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
    const conversation = (await botDispatch!.get('conversations:get')!(conversationId)) as {
      id: number
      title: string
      folder_id: number | null
    }
    const folders = (await botDispatch!.get('folders:list')!()) as Array<{
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
    const conversation = (await botDispatch!.get('conversations:create')!(title, folderId)) as {
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
    await botDispatch!.get('conversations:update')!(conversationId, { cleared_at: clearedAt, compact_summary: null })
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
    const result = (await botDispatch!.get('messages:compact')!(conversationId)) as {
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

// ─── AskUserQuestion handler ────────────────────────

const ASK_USER_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

function handleAskUserChunk(payload: Record<string, unknown>): void {
  const conversationId = payload.conversationId as number | undefined
  if (!conversationId) return

  // Reverse lookup: find the Discord channel bound to this conversation
  let targetChannelId: string | null = null
  for (const [channelId, convId] of channelConversations) {
    if (convId === conversationId) {
      targetChannelId = channelId
      break
    }
  }
  if (!targetChannelId) return

  const requestId = payload.requestId as string
  let questions: AskUserQuestion[]
  try {
    questions = JSON.parse(payload.questions as string) as AskUserQuestion[]
  } catch {
    log.error('Failed to parse ask_user questions')
    return
  }

  presentAskUser(targetChannelId, requestId, questions).catch((err) => {
    log.error('Failed to present ask_user', err)
  })
}

async function presentAskUser(
  channelId: string,
  requestId: string,
  questions: AskUserQuestion[],
): Promise<void> {
  if (!client || !botDispatch) return

  const channel = await client.channels.fetch(channelId)
  if (!channel || !('send' in channel)) return

  const textChannel = channel as TextChannel

  // Build embed with questions
  const embed = new EmbedBuilder()
    .setTitle('Question')
    .setColor(0x5865F2) // Discord blurple
    .setDescription(
      questions
        .map((q, i) => {
          const header = q.header ? `**${q.header}**\n` : ''
          const opts = q.options.length > 0
            ? '\n' + q.options.map((o) => `  • **${o.label}** — ${o.description}`).join('\n')
            : ''
          return `${questions.length > 1 ? `**${i + 1}.** ` : ''}${header}${q.question}${opts}`
        })
        .join('\n\n'),
    )

  // Build action rows
  const rows: ActionRowBuilder<any>[] = []

  // Collect indices of questions without options (need dedicated buttons)
  const textOnlyIndices: number[] = []

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    if (q.options.length === 0) {
      textOnlyIndices.push(i)
      continue
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId(`askuser_${requestId}_q${i}`)
      .setPlaceholder(q.header || q.question.slice(0, 100))

    for (const opt of q.options) {
      select.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel(opt.label.slice(0, 100))
          .setDescription(opt.description.slice(0, 100))
          .setValue(opt.label),
      )
    }

    // "Autre..." option for per-question free text
    select.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Autre...')
        .setDescription('Saisir une réponse libre')
        .setValue('__other__'),
    )

    if (q.multiSelect) {
      select.setMinValues(1)
      select.setMaxValues(q.options.length + 1) // +1 for "Autre..."
    }

    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select))
  }

  // Per-question buttons for text-only questions (no predefined options)
  if (textOnlyIndices.length > 0) {
    const buttons = textOnlyIndices.map((idx) =>
      new ButtonBuilder()
        .setCustomId(`askuser_text_${requestId}_q${idx}`)
        .setLabel((questions[idx].header || `Q${idx + 1}`).slice(0, 80))
        .setStyle(ButtonStyle.Secondary),
    )
    // Discord allows max 5 buttons per row
    for (let b = 0; b < buttons.length; b += 5) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(b, b + 5)))
    }
  }

  const msg = await textChannel.send({ embeds: [embed], components: rows })

  // Track answers — all questions must be answered (via select or button→modal)
  const answers: Record<string, string> = {}
  const totalRequired = questions.length
  let submitted = false

  function trySubmit(): void {
    if (submitted) return
    // Submit when all questions with options have been answered via select
    const answeredCount = Object.keys(answers).length
    if (answeredCount >= totalRequired) {
      doSubmit()
    }
  }

  async function doSubmit(): Promise<void> {
    if (submitted) return
    submitted = true

    try {
      await botDispatch!.get('messages:respondToApproval')!(requestId, { answers } as AskUserResponse)
    } catch (err) {
      log.error('Failed to submit ask_user response', err)
    }

    // Edit message to show submitted answers and remove components
    const answerSummary = Object.entries(answers)
      .map(([idx, val]) => `**${questions[Number(idx)]?.header || `Q${Number(idx) + 1}`}:** ${val}`)
      .join('\n')

    const doneEmbed = EmbedBuilder.from(embed)
      .setColor(0x57F287) // Green
      .setFooter({ text: 'Répondu' })

    await msg.edit({
      embeds: [doneEmbed],
      content: answerSummary || undefined,
      components: [],
    }).catch(() => {})
  }

  // Collector for select menus and buttons
  const collector = msg.createMessageComponentCollector({
    time: ASK_USER_TIMEOUT_MS,
  })

  collector.on('collect', async (interaction) => {
    if (submitted) return

    // Whitelist check
    if (!(await isUserAllowed(interaction.user.id))) {
      if (interaction.isRepliable()) {
        await interaction.reply({ content: 'Not authorized.', flags: MessageFlags.Ephemeral })
      }
      return
    }

    if (interaction.isStringSelectMenu()) {
      const selectInteraction = interaction as StringSelectMenuInteraction
      const match = selectInteraction.customId.match(/^askuser_[^_]+_q(\d+)$/)
      if (!match) return
      const qIndex = parseInt(match[1], 10)
      const selected = selectInteraction.values

      if (selected.includes('__other__')) {
        // Show modal for this specific question
        const modal = buildModalForQuestions(requestId, [questions[qIndex]], [qIndex])
        await selectInteraction.showModal(modal)
      } else {
        answers[String(qIndex)] = selected.join(', ')
        await selectInteraction.deferUpdate()
        trySubmit()
      }
    } else if (interaction.isButton()) {
      const buttonInteraction = interaction as ButtonInteraction
      // Per-question text button: askuser_text_{requestId}_q{index}
      const btnMatch = buttonInteraction.customId.match(/^askuser_text_[^_]+_q(\d+)$/)
      if (btnMatch) {
        const qIndex = parseInt(btnMatch[1], 10)
        const modal = buildModalForQuestions(requestId, [questions[qIndex]], [qIndex])
        await buttonInteraction.showModal(modal)
      }
    }
  })

  // Handle modal submissions (must be on client, not collector)
  const modalHandler = async (interaction: { isModalSubmit(): boolean; customId: string; fields: any; deferUpdate(): Promise<void>; user: { id: string } }) => {
    if (!interaction.isModalSubmit()) return
    const modalInteraction = interaction as unknown as ModalSubmitInteraction
    if (modalInteraction.customId !== `askuser_submit_${requestId}`) return
    if (submitted) return

    if (!(await isUserAllowed(modalInteraction.user.id))) return

    // Extract answers from modal fields
    for (let i = 0; i < questions.length; i++) {
      try {
        const value = modalInteraction.fields.getTextInputValue(`q${i}`)
        if (value) answers[String(i)] = value
      } catch {
        // Field not present in this modal
      }
    }

    await modalInteraction.deferUpdate().catch(() => {})
    doSubmit()

    // Clean up this handler
    client?.removeListener(Events.InteractionCreate, modalHandler as any)
  }

  client.on(Events.InteractionCreate, modalHandler as any)

  collector.on('end', async (_collected, reason) => {
    client?.removeListener(Events.InteractionCreate, modalHandler as any)

    if (reason === 'time' && !submitted) {
      // Timeout — unblock stream with empty answers
      submitted = true
      try {
        await botDispatch!.get('messages:respondToApproval')!(requestId, { answers: {} } as AskUserResponse)
      } catch {
        // Stream may have been aborted
      }
      const timeoutEmbed = EmbedBuilder.from(embed)
        .setColor(0xED4245) // Red
        .setFooter({ text: 'Timeout — pas de réponse' })
      await msg.edit({ embeds: [timeoutEmbed], components: [] }).catch(() => {})
    }
  })
}

function buildModalForQuestions(
  requestId: string,
  questions: AskUserQuestion[],
  indices: number[],
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`askuser_submit_${requestId}`)
    .setTitle('Réponse')

  // Discord modals support max 5 text inputs
  for (const idx of indices.slice(0, 5)) {
    const q = questions[indices.indexOf(idx)]
    if (!q) continue
    const input = new TextInputBuilder()
      .setCustomId(`q${idx}`)
      .setLabel((q.header || q.question || `Question ${idx + 1}`).slice(0, 45))
      .setStyle(TextInputStyle.Short)
      .setRequired(false)

    if (q.options.length > 0) {
      input.setPlaceholder(q.options.map((o) => o.label).join(', ').slice(0, 100))
    }

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
  }

  return modal
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
    if ('sendTyping' in message.channel) message.channel.sendTyping().catch(() => {})
  }, 8000)
  if ('sendTyping' in message.channel) await message.channel.sendTyping().catch(() => {})

  try {
    const result = (await botDispatch!.get('messages:send')!(conversationId, content)) as {
      content: string
    } | null
    const responseText = result?.content || '(No response)'
    const chunks = splitMessage(responseText)
    await message.reply(chunks[0])
    for (let i = 1; i < chunks.length; i++) {
      if ('send' in message.channel) await message.channel.send(chunks[i])
    }
  } catch (err) {
    await message.reply(`Error: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearInterval(typingInterval)
  }
}

// ─── Token resolution ───────────────────────────────

async function getTokenFromDb(): Promise<string | undefined> {
  if (!botDispatch) return undefined
  const settings = await botDispatch.get('settings:get')!() as Record<string, string>
  return settings.discord_botToken || undefined
}

// ─── Bot lifecycle ──────────────────────────────────

export interface BotStartOptions {
  dispatch: DispatchRegistry
  token?: string
}

export async function startBot(options: BotStartOptions): Promise<void> {
  botDispatch = options.dispatch
  const token = options.token
    || process.env.DISCORD_BOT_TOKEN
    || await getTokenFromDb()

  if (!token) {
    throw new Error('Discord bot token not configured')
  }

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
    log.info('Bot logged in', { tag: readyClient.user.tag })

    // Register global slash commands
    const rest = new REST({ version: '10' }).setToken(token)
    const commands = buildSlashCommands().map((c) => c.toJSON())
    try {
      await rest.put(Routes.applicationCommands(readyClient.user.id), { body: commands })
      log.info('Registered slash commands', { count: commands.length })
    } catch (err) {
      log.error('Failed to register slash commands', err)
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

  // Subscribe to broadcast events to intercept ask_user chunks
  unsubscribeBroadcast = addBroadcastHandler((channel, ...args) => {
    if (channel !== 'messages:stream') return
    const payload = args[0] as Record<string, unknown> | undefined
    if (payload?.type !== 'ask_user') return
    handleAskUserChunk(payload)
  })

  await client.login(token)
  await loadBindings()
}

// consumed by main/services/discord.test.ts (excluded). (suppressed below)
// fallow-ignore-next-line unused-export
export async function stopBot(): Promise<void> {
  unsubscribeBroadcast?.()
  unsubscribeBroadcast = null
  if (client) {
    client.destroy()
    client = null
  }
}

// consumed by main/services/discord.test.ts (excluded). (suppressed below)
// fallow-ignore-next-line unused-export
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

// consumed by discord.test.ts (excluded). (suppressed below)
// fallow-ignore-next-line unused-export
export function getChannelConversations(): Map<string, number> {
  return channelConversations
}

// consumed by discord.test.ts (excluded). (suppressed below)
// fallow-ignore-next-line unused-export
export { handleAskUserChunk as _handleAskUserChunk, buildModalForQuestions as _buildModalForQuestions }

// ─── IPC handlers ───────────────────────────────────

export function registerDiscordHandlers(registrar: HandleRegistrar, dispatch: DispatchRegistry): void {
  botDispatch = dispatch

  registrar.handle('discord:connect', async () => {
    const settings = (await dispatch.get('settings:get')!()) as Record<string, string>
    const token = settings.discord_botToken
    if (!token) {
      throw new Error('Discord bot token not configured')
    }
    await startBot({ dispatch, token })
  })

  registrar.handle('discord:disconnect', async () => {
    await stopBot()
  })

  registrar.handle('discord:status', async () => {
    return getBotStatus()
  })
}
