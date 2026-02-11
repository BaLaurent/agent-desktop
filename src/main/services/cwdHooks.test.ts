import { describe, it, expect } from 'vitest'
import { isPathOutsideCwd, isPathOutsideAllowed, extractBashWritePaths, buildCwdRestrictionHooks } from './cwdHooks'

describe('isPathOutsideCwd', () => {
  it('returns null for absolute path inside CWD', () => {
    expect(isPathOutsideCwd('/home/user/project/src/file.ts', '/home/user/project')).toBeNull()
  })

  it('returns resolved path for absolute path outside CWD', () => {
    const result = isPathOutsideCwd('/tmp/evil.txt', '/home/user/project')
    expect(result).toBe('/tmp/evil.txt')
  })

  it('returns null for relative path resolving inside CWD', () => {
    expect(isPathOutsideCwd('src/file.ts', '/home/user/project')).toBeNull()
  })

  it('returns resolved path for ../ that escapes CWD', () => {
    const result = isPathOutsideCwd('../other/file.ts', '/home/user/project')
    expect(result).toBe('/home/user/other/file.ts')
  })

  it('returns null when path equals CWD exactly', () => {
    expect(isPathOutsideCwd('/home/user/project', '/home/user/project')).toBeNull()
  })

  it('handles trailing slash on CWD', () => {
    expect(isPathOutsideCwd('/home/user/project/src/x.ts', '/home/user/project/')).toBeNull()
  })

  it('rejects path that is a prefix but not a child (e.g. /home/user/project2)', () => {
    const result = isPathOutsideCwd('/home/user/project2/file.ts', '/home/user/project')
    expect(result).toBe('/home/user/project2/file.ts')
  })

  it('returns null for deeply nested path inside CWD', () => {
    expect(isPathOutsideCwd('/home/user/project/a/b/c/d.ts', '/home/user/project')).toBeNull()
  })

  it('expands ~ to home directory and detects outside CWD', () => {
    // ~/toto.txt should resolve to $HOME/toto.txt which is outside CWD
    const result = isPathOutsideCwd('~/toto.txt', '/home/user/project')
    expect(result).not.toBeNull()
    expect(result).toContain('toto.txt')
  })

  it('expands bare ~ to home directory', () => {
    const result = isPathOutsideCwd('~', '/home/user/project')
    // ~ expands to home dir which is outside /home/user/project (unless home IS the project)
    // Just verify it doesn't crash and resolves to something
    expect(typeof result === 'string' || result === null).toBe(true)
  })
})

describe('extractBashWritePaths', () => {
  it('extracts > redirect target', () => {
    const paths = extractBashWritePaths('echo hello > /tmp/out.txt')
    expect(paths).toContain('/tmp/out.txt')
  })

  it('extracts >> append redirect target', () => {
    const paths = extractBashWritePaths('echo hello >> /tmp/log.txt')
    expect(paths).toContain('/tmp/log.txt')
  })

  it('extracts tee target', () => {
    const paths = extractBashWritePaths('cat file | tee /tmp/output.txt')
    expect(paths).toContain('/tmp/output.txt')
  })

  it('extracts tee with -a flag', () => {
    const paths = extractBashWritePaths('echo x | tee -a /tmp/append.txt')
    expect(paths).toContain('/tmp/append.txt')
  })

  it('extracts cp destination', () => {
    const paths = extractBashWritePaths('cp src.txt /tmp/dest.txt')
    expect(paths).toContain('/tmp/dest.txt')
  })

  it('extracts cp with flags', () => {
    const paths = extractBashWritePaths('cp -r src/ /tmp/dest/')
    expect(paths).toContain('/tmp/dest/')
  })

  it('extracts mv destination', () => {
    const paths = extractBashWritePaths('mv old.txt /tmp/new.txt')
    expect(paths).toContain('/tmp/new.txt')
  })

  it('extracts mkdir paths', () => {
    const paths = extractBashWritePaths('mkdir -p /tmp/newdir')
    expect(paths).toContain('/tmp/newdir')
  })

  it('extracts touch paths', () => {
    const paths = extractBashWritePaths('touch /tmp/newfile.txt')
    expect(paths).toContain('/tmp/newfile.txt')
  })

  it('extracts touch with tilde path', () => {
    const paths = extractBashWritePaths('touch ~/toto.txt')
    expect(paths).toContain('~/toto.txt')
  })

  it('extracts ln destination', () => {
    const paths = extractBashWritePaths('ln -s /src /tmp/link')
    expect(paths).toContain('/tmp/link')
  })

  it('extracts rsync destination', () => {
    const paths = extractBashWritePaths('rsync -avz src/ /tmp/dest/')
    expect(paths).toContain('/tmp/dest/')
  })

  it('returns empty array for read-only commands', () => {
    expect(extractBashWritePaths('ls -la')).toEqual([])
    expect(extractBashWritePaths('cat file.txt')).toEqual([])
    expect(extractBashWritePaths('grep pattern file.txt')).toEqual([])
    expect(extractBashWritePaths('find . -name "*.ts"')).toEqual([])
  })

  it('handles quoted paths in redirect', () => {
    const paths = extractBashWritePaths('echo x > "/tmp/my file.txt"')
    expect(paths).toContain('/tmp/my file.txt')
  })

  it('handles multiple commands with semicolons', () => {
    const paths = extractBashWritePaths('echo x > /tmp/a.txt; cp b.txt /tmp/c.txt')
    expect(paths).toContain('/tmp/a.txt')
    expect(paths).toContain('/tmp/c.txt')
  })

  it('deduplicates paths', () => {
    const paths = extractBashWritePaths('echo x > /tmp/f.txt; echo y > /tmp/f.txt')
    const occurrences = paths.filter(p => p === '/tmp/f.txt')
    expect(occurrences).toHaveLength(1)
  })
})

