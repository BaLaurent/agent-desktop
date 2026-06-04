# Pause Media Players During Voice Input — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When voice input (whisper recording) starts, pause currently-playing MPRIS media players (Spotify, browsers, VLC…) and resume only those when recording ends — gated by an opt-in global setting `voice_pauseMediaPlayers`.

**Architecture:** A new headless-safe mechanism module `core/utils/mediaPlayers.ts` (mirror of `volume.ts`, driven by `playerctl`) plus a single policy seam `core/services/voiceAudioEffects.ts` exposing `applyVoiceAudioEffects(db)` / `clearVoiceAudioEffects(db)`. These two functions become the single source of truth for "audio side-effects during voice input" (volume duck + media pause). The existing duck/restore call sites (whisper IPC handlers + quickChat overlay lifecycle) are rewired to call them.

**Tech Stack:** TypeScript, Node `child_process.execFile`, `playerctl` (MPRIS), Vitest, React + Zustand (settings UI). No new npm dependency — `playerctl` is an optional system binary, no-op gracefully if absent.

**Spec:** `docs/superpowers/specs/2026-06-04-pause-media-on-voice-input-design.md`

---

## File Structure

- **Create** `src/core/utils/mediaPlayers.ts` — playerctl detection + pause/resume of playing players. One responsibility: MPRIS player control. No `electron` import (headless-safe).
- **Create** `src/core/utils/mediaPlayers.test.ts` — unit tests (mock `child_process` + `env`).
- **Create** `src/core/services/voiceAudioEffects.ts` — policy: reads settings, coordinates volume duck + media pause. One responsibility: orchestrate voice-input audio effects.
- **Create** `src/core/services/voiceAudioEffects.test.ts` — unit tests (mock `volume`, `mediaPlayers`, `db`).
- **Modify** `src/core/services/settings.ts` — add `voice_pauseMediaPlayers` to the whitelist.
- **Modify** `src/core/handlers/whisper.ts` — `voice:duck`/`voice:restore` delegate to the policy seam.
- **Modify** `src/main/services/quickChat.ts` — overlay duck/restore call sites use the policy seam.
- **Modify** `src/renderer/components/settings/QuickChatSettings.tsx` — add the opt-in toggle.
- **Modify** `src/renderer/components/settings/QuickChatSettings.test.tsx` — test the toggle.

---

## Task 1: Media player control module (`mediaPlayers.ts`)

