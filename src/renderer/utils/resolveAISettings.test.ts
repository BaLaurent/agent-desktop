import { parseOverrides, resolveEffectiveSettings, getInheritanceSource } from './resolveAISettings'

describe('resolveAISettings', () => {
  describe('parseOverrides', () => {
    it('returns empty object for null', () => {
      expect(parseOverrides(null)).toEqual({})
    })

    it('returns empty object for undefined', () => {
      expect(parseOverrides(undefined)).toEqual({})
    })

    it('returns empty object for empty string', () => {
      expect(parseOverrides('')).toEqual({})
    })

    it('returns empty object for invalid JSON', () => {
      expect(parseOverrides('{bad json')).toEqual({})
    })

    it('parses valid JSON with known keys', () => {
      const result = parseOverrides(JSON.stringify({ ai_model: 'claude-opus-4-6', ai_maxTurns: '10' }))
      expect(result).toEqual({ ai_model: 'claude-opus-4-6', ai_maxTurns: '10' })
    })

    it('strips unknown keys', () => {
      const result = parseOverrides(JSON.stringify({ ai_model: 'claude-opus-4-6', unknownKey: 'foo' }))
      expect(result).toEqual({ ai_model: 'claude-opus-4-6' })
    })

    it('strips empty string values', () => {
      const result = parseOverrides(JSON.stringify({ ai_model: '', ai_maxTurns: '5' }))
      expect(result).toEqual({ ai_maxTurns: '5' })
    })

    it('parses ai_mcpDisabled key (regression: must be in AI_OVERRIDE_KEYS whitelist)', () => {
      const disabled = JSON.stringify(['server-a', 'server-b'])
      const result = parseOverrides(JSON.stringify({ ai_mcpDisabled: disabled }))
      expect(result).toEqual({ ai_mcpDisabled: disabled })
    })

    it('returns empty object for non-object JSON', () => {
      expect(parseOverrides('"string"')).toEqual({})
      expect(parseOverrides('42')).toEqual({})
      expect(parseOverrides('null')).toEqual({})
    })
  })

  describe('resolveEffectiveSettings', () => {
    const global = { ai_model: 'claude-sonnet-4-5-20250929', ai_maxTurns: '5' }

    it('returns global values when no overrides', () => {
      const result = resolveEffectiveSettings(global, {}, {})
      expect(result['ai_model']).toBe('claude-sonnet-4-5-20250929')
      expect(result['ai_maxTurns']).toBe('5')
    })

    it('folder overrides global', () => {
      const result = resolveEffectiveSettings(global, { ai_model: 'claude-opus-4-6' }, {})
      expect(result['ai_model']).toBe('claude-opus-4-6')
      expect(result['ai_maxTurns']).toBe('5') // still global
    })

    it('conversation overrides folder and global', () => {
      const result = resolveEffectiveSettings(
        global,
        { ai_model: 'claude-opus-4-6' },
        { ai_model: 'claude-haiku-4-5-20251001' }
      )
      expect(result['ai_model']).toBe('claude-haiku-4-5-20251001')
    })

    it('conversation overrides folder for one key, folder overrides global for another', () => {
      const result = resolveEffectiveSettings(
        global,
        { ai_maxTurns: '10' },
        { ai_model: 'claude-opus-4-6' }
      )
      expect(result['ai_model']).toBe('claude-opus-4-6')
      expect(result['ai_maxTurns']).toBe('10')
    })

    it('propagates ai_mcpDisabled through cascade', () => {
      const disabled = '["server-x"]'
      const result = resolveEffectiveSettings(global, {}, { ai_mcpDisabled: disabled })
      expect(result['ai_mcpDisabled']).toBe(disabled)
    })

    it('conversation ai_mcpDisabled overrides folder ai_mcpDisabled', () => {
      const result = resolveEffectiveSettings(
        global,
        { ai_mcpDisabled: '["folder-disabled"]' },
        { ai_mcpDisabled: '["conv-disabled"]' }
      )
      expect(result['ai_mcpDisabled']).toBe('["conv-disabled"]')
    })
  })

  describe('getInheritanceSource', () => {
    it('returns Global when no overrides', () => {
      expect(getInheritanceSource('ai_model', {}, {})).toBe('Global')
    })

    it('returns Folder name when folder overrides', () => {
      expect(getInheritanceSource('ai_model', { ai_model: 'x' }, {}, 'My Folder')).toBe('Folder: My Folder')
    })

    it('returns Conversation when conv overrides', () => {
      expect(getInheritanceSource('ai_model', { ai_model: 'x' }, { ai_model: 'y' }, 'My Folder')).toBe('Conversation')
    })

    it('returns Folder without name when folderName not provided', () => {
      expect(getInheritanceSource('ai_model', { ai_model: 'x' }, {})).toBe('Folder')
    })
  })
})
