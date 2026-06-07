// PI-SDK model resolution. The SDK's createAgentSession expects an object
// Model<any> (provider+id+auth metadata), NOT a string identifier. Passing
// a string causes the SDK to silently fall back to its default model, which
// confuses the user (and surfaces as misleading "no API key" errors).
//
// We resolve "provider/id" strings into the SDK's Model object by calling
// modelRegistry.find(provider, id). The CLI does the same pipeline internally.

interface PISdkLike {
  AuthStorage: { create(): unknown }
  ModelRegistry: new (auth: unknown) => {
    find(provider: string, id: string): unknown
    getAvailable(): Array<{ provider: string; id: string }>
  }
}

export async function resolvePIModelObject(
  pi: PISdkLike,
  modelId: string | undefined,
): Promise<unknown | undefined> {
  if (!modelId) return undefined

  const authStorage = pi.AuthStorage.create()
  const modelRegistry = new pi.ModelRegistry(authStorage)

  if (modelId.includes('/')) {
    const [provider, ...rest] = modelId.split('/')
    const resolvedId = rest.join('/')
    const model = modelRegistry.find(provider, resolvedId)
    if (!model) throw new Error(`PI model not found in registry: ${modelId}`)
    return model
  }

  // Bare id (no provider prefix) — try unique-match across all providers.
  const available = await modelRegistry.getAvailable()
  const matches = available.filter((m) => m.id === modelId)
  if (matches.length === 0) throw new Error(`PI model not found in registry: ${modelId}`)
  if (matches.length > 1) throw new Error(`PI model ambiguous (multiple providers): ${modelId}`)
  const match = matches[0]
  return modelRegistry.find(match.provider, match.id)
}
