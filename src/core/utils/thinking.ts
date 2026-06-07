/**
 * Strip `<thinking>…</thinking>` blocks from persisted assistant content.
 *
 * Thinking deltas are wrapped in `<thinking>…</thinking>` inside the persisted
 * message content (see streaming.ts / pi/subscribeEvents.ts) so the renderer can
 * split segments back out preserving interleaved text↔thinking order. Any
 * consumer that feeds assistant content to a model or to the user as plain prose
 * (history replay, auto-title, compaction, TTS) must drop these blocks first.
 */
export function stripThinkingBlocks(content: string): string {
  return content.replace(/<thinking>[\s\S]*?<\/thinking>\n?/g, '')
}