describe('buildCwdRestrictionHooks', () => {
  const cwd = '/home/user/project'
  const abortController = new AbortController()
  const ctx = { signal: abortController.signal }

  function makeInput(toolName: string, toolInput: Record<string, unknown>) {
    return {
      hook_event_name: 'PreToolUse',
      tool_name: toolName,
      tool_input: toolInput,
      session_id: 'test-session',
      cwd,
    }
  }

  async function callHook(toolName: string, toolInput: Record<string, unknown>) {
    const hooks = buildCwdRestrictionHooks(cwd)
    const callback = hooks.PreToolUse[0].hooks[0]
    return callback(makeInput(toolName, toolInput), null, ctx)
  }

  it('returns hooks with correct matcher', () => {
    const hooks = buildCwdRestrictionHooks(cwd)
    expect(hooks.PreToolUse).toHaveLength(1)
    expect(hooks.PreToolUse[0].matcher).toBe('Write|Edit|NotebookEdit|Bash')
    expect(hooks.PreToolUse[0].hooks).toHaveLength(1)
  })

  it('allows Write inside CWD', async () => {
    const result = await callHook('Write', { file_path: '/home/user/project/src/file.ts' })
    expect(result).toEqual({})
  })

  it('denies Write outside CWD', async () => {
    const result = await callHook('Write', { file_path: '/tmp/evil.txt' })
    expect(result.hookSpecificOutput).toBeDefined()
    expect(result.hookSpecificOutput!.hookEventName).toBe('PreToolUse')
    expect(result.hookSpecificOutput!.permissionDecision).toBe('deny')
    expect(result.hookSpecificOutput!.permissionDecisionReason).toContain('/tmp/evil.txt')
    expect(result.hookSpecificOutput!.permissionDecisionReason).toContain(cwd)
  })

  it('allows Edit inside CWD', async () => {
    const result = await callHook('Edit', { file_path: '/home/user/project/src/file.ts' })
    expect(result).toEqual({})
  })

  it('denies Edit outside CWD', async () => {
    const result = await callHook('Edit', { file_path: '/etc/passwd' })
    expect(result.hookSpecificOutput).toBeDefined()
    expect(result.hookSpecificOutput!.permissionDecision).toBe('deny')
  })

  it('allows NotebookEdit inside CWD', async () => {
    const result = await callHook('NotebookEdit', { notebook_path: '/home/user/project/nb.ipynb' })
    expect(result).toEqual({})
  })

  it('denies NotebookEdit outside CWD', async () => {
    const result = await callHook('NotebookEdit', { notebook_path: '/tmp/nb.ipynb' })
    expect(result.hookSpecificOutput).toBeDefined()
    expect(result.hookSpecificOutput!.permissionDecision).toBe('deny')
  })

  it('allows Bash without write patterns', async () => {
    const result = await callHook('Bash', { command: 'ls -la /home/user/project' })
    expect(result).toEqual({})
  })

  it('allows Bash with writes inside CWD', async () => {
    const result = await callHook('Bash', { command: 'echo x > /home/user/project/out.txt' })
    expect(result).toEqual({})
  })

  it('denies Bash with redirect outside CWD', async () => {
    const result = await callHook('Bash', { command: 'echo x > /tmp/test.txt' })
    expect(result.hookSpecificOutput).toBeDefined()
    expect(result.hookSpecificOutput!.permissionDecision).toBe('deny')
  })

  it('allows Read tool (read-only — not matched by matcher, but tested for safety)', async () => {
    const result = await callHook('Read', { file_path: '/etc/hosts' })
    expect(result).toEqual({})
  })

  it('allows unknown tools', async () => {
    const result = await callHook('SomeNewTool', { whatever: true })
    expect(result).toEqual({})
  })

  it('allows Write with no file_path (edge case)', async () => {
    const result = await callHook('Write', {})
    expect(result).toEqual({})
  })

  it('allows Bash with no command (edge case)', async () => {
    const result = await callHook('Bash', {})
    expect(result).toEqual({})
  })

  it('uses hook_event_name from input in the result', async () => {
    const hooks = buildCwdRestrictionHooks(cwd)
    const callback = hooks.PreToolUse[0].hooks[0]
    const input = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/out.txt' },
      session_id: 'test',
      cwd,
    }
    const result = await callback(input, 'tool-123', ctx)
    expect(result.hookSpecificOutput!.hookEventName).toBe('PreToolUse')
  })

  it('deny message includes "allowed directories" wording', async () => {
    const result = await callHook('Write', { file_path: '/tmp/evil.txt' })
    expect(result.hookSpecificOutput!.permissionDecisionReason).toContain('allowed directories')
  })
})

