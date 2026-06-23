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
    // Dedicated endpoint for the gate, cascading to the conversation's settings when empty.
    // A dedicated base URL is the signal the user wants a specific endpoint (e.g. a local
    // Ollama/vLLM/gateway speaking the Anthropic protocol) — in that mode we skip the
    // conversation-backend remap and force the Claude HTTP path against that base URL.
    const intentBaseUrl = getSetting(db as any, 'continuousVoice_intentBaseUrl') || ''
    const intentApiKey = getSetting(db as any, 'continuousVoice_intentApiKey') || ''
    const baseUrl = intentBaseUrl || aiSettings.baseUrl
    const apiKey = intentApiKey || aiSettings.apiKey

    const requestedModel = intentModelOverride || aiSettings.model || HAIKU_MODEL
    const customEndpoint = intentBaseUrl !== ''
    const effectiveModel = customEndpoint
      ? requestedModel
      : (mapModelToBackend(requestedModel, aiSettings.sdkBackend, {
          lastModelByBackend: aiSettings.lastModelByBackend,
        }) as string)

    const template = getSetting(db as any, 'continuousVoice_intentPrompt') || DEFAULT_INTENT_PROMPT
    const agentName = resolveAgentDisplayName(getAgentDirectives(db, convId).name, aiSettings.sdkBackend)
    const prompt = buildIntentPrompt(template, { utterance, agent_name: agentName })

    const restoreEnv = injectApiKeyEnv(apiKey, baseUrl)
    try {
      const raw = await summarizeWithModel(prompt, effectiveModel, {
        cwd: aiSettings.cwd || process.cwd(),
        apiKey,
        baseUrl,
        ...(customEndpoint ? { backend: 'claude' as const } : {}),
      })
      const addressed = raw.trim().toLowerCase().startsWith('y')
      return { addressed }
    } finally {
      restoreEnv?.()
    }
  })
}