**Files:**
- Create: `src/core/utils/mediaPlayers.ts`
- Test: `src/core/utils/mediaPlayers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/utils/mediaPlayers.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('./env', () => ({
  findBinaryInPath: vi.fn(),
}))

import { execFile } from 'child_process'
import { findBinaryInPath } from './env'
import { pauseMediaPlayers, resumeMediaPlayers, _resetForTesting } from './mediaPlayers'

function mockPlayerctl(path: string | null) {
  vi.mocked(findBinaryInPath).mockImplementation((n) => (n === 'playerctl' ? path : null))
}

// Returns sequential stdout outputs for each execFile call, ignoring args.
function mockExecSequence(outputs: string[]) {
  let i = 0
  vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb: any) => {
    cb(null, outputs[i++] ?? '', '')
    return {} as any
  })
}

// Routes execFile by args: throws for any call whose args include `failArg`.
function mockExecRouter(handler: (args: string[]) => string | Error) {
  vi.mocked(execFile).mockImplementation((_bin, args: any, _opts, cb: any) => {
    const result = handler(args as string[])
    if (result instanceof Error) cb(result, '', '')
    else cb(null, result, '')
    return {} as any
  })
}

describe('mediaPlayers', () => {
  beforeEach(() => {
    _resetForTesting()
    vi.clearAllMocks()
  })

  it('pauses only players in Playing status', async () => {
    mockPlayerctl('/usr/bin/playerctl')
    mockExecSequence([
      'spotify\nfirefox\nvlc', // --list-all
      'Playing',               // spotify status
      '',                      // spotify pause
      'Paused',                // firefox status
      'Playing',               // vlc status
      '',                      // vlc pause
    ])

    await pauseMediaPlayers()

    const calls = vi.mocked(execFile).mock.calls.map((c) => c[1])
    expect(calls).toEqual([
      ['--list-all'],
      ['-p', 'spotify', 'status'],
      ['-p', 'spotify', 'pause'],
      ['-p', 'firefox', 'status'],
      ['-p', 'vlc', 'status'],
      ['-p', 'vlc', 'pause'],
    ])
  })

  it('resumes only the players it paused', async () => {
    mockPlayerctl('/usr/bin/playerctl')
    mockExecSequence([
      'spotify\nfirefox\nvlc',
      'Playing', '',   // spotify playing → pause
      'Paused',        // firefox paused → skip
      'Playing', '',   // vlc playing → pause
    ])
    await pauseMediaPlayers()

    vi.mocked(execFile).mockClear()
    mockExecSequence(['', '']) // spotify play, vlc play
    await resumeMediaPlayers()

    const calls = vi.mocked(execFile).mock.calls.map((c) => c[1])
    expect(calls).toEqual([
      ['-p', 'spotify', 'play'],
      ['-p', 'vlc', 'play'],
    ])
  })

  it('is idempotent: second pause is a no-op', async () => {
    mockPlayerctl('/usr/bin/playerctl')
    mockExecSequence(['spotify', 'Playing', ''])
    await pauseMediaPlayers()
    const countAfterFirst = vi.mocked(execFile).mock.calls.length

    await pauseMediaPlayers()
    expect(vi.mocked(execFile).mock.calls.length).toBe(countAfterFirst)
  })

  it('resume without a prior pause is a no-op', async () => {
    mockPlayerctl('/usr/bin/playerctl')
    await resumeMediaPlayers()
    expect(execFile).not.toHaveBeenCalled()
  })

  it('no-op when playerctl is not installed', async () => {
    mockPlayerctl(null)
    await pauseMediaPlayers()
    expect(execFile).not.toHaveBeenCalled()
  })

  it('does not throw when a player closes before resume', async () => {
    mockPlayerctl('/usr/bin/playerctl')
    mockExecSequence(['spotify', 'Playing', ''])
    await pauseMediaPlayers()

    vi.mocked(execFile).mockClear()
    mockExecRouter((args) =>
      args.includes('play') ? new Error('No player could handle this command') : '',
    )
    await expect(resumeMediaPlayers()).resolves.toBeUndefined()
  })

  it('resume awaits an in-flight pause (race protection)', async () => {
    mockPlayerctl('/usr/bin/playerctl')
    mockExecSequence(['spotify', 'Playing', '', '']) // list, status, pause, then play
    const pausing = pauseMediaPlayers() // not awaited
    await resumeMediaPlayers()
    await pausing

    const playCall = vi.mocked(execFile).mock.calls.find((c) => (c[1] as string[]).includes('play'))
    expect(playCall?.[1]).toEqual(['-p', 'spotify', 'play'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/utils/mediaPlayers.test.ts`
Expected: FAIL — `Failed to resolve import "./mediaPlayers"` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/core/utils/mediaPlayers.ts`:

```typescript
import { execFile } from 'child_process'
import { findBinaryInPath } from './env'
import { createLogger, errToCtx } from './logger'

const log = createLogger('mediaPlayers')

let cachedPlayerctl: string | null | undefined = undefined
let pausedPlayers: string[] | null = null
let pausePromise: Promise<void> | null = null

function detectPlayerctl(): string | null {
  if (cachedPlayerctl !== undefined) return cachedPlayerctl
  cachedPlayerctl = findBinaryInPath('playerctl')
  return cachedPlayerctl
}

function exec(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: 5000 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout.trim())
    })
  })
}

/** Pause every MPRIS player currently in "Playing" status; remember which. Idempotent. */
export function pauseMediaPlayers(): Promise<void> {
  if (pausedPlayers !== null) return Promise.resolve()

  const playerctl = detectPlayerctl()
  if (!playerctl) {
    log.warn('playerctl not found — media pause unavailable')
    return Promise.resolve()
  }

  pausePromise = (async () => {
    try {
      const listOut = await exec(playerctl, ['--list-all'])
      const players = listOut.split('\n').map((s) => s.trim()).filter(Boolean)

      const paused: string[] = []
      for (const player of players) {
        let status: string
        try {
          status = await exec(playerctl, ['-p', player, 'status'])
        } catch {
          continue // player vanished between list and status
        }
        if (status === 'Playing') {
          try {
            await exec(playerctl, ['-p', player, 'pause'])
            paused.push(player)
          } catch {
            // player vanished between status and pause
          }
        }
      }
      pausedPlayers = paused
      log.debug('Media players paused', { count: paused.length })
    } catch (err) {
      pausedPlayers = null
      log.warn('Pause media players failed', errToCtx(err))
    }
  })()
  return pausePromise
}

