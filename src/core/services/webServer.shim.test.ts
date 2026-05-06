import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { generateShim } from './webServer'

// Extract top-level AgentAPI namespaces from the type definition, so that
// adding a new namespace to the Electron preload (preload/api.d.ts) without
// also adding it to the WS shim becomes a test failure — preventing drifts
// like the missing `git` namespace that crashed the web app's RightSidebarPanel.
function extractNamespacesFromApiDts(): string[] {
  const dtsPath = resolve(__dirname, '../../preload/api.d.ts')
  const src = readFileSync(dtsPath, 'utf8')
  const match = src.match(/export\s+interface\s+AgentAPI\s*\{([\s\S]*?)\n\}/)
  if (!match) throw new Error('AgentAPI interface not found in api.d.ts')
  const body = match[1]
  // Match exactly two-space indented `name: {` (top-level members only).
  const re = /^  (\w+)\s*:\s*\{/gm
  const names: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    names.push(m[1])
  }
  return names
}

describe('webServer shim — AgentAPI parity', () => {
  const shim = generateShim('test-token')
  const expected = extractNamespacesFromApiDts()

  it('extracts a non-trivial set of namespaces from api.d.ts', () => {
    // Sanity check on the regex itself — if this drops to <10 the parser broke
    // and the parity test below would silently pass against an empty list.
    expect(expected.length).toBeGreaterThan(20)
    expect(expected).toContain('git')
    expect(expected).toContain('settings')
  })

  it.each(expected)('shim exposes the %s namespace', (name) => {
    const re = new RegExp(`\\b${name}\\s*:\\s*\\{`)
    expect(shim).toMatch(re)
  })

  it('git namespace exposes all required methods', () => {
    const methods = [
      'isRepo', 'status', 'logGraph', 'commitDetail',
      'branches', 'stashList', 'checkout',
      'stashSave', 'stashPop', 'fetch',
    ]
    for (const m of methods) {
      expect(shim).toContain(`${m}: function`)
    }
  })

  it('git.isRepo wires to the git:isRepo channel', () => {
    expect(shim).toContain("invoke('git:isRepo'")
  })
})
