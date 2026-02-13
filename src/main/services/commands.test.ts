import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'

// Mock fs/promises before import
const mockReaddir = vi.fn()
const mockOpen = vi.fn()
vi.mock('fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  open: (...args: unknown[]) => mockOpen(...args),
}))

vi.mock('../utils/paths', () => ({
  expandTilde: (p: string) => p.replace('~', '/home/testuser'),
}))

import { registerHandlers } from './commands'

function mkFd(content: string) {
  return {
    read: vi.fn().mockImplementation((buf: Buffer) => {
      buf.write(content, 0, 'utf-8')
      return Promise.resolve({ bytesRead: content.length })
    }),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

/** Helper: Dirent-like objects for readdir({ withFileTypes: true }) */
function dirent(name: string, isDir: boolean) {
  return { name, isDirectory: () => isDir, isFile: () => !isDir }
}

describe('commands service', () => {
  let handlers: Record<string, (...args: unknown[]) => Promise<unknown>>

  beforeEach(() => {
    vi.resetAllMocks()
    handlers = {}
    const fakeIpcMain = {
      handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
        handlers[channel] = (...args: unknown[]) => Promise.resolve(handler({} as IpcMainInvokeEvent, ...args))
      },
    } as unknown as IpcMain
    registerHandlers(fakeIpcMain)
  })

  it('registers commands:list handler', () => {
    expect(handlers['commands:list']).toBeDefined()
  })

  it('returns builtin commands when no dirs exist', async () => {
    mockReaddir.mockRejectedValue(new Error('ENOENT'))
    const result = await handlers['commands:list']() as { name: string; source: string }[]
    expect(result.length).toBe(3)
    expect(result.map((c) => c.name)).toContain('compact')
    expect(result.map((c) => c.name)).toContain('clear')
    expect(result.map((c) => c.name)).toContain('help')
    expect(result.every((c) => c.source === 'builtin')).toBe(true)
  })

  it('scans user commands directory', async () => {
    mockReaddir.mockResolvedValueOnce(['mycmd.md'])
    mockOpen.mockResolvedValue(mkFd('---\ndescription: My custom command\n---\n# Content'))

    const result = await handlers['commands:list']() as { name: string; description: string; source: string }[]
    const userCmd = result.find((c) => c.name === 'mycmd')
    expect(userCmd).toBeDefined()
    expect(userCmd!.source).toBe('user')
    expect(userCmd!.description).toBe('My custom command')
  })

  it('scans project commands directory when cwd provided', async () => {
    mockReaddir
      .mockResolvedValueOnce([])            // user commands dir empty
      .mockResolvedValueOnce(['review.md']) // project commands dir
    mockOpen.mockResolvedValue(mkFd('---\ndescription: Project command\n---\n'))

    const result = await handlers['commands:list']('/tmp/myproject') as { name: string; source: string }[]
    const projectCmd = result.find((c) => c.name === 'review')
    expect(projectCmd).toBeDefined()
    expect(projectCmd!.source).toBe('project')
  })

  it('project commands override user commands with same name', async () => {
    mockReaddir
      .mockResolvedValueOnce(['review.md'])  // user dir
      .mockResolvedValueOnce(['review.md'])  // project dir
    mockOpen
      .mockResolvedValueOnce(mkFd('---\ndescription: User review\n---\n'))
      .mockResolvedValueOnce(mkFd('---\ndescription: Project review\n---\n'))

    const result = await handlers['commands:list']('/tmp/myproject') as { name: string; description: string; source: string }[]
    const reviewCmds = result.filter((c) => c.name === 'review')
    expect(reviewCmds.length).toBe(1)
    expect(reviewCmds[0].source).toBe('project')
    expect(reviewCmds[0].description).toBe('Project review')
  })

  it('handles files without frontmatter gracefully', async () => {
    mockReaddir.mockResolvedValueOnce(['nocmd.md'])
    mockOpen.mockResolvedValue(mkFd('# Just markdown, no frontmatter'))

    const result = await handlers['commands:list']() as { name: string; description: string }[]
    const cmd = result.find((c) => c.name === 'nocmd')
    expect(cmd).toBeDefined()
    expect(cmd!.description).toBe('')
  })

  it('skips non-.md files', async () => {
    mockReaddir.mockResolvedValueOnce(['readme.txt', 'script.sh', 'valid.md'])
    mockOpen.mockResolvedValue(mkFd('---\ndescription: Valid\n---\n'))

    const result = await handlers['commands:list']() as { name: string }[]
    const nonBuiltin = result.filter((c) => !['compact', 'clear', 'help'].includes(c.name))
    expect(nonBuiltin.length).toBe(1)
    expect(nonBuiltin[0].name).toBe('valid')
  })

  // ─── Skills tests ─────────────────────────────────────────

  it('does not scan skills when skillsMode is off or absent', async () => {
    mockReaddir.mockResolvedValue([])
    const result1 = await handlers['commands:list']() as { source: string }[]
    const result2 = await handlers['commands:list'](undefined, 'off') as { source: string }[]
    expect(result1.every((c) => c.source !== 'skill')).toBe(true)
    expect(result2.every((c) => c.source !== 'skill')).toBe(true)
  })

  it('scans user skills when skillsMode is user', async () => {
    mockReaddir
      .mockResolvedValueOnce([])  // user commands dir
      // readdir({ withFileTypes: true }) for user skills dir
      .mockResolvedValueOnce([dirent('weather-wttr', true), dirent('somefile.txt', false)])
    mockOpen.mockResolvedValue(mkFd('---\nname: weather-wttr\ndescription: Weather info\n---\n'))

    const result = await handlers['commands:list'](undefined, 'user') as { name: string; description: string; source: string }[]
    const skill = result.find((c) => c.name === 'weather-wttr')
    expect(skill).toBeDefined()
    expect(skill!.source).toBe('skill')
    expect(skill!.description).toBe('Weather info')
  })

  it('uses frontmatter name over folder name for skills', async () => {
    mockReaddir
      .mockResolvedValueOnce([])  // user commands dir
      .mockResolvedValueOnce([dirent('godot-animator', true)])  // user skills dir
    mockOpen.mockResolvedValue(mkFd('---\nname: godot-svg-animator\ndescription: Animate sprites\n---\n'))

    const result = await handlers['commands:list'](undefined, 'user') as { name: string }[]
    expect(result.find((c) => c.name === 'godot-svg-animator')).toBeDefined()
    expect(result.find((c) => c.name === 'godot-animator')).toBeUndefined()
  })

  it('scans project skills only in project mode', async () => {
    mockReaddir
      .mockResolvedValueOnce([])  // user commands dir
      .mockResolvedValueOnce([])  // project commands dir
      .mockResolvedValueOnce([])  // user skills dir
      .mockResolvedValueOnce([dirent('my-skill', true)])  // project skills dir
    mockOpen.mockResolvedValue(mkFd('---\nname: my-skill\ndescription: Project skill\n---\n'))

    const result = await handlers['commands:list']('/tmp/proj', 'project') as { name: string; source: string }[]
    const skill = result.find((c) => c.name === 'my-skill')
    expect(skill).toBeDefined()
    expect(skill!.source).toBe('skill')
  })

  it('does not scan project skills in user mode', async () => {
    mockReaddir
      .mockResolvedValueOnce([])  // user commands dir
      .mockResolvedValueOnce([])  // project commands dir
      .mockResolvedValueOnce([])  // user skills dir (only this one scanned, not project)
    // 4th call would be project skills but shouldn't happen

    const result = await handlers['commands:list']('/tmp/proj', 'user') as { source: string }[]
    expect(result.every((c) => c.source !== 'skill')).toBe(true)
    // readdir should have been called exactly 3 times (user cmds, project cmds, user skills)
    expect(mockReaddir).toHaveBeenCalledTimes(3)
  })

  it('handles YAML folded block description in skills', async () => {
    const yamlContent = '---\nname: weather\ndescription: >\n  Fetch weather info\n  from the API.\n---\n'
    mockReaddir
      .mockResolvedValueOnce([])  // user commands dir
      .mockResolvedValueOnce([dirent('weather', true)])  // user skills dir
    mockOpen.mockResolvedValue(mkFd(yamlContent))

    const result = await handlers['commands:list'](undefined, 'user') as { name: string; description: string }[]
    const skill = result.find((c) => c.name === 'weather')
    expect(skill).toBeDefined()
    expect(skill!.description).toBe('Fetch weather info from the API.')
  })

  it('handles quoted description in skills', async () => {
    mockReaddir
      .mockResolvedValueOnce([])  // user commands dir
      .mockResolvedValueOnce([dirent('my-skill', true)])  // user skills dir
    mockOpen.mockResolvedValue(mkFd('---\nname: my-skill\ndescription: "Quoted description"\n---\n'))

    const result = await handlers['commands:list'](undefined, 'user') as { name: string; description: string }[]
    const skill = result.find((c) => c.name === 'my-skill')
    expect(skill!.description).toBe('Quoted description')
  })

  it('falls back to folder name when skill has no frontmatter name', async () => {
    mockReaddir
      .mockResolvedValueOnce([])  // user commands dir
      .mockResolvedValueOnce([dirent('unnamed-skill', true)])  // user skills dir
    mockOpen.mockResolvedValue(mkFd('---\ndescription: No name field\n---\n'))

    const result = await handlers['commands:list'](undefined, 'user') as { name: string }[]
    expect(result.find((c) => c.name === 'unnamed-skill')).toBeDefined()
  })
})
