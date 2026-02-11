type AgentSDK = typeof import('@anthropic-ai/claude-agent-sdk')
let _sdkCache: AgentSDK | null = null

async function loadAgentSDK(): Promise<AgentSDK> {
  if (!_sdkCache) {
    _sdkCache = await (Function(
      'return import("@anthropic-ai/claude-agent-sdk")'
    )() as Promise<AgentSDK>)
  }
  return _sdkCache
}

export { loadAgentSDK }
