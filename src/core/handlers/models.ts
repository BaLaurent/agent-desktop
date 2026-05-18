import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { HandleRegistrar } from '../dispatch'
import { MODEL_OPTIONS, shortenModelName } from '../types/constants'
import { discoverPIModels } from '../../main/services/piModels'
import { createLogger, errToCtx } from '../utils/logger'

const log = createLogger('models')

interface ModelOption {
  value: string
  label: string
}

interface AnthropicModel {
  id: string
  display_name?: string
  type?: string
}

interface ModelsResponse {
  data: AnthropicModel[]
  has_more: boolean
  last_id: string | null
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MODELS_ENDPOINT = 'https://api.anthropic.com/v1/models'
const STATIC_FALLBACK: ModelOption[] = MODEL_OPTIONS.map((o) => ({ value: o.value, label: o.label }))

interface CacheEntry {
  fetchedAt: number
  models: ModelOption[]
}

let cache: CacheEntry | null = null

async function readOAuthToken(): Promise<string | null> {
  try {
    const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
    const credentialsPath = path.join(configDir, '.credentials.json')
    const data = JSON.parse(await fs.promises.readFile(credentialsPath, 'utf8'))
    const token = data?.claudeAiOauth?.accessToken
    return typeof token === 'string' && token.length > 0 ? token : null
  } catch {
    return null
  }
}

async function fetchPage(token: string, afterId: string | null): Promise<ModelsResponse> {
  const url = afterId ? `${MODELS_ENDPOINT}?limit=100&after_id=${encodeURIComponent(afterId)}` : `${MODELS_ENDPOINT}?limit=100`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'oauth-2025-04-20',
    },
  })
  if (!res.ok) {
    throw new Error(`models endpoint returned ${res.status}: ${await res.text().catch(() => '')}`)
  }
  return (await res.json()) as ModelsResponse
}

async function fetchAllModels(token: string): Promise<ModelOption[]> {
  const collected: AnthropicModel[] = []
  let afterId: string | null = null
  for (let pages = 0; pages < 10; pages++) {
    const page = await fetchPage(token, afterId)
    collected.push(...page.data)
    if (!page.has_more || !page.last_id) break
    afterId = page.last_id
  }
  return collected.map((m) => ({
    value: m.id,
    label: m.display_name || shortenModelName(m.id),
  }))
}

async function loadModels(forceRefresh: boolean): Promise<ModelOption[]> {
  const now = Date.now()
  if (!forceRefresh && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.models
  }
  const token = await readOAuthToken()
  if (!token) return STATIC_FALLBACK
  try {
    const models = await fetchAllModels(token)
    if (models.length === 0) return STATIC_FALLBACK
    cache = { fetchedAt: now, models }
    return models
  } catch (err) {
    log.warn('fetch failed, using static fallback', errToCtx(err))
    return cache?.models ?? STATIC_FALLBACK
  }
}

// consumed by models.test.ts (excluded). (suppressed below)
// fallow-ignore-next-line unused-export
export function _resetModelsCache(): void {
  cache = null
}

async function loadModelsForBackend(backend?: string, forceRefresh = false): Promise<ModelOption[]> {
  if (backend === 'pi') return discoverPIModels()
  return loadModels(forceRefresh)
}

export function registerModelsHandlers(registrar: HandleRegistrar): void {
  registrar.handle('models:list', async (_event, backend?: string) => {
    return loadModelsForBackend(backend, false)
  })
  registrar.handle('models:refresh', async (_event, backend?: string) => {
    return loadModelsForBackend(backend, true)
  })
}
