import { useConversationsStore } from '../../stores/conversationsStore'

export function EmptyState() {
  const createConversation = useConversationsStore((s) => s.createConversation)

  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <svg
        className="w-12 h-12 mb-4"
        style={{ color: 'var(--color-text-muted)' }}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
        />
      </svg>
      <p className="text-sm mb-4" style={{ color: 'var(--color-text-muted)' }}>
        No conversations yet
      </p>
      <button
        onClick={() => createConversation()}
        className="px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80 bg-primary text-contrast"
      >
        Start a new conversation
      </button>
    </div>
  )
}
