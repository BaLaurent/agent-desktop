# Agent Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add configurable agent name, personality, and language that cascade through Global > Folder > Conversation.

**Architecture:** 3 new keys (`agent_name`, `agent_personality`, `agent_language`) in the existing `AIOverrides` interface. Personality and language are injected into the system prompt via `getSystemPrompt()`. Agent name replaces the hardcoded `'Claude'` label in `MessageBubble`. No new DB tables or IPC channels needed.

**Tech Stack:** TypeScript, React, Zustand, sql.js, Vitest

---

### Task 1: Add agent keys to shared types and constants

**Files:**
- Modify: `src/shared/types.ts:8-29` (AIOverrides interface)
- Modify: `src/shared/constants.ts:95-133` (SETTING_DEFS + AI_OVERRIDE_KEYS)

**Step 1: Add keys to AIOverrides interface**

In `src/shared/types.ts`, add 3 new optional properties at the end of the `AIOverrides` interface (before the closing `}`):

```typescript
  agent_name?: string             // display name, fallback 'Claude'
  agent_personality?: string      // free text personality directive
  agent_language?: string         // free text language directive
```

**Step 2: Add to SETTING_DEFS array**

In `src/shared/constants.ts`, add 3 entries at the beginning of the `SETTING_DEFS` array (before the `ai_sdkBackend` entry):

```typescript
  { key: 'agent_name', label: 'Agent Name', type: 'textarea' },
  { key: 'agent_personality', label: 'Personality', type: 'textarea' },
  { key: 'agent_language', label: 'Language', type: 'textarea' },
```

Note: `type: 'textarea'` is used because `SettingDef.type` only allows `'select' | 'number' | 'textarea'`. The UI will render custom inputs (not auto-generated from SETTING_DEFS), so this just satisfies the type checker and adds the keys to the auto-whitelist.

**Step 3: Add to AI_OVERRIDE_KEYS array**

In `src/shared/constants.ts`, add 3 entries at the end of `AI_OVERRIDE_KEYS` (before the closing `]`):

```typescript
  'agent_name',
  'agent_personality',
  'agent_language',
```

**Step 4: Verify build**

Run: `npm run build`
Expected: 0 errors, 0 warnings

**Step 5: Commit**

```bash
git add src/shared/types.ts src/shared/constants.ts
git commit -m "feat(agent): add agent_name, agent_personality, agent_language to AIOverrides"
```

---

### Task 2: Inject personality and language into getSystemPrompt()

**Files:**
- Modify: `src/main/services/messages.ts:122-247` (getSystemPrompt function)
- Modify: `src/main/services/messages.test.ts` (add tests)

**Step 1: Write failing tests**

In `src/main/services/messages.test.ts`, add these tests after the existing `getSystemPrompt` tests (after line ~137):

```typescript
  it('getSystemPrompt injects agent_personality from global settings', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('agent_personality', 'concis et technique')").run()
    const prompt = await getSystemPrompt(db, convId, '/tmp/test')
    expect(prompt).toContain('Personality: concis et technique')
  })

  it('getSystemPrompt injects agent_language from global settings', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('agent_language', 'Français')").run()
    const prompt = await getSystemPrompt(db, convId, '/tmp/test')
    expect(prompt).toContain('Always respond in Français.')
  })

  it('getSystemPrompt cascades agent_personality from conversation overrides', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('agent_personality', 'Global personality')").run()
    db.prepare('UPDATE conversations SET ai_overrides = ? WHERE id = ?').run(
      JSON.stringify({ agent_personality: 'Conv personality' }),
      convId
    )
    const prompt = await getSystemPrompt(db, convId, '/tmp/test')
    expect(prompt).toContain('Conv personality')
    expect(prompt).not.toContain('Global personality')
  })

  it('getSystemPrompt cascades agent_language from folder overrides', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('agent_language', 'English')").run()
    const folder = db.prepare("INSERT INTO folders (name) VALUES ('Lang Folder')").run()
    const folderId = folder.lastInsertRowid as number
    db.prepare('UPDATE folders SET ai_overrides = ? WHERE id = ?').run(
      JSON.stringify({ agent_language: 'Español' }),
      folderId
    )
    db.prepare('UPDATE conversations SET folder_id = ? WHERE id = ?').run(folderId, convId)
    const prompt = await getSystemPrompt(db, convId, '/tmp/test')
    expect(prompt).toContain('Always respond in Español.')
    expect(prompt).not.toContain('English')
  })

  it('getSystemPrompt does not inject agent directives when not set', async () => {
    const prompt = await getSystemPrompt(db, convId, '/tmp/test')
    expect(prompt).not.toContain('Personality:')
    expect(prompt).not.toContain('Always respond in')
  })
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/main/services/messages.test.ts`
Expected: 5 new tests FAIL (personality/language not injected yet)

