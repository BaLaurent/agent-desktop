import { useSettingsStore } from '../stores/settingsStore'
import { resolveAgentDisplayName } from '../../shared/constants'

export function useAgentDisplayName(effectiveAgentName?: string, effectiveSdkBackend?: string): string {
  const globalAgentName = useSettingsStore((s) => s.settings.agent_name)
  const globalSdkBackend = useSettingsStore((s) => s.settings.ai_sdkBackend)
  return resolveAgentDisplayName(
    effectiveAgentName ?? globalAgentName,
    effectiveSdkBackend ?? globalSdkBackend,
  )
}