/** Resume only the players paused by pauseMediaPlayers(). Best-effort, idempotent. */
export async function resumeMediaPlayers(): Promise<void> {
  if (pausePromise) {
    await pausePromise
    pausePromise = null
  }

  if (pausedPlayers === null) return

  const playerctl = detectPlayerctl()
  if (!playerctl) {
    pausedPlayers = null
    return
  }

  const players = pausedPlayers
  pausedPlayers = null

  for (const player of players) {
    try {
      await exec(playerctl, ['-p', player, 'play'])
    } catch {
      // player closed between pause and resume
    }
  }
  log.debug('Media players resumed', { count: players.length })
}

/** Reset module state for testing */
export function _resetForTesting(): void {
  cachedPlayerctl = undefined
  pausedPlayers = null
  pausePromise = null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/core/utils/mediaPlayers.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/utils/mediaPlayers.ts src/core/utils/mediaPlayers.test.ts
git commit -m "feat(voice): add MPRIS media player pause/resume module"
```

---

## Task 2: Voice audio effects policy seam (`voiceAudioEffects.ts`)

**Files:**
- Create: `src/core/services/voiceAudioEffects.ts`
- Test: `src/core/services/voiceAudioEffects.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/services/voiceAudioEffects.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../utils/volume', () => ({
  duckVolume: vi.fn(),
  restoreVolume: vi.fn(),
}))
vi.mock('../utils/mediaPlayers', () => ({
  pauseMediaPlayers: vi.fn(),
  resumeMediaPlayers: vi.fn(),
}))
vi.mock('../utils/db', () => ({
  getSetting: vi.fn(),
}))

import { duckVolume, restoreVolume } from '../utils/volume'
import { pauseMediaPlayers, resumeMediaPlayers } from '../utils/mediaPlayers'
import { getSetting } from '../utils/db'
import { applyVoiceAudioEffects, clearVoiceAudioEffects } from './voiceAudioEffects'

const db = {} as any

function settings(map: Record<string, string>) {
  vi.mocked(getSetting).mockImplementation((_db, key) => map[key] ?? '')
}

