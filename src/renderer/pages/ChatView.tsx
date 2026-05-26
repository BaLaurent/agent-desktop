import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useShallow } from 'zustand/react/shallow'
import { useSettingsStore } from '../stores/settingsStore'
import { useConversationsStore } from '../stores/conversationsStore'
import { useFileExplorerStore } from '../stores/fileExplorerStore'
import { useMcpStore } from '../stores/mcpStore'
import { useKnowledgeStore } from '../stores/knowledgeStore'
import { useUiStore } from '../stores/uiStore'
import { useVoiceInputStore } from '../stores/voiceInputStore'
import { usePiExtensionUI } from '../hooks/usePiExtensionUI'
import { usePiExtensionUIStore } from '../stores/piExtensionUIStore'
import { parseOverrides, resolveEffectiveSettings, getInheritanceSource } from '../utils/resolveAISettings'
import { parseMcpDisabledList } from '../utils/mcpUtils'
import { DEFAULT_MODEL, DEFAULT_EXCLUDE_PATTERNS, shortenModelName, parseCustomModelContextLengths } from '../../shared/constants'
import { getEffectiveContextWindow, computeUsedTokens } from '../../shared/contextWindow'
import type { Attachment, AIOverrides, KnowledgeSelection } from '../../shared/types'
import { ChatAttachmentsDropZone } from './chat/ChatAttachments'
import { ChatLayout } from './chat/ChatLayout'
import { ChatOverridesPopover, ChatExtensionOverlays } from './chat/ChatOverlays'

interface ChatViewProps {
  conversationId: number | null
  conversationTitle?: string
  conversationModel?: string
  conversationCwd?: string | null
}

/**
 * Orchestrator for the chat page. Owns top-level effects (active conversation
 * sync, file-tree refresh, voice consumption), the cascade resolution
 * (global -> folder -> conversation overrides), and the attachments useState.
 *
 * Body sections - message list, status line, input row, queue, attachment
 * preview, extension overlays - live in `./chat/` sub-components. Each
 * sub-component reads the chat/extension Zustand stores directly with
 * granular selectors so re-renders stay localised.
 */
