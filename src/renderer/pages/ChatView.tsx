import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageList } from '../components/chat/MessageList'
import { MessageInput } from '../components/chat/MessageInput'
import type { MessageInputHandle } from '../components/chat/MessageInput'
import { FileDropZone } from '../components/attachments/FileDropZone'
import { FileUploadButton } from '../components/attachments/FileUploadButton'
import { VoiceInputButton } from '../components/chat/VoiceInputButton'
import { AttachmentPreview } from '../components/attachments/AttachmentPreview'
import { AIOverridesPopover } from '../components/settings/AIOverridesPopover'
import { ChatStatusLine } from '../components/chat/ChatStatusLine'
import { useChatStore } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useAuthStore } from '../stores/authStore'
import { useConversationsStore } from '../stores/conversationsStore'
import { useFileExplorerStore } from '../stores/fileExplorerStore'
import { useMcpStore } from '../stores/mcpStore'
import { useKnowledgeStore } from '../stores/knowledgeStore'
import { parseOverrides, resolveEffectiveSettings, getInheritanceSource } from '../utils/resolveAISettings'
import { parseMcpDisabledList } from '../utils/mcpUtils'
import { useVoiceInputStore } from '../stores/voiceInputStore'
import type { Attachment, AIOverrides, KnowledgeSelection } from '../../shared/types'
import { DEFAULT_MODEL, DEFAULT_EXCLUDE_PATTERNS, shortenModelName } from '../../shared/constants'

interface ChatViewProps {
  conversationId: number | null
  conversationTitle?: string
  conversationModel?: string
  conversationCwd?: string | null
}

