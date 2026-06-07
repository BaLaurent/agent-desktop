import { useCallback, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { MessageList } from '../../components/chat/MessageList'
import { MessageInput } from '../../components/chat/MessageInput'
import type { MessageInputHandle } from '../../components/chat/MessageInput'
import { VoiceInputButton } from '../../components/chat/VoiceInputButton'
import { ChatStatusLine } from '../../components/chat/ChatStatusLine'
import { useCompactMode } from '../../hooks/useMobileMode'
import { useChatStore } from '../../stores/chatStore'
import { useShallow } from 'zustand/react/shallow'
import { useAuthStore } from '../../stores/authStore'
import { usePiExtensionUIStore } from '../../stores/piExtensionUIStore'
import { parseCustomModels } from '../../../shared/constants'
import { ChatAttachmentsPreview, ChatAttachmentsUpload, useAttachmentPaste } from './ChatAttachments'
import { ChatQueuePanelContainer, useHasQueuedMessages } from './ChatQueuePanel'
import { ChatExtensionWidgets } from './ChatOverlays'
import type { Attachment, AIOverrides } from '../../../shared/types'
import type { TaskNotification } from '../../stores/chatStore'

const EMPTY_TASK_NOTIFICATIONS: TaskNotification[] = []

interface MessageInputDeps {
  cwd: string
  excludePatterns: string[]
  skillsMode: 'off' | 'auto' | string
  disabledSkills: string[]
  externalText: { id: number; text: string } | undefined
}

interface ChatLayoutProps {
  conversationId: number
  // Effective cascade values resolved once in the orchestrator.
  effectiveModel: string
  effectivePermissionMode: string
  effectiveBackend: string
  effectiveTtsResponseMode: string | undefined
  effectiveAgentName: string | undefined
  effectiveSdkBackend: string | undefined
  globalSettings: Record<string, string>
  // ChatStatusLine inputs.
  mcpServerEntries: { name: string; active: boolean }[]
  kbCollectionEntries: { name: string; selected: boolean; access: 'read' | 'readwrite' }[]
  contextUsed: number | null
  contextWindow: number
  // Attachments (state owned by the orchestrator — see ChatAttachments.tsx).
  attachments: Attachment[]
  setAttachments: (next: Attachment[] | ((prev: Attachment[]) => Attachment[])) => void
  // Effective settings the input row needs.
  inputDeps: MessageInputDeps
  // Cascade-mutating callbacks delegated up.
  convOverrides: AIOverrides
  saveConversationOverrides: (next: AIOverrides) => void
  // Render-only refs/handlers passed down by the orchestrator.
  onEditMessage: (messageId: number, content: string) => void
  onRegenerate: () => void
  onFork: (messageId: number) => Promise<void> | void
  onStopGeneration: (conversationId: number) => void
}

/**
 * Main chat-body wrapper: header-less core column with messages → attachments
 * preview → queue → status line → input. Owns the slash-command dispatcher
 * (handleSend) because the dispatcher logically lives next to MessageInput,
 * not in the orchestrator.
 *
 * Reads chatStore directly with granular selectors for streaming/loading
 * state — these change frequently and we don't want each tick to re-render
 * the orchestrator. Mutating cascades go back up via saveConversationOverrides
 * (the orchestrator owns the conversations store).
 */
export function ChatLayout(props: ChatLayoutProps) {
  const {
    conversationId, effectiveModel, effectivePermissionMode, effectiveBackend,
    effectiveTtsResponseMode, effectiveAgentName, effectiveSdkBackend,
    globalSettings, mcpServerEntries, kbCollectionEntries,
    contextUsed, contextWindow,
    attachments, setAttachments, inputDeps,
    convOverrides, saveConversationOverrides,
    onEditMessage, onRegenerate, onFork, onStopGeneration,
  } = props

  const compact = useCompactMode()
  const { isAuthenticated } = useAuthStore()

  // Granular selectors — preserved from original ChatView locality.
  const messages = useChatStore((s) => s.messages)
  const clearedAt = useChatStore((s) => s.clearedAt)
  const compactSummary = useChatStore((s) => s.compactSummary)
  const isCompacting = useChatStore((s) => s.isCompacting)
  const contextDisplay = useChatStore((s) => s.contextDisplay)
  const dismissContextInfo = useChatStore((s) => s.dismissContextInfo)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const streamParts = useChatStore((s) => s.streamParts)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const isLoading = useChatStore((s) => s.isLoading)

  const taskNotificationsRaw = useChatStore((s) => s.taskNotifications[conversationId])
  const taskNotifications = taskNotificationsRaw ?? EMPTY_TASK_NOTIFICATIONS

  // Action selectors — useShallow so destructured handlers stay stable.
  const actions = useChatStore(useShallow((s) => ({
    sendMessage: s.sendMessage,
    addToQueue: s.addToQueue,
    clearContext: s.clearContext,
    compactContext: s.compactContext,
    showContextInfo: s.showContextInfo,
  })))
  const { sendMessage, addToQueue, clearContext, compactContext, showContextInfo } = actions

  const statusEntries = usePiExtensionUIStore((s) => s.statusEntries)

  const hasQueuedMessages = useHasQueuedMessages(conversationId)

  const messageInputRef = useRef<MessageInputHandle>(null)
  const [canSend, setCanSend] = useState(false)

  const addAttachments = useCallback(
    (atts: Attachment[]) => setAttachments((prev) => [...prev, ...atts]),
    [setAttachments],
  )
  const handlePaste = useAttachmentPaste(addAttachments)
  const removeAttachment = useCallback(
    (idx: number) => setAttachments((prev) => prev.filter((_, i) => i !== idx)),
    [setAttachments],
  )
  const handleFilesSelected = useCallback(
    (files: Attachment[]) => setAttachments((prev) => [...prev, ...files]),
    [setAttachments],
  )

  const handleSend = useCallback(async (content: string) => {
    const trimmed = content.trim()
    if (trimmed === '/clear') return clearContext(conversationId)
    if (trimmed === '/compact') return compactContext(conversationId)
    if (trimmed === '/context') return showContextInfo(conversationId)
    // Macro invocation: /name with no extra arguments
    if (/^\/[\w-]+$/.test(trimmed)) {
      const macroName = trimmed.slice(1)
      const macroMessages = await window.agent.macros.load(macroName)
      if (macroMessages) {
        const [first, ...rest] = macroMessages
        for (const msg of rest) addToQueue(conversationId, msg)
        sendMessage(conversationId, first)
        return
      }
    }
    sendMessage(conversationId, content, attachments.length > 0 ? attachments : undefined)
    setAttachments([])
  }, [conversationId, attachments, setAttachments, sendMessage, addToQueue, clearContext, compactContext, showContextInfo])

  const handleQueue = useCallback((content: string) => {
    addToQueue(conversationId, content, attachments.length > 0 ? attachments : undefined)
    setAttachments([])
  }, [conversationId, addToQueue, attachments, setAttachments])

  const handleStopGeneration = useCallback(
    () => onStopGeneration(conversationId),
    [conversationId, onStopGeneration],
  )

  // MCP / KB / model toggles — all mutate convOverrides, written back via the
  // single saveConversationOverrides seam owned by the orchestrator.
  const handleModelChange = useCallback(
    (newModel: string) => saveConversationOverrides({ ...convOverrides, ai_model: newModel }),
    [convOverrides, saveConversationOverrides],
  )
  const handlePermissionModeChange = useCallback(
    (newMode: string) => saveConversationOverrides({ ...convOverrides, ai_permissionMode: newMode }),
    [convOverrides, saveConversationOverrides],
  )
  const handleMcpServerToggle = useCallback((serverName: string) => {
    const next = { ...convOverrides }
    const disabled = new Set<string>(
      next.ai_mcpDisabled ? (JSON.parse(next.ai_mcpDisabled) as string[]) : [],
    )
    if (disabled.has(serverName)) disabled.delete(serverName)
    else disabled.add(serverName)
    if (disabled.size > 0) next.ai_mcpDisabled = JSON.stringify([...disabled])
    else delete next.ai_mcpDisabled
    saveConversationOverrides(next)
  }, [convOverrides, saveConversationOverrides])

  const handleKbCollectionToggle = useCallback((name: string) => {
    const current = kbCollectionEntries
      .filter((c) => c.selected)
      .map((c) => ({ folder: c.name, access: c.access }))
    const idx = current.findIndex((s) => s.folder === name)
    if (idx >= 0) current.splice(idx, 1)
    else current.push({ folder: name, access: 'read' })
    const next = { ...convOverrides }
    if (current.length > 0) next.ai_knowledgeFolders = JSON.stringify(current)
    else delete next.ai_knowledgeFolders
    saveConversationOverrides(next)
  }, [convOverrides, kbCollectionEntries, saveConversationOverrides])

  const handleKbAccessToggle = useCallback((name: string) => {
    const current = kbCollectionEntries
      .filter((c) => c.selected)
      .map((c) => ({ folder: c.name, access: c.access }))
    const entry = current.find((s) => s.folder === name)
    if (entry) entry.access = entry.access === 'read' ? 'readwrite' : 'read'
    const next = { ...convOverrides }
    if (current.length > 0) next.ai_knowledgeFolders = JSON.stringify(current)
    else delete next.ai_knowledgeFolders
    saveConversationOverrides(next)
  }, [convOverrides, kbCollectionEntries, saveConversationOverrides])

  const messageInputProps = buildMessageInputProps({
    inputRef: messageInputRef,
    handleSend,
    handleQueue,
    hasQueuedMessages,
    handlePaste,
    isAuthenticated,
    isStreaming,
    inputDeps,
    setCanSend,
  })

  return (
    <>
      <MessageList
        messages={messages}
        clearedAt={clearedAt}
        compactSummary={compactSummary}
        isCompacting={isCompacting}
        isStreaming={isStreaming}
        streamParts={streamParts}
        streamingContent={streamingContent}
        isLoading={isLoading}
        taskNotifications={taskNotifications}
        contextDisplay={contextDisplay}
        onDismissContextInfo={dismissContextInfo}
        effectiveTtsResponseMode={effectiveTtsResponseMode}
        effectiveAgentName={effectiveAgentName}
        effectiveSdkBackend={effectiveSdkBackend}
        conversationId={conversationId}
        onEdit={onEditMessage}
        onRegenerate={onRegenerate}
        onFork={onFork}
        onStopGeneration={handleStopGeneration}
      />

      <ChatAttachmentsPreview attachments={attachments} onRemove={removeAttachment} />

      <ChatQueuePanelContainer conversationId={conversationId} />

      <ChatExtensionWidgets placement="aboveEditor" />

      <div className="flex-shrink-0 px-4 pt-2">
        <ChatStatusLine
          model={effectiveModel}
          backend={effectiveBackend || 'claude-agent-sdk'}
          permissionMode={effectivePermissionMode}
          mcpServers={mcpServerEntries}
          onModelChange={handleModelChange}
          onPermissionModeChange={handlePermissionModeChange}
          onMcpServerToggle={handleMcpServerToggle}
          kbCollections={kbCollectionEntries}
          onKbCollectionToggle={handleKbCollectionToggle}
          onKbAccessToggle={handleKbAccessToggle}
          extensionStatus={statusEntries}
          customModels={parseCustomModels(globalSettings['ai_customModels'])}
          contextUsed={contextUsed}
          contextWindow={contextWindow}
        />
      </div>

      <div
        className="flex-shrink-0 p-3 border-t mobile-safe-bottom"
        style={{ borderColor: 'var(--color-surface)', backgroundColor: 'var(--color-bg)' }}
      >
        {compact ? (
          <CompactInputRow
            handleFilesSelected={handleFilesSelected}
            messageInputRef={messageInputRef}
            isAuthenticated={isAuthenticated}
            conversationId={conversationId}
            messageInputProps={messageInputProps}
            canSend={canSend}
          />
        ) : (
          <DesktopInputRow
            handleFilesSelected={handleFilesSelected}
            messageInputRef={messageInputRef}
            isAuthenticated={isAuthenticated}
            conversationId={conversationId}
            messageInputProps={messageInputProps}
            canSend={canSend}
          />
        )}
      </div>

      <ChatExtensionWidgets placement="belowEditor" />
    </>
  )
}

interface MessageInputPropsArgs {
  inputRef: RefObject<MessageInputHandle | null>
  handleSend: (content: string) => Promise<void> | void
  handleQueue: (content: string) => void
  hasQueuedMessages: boolean
  handlePaste: (e: React.ClipboardEvent) => Promise<void> | void
  isAuthenticated: boolean
  isStreaming: boolean
  inputDeps: MessageInputDeps
  setCanSend: (next: boolean) => void
}

/**
 * Builds the prop bag passed to the two MessageInput render variants.
 * The compact and desktop branches use the same input bindings — extracting
 * the bag here keeps the JSX symmetric and avoids drift between the two.
 */
function buildMessageInputProps(args: MessageInputPropsArgs) {
  return {
    ref: args.inputRef as RefObject<MessageInputHandle>,
    onSend: args.handleSend,
    onQueue: args.handleQueue,
    hasQueuedMessages: args.hasQueuedMessages,
    onPaste: args.handlePaste,
    disabled: !args.isAuthenticated,
    isStreaming: args.isStreaming,
    externalText: args.inputDeps.externalText,
    cwd: args.inputDeps.cwd,
    excludePatterns: args.inputDeps.excludePatterns,
    skillsMode: args.inputDeps.skillsMode,
    disabledSkills: args.inputDeps.disabledSkills,
    onCanSendChange: args.setCanSend,
  }
}

interface InputRowProps {
  handleFilesSelected: (files: Attachment[]) => void
  messageInputRef: RefObject<MessageInputHandle | null>
  isAuthenticated: boolean
  conversationId: number
  messageInputProps: ReturnType<typeof buildMessageInputProps>
  canSend: boolean
}

function MentionButton({ messageInputRef, compact }: { messageInputRef: RefObject<MessageInputHandle | null>; compact: boolean }) {
  const sizeClass = compact ? 'w-11 h-11' : 'w-8 h-8'
  return (
    <button
      onClick={() => messageInputRef.current?.triggerMention()}
      className={`flex-shrink-0 ${sizeClass} rounded-md flex items-center justify-center transition-opacity hover:opacity-80`}
      style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-text-muted)' }}
      title="Mention a file (@)"
      aria-label="Mention file"
    >
      <span className="text-sm font-bold">@</span>
    </button>
  )
}

