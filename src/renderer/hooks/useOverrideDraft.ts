import { useState, useMemo, useCallback } from 'react'
import type { AIOverrides, CwdWhitelistEntry } from '../../shared/types'
import { parseMcpDisabledList } from '../utils/mcpUtils'

function parseCwdWhitelist(json: string | undefined): CwdWhitelistEntry[] {
  if (!json) return []
  try { const arr = JSON.parse(json); return Array.isArray(arr) ? arr : [] } catch { return [] }
}

export function useOverrideDraft(
  initialOverrides: AIOverrides,
  fallbackValues: Record<string, string>,
) {
  const [draft, setDraft] = useState<AIOverrides>({ ...initialOverrides })

  const mcpDisabledDraft = useMemo(() => parseMcpDisabledList(draft.ai_mcpDisabled), [draft.ai_mcpDisabled])
  const mcpDisabledInherited = useMemo(() => parseMcpDisabledList(fallbackValues['ai_mcpDisabled']), [fallbackValues])

  const mcpOverridden = draft.ai_mcpDisabled !== undefined

  const cwdWhitelistDraft = useMemo(() => parseCwdWhitelist(draft.hooks_cwdWhitelist), [draft.hooks_cwdWhitelist])
  const cwdWhitelistInherited = useMemo(() => parseCwdWhitelist(fallbackValues['hooks_cwdWhitelist']), [fallbackValues])
  const cwdWhitelistOverridden = draft.hooks_cwdWhitelist !== undefined

  const toggleMcpOverride = useCallback(() => {
    setDraft((prev) => {
      const next = { ...prev }
      if (next.ai_mcpDisabled !== undefined) {
        delete next.ai_mcpDisabled
      } else {
        next.ai_mcpDisabled = fallbackValues['ai_mcpDisabled'] || '[]'
      }
      return next
    })
  }, [fallbackValues])

  const toggleMcpServer = useCallback((serverName: string) => {
    setDraft((prev) => {
      const disabled = new Set(parseMcpDisabledList(prev.ai_mcpDisabled))
      if (disabled.has(serverName)) {
        disabled.delete(serverName)
      } else {
        disabled.add(serverName)
      }
      return { ...prev, ai_mcpDisabled: disabled.size > 0 ? JSON.stringify([...disabled]) : '[]' }
    })
  }, [])

  const toggleCwdWhitelistOverride = useCallback(() => {
    setDraft((prev) => {
      const next = { ...prev }
      if (next.hooks_cwdWhitelist !== undefined) {
        delete next.hooks_cwdWhitelist
      } else {
        next.hooks_cwdWhitelist = fallbackValues['hooks_cwdWhitelist'] || '[]'
      }
      return next
    })
  }, [fallbackValues])

  const setCwdWhitelist = useCallback((entries: CwdWhitelistEntry[]) => {
    setDraft((prev) => ({ ...prev, hooks_cwdWhitelist: JSON.stringify(entries) }))
  }, [])

  const toggleOverride = useCallback((key: string) => {
    setDraft((prev) => {
      const next = { ...prev }
      if (next[key as keyof AIOverrides] !== undefined) {
        delete next[key as keyof AIOverrides]
      } else {
        next[key as keyof AIOverrides] = fallbackValues[key] || ''
      }
      return next
    })
  }, [fallbackValues])

  const setValue = useCallback((key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }, [])

  const cleanDraft = useCallback((): AIOverrides => {
    const cleaned: AIOverrides = {}
    for (const [k, v] of Object.entries(draft)) {
      if (v !== undefined && v !== '') {
        if (k === 'ai_mcpDisabled' || k === 'hooks_cwdWhitelist') {
          cleaned[k as keyof AIOverrides] = v
        } else {
          cleaned[k as keyof AIOverrides] = v
        }
      }
    }
    return Object.keys(cleaned).length > 0 ? cleaned : {}
  }, [draft])

  return {
    draft,
    mcpDisabledDraft,
    mcpDisabledInherited,
    mcpOverridden,
    toggleMcpOverride,
    toggleMcpServer,
    cwdWhitelistDraft,
    cwdWhitelistInherited,
    cwdWhitelistOverridden,
    toggleCwdWhitelistOverride,
    setCwdWhitelist,
    toggleOverride,
    setValue,
    cleanDraft,
  }
}