export function ChatView({ conversationId, conversationTitle, conversationCwd }: ChatViewProps) {
  const isStreaming = useChatStore((s) => s.isStreaming)
  const error = useChatStore((s) => s.error)
  const connectionStatus = useChatStore((s) => s.connectionStatus)

  const orchestratorActions = useChatStore(useShallow((s) => ({
    loadMessages: s.loadMessages,
    setActiveConversation: s.setActiveConversation,
    clearChat: s.clearChat,
    sendMessage: s.sendMessage,
    stopGeneration: s.stopGeneration,
    regenerateLastResponse: s.regenerateLastResponse,
    editMessage: s.editMessage,
  })))
  const {
    loadMessages, setActiveConversation, clearChat, sendMessage,
    stopGeneration, regenerateLastResponse, editMessage,
  } = orchestratorActions

  const globalSettings = useSettingsStore((s) => s.settings)
  const { conversations, folders, updateConversation, forkConversation } = useConversationsStore()
  const { loadTree, clear: clearFiles } = useFileExplorerStore()
  const mcpServers = useMcpStore((s) => s.servers)
  const loadMcpServers = useMcpStore((s) => s.loadServers)
  const kbCollections = useKnowledgeStore((s) => s.collections)
  const loadKbCollections = useKnowledgeStore((s) => s.loadCollections)

  const lastTranscription = useVoiceInputStore((s) => s.lastTranscription)
  const clearTranscription = useVoiceInputStore((s) => s.clearTranscription)
  const consumedVoiceIdRef = useRef(0)

  usePiExtensionUI()

  const [showOverrides, setShowOverrides] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])

  const conversation = conversations.find((c) => c.id === conversationId)
  const folder = conversation?.folder_id ? folders.find((f) => f.id === conversation.folder_id) : undefined
  const convOverrides = useMemo(() => parseOverrides(conversation?.ai_overrides), [conversation?.ai_overrides])
  const folderOverrides = useMemo(() => parseOverrides(folder?.ai_overrides), [folder?.ai_overrides])
  const effectiveSettings = useMemo(
    () => resolveEffectiveSettings(globalSettings, folderOverrides, convOverrides),
    [globalSettings, folderOverrides, convOverrides],
  )
  const effectiveModel = effectiveSettings['ai_model'] || DEFAULT_MODEL
  const effectivePermissionMode = effectiveSettings['ai_permissionMode'] || 'bypassPermissions'

  const customCtxOverrides = useMemo(
    () => parseCustomModelContextLengths(globalSettings['ai_customModelContextLengths']),
    [globalSettings],
  )
  const contextWindow = useMemo(
    () => getEffectiveContextWindow(effectiveModel, conversation?.last_context_window ?? null, customCtxOverrides),
    [conversation?.last_context_window, effectiveModel, customCtxOverrides],
  )
  const contextUsed = useMemo(
    () => resolveContextUsed(conversation),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversation?.last_usage_updated_at, conversation?.last_content_tokens, conversation?.last_input_tokens, conversation?.last_cache_read_tokens, conversation?.last_cache_creation_tokens],
  )
  const mcpDisabledList = useMemo(() => parseMcpDisabledList(effectiveSettings['ai_mcpDisabled']), [effectiveSettings])
  const mcpServerEntries = useMemo(() => {
    const disabledSet = new Set(mcpDisabledList)
    return mcpServers.filter((s) => s.enabled === 1).map((s) => ({ name: s.name, active: !disabledSet.has(s.name) }))
  }, [mcpServers, mcpDisabledList])
  const mcpServerNames = useMemo(
    () => mcpServers.filter((s) => s.enabled === 1).map((s) => ({ name: s.name })),
    [mcpServers],
  )

  const kbSelections = useMemo<KnowledgeSelection[]>(
    () => parseJsonArray<KnowledgeSelection>(effectiveSettings['ai_knowledgeFolders']),
    [effectiveSettings],
  )
  const disabledSkills = useMemo<string[]>(
    () => parseJsonArray<string>(effectiveSettings['ai_disabledSkills']),
    [effectiveSettings],
  )
  const excludePatterns = useMemo(
    () => splitCsv(effectiveSettings['files_excludePatterns'] || DEFAULT_EXCLUDE_PATTERNS),
    [effectiveSettings],
  )

  const kbCollectionEntries = useMemo(() => {
    const selectedMap = new Map(kbSelections.map((s) => [s.folder, s.access]))
    return kbCollections.map((c) => ({
      name: c.name,
      selected: selectedMap.has(c.name),
      access: (selectedMap.get(c.name) || 'read') as 'read' | 'readwrite',
    }))
  }, [kbCollections, kbSelections])

  const inheritedSources = useMemo(
    () => buildInheritedSources(folderOverrides, convOverrides, folder?.name),
    [folderOverrides, convOverrides, folder?.name],
  )

  const inheritedValues = useMemo(
    () => resolveEffectiveSettings(globalSettings, folderOverrides, {}),
    [globalSettings, folderOverrides],
  )

  const saveConversationOverrides = useCallback((newOverrides: AIOverrides) => {
    if (!conversationId) return
    const json = Object.keys(newOverrides).length > 0 ? JSON.stringify(newOverrides) : null
    updateConversation(conversationId, { ai_overrides: json } as Parameters<typeof updateConversation>[1])
  }, [conversationId, updateConversation])

  const autoSendVoice = globalSettings.whisper_autoSend === 'true'
  useEffect(() => {
    if (!lastTranscription || lastTranscription.id === consumedVoiceIdRef.current) return
    consumedVoiceIdRef.current = lastTranscription.id
    if (autoSendVoice && conversationId) {
      sendMessage(conversationId, lastTranscription.text)
      clearTranscription()
    }
  }, [lastTranscription, clearTranscription, autoSendVoice, conversationId, sendMessage])

  useEffect(() => {
    usePiExtensionUIStore.getState().reset()
    if (conversationId) {
      setActiveConversation(conversationId)
      loadMessages(conversationId)
      const cwd = conversationCwd || `~/.agent-desktop/sessions-folder/${conversationId}`
      loadTree(cwd)
    } else {
      clearChat()
      clearFiles()
    }
  }, [conversationId, conversationCwd, setActiveConversation, loadMessages, clearChat, loadTree, clearFiles])

  const wasStreamingRef = useRef(isStreaming)
  useEffect(() => {
    const wasStreaming = wasStreamingRef.current
    wasStreamingRef.current = isStreaming
    if (conversationId && wasStreaming && !isStreaming) {
      useFileExplorerStore.getState().refresh()
    }
  }, [conversationId, isStreaming])

  useEffect(() => {
    loadMcpServers()
    loadKbCollections()
  }, [loadMcpServers, loadKbCollections])

  const handleChangeCwd = useCallback(async () => {
    if (!conversationId) return
    const next = await window.agent.system.selectFolder()
    if (next) {
      updateConversation(conversationId, { cwd: next } as Partial<import('../../shared/types').Conversation>)
    }
  }, [conversationId, updateConversation])

  const handleRegenerate = useCallback(() => {
    if (!conversationId) return
    regenerateLastResponse(conversationId)
  }, [conversationId, regenerateLastResponse])

  const handleFork = useCallback(async (messageId: number) => {
    if (!conversationId) return
    await forkConversation(conversationId, messageId)
  }, [conversationId, forkConversation])

  const displayCwd = resolveDisplayCwd(conversationCwd, conversationId)

  if (!conversationId) {
    return <ChatEmptyState />
  }

  const layoutDeps = {
    backend: effectiveSettings['ai_sdkBackend'] || 'claude-agent-sdk',
    ttsResponseMode: effectiveSettings['tts_responseMode'],
    agentName: effectiveSettings['agent_name'],
    sdkBackend: effectiveSettings['ai_sdkBackend'],
  }
  const inputDeps = {
    cwd: displayCwd,
    excludePatterns,
    skillsMode: effectiveSettings['ai_skills'] ?? 'off',
    disabledSkills,
    externalText: autoSendVoice ? undefined : (lastTranscription ?? undefined),
  }

  return (
    <ChatAttachmentsDropZone onFilesDropped={(files) => setAttachments((prev) => [...prev, ...files])}>
      <div className="flex-1 flex flex-col overflow-hidden">
        <ChatHeader
          title={conversationTitle}
          displayCwd={displayCwd}
          effectiveModel={effectiveModel}
          hasOverrides={Object.keys(convOverrides).length > 0}
          onChangeCwd={handleChangeCwd}
          onToggleOverrides={() => setShowOverrides((v) => !v)}
        />

        <ChatReconnectingBanner active={connectionStatus === 'reconnecting'} />
        <ChatErrorBanner message={error} />

        <ChatLayout
          conversationId={conversationId}
          effectiveModel={effectiveModel}
          effectivePermissionMode={effectivePermissionMode}
          effectiveBackend={layoutDeps.backend}
          effectiveTtsResponseMode={layoutDeps.ttsResponseMode}
          effectiveAgentName={layoutDeps.agentName}
          effectiveSdkBackend={layoutDeps.sdkBackend}
          globalSettings={globalSettings}
          mcpServerEntries={mcpServerEntries}
          kbCollectionEntries={kbCollectionEntries}
          contextUsed={contextUsed}
          contextWindow={contextWindow}
          attachments={attachments}
          setAttachments={setAttachments}
          inputDeps={inputDeps}
          convOverrides={convOverrides}
          saveConversationOverrides={saveConversationOverrides}
          onEditMessage={editMessage}
          onRegenerate={handleRegenerate}
          onFork={handleFork}
          onStopGeneration={stopGeneration}
        />
      </div>

      <ChatOverridesPopover
        open={showOverrides}
        convOverrides={convOverrides}
        inheritedValues={inheritedValues}
        inheritedSources={inheritedSources}
        mcpServers={mcpServerNames}
        onSave={(newOverrides) => {
          saveConversationOverrides(newOverrides)
          setShowOverrides(false)
        }}
        onClose={() => setShowOverrides(false)}
      />

      <ChatExtensionOverlays />
    </ChatAttachmentsDropZone>
  )
}

