import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'path'
import fs from 'fs/promises'
import os from 'os'

// vi.hoisted runs before vi.mock hoisting, so MOCK_HOME is available in the factory
const { MOCK_HOME } = vi.hoisted(() => {
  const { join } = require('path')
  const os = require('os')
  return { MOCK_HOME: join(os.tmpdir(), `agent-theme-test-${Date.now()}`) }
})

vi.mock('electron', () => ({
  app: { getPath: (key: string) => key === 'home' ? MOCK_HOME : MOCK_HOME },
}))

import { registerHandlers, ensureThemeDir } from './themes'

function createMockIpcMain() {
  const handlers = new Map<string, (...args: any[]) => any>()
  return {
    handle: (channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler)
    },
    invoke: async (channel: string, ...args: any[]) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`No handler for ${channel}`)
      return handler({} as any, ...args)
    },
  }
}

const THEMES_DIR = join(MOCK_HOME, '.agent-desktop', 'themes')

describe('Themes Service (Filesystem)', () => {
  let ipc: ReturnType<typeof createMockIpcMain>

  beforeEach(async () => {
    await fs.rm(join(MOCK_HOME, '.agent-desktop'), { recursive: true, force: true })
    await ensureThemeDir()
    ipc = createMockIpcMain()
    registerHandlers(ipc as any)
  })

  afterEach(async () => {
    await fs.rm(join(MOCK_HOME, '.agent-desktop'), { recursive: true, force: true })
  })

  it('ensureThemeDir creates directory and builtin files', async () => {
    const files = await fs.readdir(THEMES_DIR)
    expect(files).toContain('default-dark.css')
    expect(files).toContain('default-light.css')
  })

  it('ensureThemeDir does not overwrite existing builtin files', async () => {
    const darkPath = join(THEMES_DIR, 'default-dark.css')
    await fs.writeFile(darkPath, '/* custom */')
    await ensureThemeDir()
    const content = await fs.readFile(darkPath, 'utf-8')
    expect(content).toBe('/* custom */')
  })

  it('list returns builtin themes', async () => {
    const themes = await ipc.invoke('themes:list') as any[]
    expect(themes.length).toBeGreaterThanOrEqual(2)
    const filenames = themes.map((t: any) => t.filename)
    expect(filenames).toContain('default-dark.css')
    expect(filenames).toContain('default-light.css')
    expect(themes.find((t: any) => t.filename === 'default-dark.css').isBuiltin).toBe(true)
  })

  it('list returns ThemeFile structure', async () => {
    const themes = await ipc.invoke('themes:list') as any[]
    const theme = themes[0]
    expect(theme).toHaveProperty('filename')
    expect(theme).toHaveProperty('name')
    expect(theme).toHaveProperty('isBuiltin')
    expect(theme).toHaveProperty('css')
  })

  it('read returns a single theme by filename', async () => {
    const theme = await ipc.invoke('themes:read', 'default-dark.css') as any
    expect(theme.filename).toBe('default-dark.css')
    expect(theme.name).toBe('Default Dark')
    expect(theme.isBuiltin).toBe(true)
    expect(theme.css).toContain('--color-bg')
  })

  it('create writes a new CSS file and returns ThemeFile', async () => {
    const css = ':root { --color-bg: #000; }'
    const theme = await ipc.invoke('themes:create', 'ocean.css', css) as any
    expect(theme.filename).toBe('ocean.css')
    expect(theme.name).toBe('Ocean')
    expect(theme.isBuiltin).toBe(false)
    expect(theme.css).toBe(css)
    // Verify file on disk
    const content = await fs.readFile(join(THEMES_DIR, 'ocean.css'), 'utf-8')
    expect(content).toBe(css)
  })

  it('create rejects duplicate filename', async () => {
    const css = ':root { --color-bg: #000; }'
    await ipc.invoke('themes:create', 'dupe.css', css)
    await expect(ipc.invoke('themes:create', 'dupe.css', css)).rejects.toThrow('already exists')
  })

  it('save overwrites custom theme CSS', async () => {
    await ipc.invoke('themes:create', 'custom.css', ':root {}')
    await ipc.invoke('themes:save', 'custom.css', ':root { --color-bg: #111; }')
    const theme = await ipc.invoke('themes:read', 'custom.css') as any
    expect(theme.css).toBe(':root { --color-bg: #111; }')
  })

  it('save rejects builtin themes', async () => {
    await expect(
      ipc.invoke('themes:save', 'default-dark.css', ':root {}')
    ).rejects.toThrow('Cannot modify built-in themes')
  })

  it('delete removes custom theme file', async () => {
    await ipc.invoke('themes:create', 'temp.css', ':root {}')
    await ipc.invoke('themes:delete', 'temp.css')
    const themes = await ipc.invoke('themes:list') as any[]
    expect(themes.find((t: any) => t.filename === 'temp.css')).toBeUndefined()
  })

  it('delete rejects builtin themes', async () => {
    await expect(
      ipc.invoke('themes:delete', 'default-dark.css')
    ).rejects.toThrow('Cannot delete built-in themes')
  })

  it('getDir returns themes directory path', async () => {
    const dir = await ipc.invoke('themes:getDir')
    expect(dir).toBe(THEMES_DIR)
  })

  it('refresh re-scans directory', async () => {
    await fs.writeFile(join(THEMES_DIR, 'external.css'), ':root {}')
    const themes = await ipc.invoke('themes:refresh') as any[]
    expect(themes.find((t: any) => t.filename === 'external.css')).toBeDefined()
  })

  it('validates filename - rejects without .css extension', async () => {
    await expect(ipc.invoke('themes:create', 'bad.txt', ':root {}')).rejects.toThrow('.css')
  })

  it('validates filename - rejects path separators', async () => {
    await expect(ipc.invoke('themes:create', '../evil.css', ':root {}')).rejects.toThrow()
  })

  it('validates filename - rejects path with slashes', async () => {
    await expect(ipc.invoke('themes:create', 'a/b.css', ':root {}')).rejects.toThrow('path separators')
  })

  it('ensureThemeDir creates cheatsheet.md', async () => {
    const files = await fs.readdir(THEMES_DIR)
    expect(files).toContain('cheatsheet.md')
    const content = await fs.readFile(join(THEMES_DIR, 'cheatsheet.md'), 'utf-8')
    expect(content).toContain('CSS Custom Properties')
    expect(content).toContain('--color-bg')
  })

  it('ensureThemeDir does not overwrite existing cheatsheet.md', async () => {
    const cheatsheetPath = join(THEMES_DIR, 'cheatsheet.md')
    await fs.writeFile(cheatsheetPath, '/* custom cheatsheet */')
    await ensureThemeDir()
    const content = await fs.readFile(cheatsheetPath, 'utf-8')
    expect(content).toBe('/* custom cheatsheet */')
  })

  it('derives display name from filename', async () => {
    await ipc.invoke('themes:create', 'my-custom-theme.css', ':root {}')
    const theme = await ipc.invoke('themes:read', 'my-custom-theme.css') as any
    expect(theme.name).toBe('My Custom Theme')
  })
})
