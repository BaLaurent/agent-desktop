# Agent Settings — Design Document

## Summary

Add an "Agent" section in global settings to configure:
- **Agent Name** — displayed in UI wherever the assistant name appears
- **Personality** — injected into the system prompt
- **Language** — injected into the system prompt

All three cascade like existing AI overrides: Global > Folder > Conversation.

## Approach

**3 new keys in `AIOverrides`** — reuses 100% of the existing settings + cascade infrastructure. No new tables, no new IPC channels, no migration.

## Data Layer

### New keys in `AIOverrides` (types.ts)
- `agent_name?: string` — display name, fallback `'Claude'`
- `agent_personality?: string` — free text personality directive
- `agent_language?: string` — free text language directive

### Constants (constants.ts)
- Add to `AI_OVERRIDE_KEYS` array
- Add to `SETTING_DEFS` for UI rendering (name/language as textarea-ish inputs, personality as textarea)

### Settings whitelist (settings.ts)
- Add `agent_name`, `agent_personality`, `agent_language` to `ALLOWED_SETTING_KEYS`

### No DB migration needed
Keys stored as key-value in `settings` table (global) and as JSON in `ai_overrides` column (folders/conversations).

## System Prompt Integration (messages.ts)

In `getSystemPrompt()`, after building the base prompt (cwdDirective + cascaded defaultSystemPrompt), inject agent directives:

```
if (personality) prompt = `Personality: ${personality}\n\n` + prompt
if (language)    prompt = `Always respond in ${language}.\n\n` + prompt
```

Personality and language are read from cascaded settings (same cascade as `ai_defaultSystemPrompt`).

The agent name is NOT injected into the system prompt — it's purely a UI label.

## UI — Settings Panel (AISettings.tsx)

New "Agent" section at the top of AI settings (before Backend), with 3 fields:
- **Agent Name** — `<input type="text">` placeholder "Claude"
- **Personality** — `<textarea>` placeholder "e.g. concis et technique, chaleureux et pédagogue"
- **Language** — `<input type="text">` placeholder "e.g. Français, English, Español"

All use `setSetting()` — immediate effect.

## UI — Agent Name in Chat (MessageBubble.tsx)

Replace hardcoded `'Claude'` (line 140) with the configured name.

Resolution: `conversation.ai_overrides.agent_name > settings.agent_name > 'Claude'`

For V1, folder-level cascade for display name is skipped (system prompt cascade covers it for AI behavior). Can be added later if needed.

## Files to Modify

1. `src/shared/types.ts` — add 3 keys to `AIOverrides`
2. `src/shared/constants.ts` — add to `AI_OVERRIDE_KEYS` + `SETTING_DEFS`
3. `src/main/services/settings.ts` — add to `ALLOWED_SETTING_KEYS`
4. `src/main/services/messages.ts` — inject personality/language in `getSystemPrompt()`
5. `src/renderer/components/settings/AISettings.tsx` — add Agent section
6. `src/renderer/components/chat/MessageBubble.tsx` — use configured name
7. `src/renderer/components/chat/MessageBubble.test.tsx` — update test expectations