**Step 3: Implement agent directive injection in getSystemPrompt()**

In `src/main/services/messages.ts`, inside `getSystemPrompt()`, add a cascade lookup for `agent_personality` and `agent_language` AFTER the base prompt is built (after line 157 `prompt = cascadedPrompt ? ...`) and BEFORE the knowledge base section (before line 160 `// Append knowledge base`).

Add this block:

```typescript
  // ─── Agent personality & language injection ───────────────
  // Cascade: conversation ai_overrides > folder ai_overrides > global setting
  function cascadeAgentKey(key: string): string | undefined {
    // Check conversation ai_overrides
    if (row?.ai_overrides) {
      const convOv = safeJsonParse<Record<string, string>>(row.ai_overrides, {})
      if (convOv[key]) return convOv[key]
    }
    // Check folder ai_overrides
    if (row?.folder_id) {
      const folderOv = getFolderOverrides(db, row.folder_id)
      if (folderOv[key]) return folderOv[key]
    }
    // Fall back to global setting
    const globalRow = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined
    return globalRow?.value || undefined
  }

  const agentPersonality = cascadeAgentKey('agent_personality')
  const agentLanguage = cascadeAgentKey('agent_language')

  if (agentPersonality) {
    prompt = `Personality: ${agentPersonality}\n\n${prompt}`
  }
  if (agentLanguage) {
    prompt = `Always respond in ${agentLanguage}.\n\n${prompt}`
  }
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/main/services/messages.test.ts`
Expected: ALL tests PASS

**Step 5: Commit**

```bash
git add src/main/services/messages.ts src/main/services/messages.test.ts
git commit -m "feat(agent): inject personality and language into system prompt with cascade"
```

---

### Task 3: Add Agent section to AISettings UI

**Files:**
- Modify: `src/renderer/components/settings/AISettings.tsx:79-107` (add section before Backend)

**Step 1: Add state reads for agent settings**

In `AISettings.tsx`, add these reads after line 43 (`const defaultSystemPrompt = ...`):

```typescript
  const agentName = settings['agent_name'] ?? ''
  const agentPersonality = settings['agent_personality'] ?? ''
  const agentLanguage = settings['agent_language'] ?? ''
```

**Step 2: Add Agent section JSX**

In `AISettings.tsx`, inside the return JSX, add this block BEFORE the `{/* Backend */}` comment (before line 81):

