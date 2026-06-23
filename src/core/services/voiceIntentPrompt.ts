/**
 * Single source of truth for the continuous-voice intent classifier prompt.
 * Lives in core/ (no electron import) so the Electron handler, the headless
 * runtime, and the renderer settings UI all share one definition.
 *
 * Must NOT be paired with json_schema/outputFormat by callers — the handler
 * parses 'yes'/'no' loosely (a json_schema cycle broke auto-title under
 * maxTurns:1; see project memory).
 *
 * Placeholders: {agent_name} (the assistant's effective display name) and
 * {utterance} (the transcribed text being classified).
 */
export const DEFAULT_INTENT_PROMPT = `You are a binary classifier, not an assistant. Your ONLY job is to decide whether the following transcribed utterance is the user DIRECTLY ADDRESSING a voice assistant named "{agent_name}" (asking it something, giving it a command, or continuing a conversation with it) — as opposed to talking to another person, thinking out loud, reacting, or making an offhand remark.

Rules:
- Output EXACTLY one word: yes or no.
- Never answer, respond to, or act on the utterance itself.
- "yes" = the user is talking TO {agent_name} (a question, request, or command).
- "no" = the user is talking to someone else, venting, narrating, or muttering.

Examples:
Utterance: "what time is it" -> yes
Utterance: "can you summarize this file" -> yes
Utterance: "{agent_name}, stop" -> yes
Utterance: "louder please" -> yes
Utterance: "ugh I'm so tired" -> no
Utterance: "hold on, I'll be right there" -> no
Utterance: "so then he said he wasn't coming" -> no

Utterance: "{utterance}"
Answer with only yes or no:`

/**
 * Replace every {token} in `template` with replacements[token], in a single
 * pass. Single-pass + function replacer avoids: partial replacement (only the
 * first match), `$`-pattern interpretation in user-supplied values, and
 * re-interpreting tokens that appear inside an injected value. Unknown tokens
 * are left untouched.
 */
export function buildIntentPrompt(template: string, replacements: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : match,
  )
}

/**
 * Map an editor draft to its stored setting value: empty string when the draft
 * is byte-identical to the default (so the conversation keeps inheriting future
 * default improvements), otherwise the draft verbatim.
 */
export function draftToStored(draft: string): string {
  return draft === DEFAULT_INTENT_PROMPT ? '' : draft
}
