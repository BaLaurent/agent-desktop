import { useSettingsStore } from '../stores/settingsStore'
import { BACKEND_DISPLAY_NAMES } from '../../shared/constants'

export function useAgentDisplayName(effectiveAgentName?: string, effectiveSdkBackend?: string): string {
  const globalAgentName = useSettingsStore((s) => s.settings.agent_name)
  const globalSdkBackend = useSettingsStore((s) => s.settings.ai_sdkBackend)
  const name = effectiveAgentName ?? globalAgentName
  const backend = effectiveSdkBackend ?? globalSdkBackend
  return name || BACKEND_DISPLAY_NAMES[backend ?? 'claude-agent-sdk'] || 'Claude'
}
