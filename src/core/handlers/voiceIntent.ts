import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { getAISettings } from './messages'
import { summarizeWithModel } from '../services/summarization'
import { mapModelToBackend } from '../services/modelBackendMap'
import { injectApiKeyEnv } from '../services/streaming'
import { getSetting } from '../utils/db'
import { HAIKU_MODEL, resolveAgentDisplayName } from '../types/constants'
import { DEFAULT_INTENT_PROMPT, buildIntentPrompt } from '../services/voiceIntentPrompt'
import { getAgentDirectives } from './messages/knowledgeBase'

export interface VoiceIntentHandlerOptions {
  sessionsBase: string
  knowledgesDir?: string
}

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
    const agentName = resolveAgentDisplayName(getAgentDirectives(db, convId).name, aiSettings.sdkBackend)
    const prompt = buildIntentPrompt(template, { utterance, agent_name: agentName })

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