```tsx
      {/* ─── Agent Identity ─────────────────────────────── */}
      <div className="flex items-center justify-between py-3 border-b border-[var(--color-text-muted)]/10">
        <div className="flex flex-col gap-0.5 pr-4">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Agent Name
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Display name shown in chat bubbles.
          </span>
        </div>
        <input
          type="text"
          value={agentName}
          onChange={(e) => setSetting('agent_name', e.target.value)}
          placeholder="Claude"
          className="w-48 px-3 py-1.5 rounded text-sm border border-[var(--color-text-muted)]/20 outline-none mobile:text-base"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
          aria-label="Agent name"
        />
      </div>

      <div className="flex items-center justify-between py-3 border-b border-[var(--color-text-muted)]/10">
        <div className="flex flex-col gap-0.5 pr-4">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Language
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Response language injected into the system prompt.
          </span>
        </div>
        <input
          type="text"
          value={agentLanguage}
          onChange={(e) => setSetting('agent_language', e.target.value)}
          placeholder="e.g. Français, English, Español"
          className="w-48 px-3 py-1.5 rounded text-sm border border-[var(--color-text-muted)]/20 outline-none mobile:text-base"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
          aria-label="Agent language"
        />
      </div>

      <div className="flex flex-col gap-2 py-3 border-b border-[var(--color-text-muted)]/10">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Personality
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Personality directive injected into the system prompt.
          </span>
        </div>
        <textarea
          value={agentPersonality}
          onChange={(e) => setSetting('agent_personality', e.target.value)}
          rows={2}
          placeholder="e.g. concis et technique, chaleureux et pédagogue"
          className="w-full px-3 py-2 rounded text-sm border border-[var(--color-text-muted)]/20 outline-none resize-y mobile:text-base"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
          aria-label="Agent personality"
        />
      </div>
```

**Step 3: Verify build**

Run: `npm run build`
Expected: 0 errors, 0 warnings

**Step 4: Commit**

```bash
git add src/renderer/components/settings/AISettings.tsx
git commit -m "feat(agent): add Agent Identity section to AI settings UI"
```

---

### Task 4: Display agent name in MessageBubble

**Files:**
- Modify: `src/renderer/components/chat/MessageBubble.tsx:140` (replace hardcoded 'Claude')
- Modify: `src/renderer/components/chat/MessageBubble.test.tsx:10,59-61` (update tests)

**Step 1: Update the test mock and test expectation**

In `src/renderer/components/chat/MessageBubble.test.tsx`, update the `settingsMock` (line 10) to include `agent_name`:

```typescript
const settingsMock: Record<string, string> = { tts_provider: 'spd-say', tts_responseMode: 'full' }
```

No change needed here — the mock already returns `settings` as a record. The default (no `agent_name` key) should fall back to `'Claude'`.

Add a new test after the existing "shows Claude label" test (after line 62):

```typescript
  it('assistant message shows configured agent name', () => {
    settingsMock['agent_name'] = 'Jarvis'
    render(<MessageBubble message={makeMessage({ role: 'assistant' })} isLast={false} />)
    expect(screen.getByText('Jarvis')).toBeInTheDocument()
    delete settingsMock['agent_name']
  })
```

**Step 2: Run tests to verify the new test fails**

Run: `npm test -- --run src/renderer/components/chat/MessageBubble.test.tsx`
Expected: "assistant message shows configured agent name" FAILS (still shows 'Claude')

**Step 3: Implement the agent name read in MessageBubble**

In `src/renderer/components/chat/MessageBubble.tsx`, add a new line after the existing `useSettingsStore` reads (after the `ttsResponseMode` line, around line 57):

```typescript
  const agentName = useSettingsStore((s) => s.settings.agent_name) || 'Claude'
```

Then replace line 140:

```typescript
          {isUser ? 'You' : 'Claude'}
```

with:

```typescript
          {isUser ? 'You' : agentName}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/renderer/components/chat/MessageBubble.test.tsx`
Expected: ALL tests PASS

**Step 5: Commit**

```bash
git add src/renderer/components/chat/MessageBubble.tsx src/renderer/components/chat/MessageBubble.test.tsx
git commit -m "feat(agent): display configured agent name in chat bubbles"
```

---

### Task 5: Full test suite + build verification

**Files:** None (verification only)

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass (1917+ tests)

**Step 2: Run build**

Run: `npm run build`
Expected: 0 errors, 0 warnings

**Step 3: Final commit if any fixups needed**

If any tests needed fixing, commit the fixes with:

```bash
git commit -m "fix(agent): test fixups for agent settings"
```
