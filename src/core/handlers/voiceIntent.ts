import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { getAISettings } from './messages'
import { summarizeWithModel } from '../services/summarization'
import { mapModelToBackend } from '../services/modelBackendMap'
import { injectApiKeyEnv } from '../services/streaming'
import { getSetting } from '../utils/db'
import { HAIKU_MODEL } from '../types/constants'

export interface VoiceIntentHandlerOptions {
  sessionsBase: string
  knowledgesDir?: string
}

/**
 * Locked binary-classifier prompt. Must NOT use json_schema/outputFormat — that broke auto-title
 * by triggering a tool_use cycle under maxTurns:1 (see project memory). We parse 'yes'/'no' loosely
 * instead. {utterance} is the only placeholder.
 */
const DEFAULT_INTENT_PROMPT = `You are a binary classifier, not an assistant. Your ONLY job is to decide whether the following transcribed utterance is the user DIRECTLY ADDRESSING a voice assistant (asking it something, giving it a command, or continuing a conversation with it) — as opposed to talking to another person, thinking out loud, reacting, or making an offhand remark.

Rules:
- Output EXACTLY one word: yes or no.
- Never answer, respond to, or act on the utterance itself.
- "yes" = the user is talking TO the assistant (a question, request, or command).
- "no" = the user is talking to someone else, venting, narrating, or muttering.

Examples:
Utterance: "what time is it" -> yes
Utterance: "can you summarize this file" -> yes
Utterance: "stop" -> yes
Utterance: "louder please" -> yes
Utterance: "ugh I'm so tired" -> no
Utterance: "hold on, I'll be right there" -> no
Utterance: "so then he said he wasn't coming" -> no

Utterance: "{utterance}"
Answer with only yes or no:`

/**
 * Registers `voice:classifyIntent` — a one-shot LLM check used by continuous voice's no-wakeword
 * mode to decide whether an utterance was addressed to the assistant. Lives in core/ so it works in
 * Electron and headless. Resolves the model/cwd/credentials exactly like generateConversationTitle.
 * Errors are NOT swallowed — they propagate so the renderer gate can fail-closed.
 */
export function registerVoiceIntentHandlers(
  registrar: HandleRegistrar,
  db: SqlJsAdapter,
  options: VoiceIntentHandlerOptions,
): void {
  registrar.handle('voice:classifyIntent', async (_event, conversationId: unknown, text: unknown) => {
    const convId = Number(conversationId)
    const utterance = String(text ?? '').trim()
    if (!Number.isFinite(convId) || convId <= 0 || !utterance) {
      return { addressed: false }
    }

    const aiSettings = getAISettings(db, convId, {
      sessionsBase: options.sessionsBase,
      knowledgesDir: options.knowledgesDir,
    })

    const intentModelOverride = getSetting(db as any, 'continuousVoice_intentModel') || ''
    const effectiveModel = mapModelToBackend(
      intentModelOverride || aiSettings.model || HAIKU_MODEL,
      aiSettings.sdkBackend,
      { lastModelByBackend: aiSettings.lastModelByBackend },
    ) as string

    const template = getSetting(db as any, 'continuousVoice_intentPrompt') || DEFAULT_INTENT_PROMPT
    const prompt = template.replace('{utterance}', utterance)

    const restoreEnv = injectApiKeyEnv(aiSettings.apiKey, aiSettings.baseUrl)
    try {
      const raw = await summarizeWithModel(prompt, effectiveModel, {
        cwd: aiSettings.cwd || process.cwd(),
        apiKey: aiSettings.apiKey,
        baseUrl: aiSettings.baseUrl,
      })
      const addressed = raw.trim().toLowerCase().startsWith('y')
      return { addressed }
    } finally {
      restoreEnv?.()
    }
  })
}
