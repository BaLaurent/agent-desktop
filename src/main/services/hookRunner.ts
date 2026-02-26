import { promises as fsp } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { exec } from 'child_process'

interface SettingsHook {
  type: 'command'
  command: string
  timeout?: number
}

interface SettingsHookMatcher {
  matcher?: string
  hooks: SettingsHook[]
}

interface HookResult {
  systemMessage?: string
}

/**
 * Read hooks configuration from ~/.claude/settings.json for a given event.
 * Returns the list of hook matchers (commands) for that event, or empty if none.
 */
async function readSettingsHooks(event: string): Promise<SettingsHookMatcher[]> {
  const settingsPath = join(app.getPath('home'), '.claude', 'settings.json')
  try {
    const raw = await fsp.readFile(settingsPath, 'utf-8')
    const settings = JSON.parse(raw) as { hooks?: Record<string, SettingsHookMatcher[]> }
    return settings.hooks?.[event] ?? []
  } catch {
    return []
  }
}

/**
 * Execute a single command hook, passing input as JSON on stdin.
 * Returns parsed JSON output or null if the hook produces no valid JSON.
 */
function execHookCommand(
  command: string,
  input: Record<string, unknown>,
  timeoutMs: number
): Promise<HookResult | null> {
  return new Promise((resolve) => {
    const child = exec(command, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        resolve(null)
        return
      }
      const trimmed = stdout.trim()
      if (!trimmed) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(trimmed) as HookResult)
      } catch {
        resolve(null)
      }
    })
    // Pass hook input as JSON on stdin (same format as Claude Code CLI)
    child.stdin?.write(JSON.stringify(input))
    child.stdin?.end()
  })
}

export interface HookSystemMessage {
  content: string
  hookName?: string
  hookEvent: string
}

/**
 * Run UserPromptSubmit hooks from ~/.claude/settings.json.
 * Executes each command hook, parses JSON output, and returns any systemMessage values.
 *
 * This runs hooks at the application level because the Agent SDK subprocess
 * does not yield hook_response messages for UserPromptSubmit through its async iterator.
 */
export async function runUserPromptSubmitHooks(
  prompt: string,
  cwd: string,
  permissionMode: string
): Promise<HookSystemMessage[]> {
  const matchers = await readSettingsHooks('UserPromptSubmit')
  if (matchers.length === 0) return []

  const input = {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'agent-desktop',
    cwd,
    permission_mode: permissionMode,
    prompt,
  }

  const results: HookSystemMessage[] = []

  for (const matcher of matchers) {
    for (const hook of matcher.hooks) {
      if (hook.type !== 'command') continue
      const timeoutMs = (hook.timeout ?? 60) * 1000
      const result = await execHookCommand(hook.command, input, timeoutMs)
      if (result?.systemMessage) {
        results.push({
          content: result.systemMessage,
          hookEvent: 'UserPromptSubmit',
        })
      }
    }
  }

  return results
}
