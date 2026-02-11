import type { AIOverrides } from '../../shared/types'
import { AI_OVERRIDE_KEYS } from '../../shared/constants'

export function parseOverrides(json: string | null | undefined): AIOverrides {
  if (!json) return {}
  try {
    const parsed = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const result: AIOverrides = {}
    for (const key of AI_OVERRIDE_KEYS) {
      if (key in parsed && parsed[key] !== undefined && parsed[key] !== '') {
        result[key] = String(parsed[key])
      }
    }
    return result
  } catch {
    return {}
  }
}

export function resolveEffectiveSettings(
  globalSettings: Record<string, string>,
  folderOverrides: AIOverrides,
  convOverrides: AIOverrides
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key of AI_OVERRIDE_KEYS) {
    const value = convOverrides[key] ?? folderOverrides[key] ?? globalSettings[key]
    if (value !== undefined) {
      result[key] = value
    }
  }
  return result
}

export function getInheritanceSource(
  key: keyof AIOverrides,
  folderOverrides: AIOverrides,
  convOverrides: AIOverrides,
  folderName?: string
): string {
  if (convOverrides[key]) return 'Conversation'
  if (folderOverrides[key]) return folderName ? `Folder: ${folderName}` : 'Folder'
  return 'Global'
}
