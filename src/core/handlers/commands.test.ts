import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { DispatchRegistry } from '../dispatch'
import { registerCommandsHandlers } from './commands'
import { createTestDb } from '../__tests__/db-helper'
import type { SqlJsAdapter } from '../db/sqljs-adapter'

const { discoverOmpCommandsCached } = vi.hoisted(() => ({ discoverOmpCommandsCached: vi.fn() }))
vi.mock('../services/pi/ompCommands', () => ({ discoverOmpCommandsCached }))

// Each test runs with a dedicated HOME → ~/.agent-desktop/macros resolves to a temp dir.
// getMacrosDir() in commands.ts calls expandTilde() which reads process.env.HOME at call time,
// so we only need to set HOME before each test, no module re-import needed.

describe('commands handlers (macros)', () => {
  let dispatch: DispatchRegistry
  let tmpHome: string
  let origHome: string | undefined
  let macrosDir: string
  let db: SqlJsAdapter

  beforeEach(async () => {
    origHome = process.env.HOME
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'macros-test-'))
    process.env.HOME = tmpHome
    macrosDir = path.join(tmpHome, '.agent-desktop', 'macros')

    dispatch = new DispatchRegistry()
    db = await createTestDb()
    registerCommandsHandlers(dispatch, db as never)
    discoverOmpCommandsCached.mockReset()
    discoverOmpCommandsCached.mockResolvedValue([])
  })

  afterEach(async () => {
    if (origHome !== undefined) process.env.HOME = origHome
    else delete process.env.HOME
    await fs.rm(tmpHome, { recursive: true, force: true })
  })

  it('registers macros:list / save / delete / load handlers', () => {
    expect(dispatch.has('macros:list')).toBe(true)
    expect(dispatch.has('macros:save')).toBe(true)
    expect(dispatch.has('macros:delete')).toBe(true)
    expect(dispatch.has('macros:load')).toBe(true)
  })

  it('macros:list returns [] when directory missing', async () => {
    const list = dispatch.get('macros:list')!
    const result = await list()
    expect(result).toEqual([])
  })

  it('macros:save creates a file that macros:list sees', async () => {
    const save = dispatch.get('macros:save')!
    await save('demo', 'A demo macro', ['hello', 'world'])

    const list = dispatch.get('macros:list')!
    const result = (await list()) as Array<{ name: string; description: string; messages: string[] }>
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ name: 'demo', description: 'A demo macro', messages: ['hello', 'world'] })

    // File should exist on disk with the expected shape
    const raw = await fs.readFile(path.join(macrosDir, 'demo.json'), 'utf-8')
    expect(JSON.parse(raw)).toEqual({ description: 'A demo macro', messages: ['hello', 'world'] })
  })

  it('macros:save rejects invalid name (path traversal attempt)', async () => {
    const save = dispatch.get('macros:save')!
    await expect(save('../evil', '', ['x'])).rejects.toThrow(/Invalid macro name/)
    await expect(save('bad/name', '', ['x'])).rejects.toThrow(/Invalid macro name/)
    await expect(save('', '', ['x'])).rejects.toThrow(/Invalid macro name/)
  })

  it('macros:save rejects empty messages array', async () => {
    const save = dispatch.get('macros:save')!
    await expect(save('ok-name', 'desc', [])).rejects.toThrow(/Invalid macro content/)
  })

  it('macros:save rejects non-string messages', async () => {
    const save = dispatch.get('macros:save')!
    await expect(save('ok-name', 'desc', [123, 'x'])).rejects.toThrow(/all messages must be strings/)
  })

  it('macros:save refuses to silently overwrite on rename collision', async () => {
    const save = dispatch.get('macros:save')!
    await save('alpha', '', ['x'])
    await save('beta', '', ['y'])
    // Trying to rename alpha → beta must not clobber beta
    await expect(save('beta', '', ['z'], 'alpha')).rejects.toThrow(/already exists/)
    const list = dispatch.get('macros:list')!
    const result = (await list()) as Array<{ name: string; messages: string[] }>
    expect(result.find((m) => m.name === 'beta')!.messages).toEqual(['y'])
  })

  it('macros:save rejects description over 500 chars', async () => {
    const save = dispatch.get('macros:save')!
    const big = 'x'.repeat(501)
    await expect(save('big-desc', big, ['hi'])).rejects.toThrow(/Invalid macro content/)
  })

  it('macros:save with oldName renames (new file appears, old file removed)', async () => {
    const save = dispatch.get('macros:save')!
    await save('first', 'desc', ['hello'])
    await save('second', 'desc', ['hello'], 'first')

    const list = dispatch.get('macros:list')!
    const result = (await list()) as Array<{ name: string }>
    expect(result.map((m) => m.name)).toEqual(['second'])
    await expect(fs.access(path.join(macrosDir, 'first.json'))).rejects.toThrow()
  })

  it('macros:load returns messages after save', async () => {
    const save = dispatch.get('macros:save')!
    const load = dispatch.get('macros:load')!

    await save('roundtrip', '', ['one', 'two', '/clear'])
    const msgs = await load('roundtrip')
    expect(msgs).toEqual(['one', 'two', '/clear'])
  })

  it('macros:load returns null for invalid names', async () => {
    const load = dispatch.get('macros:load')!
    expect(await load('../evil')).toBeNull()
    expect(await load('nonexistent')).toBeNull()
    expect(await load(123)).toBeNull()
  })

  it('macros:delete removes the file', async () => {
    const save = dispatch.get('macros:save')!
    const del = dispatch.get('macros:delete')!
    const list = dispatch.get('macros:list')!

    await save('doomed', '', ['x'])
    expect(((await list()) as unknown[]).length).toBe(1)

    await del('doomed')
    expect(((await list()) as unknown[]).length).toBe(0)
  })

  it('macros:delete is idempotent (no throw on missing file)', async () => {
    const del = dispatch.get('macros:delete')!
    await expect(del('never-existed')).resolves.toBeUndefined()
  })

  it('macros:delete rejects invalid name', async () => {
    const del = dispatch.get('macros:delete')!
    await expect(del('../escape')).rejects.toThrow(/Invalid macro name/)
  })

  it('commands:list includes saved macros with source="macro"', async () => {
    const save = dispatch.get('macros:save')!
    await save('via-list', 'Listed via commands:list', ['hi'])

    const commandsList = dispatch.get('commands:list')!
    const cmds = (await commandsList()) as Array<{ name: string; source: string }>
    const found = cmds.find((c) => c.name === 'via-list')
    expect(found).toBeDefined()
    expect(found!.source).toBe('macro')
  })

  it('commands:list includes the /context builtin', async () => {
    const commandsList = dispatch.get('commands:list')!
    const cmds = (await commandsList()) as Array<{ name: string; source: string; description: string }>
    const ctx = cmds.find((c) => c.name === 'context')
    expect(ctx).toBeDefined()
    expect(ctx!.source).toBe('builtin')
  })

  it('commands:list (pi backend) exposes omp-discovered commands + builtins + macros, not the claude scan', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_sdkBackend', 'pi')").run()
    discoverOmpCommandsCached.mockResolvedValue([
      { name: 'skill:foo', description: 'A skill', source: 'skill' },
      { name: 'triage', description: 'Triage issues', source: 'user' },
    ])
    const save = dispatch.get('macros:save')!
    await save('mymacro', 'A macro', ['hi'])

    const commandsList = dispatch.get('commands:list')!
    const cmds = (await commandsList('/tmp/proj', 'user')) as Array<{ name: string; source: string }>
    expect(discoverOmpCommandsCached).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/tmp/proj' }))
    // omp-discovered commands surface
    expect(cmds.find((c) => c.name === 'skill:foo')?.source).toBe('skill')
    expect(cmds.find((c) => c.name === 'triage')?.source).toBe('user')
    // app-level builtins + macros still present
    expect(cmds.find((c) => c.name === 'context')?.source).toBe('builtin')
    expect(cmds.find((c) => c.name === 'mymacro')?.source).toBe('macro')
  })

  it('commands:list (claude backend) never calls omp discovery', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_sdkBackend', 'claude-agent-sdk')").run()
    const commandsList = dispatch.get('commands:list')!
    await commandsList()
    expect(discoverOmpCommandsCached).not.toHaveBeenCalled()
  })
})