// --- Pure helpers (top-level, no hooks) -----------------------------------

function parseJsonArray<T>(raw: string | undefined): T[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as T[]) : []
  } catch { return [] }
}

function splitCsv(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

function resolveDisplayCwd(conversationCwd: string | null | undefined, conversationId: number | null): string {
  if (conversationCwd) return conversationCwd
  if (conversationId) return `~/.agent-desktop/sessions-folder/${conversationId}`
  return ''
}

type ConversationLike = {
  last_usage_updated_at?: string | number | null
  last_content_tokens?: number | null
  last_input_tokens?: number | null
  last_cache_read_tokens?: number | null
  last_cache_creation_tokens?: number | null
}

function resolveContextUsed(conv: ConversationLike | undefined): number | null {
  if (!conv?.last_usage_updated_at) return null
  if (typeof conv.last_content_tokens === 'number') return conv.last_content_tokens
  return computeUsedTokens({
    input: conv.last_input_tokens,
    cacheRead: conv.last_cache_read_tokens,
    cacheCreation: conv.last_cache_creation_tokens,
  })
}

const INHERITED_KEYS: (keyof AIOverrides)[] = [
  'ai_model', 'ai_maxTurns', 'ai_maxThinkingTokens', 'ai_maxBudgetUsd',
  'ai_permissionMode', 'ai_tools', 'ai_defaultSystemPrompt',
  'ai_mcpDisabled', 'ai_knowledgeFolders',
]

function buildInheritedSources(
  folderOverrides: AIOverrides,
  convOverrides: AIOverrides,
  folderName: string | undefined,
): Record<string, string> {
  const sources: Record<string, string> = {}
  for (const key of INHERITED_KEYS) {
    sources[key] = getInheritanceSource(key, folderOverrides, convOverrides, folderName)
  }
  return sources
}

// --- Sub-views (no business logic) ----------------------------------------

function ChatEmptyState() {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center"
      style={{ color: 'var(--color-text-muted)' }}
    >
      <div className="text-4xl mb-4">💬</div>
      <h2 className="text-lg font-medium mb-1" style={{ color: 'var(--color-text)' }}>
        No conversation selected
      </h2>
      <p className="text-sm">Select or create a conversation to get started</p>
    </div>
  )
}

