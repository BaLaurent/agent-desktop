import { useState, useRef, useEffect, useCallback } from 'react'
import { useConversationsStore } from '../../stores/conversationsStore'

export function SearchBar() {
  const [value, setValue] = useState('')
  const searchConversations = useConversationsStore((s) => s.searchConversations)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const debouncedSearch = useCallback(
    (query: string) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        searchConversations(query)
      }, 300)
    },
    [searchConversations]
  )

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value
    setValue(query)
    debouncedSearch(query)
  }

  const handleClear = () => {
    setValue('')
    searchConversations('')
    inputRef.current?.focus()
  }

  return (
    <div className="relative px-3 py-2">
      <svg
        className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4"
        style={{ color: 'var(--color-text-muted)' }}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        placeholder="Search conversations..."
        className="w-full pl-8 pr-8 py-1.5 rounded text-sm outline-none"
        style={{
          backgroundColor: 'var(--color-bg)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-text-muted)',
        }}
        aria-label="Search conversations"
      />
      {value && (
        <button
          onClick={handleClear}
          className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full text-xs"
          style={{ color: 'var(--color-text-muted)' }}
          aria-label="Clear search"
        >
          &times;
        </button>
      )}
    </div>
  )
}