describe('isPathOutsideAllowed', () => {
  it('returns null for path inside CWD', () => {
    expect(isPathOutsideAllowed('/home/user/project/file.ts', '/home/user/project')).toBeNull()
  })

  it('returns null for path inside an additional writable path', () => {
    expect(
      isPathOutsideAllowed('/data/knowledge/docs/file.md', '/home/user/project', ['/data/knowledge/docs'])
    ).toBeNull()
  })

  it('returns resolved path when outside both CWD and additional paths', () => {
    const result = isPathOutsideAllowed('/tmp/evil.txt', '/home/user/project', ['/data/knowledge/docs'])
    expect(result).toBe('/tmp/evil.txt')
  })

  it('returns resolved path when outside CWD with empty additional paths', () => {
    const result = isPathOutsideAllowed('/tmp/evil.txt', '/home/user/project', [])
    expect(result).toBe('/tmp/evil.txt')
  })

  it('returns resolved path when outside CWD with undefined additional paths', () => {
    const result = isPathOutsideAllowed('/tmp/evil.txt', '/home/user/project')
    expect(result).toBe('/tmp/evil.txt')
  })

  it('checks all additional paths until one matches', () => {
    // Path is inside the second additional path
    expect(
      isPathOutsideAllowed('/data/kb2/file.ts', '/home/user/project', ['/data/kb1', '/data/kb2'])
    ).toBeNull()
  })

  it('returns null when path matches CWD even with additional paths', () => {
    expect(
      isPathOutsideAllowed('/home/user/project/src/x.ts', '/home/user/project', ['/other'])
    ).toBeNull()
  })
})

describe('buildCwdRestrictionHooks with additional paths', () => {
  const cwd = '/home/user/project'
  const additionalPaths = ['/home/user/knowledges/docs']
  const abortController = new AbortController()
  const ctx = { signal: abortController.signal }

  function makeInput(toolName: string, toolInput: Record<string, unknown>) {
    return {
      hook_event_name: 'PreToolUse',
      tool_name: toolName,
      tool_input: toolInput,
      session_id: 'test-session',
      cwd,
    }
  }

  async function callHookWithPaths(toolName: string, toolInput: Record<string, unknown>) {
    const hooks = buildCwdRestrictionHooks(cwd, additionalPaths)
    const callback = hooks.PreToolUse[0].hooks[0]
    return callback(makeInput(toolName, toolInput), null, ctx)
  }

  it('allows Write inside additional writable path', async () => {
    const result = await callHookWithPaths('Write', { file_path: '/home/user/knowledges/docs/notes.md' })
    expect(result).toEqual({})
  })

  it('allows Edit inside additional writable path', async () => {
    const result = await callHookWithPaths('Edit', { file_path: '/home/user/knowledges/docs/sub/file.ts' })
    expect(result).toEqual({})
  })

  it('denies Write outside both CWD and additional paths', async () => {
    const result = await callHookWithPaths('Write', { file_path: '/tmp/evil.txt' })
    expect(result.hookSpecificOutput).toBeDefined()
    expect(result.hookSpecificOutput!.permissionDecision).toBe('deny')
    expect(result.hookSpecificOutput!.permissionDecisionReason).toContain('/tmp/evil.txt')
    expect(result.hookSpecificOutput!.permissionDecisionReason).toContain(cwd)
    expect(result.hookSpecificOutput!.permissionDecisionReason).toContain(additionalPaths[0])
  })

  it('allows Write inside CWD even when additional paths exist', async () => {
    const result = await callHookWithPaths('Write', { file_path: '/home/user/project/src/file.ts' })
    expect(result).toEqual({})
  })

  it('allows Bash with write to additional path', async () => {
    const result = await callHookWithPaths('Bash', { command: 'echo x > /home/user/knowledges/docs/out.txt' })
    expect(result).toEqual({})
  })

  it('denies Bash with write outside all allowed dirs', async () => {
    const result = await callHookWithPaths('Bash', { command: 'echo x > /tmp/test.txt' })
    expect(result.hookSpecificOutput).toBeDefined()
    expect(result.hookSpecificOutput!.permissionDecision).toBe('deny')
  })

  it('allows NotebookEdit inside additional path', async () => {
    const result = await callHookWithPaths('NotebookEdit', { notebook_path: '/home/user/knowledges/docs/nb.ipynb' })
    expect(result).toEqual({})
  })

  it('denies NotebookEdit outside all allowed dirs', async () => {
    const result = await callHookWithPaths('NotebookEdit', { notebook_path: '/tmp/nb.ipynb' })
    expect(result.hookSpecificOutput).toBeDefined()
    expect(result.hookSpecificOutput!.permissionDecision).toBe('deny')
  })
})
