import { describe, it, expect, beforeEach } from 'vitest'
import { buildContextBreakdown } from './contextBreakdown'
import { createTestDb } from '../__tests__/db-helper'
import { createTables } from '../db/schema'
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

async function seedConversation(db: Awaited<ReturnType<typeof createTestDb>>, overrides: Record<string, unknown> = {}) {
  const cols = {
    title: 'Test',
    model: 'claude-opus-4-7',
    last_input_tokens: null,
    last_output_tokens: null,
    last_cache_read_tokens: null,
    last_cache_creation_tokens: null,
    last_context_window: null,
    compact_summary: null,
    cleared_at: null,
    ...overrides,
  }
  const stmt = db.prepare(`INSERT INTO conversations (
    title, model, last_input_tokens, last_output_tokens,
    last_cache_read_tokens, last_cache_creation_tokens, last_context_window,
    compact_summary, cleared_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
  const result = stmt.run(
    cols.title, cols.model,
    cols.last_input_tokens, cols.last_output_tokens,
    cols.last_cache_read_tokens, cols.last_cache_creation_tokens, cols.last_context_window,
    cols.compact_summary, cols.cleared_at
  )
  return Number(result.lastInsertRowid)
}

describe('buildContextBreakdown', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>

  beforeEach(async () => {
    db = await createTestDb()
    createTables(db as never)
  })

  it('returns a pre-first-turn breakdown when no SDK usage has been persisted yet', async () => {
    const id = await seedConversation(db)
    const result = await buildContextBreakdown({
      db: db as never,
      conversationId: id,
      systemPrompt: 'You are a helpful assistant.',
    })
    expect(result.preFirstTurn).toBe(true)
    // Total is now content-based: just the system prompt tokens here (no msgs, no skills)
    expect(result.total).toBeGreaterThan(0)
    expect(result.total).toBeLessThan(20)
    // Opus 4.7 is 1M natively per static table
    expect(result.window).toBe(1_000_000)
    // Autocompact buffer is ~3% of window
    expect(result.autocompactBuffer).toBe(30_000)
  })

  it('headline total is content-based, not SDK cache-inclusive', async () => {
    // SDK reports 70k of total (input + cache_read + cache_create) but we only
    // show what we can tokenize from DB content.
    const id = await seedConversation(db, {
      last_input_tokens: 10,
      last_cache_read_tokens: 50_000,
      last_cache_creation_tokens: 20_000,
      last_context_window: 1_000_000,
    })
    const result = await buildContextBreakdown({
      db: db as never,
      conversationId: id,
      systemPrompt: 'System prompt content.',
    })
    expect(result.preFirstTurn).toBe(false)
    // Total is content-only ≈ system prompt tokens (few), NOT the 70k SDK reports
    expect(result.total).toBeLessThan(100)
  })

  it('falls back to an empty breakdown for a missing conversation', async () => {
    const result = await buildContextBreakdown({
      db: db as never,
      conversationId: 999_999,
      systemPrompt: '',
    })
    expect(result.total).toBe(0)
    expect(result.categories).toEqual([])
  })

  it('adds a "Tool exchanges" category when assistant messages have tool_calls payloads', async () => {
    const id = await seedConversation(db, {
      last_input_tokens: 10,
      last_cache_read_tokens: 0,
      last_cache_creation_tokens: 0,
    })
    // Seed an assistant message with a large tool_calls JSON payload
    const toolCallsJson = JSON.stringify([{
      id: 'toolu_1',
      name: 'bash',
      input: JSON.stringify({ command: 'ls -la' }),
      output: 'drwxr-xr-x 5 user user 4096 Apr 20 23:00 .\n'.repeat(200),
      status: 'done',
    }])
    db.prepare(
      "INSERT INTO messages (conversation_id, role, content, tool_calls) VALUES (?, 'assistant', 'I ran the command.', ?)"
    ).run(id, toolCallsJson)

    const result = await buildContextBreakdown({
      db: db as never,
      conversationId: id,
      systemPrompt: 'sp',
    })
    const toolCat = result.categories.find((c) => c.label === 'Tool exchanges')
    expect(toolCat).toBeDefined()
    expect(toolCat!.tokens).toBeGreaterThan(100) // the ls output alone is ~1.5k tokens
  })

  it('does not add the "Tool exchanges" category when no tool_calls are present', async () => {
    const id = await seedConversation(db, {
      last_input_tokens: 10,
      last_cache_read_tokens: 0,
      last_cache_creation_tokens: 0,
    })
    db.prepare(
      "INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', 'hello')"
    ).run(id)
    const result = await buildContextBreakdown({
      db: db as never,
      conversationId: id,
      systemPrompt: 'sp',
    })
    expect(result.categories.find((c) => c.label === 'Tool exchanges')).toBeUndefined()
  })

  it('adds a "Skills" category when ai_skills is enabled and the scope has SKILL.md files', async () => {
    // Simulate a project-scoped skills directory with 3 skills
    const origHome = process.env.HOME
    const tmpHome = await mkdtemp(join(tmpdir(), 'ctx-skills-test-'))
    const tmpProject = await mkdtemp(join(tmpdir(), 'ctx-skills-project-'))
    process.env.HOME = tmpHome
    try {
      await mkdir(join(tmpHome, '.claude/skills/alpha'), { recursive: true })
      await writeFile(
        join(tmpHome, '.claude/skills/alpha/SKILL.md'),
        '---\nname: alpha\ndescription: Alpha skill that does thing A with a fairly verbose description\n---\nbody here'
      )
      await mkdir(join(tmpProject, '.claude/skills/beta'), { recursive: true })
      await writeFile(
        join(tmpProject, '.claude/skills/beta/SKILL.md'),
        '---\nname: beta\ndescription: Beta skill doing stuff\n---\nbody'
      )

      const id = await seedConversation(db, {
        last_input_tokens: 10,
        last_cache_read_tokens: 0,
        last_cache_creation_tokens: 0,
      })
      const result = await buildContextBreakdown({
        db: db as never,
        conversationId: id,
        systemPrompt: 'sp',
        skillsMode: 'project',
        cwd: tmpProject,
      })
      const skills = result.categories.find((c) => c.label === 'Skills')
      expect(skills).toBeDefined()
      expect(skills!.tokens).toBeGreaterThan(0)
      expect(skills!.hint).toContain('2 SKILL.md') // both alpha + beta discovered
    } finally {
      if (origHome !== undefined) process.env.HOME = origHome
      else delete process.env.HOME
      await rm(tmpHome, { recursive: true, force: true })
      await rm(tmpProject, { recursive: true, force: true })
    }
  })

  it('ignores marketplace-cached SKILL.md files not listed in installed_plugins.json', async () => {
    // Reproduce the real structure: ~/.claude/plugins/{marketplaces, cache, installed_plugins.json}
    const origHome = process.env.HOME
    const tmpHome = await mkdtemp(join(tmpdir(), 'ctx-marketplace-test-'))
    process.env.HOME = tmpHome
    try {
      // 100 skills in a marketplace catalog — should NOT be counted
      for (let i = 0; i < 100; i++) {
        const dir = join(tmpHome, '.claude/plugins/marketplaces/some-marketplace/skill-' + i)
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, 'SKILL.md'), `---\nname: skill-${i}\ndescription: Marketplace skill ${i} with a long enough description to matter\n---\nbody`)
      }

      // 1 actually-installed skill — must be counted
      const installDir = join(tmpHome, '.claude/plugins/cache/real-plugin/my-skill/1.0.0')
      await mkdir(installDir, { recursive: true })
      await writeFile(join(installDir, 'SKILL.md'), '---\nname: real\ndescription: An actually installed skill\n---\nbody')

      await writeFile(
        join(tmpHome, '.claude/plugins/installed_plugins.json'),
        JSON.stringify({
          version: 2,
          plugins: {
            'my-skill@real-plugin': [{ scope: 'user', installPath: installDir, version: '1.0.0' }],
          },
        })
      )

      const id = await seedConversation(db)
      const result = await buildContextBreakdown({
        db: db as never,
        conversationId: id,
        systemPrompt: 'sp',
        skillsMode: 'user',
      })
      const skills = result.categories.find((c) => c.label === 'Skills')
      expect(skills).toBeDefined()
      // Only the installed one should count — not the 100 marketplace entries
      expect(skills!.hint).toContain('1 SKILL.md')
    } finally {
      if (origHome !== undefined) process.env.HOME = origHome
      else delete process.env.HOME
      await rm(tmpHome, { recursive: true, force: true })
    }
  })

  it('produces a tip suggesting a skills mode downgrade when local skills exceed 20k tokens', async () => {
    const origHome = process.env.HOME
    const tmpHome = await mkdtemp(join(tmpdir(), 'ctx-tip-test-'))
    process.env.HOME = tmpHome
    try {
      await mkdir(join(tmpHome, '.claude/skills/huge'), { recursive: true })
      // Craft a frontmatter that alone tokenizes to >20k. Using a long description.
      const bigDesc = 'abcdefg hijklmn opqrstu '.repeat(4000) // ~24k tokens
      await writeFile(
        join(tmpHome, '.claude/skills/huge/SKILL.md'),
        `---\nname: huge\ndescription: ${bigDesc}\n---\nbody`
      )

      const id = await seedConversation(db, {
        last_input_tokens: 10,
        last_cache_read_tokens: 0,
        last_cache_creation_tokens: 0,
      })
      const result = await buildContextBreakdown({
        db: db as never,
        conversationId: id,
        systemPrompt: 'sp',
        skillsMode: 'local',
      })
      expect(result.tip).toBeDefined()
      expect(result.tip).toMatch(/Settings.*AI.*Skills Mode/i)
    } finally {
      if (origHome !== undefined) process.env.HOME = origHome
      else delete process.env.HOME
      await rm(tmpHome, { recursive: true, force: true })
    }
  })

  it('keeps the total content-based even when SDK reports a big cache spike', async () => {
    const id = await seedConversation(db, {
      last_input_tokens: 10,
      last_cache_read_tokens: 55_000,
      last_cache_creation_tokens: 80_000, // SDK cached 80k this turn
    })
    db.prepare(
      "INSERT INTO messages (conversation_id, role, content, tool_calls) VALUES (?, 'user', 'get aapl price', NULL), (?, 'assistant', 'Here is the price.', ?)"
    ).run(id, id, JSON.stringify([{ id: 't1', name: 'Bash', input: '{}', output: 'tiny captured slice', status: 'done' }]))

    const result = await buildContextBreakdown({
      db: db as never,
      conversationId: id,
      systemPrompt: 'sp',
    })
    // Total reflects ONLY locally-tokenized content (messages + tool_calls +
    // system prompt) — never the 145k SDK-reported cache usage.
    expect(result.total).toBeLessThan(200)
    // The SDK-derived 'Framework & MCP tools' line is informational only.
    const fw = result.categories.find((c) => c.label === 'Framework & MCP tools')
    expect(fw).toBeDefined()
    expect(fw!.informational).toBe(true)
    expect(fw!.tokens).toBeGreaterThan(100_000) // ~sdk_total(145k) - content ≈ 135k
  })

  it('does not add the "Skills" category when skillsMode is off', async () => {
    const id = await seedConversation(db, {
      last_input_tokens: 10,
      last_cache_read_tokens: 0,
      last_cache_creation_tokens: 0,
    })
    const result = await buildContextBreakdown({
      db: db as never,
      conversationId: id,
      systemPrompt: 'sp',
      skillsMode: 'off',
    })
    expect(result.categories.find((c) => c.label === 'Skills')).toBeUndefined()
  })

  it('includes a compact summary category when one is present', async () => {
    const id = await seedConversation(db, {
      compact_summary: 'Previous turns summarized here.',
      last_input_tokens: 5,
      last_cache_read_tokens: 0,
      last_cache_creation_tokens: 0,
    })
    const result = await buildContextBreakdown({
      db: db as never,
      conversationId: id,
      systemPrompt: 'sp',
    })
    const summary = result.categories.find((c) => c.label === 'Compact summary')
    expect(summary).toBeDefined()
    expect(summary!.tokens).toBeGreaterThan(0)
  })
})
