import { useState, useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { FileMentionDropdown, flattenFileTree } from './FileMentionDropdown'
import type { FlatFile } from './FileMentionDropdown'
import type { FileNode } from '../../../shared/types'

export interface MessageInputHandle {
  triggerMention: () => void
  send: () => void
}

interface MessageInputProps {
  onSend: (content: string) => void
  disabled: boolean
  isStreaming: boolean
  externalText?: { text: string; id: number }
  cwd?: string | null
  onCanSendChange?: (canSend: boolean) => void
  onPaste?: (e: React.ClipboardEvent) => void
}

export const MessageInput = forwardRef<MessageInputHandle, MessageInputProps>(
  function MessageInput({ onSend, disabled, isStreaming, externalText, cwd, onCanSendChange, onPaste }, ref) {
    const [content, setContent] = useState('')
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const sendOnEnter = useSettingsStore((s) => s.settings.sendOnEnter ?? 'true')
    const consumedExternalIdRef = useRef<number>(0)

    // Mention state
    const [mentionOpen, setMentionOpen] = useState(false)
    const [mentionFilter, setMentionFilter] = useState('')
    const [mentionIndex, setMentionIndex] = useState(0)
    const [mentionFiles, setMentionFiles] = useState<FlatFile[]>([])
    const mentionAnchorRef = useRef<number>(-1)
    const mentionCwdRef = useRef<string | null>(null)
    // Resolved mentions: maps @displayText → absolute path for send-time substitution
    const [resolvedMentions, setResolvedMentions] = useState<Array<{ display: string; name: string; path: string }>>([])

    async function loadFiles() {
      if (!cwd) return
      // Cache: only refetch if CWD changed
      if (mentionCwdRef.current === cwd && mentionFiles.length > 0) return
      try {
        const tree: FileNode[] = await window.agent.files.listTree(cwd)
        const flat = flattenFileTree(tree, cwd)
        setMentionFiles(flat)
        mentionCwdRef.current = cwd
      } catch {
        setMentionFiles([])
      }
    }

    const handleSend = useCallback(() => {
      const trimmed = content.trim()
      if (!trimmed || disabled || isStreaming) return
      // Resolve @mentions to markdown links before sending
      let resolved = trimmed
      for (const m of resolvedMentions) {
        resolved = resolved.replaceAll(`@${m.display}`, `[${m.name}](${m.path})`)
      }
      onSend(resolved)
      setContent('')
      setResolvedMentions([])
      setMentionOpen(false)
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    }, [content, disabled, isStreaming, onSend, resolvedMentions])

    // Notify parent of canSend state
    useEffect(() => {
      onCanSendChange?.(!!content.trim() && !disabled && !isStreaming)
    }, [content, disabled, isStreaming, onCanSendChange])

    // Expose triggerMention and send to parent
    useImperativeHandle(ref, () => ({
      triggerMention() {
        if (!cwd) return
        setContent((prev) => {
          const separator = prev.length > 0 && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : ''
          const newContent = prev + separator + '@'
          mentionAnchorRef.current = newContent.length - 1
          return newContent
        })
        setMentionFilter('')
        setMentionIndex(0)
        setMentionOpen(true)
        loadFiles()
        // Focus after state update
        setTimeout(() => textareaRef.current?.focus(), 0)
      },
      send() {
        handleSend()
      },
    }), [cwd, handleSend])

    // Append external text (e.g. voice transcription) when it arrives
    useEffect(() => {
      if (!externalText || externalText.id === consumedExternalIdRef.current) return
      consumedExternalIdRef.current = externalText.id
      setContent((prev) => {
        const separator = prev.length > 0 && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : ''
        return prev + separator + externalText.text
      })
      textareaRef.current?.focus()
    }, [externalText])

    // Auto-resize textarea
    useEffect(() => {
      const el = textareaRef.current
      if (!el) return
      el.style.height = 'auto'
      const maxHeight = 6 * 24 // ~6 lines
      el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
    }, [content])

    const closeMention = useCallback(() => {
      setMentionOpen(false)
      setMentionFilter('')
      setMentionIndex(0)
      mentionAnchorRef.current = -1
    }, [])

    const handleSelectFile = useCallback((file: FlatFile) => {
      // Replace @filter with @relativePath (human-readable); resolve to link on send
      const anchor = mentionAnchorRef.current
      const display = file.relativePath
      const mention = `@${display}`
      if (anchor >= 0) {
        setContent((prev) => {
          const before = prev.slice(0, anchor)
          const el = textareaRef.current
          const cursorPos = el ? el.selectionStart : prev.length
          const after = prev.slice(cursorPos)
          return before + mention + after
        })
      } else {
        setContent((prev) => prev + mention)
      }
      // Track this mention for send-time resolution
      setResolvedMentions((prev) => {
        if (prev.some((m) => m.display === display)) return prev
        return [...prev, { display, name: file.name, path: file.path }]
      })
      closeMention()
      textareaRef.current?.focus()
    }, [closeMention])

    const handleChange = useCallback((value: string) => {
      setContent(value)

      if (!cwd) {
        if (mentionOpen) closeMention()
        return
      }

      // Find the last @ that is at position 0 or preceded by space/newline
      const textarea = textareaRef.current
      const cursorPos = textarea ? textarea.selectionStart : value.length

      let atPos = -1
      for (let i = cursorPos - 1; i >= 0; i--) {
        if (value[i] === '@') {
          if (i === 0 || value[i - 1] === ' ' || value[i - 1] === '\n') {
            atPos = i
          }
          break
        }
        // Stop searching if we hit a space or newline before finding @
        if (value[i] === ' ' || value[i] === '\n') break
      }

      if (atPos >= 0) {
        const filter = value.slice(atPos + 1, cursorPos)
        mentionAnchorRef.current = atPos
        setMentionFilter(filter)
        setMentionIndex(0)
        if (!mentionOpen) {
          setMentionOpen(true)
          loadFiles()
        }
      } else if (mentionOpen) {
        closeMention()
      }
    }, [cwd, mentionOpen, closeMention])

    // Compute filtered files for keyboard nav bounds
    const filteredFiles = mentionFilter
      ? mentionFiles.filter((f) => f.relativePath.toLowerCase().includes(mentionFilter.toLowerCase()))
      : mentionFiles

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        // Mention dropdown keyboard handling takes priority
        if (mentionOpen && filteredFiles.length > 0) {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setMentionIndex((prev) => Math.min(prev + 1, filteredFiles.length - 1))
            return
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setMentionIndex((prev) => Math.max(prev - 1, 0))
            return
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault()
            const file = filteredFiles[mentionIndex]
            if (file) handleSelectFile(file)
            return
          }
        }

        if (mentionOpen && e.key === 'Escape') {
          e.preventDefault()
          closeMention()
          return
        }

        if (sendOnEnter === 'false') {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            handleSend()
          }
        } else {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
          }
        }
      },
      [handleSend, sendOnEnter, mentionOpen, filteredFiles, mentionIndex, handleSelectFile, closeMention]
    )

    return (
      <div
        className="flex-1 flex items-end gap-2 rounded-lg px-3 py-2 relative"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        {mentionOpen && (
          <FileMentionDropdown
            files={mentionFiles}
            filter={mentionFilter}
            selectedIndex={mentionIndex}
            onSelect={handleSelectFile}
            onClose={closeMention}
          />
        )}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={onPaste}
          placeholder={disabled ? 'Sign in to start chatting...' : 'Message Claude... (@ to mention files)'}
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none bg-transparent outline-none text-sm leading-6"
          style={{ color: 'var(--color-text)', maxHeight: `${6 * 24}px` }}
          aria-label="Message input"
        />
      </div>
    )
  }
)
