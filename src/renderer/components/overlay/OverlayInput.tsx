import { useState, useRef, useEffect } from 'react'

interface OverlayInputProps {
  onSend: (text: string) => void
  isStreaming: boolean
}

export function OverlayInput({ onSend, isStreaming }: OverlayInputProps) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && text.trim() && !isStreaming) {
      e.preventDefault()
      onSend(text.trim())
      setText('')
    }
  }

  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything..."
        className="flex-1 bg-transparent outline-none text-sm"
        style={{ color: 'var(--color-text, #e0e0e0)' }}
        aria-label="Quick chat input"
        disabled={isStreaming}
      />
      {isStreaming && (
        <div
          className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'var(--color-primary, #6366f1)', borderTopColor: 'transparent' }}
        />
      )}
    </div>
  )
}