export function ChatView({ conversationId, conversationTitle, conversationModel, conversationCwd }: ChatViewProps) {
  const {
    messages,
    clearedAt,
    isStreaming,
    streamParts,
    streamingContent,
    isLoading,
    error,
    loadMessages,
    sendMessage,
    stopGeneration,
    regenerateLastResponse,
    editMessage,
    clearChat,
    setActiveConversation,
  } = useChatStore()

  const { isAuthenticated } = useAuthStore()
  const globalSettings = useSettingsStore((s) => s.settings)
  const { conversations, folders, updateConversation } = useConversationsStore()
  const { loadTree, clear: clearFiles } = useFileExplorerStore()
  const mcpServers = useMcpStore((s) => s.servers)
  const loadMcpServers = useMcpStore((s) => s.loadServers)
  const kbCollections = useKnowledgeStore((s) => s.collections)
  const loadKbCollections = useKnowledgeStore((s) => s.loadCollections)
  const mcpServerNames = useMemo(
    () => mcpServers.filter((s) => s.enabled === 1).map((s) => ({ name: s.name })),
    [mcpServers]
  )

  // Overrides popover state
  const [showOverrides, setShowOverrides] = useState(false)

  // Attachment state
  const [attachments, setAttachments] = useState<Attachment[]>([])

  // Voice input
  const lastTranscription = useVoiceInputStore((s) => s.lastTranscription)
  const clearTranscription = useVoiceInputStore((s) => s.clearTranscription)
  const consumedVoiceIdRef = useRef(0)
  const messageInputRef = useRef<MessageInputHandle>(null)
  const [canSend, setCanSend] = useState(false)

  // Consume transcription: auto-send or inject into input
  const autoSendVoice = globalSettings.whisper_autoSend === 'true'
  useEffect(() => {
    if (!lastTranscription || lastTranscription.id === consumedVoiceIdRef.current) return
    consumedVoiceIdRef.current = lastTranscription.id

    if (autoSendVoice && conversationId) {
      sendMessage(conversationId, lastTranscription.text)
      clearTranscription()
    }
    // When autoSend is off, MessageInput consumes via externalText prop
  }, [lastTranscription, clearTranscription, autoSendVoice, conversationId, sendMessage])

  // Compute effective model via cascade
  const conversation = conversations.find((c) => c.id === conversationId)
  const folder = conversation?.folder_id ? folders.find((f) => f.id === conversation.folder_id) : undefined
  const convOverrides = useMemo(() => parseOverrides(conversation?.ai_overrides), [conversation?.ai_overrides])
  const folderOverrides = useMemo(() => parseOverrides(folder?.ai_overrides), [folder?.ai_overrides])
  const effectiveSettings = useMemo(
    () => resolveEffectiveSettings(globalSettings, folderOverrides, convOverrides),
    [globalSettings, folderOverrides, convOverrides]
  )
  const effectiveModel = effectiveSettings['ai_model'] || DEFAULT_MODEL
  const effectivePermissionMode = effectiveSettings['ai_permissionMode'] || 'bypassPermissions'
  const mcpDisabledList = useMemo(() => parseMcpDisabledList(effectiveSettings['ai_mcpDisabled']), [effectiveSettings])
  const mcpServerEntries = useMemo(() => {
    const disabledSet = new Set(mcpDisabledList)
    return mcpServers
      .filter((s) => s.enabled === 1)
      .map((s) => ({ name: s.name, active: !disabledSet.has(s.name) }))
  }, [mcpServers, mcpDisabledList])

  // KB collections — parse selections from ai_overrides (like mcpDisabledList pattern)
  const kbSelections = useMemo<KnowledgeSelection[]>(() => {
    const raw = effectiveSettings['ai_knowledgeFolders']
    if (!raw) return []
    try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : [] } catch { return [] }
  }, [effectiveSettings])

  // Disabled skills — parse from effective settings
  const disabledSkills = useMemo<string[]>(() => {
    const raw = effectiveSettings['ai_disabledSkills']
    if (!raw) return []
    try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : [] } catch { return [] }
  }, [effectiveSettings])

  // File exclude patterns — resolve from cascade
  const excludePatterns = useMemo(() => {
    const raw = effectiveSettings['files_excludePatterns'] || DEFAULT_EXCLUDE_PATTERNS
    return raw.split(',').map((s: string) => s.trim()).filter(Boolean)
  }, [effectiveSettings])

  const kbCollectionEntries = useMemo(() => {
    const selectedMap = new Map(kbSelections.map(s => [s.folder, s.access]))
    return kbCollections.map(c => ({
      name: c.name,
      selected: selectedMap.has(c.name),
      access: (selectedMap.get(c.name) || 'read') as 'read' | 'readwrite',
    }))
  }, [kbCollections, kbSelections])

  // Load MCP servers once on mount
  useEffect(() => { loadMcpServers() }, [loadMcpServers])

  // Load KB collections once on mount
  useEffect(() => { loadKbCollections() }, [loadKbCollections])

  // Build inheritance source info for the popover
  const inheritedSources = useMemo(() => {
    const keys: (keyof AIOverrides)[] = ['ai_model', 'ai_maxTurns', 'ai_maxThinkingTokens', 'ai_maxBudgetUsd', 'ai_permissionMode', 'ai_tools', 'ai_defaultSystemPrompt', 'ai_mcpDisabled', 'ai_knowledgeFolders']
    const sources: Record<string, string> = {}
    for (const key of keys) {
      sources[key] = getInheritanceSource(key, folderOverrides, convOverrides, folder?.name)
    }
    return sources
  }, [folderOverrides, convOverrides, folder?.name])

  // Inherited values = folder overrides merged onto global (without conv overrides)
  const inheritedValues = useMemo(
    () => resolveEffectiveSettings(globalSettings, folderOverrides, {}),
    [globalSettings, folderOverrides]
  )

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    const fileItems: DataTransferItem[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file') fileItems.push(item)
    }
    if (fileItems.length === 0) return

    e.preventDefault()

    for (const item of fileItems) {
      const blob = item.getAsFile()
      if (!blob) continue

      try {
        const buffer = await blob.arrayBuffer()
        const path = await window.agent.files.savePastedFile(new Uint8Array(buffer), blob.type)
        const ext = blob.type.split('/')[1] || 'png'
        const name = blob.name && blob.name !== 'image.png'
          ? blob.name
          : `pasted-${Date.now()}.${ext}`

        setAttachments((prev) => [...prev, { name, path, type: blob.type, size: blob.size }])
      } catch (err) {
        console.error('Failed to save pasted file:', err)
      }
    }
  }, [])

  const handleFilesSelected = useCallback((files: Attachment[]) => {
    setAttachments((prev) => [...prev, ...files])
  }, [])

  const handleRemoveAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const saveConversationOverrides = useCallback((newOverrides: AIOverrides) => {
    if (!conversationId) return
    const json = Object.keys(newOverrides).length > 0 ? JSON.stringify(newOverrides) : null
    updateConversation(conversationId, { ai_overrides: json } as any)
  }, [conversationId, updateConversation])

  const handleMcpServerToggle = useCallback((serverName: string) => {
    const newOverrides = { ...convOverrides }
    const currentDisabled = new Set(mcpDisabledList)
    if (currentDisabled.has(serverName)) {
      currentDisabled.delete(serverName)
    } else {
      currentDisabled.add(serverName)
    }
    if (currentDisabled.size > 0) {
      newOverrides.ai_mcpDisabled = JSON.stringify([...currentDisabled])
    } else {
      delete newOverrides.ai_mcpDisabled
    }
    saveConversationOverrides(newOverrides)
  }, [mcpDisabledList, convOverrides, saveConversationOverrides])

  const handleModelChange = useCallback((newModel: string) => {
    saveConversationOverrides({ ...convOverrides, ai_model: newModel })
  }, [convOverrides, saveConversationOverrides])

  const handlePermissionModeChange = useCallback((newMode: string) => {
    saveConversationOverrides({ ...convOverrides, ai_permissionMode: newMode })
  }, [convOverrides, saveConversationOverrides])

  const handleKbCollectionToggle = useCallback((name: string) => {
    const current = [...kbSelections]
    const idx = current.findIndex(s => s.folder === name)
    if (idx >= 0) {
      current.splice(idx, 1)
    } else {
      current.push({ folder: name, access: 'read' })
    }
    const newOverrides = { ...convOverrides }
    if (current.length > 0) {
      newOverrides.ai_knowledgeFolders = JSON.stringify(current)
    } else {
      delete newOverrides.ai_knowledgeFolders
    }
    saveConversationOverrides(newOverrides)
  }, [kbSelections, convOverrides, saveConversationOverrides])

  const handleKbAccessToggle = useCallback((name: string) => {
    const current = [...kbSelections]
    const entry = current.find(s => s.folder === name)
    if (entry) {
      entry.access = entry.access === 'read' ? 'readwrite' : 'read'
    }
    const newOverrides = { ...convOverrides }
    if (current.length > 0) {
      newOverrides.ai_knowledgeFolders = JSON.stringify(current)
    } else {
      delete newOverrides.ai_knowledgeFolders
    }
    saveConversationOverrides(newOverrides)
  }, [kbSelections, convOverrides, saveConversationOverrides])

  const handleChangeCwd = async () => {
    if (!conversationId) return
    const folder = await window.agent.system.selectFolder()
    if (folder) {
      updateConversation(conversationId, { cwd: folder } as Partial<import('../../shared/types').Conversation>)
    }
  }

  const displayCwd = conversationCwd || (conversationId ? `~/.agent-desktop/sessions-folder/${conversationId}` : '')

  // Sync active conversation and load messages/files when conversation changes
  useEffect(() => {
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

  // Auto-refresh file tree when streaming finishes (not on conversation switch)
  const wasStreamingRef = useRef(isStreaming)
  useEffect(() => {
    const wasStreaming = wasStreamingRef.current
    wasStreamingRef.current = isStreaming
    if (conversationId && wasStreaming && !isStreaming) {
      useFileExplorerStore.getState().refresh()
    }
  }, [conversationId, isStreaming])

  const handleSend = async (content: string) => {
    if (!conversationId) return
    const trimmed = content.trim()
    if (trimmed === '/clear' || trimmed === '/compact') {
      await useChatStore.getState().clearContext(conversationId)
      return
    }
    sendMessage(conversationId, content, attachments.length > 0 ? attachments : undefined)
    setAttachments([])
  }

  const handleRegenerate = () => {
    if (!conversationId) return
    regenerateLastResponse(conversationId)
  }

  // Empty state
  if (!conversationId) {
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

  return (
    <FileDropZone onFilesDropped={handleFilesSelected}>
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b gap-2"
          style={{
            borderColor: 'var(--color-surface)',
            backgroundColor: 'var(--color-bg)',
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-medium flex-shrink-0" style={{ color: 'var(--color-text)' }}>
              {conversationTitle || 'New Conversation'}
            </h2>
            <button
              onClick={handleChangeCwd}
              title={`Working directory: ${displayCwd}\nClick to change`}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs truncate max-w-[300px] hover:opacity-80 transition-opacity"
              style={{
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-text-muted)',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0">
                <path d="M1 3.5A1.5 1.5 0 012.5 2h3.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.56 4H13.5A1.5 1.5 0 0115 5.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" />
              </svg>
              <span className="truncate">{displayCwd}</span>
            </button>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div
              className="text-xs px-2 py-0.5 rounded"
              style={{
                backgroundColor: 'var(--color-surface)',
                color: Object.keys(convOverrides).length > 0 ? 'var(--color-primary)' : 'var(--color-text-muted)',
              }}
            >
              {shortenModelName(effectiveModel)}
            </div>
            <button
              onClick={() => setShowOverrides((v) => !v)}
              title="AI Settings overrides"
              className="p-1 rounded hover:opacity-80 transition-opacity"
              style={{ color: Object.keys(convOverrides).length > 0 ? 'var(--color-primary)' : 'var(--color-text-muted)' }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z" />
                <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0a1.97 1.97 0 01-2.929 1.1c-1.541-.971-3.37.858-2.4 2.4a1.97 1.97 0 01-1.1 2.93c-1.79.526-1.79 3.064 0 3.591a1.97 1.97 0 011.1 2.929c-.97 1.542.858 3.371 2.4 2.4a1.97 1.97 0 012.93 1.1c.526 1.79 3.064 1.79 3.591 0a1.97 1.97 0 012.929-1.1c1.542.97 3.371-.858 2.4-2.4a1.97 1.97 0 011.1-2.93c1.79-.526 1.79-3.064 0-3.591a1.97 1.97 0 01-1.1-2.929c.97-1.542-.858-3.371-2.4-2.4a1.97 1.97 0 01-2.93-1.1zM8 10.93a2.929 2.929 0 110-5.858 2.929 2.929 0 010 5.858z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div
            className="flex-shrink-0 px-4 py-2 text-sm"
            style={{ backgroundColor: 'var(--color-error)', color: '#fff' }}
          >
            {error}
          </div>
        )}

        {/* Messages */}
        <MessageList
          messages={messages}
          clearedAt={clearedAt}
          isStreaming={isStreaming}
          streamParts={streamParts}
          streamingContent={streamingContent}
          isLoading={isLoading}
          onEdit={editMessage}
          onRegenerate={handleRegenerate}
          onStopGeneration={stopGeneration}
        />

        {/* Attachment preview (between messages and input) */}
        {attachments.length > 0 && (
          <div
            className="flex-shrink-0 border-t"
            style={{ borderColor: 'var(--color-surface)' }}
          >
            <AttachmentPreview attachments={attachments} onRemove={handleRemoveAttachment} />
          </div>
        )}

        {/* Status line above input */}
        <div className="flex-shrink-0 px-4 pt-2">
          <ChatStatusLine
            model={effectiveModel}
            permissionMode={effectivePermissionMode}
            mcpServers={mcpServerEntries}
            onModelChange={handleModelChange}
            onPermissionModeChange={handlePermissionModeChange}
            onMcpServerToggle={handleMcpServerToggle}
            kbCollections={kbCollectionEntries}
            onKbCollectionToggle={handleKbCollectionToggle}
            onKbAccessToggle={handleKbAccessToggle}
          />
        </div>

        {/* Input area with file upload + @ mention + voice buttons */}
        <div
          className="flex-shrink-0 p-3 border-t"
          style={{ borderColor: 'var(--color-surface)', backgroundColor: 'var(--color-bg)' }}
        >
          <div className="flex items-center gap-2">
            <FileUploadButton onFilesSelected={handleFilesSelected} />
            <button
              onClick={() => messageInputRef.current?.triggerMention()}
              className="flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center transition-opacity hover:opacity-80"
              style={{
                backgroundColor: 'var(--color-deep)',
                color: 'var(--color-text-muted)',
              }}
              title="Mention a file (@)"
              aria-label="Mention file"
            >
              <span className="text-sm font-bold">@</span>
            </button>
            <VoiceInputButton disabled={!isAuthenticated || !conversationId} />
            <MessageInput
              ref={messageInputRef}
              onSend={handleSend}
              onPaste={handlePaste}
              disabled={!isAuthenticated || !conversationId}
              isStreaming={isStreaming}
              externalText={autoSendVoice ? undefined : (lastTranscription ?? undefined)}
              cwd={displayCwd}
              excludePatterns={excludePatterns}
              skillsMode={effectiveSettings['ai_skills'] ?? 'off'}
              disabledSkills={disabledSkills}
              onCanSendChange={setCanSend}
            />
            <button
              onClick={() => messageInputRef.current?.send()}
              disabled={!canSend}
              className="flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center transition-opacity"
              style={{
                backgroundColor: 'var(--color-primary)',
                opacity: canSend ? 1 : 0.4,
              }}
              aria-label="Send message"
              title="Send message"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      {showOverrides && conversationId && (
        <AIOverridesPopover
          overrides={convOverrides}
          inheritedValues={inheritedValues}
          inheritedSources={inheritedSources}
          title="Conversation AI Settings"
          mcpServers={mcpServerNames}
          onSave={(newOverrides) => {
            saveConversationOverrides(newOverrides)
            setShowOverrides(false)
          }}
          onClose={() => setShowOverrides(false)}
        />
      )}
    </FileDropZone>
  )
}
