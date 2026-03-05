import { useSettingsStore } from '../stores/settingsStore'
import { BACKEND_DISPLAY_NAMES } from '../../shared/constants'

export function useAgentDisplayName(): string {
  const agentName = useSettingsStore((s) => s.settings.agent_name)
  const sdkBackend = useSettingsStore((s) => s.settings.ai_sdkBackend)
  return agentName || BACKEND_DISPLAY_NAMES[sdkBackend ?? 'claude-agent-sdk'] || 'Claude'
}