function SendButton({ messageInputRef, canSend, compact }: { messageInputRef: RefObject<MessageInputHandle | null>; canSend: boolean; compact: boolean }) {
  const sizeClass = compact ? 'w-11 h-11' : 'w-8 h-8'
  return (
    <button
      onClick={() => messageInputRef.current?.send()}
      disabled={!canSend}
      className={`flex-shrink-0 ${sizeClass} rounded-md flex items-center justify-center transition-opacity`}
      style={{ backgroundColor: 'var(--color-primary)', opacity: canSend ? 1 : 0.4 }}
      aria-label="Send message"
      title="Send message"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="22" y1="2" x2="11" y2="13" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" />
      </svg>
    </button>
  )
}

function CompactInputRow(props: InputRowProps) {
  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <ChatAttachmentsUpload onFilesSelected={props.handleFilesSelected} />
        <MentionButton messageInputRef={props.messageInputRef} compact />
        <VoiceInputButton disabled={!props.isAuthenticated} />
      </div>
      <div className="flex items-center gap-2">
        <MessageInput {...props.messageInputProps} />
        <SendButton messageInputRef={props.messageInputRef} canSend={props.canSend} compact />
      </div>
    </>
  )
}

function DesktopInputRow(props: InputRowProps) {
  return (
    <div className="flex items-center gap-2">
      <ChatAttachmentsUpload onFilesSelected={props.handleFilesSelected} />
      <MentionButton messageInputRef={props.messageInputRef} compact={false} />
      <VoiceInputButton disabled={!props.isAuthenticated} />
      <MessageInput {...props.messageInputProps} />
      <SendButton messageInputRef={props.messageInputRef} canSend={props.canSend} compact={false} />
    </div>
  )
}