function ChatErrorBanner({ message }: { message: string | null | undefined }) {
  if (!message) return null
  return (
    <div
      className="flex-shrink-0 px-4 py-2 text-sm"
      style={{ backgroundColor: 'var(--color-error)', color: 'var(--color-text-contrast)' }}
    >
      {message}
    </div>
  )
}

/**
 * Non-fatal banner shown while the web transport reconnects after a drop. The
 * server keeps streaming and persists the turn, so this is recoverable — we
 * deliberately use the warning colour (not error red) and keep the streaming
 * view alive. Never shows under Electron (connectionStatus stays 'connected').
 */
function ChatReconnectingBanner({ active }: { active: boolean }) {
  if (!active) return null
  return (
    <div
      className="flex-shrink-0 px-4 py-2 text-sm flex items-center gap-2"
      style={{ backgroundColor: 'var(--color-warning)', color: 'var(--color-text-contrast)' }}
    >
      <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--color-text-contrast)' }} />
      Reconnecting… your work is still being saved.
    </div>
  )
}

interface ChatHeaderProps {
  title: string | undefined
  displayCwd: string
  effectiveModel: string
  hasOverrides: boolean
  onChangeCwd: () => void
  onToggleOverrides: () => void
}

function ChatHeader({ title, displayCwd, effectiveModel, hasOverrides, onChangeCwd, onToggleOverrides }: ChatHeaderProps) {
  return (
    <div
      className="flex-shrink-0 flex items-center justify-between py-2 border-b gap-2 px-4 mobile:pl-14 mobile:pr-4"
      style={{ borderColor: 'var(--color-surface)', backgroundColor: 'var(--color-bg)' }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <h2 className="text-sm font-medium min-w-0 truncate" style={{ color: 'var(--color-text)' }}>
          {title || 'New Conversation'}
        </h2>
        <button
          onClick={onChangeCwd}
          title={`Working directory: ${displayCwd}\nClick to change`}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs truncate max-w-[300px] hover:opacity-80 transition-opacity compact:hidden"
          style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)' }}
        >
          <FolderIcon />
          <span className="truncate">{displayCwd}</span>
        </button>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={useUiStore.getState().togglePanel}
          title="File explorer"
          className="hidden compact:flex p-2.5 rounded hover:opacity-80 transition-opacity items-center justify-center"
          style={{ color: 'var(--color-text-muted)' }}
          aria-label="Open file explorer"
        >
          <FolderIcon size={16} />
        </button>
        <div
          className="text-xs px-2 py-0.5 rounded"
          style={{
            backgroundColor: 'var(--color-surface)',
            color: hasOverrides ? 'var(--color-primary)' : 'var(--color-text-muted)',
          }}
        >
          {shortenModelName(effectiveModel)}
        </div>
        <button
          onClick={onToggleOverrides}
          title="AI Settings overrides"
          className="rounded hover:opacity-80 transition-opacity p-1 mobile:p-2.5"
          style={{ color: hasOverrides ? 'var(--color-primary)' : 'var(--color-text-muted)' }}
        >
          <GearIcon />
        </button>
      </div>
    </div>
  )
}

function FolderIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0">
      <path d="M1 3.5A1.5 1.5 0 012.5 2h3.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.56 4H13.5A1.5 1.5 0 0115 5.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z" />
      <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0a1.97 1.97 0 01-2.929 1.1c-1.541-.971-3.37.858-2.4 2.4a1.97 1.97 0 01-1.1 2.93c-1.79.526-1.79 3.064 0 3.591a1.97 1.97 0 011.1 2.929c-.97 1.542.858 3.371 2.4 2.4a1.97 1.97 0 012.93 1.1c.526 1.79 3.064 1.79 3.591 0a1.97 1.97 0 012.929-1.1c1.542.97 3.371-.858 2.4-2.4a1.97 1.97 0 011.1-2.93c1.79-.526 1.79-3.064 0-3.591a1.97 1.97 0 01-1.1-2.929c.97-1.542-.858-3.371-2.4-2.4a1.97 1.97 0 01-2.93-1.1zM8 10.93a2.929 2.929 0 110-5.858 2.929 2.929 0 010 5.858z" />
    </svg>
  )
}