describe('voiceAudioEffects', () => {
  beforeEach(() => vi.clearAllMocks())

  it('applies both duck and pause when both are enabled', async () => {
    settings({ voice_volumeDuck: '30', voice_pauseMediaPlayers: 'true' })
    await applyVoiceAudioEffects(db)
    expect(duckVolume).toHaveBeenCalledWith(30)
    expect(pauseMediaPlayers).toHaveBeenCalledOnce()
  })

  it('applies only duck when pause is disabled', async () => {
    settings({ voice_volumeDuck: '30', voice_pauseMediaPlayers: 'false' })
    await applyVoiceAudioEffects(db)
    expect(duckVolume).toHaveBeenCalledWith(30)
    expect(pauseMediaPlayers).not.toHaveBeenCalled()
  })

  it('applies only pause when duck is 0', async () => {
    settings({ voice_volumeDuck: '0', voice_pauseMediaPlayers: 'true' })
    await applyVoiceAudioEffects(db)
    expect(duckVolume).not.toHaveBeenCalled()
    expect(pauseMediaPlayers).toHaveBeenCalledOnce()
  })

  it('applies nothing when both are disabled', async () => {
    settings({ voice_volumeDuck: '0', voice_pauseMediaPlayers: 'false' })
    await applyVoiceAudioEffects(db)
    expect(duckVolume).not.toHaveBeenCalled()
    expect(pauseMediaPlayers).not.toHaveBeenCalled()
  })

  it('clear restores volume and resumes media', async () => {
    await clearVoiceAudioEffects(db)
    expect(restoreVolume).toHaveBeenCalledOnce()
    expect(resumeMediaPlayers).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/services/voiceAudioEffects.test.ts`
Expected: FAIL — `Failed to resolve import "./voiceAudioEffects"`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/core/services/voiceAudioEffects.ts`:

```typescript
import type Database from 'better-sqlite3'
import { getSetting } from '../utils/db'
import { duckVolume, restoreVolume } from '../utils/volume'
import { pauseMediaPlayers, resumeMediaPlayers } from '../utils/mediaPlayers'

/** Audio side-effects applied when voice recording starts (single source of truth). */
export async function applyVoiceAudioEffects(db: Database.Database): Promise<void> {
  const duck = Number(getSetting(db, 'voice_volumeDuck')) || 0
  if (duck > 0) await duckVolume(duck)
  if (getSetting(db, 'voice_pauseMediaPlayers') === 'true') await pauseMediaPlayers()
}

/** Reverses applyVoiceAudioEffects when voice recording ends. Both calls are idempotent. */
export async function clearVoiceAudioEffects(db: Database.Database): Promise<void> {
  await restoreVolume()
  await resumeMediaPlayers()
}
```

Note: `import type Database from 'better-sqlite3'` mirrors `src/core/utils/db.ts` (a type-only compat shim; the runtime DB is sql.js).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/core/services/voiceAudioEffects.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/services/voiceAudioEffects.ts src/core/services/voiceAudioEffects.test.ts
git commit -m "feat(voice): add voiceAudioEffects orchestration seam"
```

---

## Task 3: Register the setting + rewire whisper handlers

**Files:**
- Modify: `src/core/services/settings.ts:42`
- Modify: `src/core/handlers/whisper.ts`

- [ ] **Step 1: Add the setting to the whitelist**

In `src/core/services/settings.ts`, find line 42 (`'voice_volumeDuck',`) and add the new key immediately after it:

```typescript
  'voice_volumeDuck',
  'voice_pauseMediaPlayers',
```

- [ ] **Step 2: Rewire the whisper handlers**

Replace the entire contents of `src/core/handlers/whisper.ts` with:

```typescript
import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { transcribe, validateConfig } from '../services/whisper'
import { applyVoiceAudioEffects, clearVoiceAudioEffects } from '../services/voiceAudioEffects'

// ─── Handler registration ───────────────────────────────────

export function registerWhisperHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  registrar.handle('whisper:transcribe', async (_event, wavBuffer: unknown) => {
    const raw = wavBuffer as Uint8Array | Buffer
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    return transcribe(db as any, buf)
  })

  registrar.handle('whisper:validateConfig', async () => {
    return validateConfig(db as any)
  })

  registrar.handle('voice:duck', async () => {
    await applyVoiceAudioEffects(db as any)
  })

  registrar.handle('voice:restore', async () => {
    await clearVoiceAudioEffects(db as any)
  })
}
```

(This removes the now-unused `getSetting` / `duckVolume` / `restoreVolume` imports — the volume-read knowledge moved into `applyVoiceAudioEffects`.)

- [ ] **Step 3: Verify the project type-checks and existing tests still pass**

Run: `npx vitest run src/core/services/voiceAudioEffects.test.ts src/core/utils/mediaPlayers.test.ts src/core/utils/volume.test.ts`
Expected: PASS (all).

Run: `npm run build`
Expected: 0 errors (no unused-import or type errors from the whisper.ts edit).

- [ ] **Step 4: Commit**

```bash
git add src/core/services/settings.ts src/core/handlers/whisper.ts
git commit -m "feat(voice): whitelist voice_pauseMediaPlayers and delegate handlers to seam"
```

---

## Task 4: Rewire quickChat overlay duck/restore call sites

**Files:**
- Modify: `src/main/services/quickChat.ts:10` (import), `:126`, `:137`, `:153-156`

- [ ] **Step 1: Swap the import**

In `src/main/services/quickChat.ts`, replace line 10:

```typescript
import { duckVolume, restoreVolume } from '../utils/volume'
```

with:

```typescript
import { applyVoiceAudioEffects, clearVoiceAudioEffects } from '../../core/services/voiceAudioEffects'
```

(Keep the existing `import { getSetting } from '../../core/utils/db'` — still used by `resolveResumeTarget`.)

- [ ] **Step 2: Replace the `win.on('closed')` restore (line 126)**

Change:

```typescript
  win.on('closed', () => { overlayWindow = null; headlessActive = false; restoreVolume() })
```

to:

```typescript
  win.on('closed', () => { overlayWindow = null; headlessActive = false; void clearVoiceAudioEffects(db) })
```

- [ ] **Step 3: Replace the re-toggle restore (line 137)**

Inside `showOverlay`, change:

```typescript
        overlayWindow.webContents.send('overlay:stopRecording')
        restoreVolume()
```

to:

```typescript
        overlayWindow.webContents.send('overlay:stopRecording')
        void clearVoiceAudioEffects(db)
```

- [ ] **Step 4: Replace the voice-mode duck block (lines 153-156)**

Change:

```typescript
  if (mode === 'voice') {
    const duck = Number(getSetting(db, 'voice_volumeDuck')) || 0
    if (duck > 0) duckVolume(duck)
  }
```

to:

```typescript
  if (mode === 'voice') {
    applyVoiceAudioEffects(db).catch(() => {})
  }
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: 0 errors (no unused `duckVolume`/`restoreVolume` imports remain; `db` is in module scope at every call site).

- [ ] **Step 6: Commit**

```bash
git add src/main/services/quickChat.ts
git commit -m "feat(voice): route quickChat overlay audio effects through the seam"
```

---

## Task 5: Settings UI toggle

**Files:**
- Modify: `src/renderer/components/settings/QuickChatSettings.tsx` (Voice Volume section)
- Modify: `src/renderer/components/settings/QuickChatSettings.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/renderer/components/settings/QuickChatSettings.test.tsx`, add these two tests inside the `describe('QuickChatSettings', ...)` block (e.g. after the `changing volume duck slider` test at line 96):

```typescript
  it('pause-media checkbox reflects settings value', () => {
    useSettingsStore.setState({
      settings: { voice_pauseMediaPlayers: 'true' },
      setSetting: vi.fn().mockResolvedValue(undefined),
    })

    render(<QuickChatSettings />)
    const checkbox = screen.getByLabelText(/pause media players/i) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
  })

  it('toggling pause-media checkbox calls setSetting', () => {
    const setSetting = vi.fn().mockResolvedValue(undefined)
    useSettingsStore.setState({ setSetting })

    render(<QuickChatSettings />)
    const checkbox = screen.getByLabelText(/pause media players/i)
    fireEvent.click(checkbox)

    expect(setSetting).toHaveBeenCalledWith('voice_pauseMediaPlayers', 'true')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.renderer.ts src/renderer/components/settings/QuickChatSettings.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: /pause media players/i`.

- [ ] **Step 3: Add the toggle to the component**

In `src/renderer/components/settings/QuickChatSettings.tsx`, inside the `{/* Voice Volume */}` block, immediately after the slider's help `<span>` (the one ending `0 = disabled.`, line 81-82) and before the closing `</div>` of that block, add:

```tsx
        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <input
            type="checkbox"
            checked={settings.voice_pauseMediaPlayers === 'true'}
            onChange={(e) => setSetting('voice_pauseMediaPlayers', e.target.checked ? 'true' : 'false')}
            className="accent-[var(--color-primary)]"
          />
          Pause media players during voice recording
        </label>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Pauses currently playing media (Spotify, browsers, etc. via playerctl) while recording, and resumes them when recording stops. Linux only.
        </span>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.renderer.ts src/renderer/components/settings/QuickChatSettings.test.tsx`
Expected: PASS (all tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/QuickChatSettings.tsx src/renderer/components/settings/QuickChatSettings.test.tsx
git commit -m "feat(voice): add opt-in toggle to pause media during voice input"
```

---

## Task 6: Full verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS. (If the chain stops on the known-flaky `webServer.test.ts` port race, rerun the renderer config separately per project memory: `npx vitest run --config vitest.config.renderer.ts`.)

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Dedup baseline check**

Run: `npm run audit:check`
Expected: no regression vs baseline. (`mediaPlayers.ts` deliberately mirrors `volume.ts` structure; if the clone detector flags the `exec` helper or `detectX` shape, document it as an intentional boundary mirror rather than collapsing the two modules — they control different subsystems and change for different reasons.)

- [ ] **Step 4: Manual smoke test (Linux with playerctl)**

1. `npm run dev`.
2. Settings → Quick Chat → enable "Pause media players during voice recording".
3. Start playing music (Spotify / browser).
4. Trigger voice input (mic button or Quick Voice shortcut). → music pauses.
5. Stop recording. → music resumes.
6. Manually pause the music, then trigger + stop voice input. → music stays paused (we only resume what we paused).
7. Disable the toggle, repeat step 3-5. → music keeps playing (duck only, no pause).

---

## Self-Review Notes

- **Spec coverage:** mechanism (Task 1), ren-resume-only-paused (Task 1 `pausedPlayers` list), orchestration seam (Task 2), setting whitelist + opt-in default (Task 3 — default `'false'` is implicit: `getSetting` returns `''` for an unset key, so `=== 'true'` is false), both handler layers rewired (Task 3 IPC + Task 4 quickChat safety net), UI toggle (Task 5), error handling / no-playerctl no-op (Task 1 tests), graceful resume of closed players (Task 1 test).
- **No new IPC channel:** `voice:duck`/`voice:restore` names retained per spec; renderer untouched.
- **Type consistency:** `applyVoiceAudioEffects` / `clearVoiceAudioEffects` signatures `(db: Database.Database) => Promise<void>` used identically in Tasks 2, 3, 4. `pauseMediaPlayers` / `resumeMediaPlayers` / `_resetForTesting` names match across Task 1 impl + test and Task 2 mock.
