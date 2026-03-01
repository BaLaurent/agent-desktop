# Auto Theme Day/Night — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add automatic day/night theme switching driven by configurable transition hours, piggybacking on the existing scheduler 60s tick.

**Architecture:** 5 new settings keys (`autoTheme_*`) in the flat key-value store. A `checkAutoTheme()` function in `scheduler.ts` computes the expected theme from current time + configured hours, and sends an IPC event to the renderer when a switch is needed. The renderer listens and calls `applyTheme()`. UI in `AppearanceSettings.tsx` provides toggle, theme dropdowns, time pickers, and a click-dialog when auto-mode is active.

**Tech Stack:** Electron IPC, Zustand, Tailwind CSS, Vitest

---

## Task 1: Settings Whitelist + Auto-Theme Scheduler Logic

**Files:**
- Modify: `src/main/services/settings.ts:27-30` (add 5 keys after `heatmap_max`)
- Modify: `src/main/services/scheduler.ts` (add `getExpectedThemeFilename()`, `checkAutoTheme()`, call in `tick()` and `startScheduler()`)
- Modify: `src/main/services/scheduler.test.ts` (add tests for `getExpectedThemeFilename`)

**Step 1: Write the failing tests for `getExpectedThemeFilename`**

Add to `src/main/services/scheduler.test.ts`:

```typescript
import { computeNextRun, getExpectedThemeFilename } from './scheduler'

describe('getExpectedThemeFilename', () => {
  it('returns day theme during daytime (normal range)', () => {
    const now = new Date('2025-01-15T12:00:00')
    expect(getExpectedThemeFilename('07:00', '21:00', 'light.css', 'dark.css', now))
      .toBe('light.css')
  })

  it('returns night theme before day starts (normal range)', () => {
    const now = new Date('2025-01-15T05:00:00')
    expect(getExpectedThemeFilename('07:00', '21:00', 'light.css', 'dark.css', now))
      .toBe('dark.css')
  })

  it('returns night theme after night starts (normal range)', () => {
    const now = new Date('2025-01-15T22:00:00')
    expect(getExpectedThemeFilename('07:00', '21:00', 'light.css', 'dark.css', now))
      .toBe('dark.css')
  })

  it('returns day theme at exact day start time', () => {
    const now = new Date('2025-01-15T07:00:00')
    expect(getExpectedThemeFilename('07:00', '21:00', 'light.css', 'dark.css', now))
      .toBe('light.css')
  })

  it('returns night theme at exact night start time', () => {
    const now = new Date('2025-01-15T21:00:00')
    expect(getExpectedThemeFilename('07:00', '21:00', 'light.css', 'dark.css', now))
      .toBe('dark.css')
  })

  it('handles inverted range — night crosses midnight (during day)', () => {
    const now = new Date('2025-01-15T23:00:00')
    expect(getExpectedThemeFilename('22:00', '06:00', 'light.css', 'dark.css', now))
      .toBe('light.css')
  })

  it('handles inverted range — night crosses midnight (during night)', () => {
    const now = new Date('2025-01-15T03:00:00')
    expect(getExpectedThemeFilename('22:00', '06:00', 'light.css', 'dark.css', now))
      .toBe('dark.css')
  })

  it('handles inverted range — night crosses midnight (afternoon = night)', () => {
    const now = new Date('2025-01-15T14:00:00')
    expect(getExpectedThemeFilename('22:00', '06:00', 'light.css', 'dark.css', now))
      .toBe('dark.css')
  })

  it('returns day theme when both times are equal', () => {
    const now = new Date('2025-01-15T12:00:00')
    expect(getExpectedThemeFilename('12:00', '12:00', 'light.css', 'dark.css', now))
      .toBe('light.css')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/services/scheduler.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — `getExpectedThemeFilename` is not exported / does not exist

**Step 3: Implement `getExpectedThemeFilename` in scheduler.ts**

Add after the `computeNextRun` function (after line 48) in `src/main/services/scheduler.ts`:

```typescript
export function getExpectedThemeFilename(
  dayTime: string,
  nightTime: string,
  dayTheme: string,
  nightTheme: string,
  now: Date = new Date()
): string {
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const [dayH, dayM] = dayTime.split(':').map(Number)
  const [nightH, nightM] = nightTime.split(':').map(Number)
  const dayMinutes = dayH * 60 + dayM
  const nightMinutes = nightH * 60 + nightM

  if (dayMinutes <= nightMinutes) {
    return (currentMinutes >= dayMinutes && currentMinutes < nightMinutes) ? dayTheme : nightTheme
  }
  return (currentMinutes >= dayMinutes || currentMinutes < nightMinutes) ? dayTheme : nightTheme
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/services/scheduler.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: ALL PASS

**Step 5: Add `checkAutoTheme` function + hook into tick**

Add `checkAutoTheme` in `src/main/services/scheduler.ts` (before the `tick()` function):

```typescript
function checkAutoTheme(db: Database.Database): void {
  const getVal = (key: string): string | null => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  if (getVal('autoTheme_enabled') !== 'true') return

  const dayTheme = getVal('autoTheme_dayTheme')
  const nightTheme = getVal('autoTheme_nightTheme')
  const dayTime = getVal('autoTheme_dayTime') || '07:00'
  const nightTime = getVal('autoTheme_nightTime') || '21:00'

  if (!dayTheme || !nightTheme) return

  const expected = getExpectedThemeFilename(dayTime, nightTime, dayTheme, nightTheme)
  const current = getVal('activeTheme')

  if (current === expected) return

  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('activeTheme', ?, datetime('now'))").run(expected)
  notifyRenderer('theme:autoSwitch', expected)
}
```

Modify `tick()` to call `checkAutoTheme` (add as first line of `tick()`):

```typescript
function tick(): void {
  if (!schedulerDb) return
  checkAutoTheme(schedulerDb)
  // ... rest of existing tick code ...
}
```

Modify `startScheduler()` to call `checkAutoTheme` at startup (add after the recovery loop, before the setInterval):

```typescript
  // Auto-theme: check on startup
  checkAutoTheme(db)

  // 1-minute tick resolution
  tickInterval = setInterval(tick, 60_000)
```

**Step 6: Add 5 keys to settings whitelist**

In `src/main/services/settings.ts`, add after line 29 (`'heatmap_max'`):

```typescript
  // Auto day/night theme
  'autoTheme_enabled',
  'autoTheme_dayTheme',
  'autoTheme_nightTheme',
  'autoTheme_dayTime',
  'autoTheme_nightTime',
```

**Step 7: Run all scheduler tests**

Run: `npx vitest run src/main/services/scheduler.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: ALL PASS

**Step 8: Commit**

```bash
git add src/main/services/settings.ts src/main/services/scheduler.ts src/main/services/scheduler.test.ts
git commit -m "feat(theme): add auto day/night theme logic in scheduler"
```

---

## Task 2: IPC Event Plumbing + Renderer Listener

**Files:**
- Modify: `src/preload/api.d.ts:204-211` (add `onAutoThemeSwitch` to events interface)
- Modify: `src/preload/index.ts:219-248` (add `onAutoThemeSwitch` to events object)
- Modify: `src/renderer/__tests__/setup.ts:135-144` (add mock for `onAutoThemeSwitch`)
- Modify: `src/renderer/App.tsx:58-68` (add listener in useEffect)

**Step 1: Add type to `api.d.ts`**

In `src/preload/api.d.ts`, add inside the `events` interface (after `onConversationUpdated`, around line 210):

```typescript
    onAutoThemeSwitch(callback: (filename: string) => void): () => void
```

**Step 2: Add listener to preload**

In `src/preload/index.ts`, add inside the `events` object (after `onConversationUpdated`, around line 248):

```typescript
    onAutoThemeSwitch: (callback: (filename: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, filename: string) => callback(filename)
      ipcRenderer.on('theme:autoSwitch', handler)
      return () => { ipcRenderer.removeListener('theme:autoSwitch', handler) }
    },
```

**Step 3: Add mock to test setup**

In `src/renderer/__tests__/setup.ts`, add inside the `events` mock object (after `onConversationUpdated`, around line 143):

```typescript
    onAutoThemeSwitch: vi.fn().mockReturnValue(() => {}),
```

**Step 4: Wire renderer listener in App.tsx**

In `src/renderer/App.tsx`, add after the existing `unsubDeeplink` line (around line 63):

```typescript
    const unsubAutoTheme = window.agent.events.onAutoThemeSwitch((filename) => {
      const { themes } = useSettingsStore.getState()
      const theme = themes.find((t) => t.filename === filename)
      if (theme) {
        const styleEl = document.getElementById('agent-theme') as HTMLStyleElement | null
        if (styleEl) styleEl.textContent = theme.css
        useSettingsStore.setState({ activeTheme: filename })
      }
    })
```

Update the cleanup return to include `unsubAutoTheme`:

```typescript
    return () => {
      unsubTray()
      unsubDeeplink()
      unsubAutoTheme()
    }
```

Note: We bypass `applyTheme()` to avoid a redundant `setSetting('activeTheme', ...)` IPC call — the main process already updated the DB.

**Step 5: Run renderer tests**

Run: `npx vitest run src/renderer/stores/settingsStore.test.ts --reporter=verbose 2>&1 | tail -10`
Expected: ALL PASS (existing tests unaffected)

**Step 6: Commit**

```bash
git add src/preload/api.d.ts src/preload/index.ts src/renderer/__tests__/setup.ts src/renderer/App.tsx
git commit -m "feat(theme): wire auto-theme IPC event from scheduler to renderer"
```

---

## Task 3: AppearanceSettings UI — Auto Theme Section + Manual Click Dialog

**Files:**
- Modify: `src/renderer/components/settings/AppearanceSettings.tsx` (add auto-theme section + modify theme click handler)

**Step 1: Add state variables for auto-theme dialog**

In `AppearanceSettings.tsx`, add after the existing `useState` declarations (around line 38):

```typescript
  const [autoThemeDialog, setAutoThemeDialog] = useState<ThemeFile | null>(null)
```

**Step 2: Add derived auto-theme values**

After the `heatmapMode` line (around line 49), add:

```typescript
  const autoThemeEnabled = (settings.autoTheme_enabled ?? 'false') === 'true'
  const autoThemeDayTheme = settings.autoTheme_dayTheme ?? 'default-light.css'
  const autoThemeNightTheme = settings.autoTheme_nightTheme ?? 'default-dark.css'
  const autoThemeDayTime = settings.autoTheme_dayTime ?? '07:00'
  const autoThemeNightTime = settings.autoTheme_nightTime ?? '21:00'
```

**Step 3: Modify `handleSelectTheme` to show dialog when auto is on**

Replace the `handleSelectTheme` function:

```typescript
  const handleSelectTheme = (theme: ThemeFile) => {
    if (autoThemeEnabled) {
      setAutoThemeDialog(theme)
    } else {
      applyTheme(theme)
    }
  }
```

**Step 4: Add auto-theme toggle section JSX**

Insert a new section between the Folder Heatmap section and the Theme Selection section (before `{/* Theme Selection */}`, around line 319):

```tsx
      {/* Auto Day/Night Theme */}
      <div className="rounded-lg overflow-hidden border border-deep">
        <div className="flex items-center justify-between px-4 py-3 border-b border-deep">
          <div className="flex flex-col">
            <span className="text-sm text-body">Auto Day/Night Theme</span>
            <span className="text-xs text-muted">Switch theme automatically based on time of day</span>
          </div>
          <button
            onClick={() => setSetting('autoTheme_enabled', autoThemeEnabled ? 'false' : 'true')}
            role="switch"
            aria-checked={autoThemeEnabled}
            aria-label="Toggle auto day/night theme"
            className="relative w-9 h-5 rounded-full flex-shrink-0 transition-colors"
            style={{
              backgroundColor: autoThemeEnabled ? 'var(--color-primary)' : 'var(--color-text-muted)',
              opacity: autoThemeEnabled ? 1 : 0.3,
            }}
          >
            <span
              className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
              style={{ transform: autoThemeEnabled ? 'translateX(16px)' : 'translateX(0px)' }}
            />
          </button>
        </div>

        {autoThemeEnabled && (
          <>
            {/* Day theme row */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-deep">
              <span className="text-sm text-body">Day theme</span>
              <div className="flex items-center gap-2">
                <select
                  value={autoThemeDayTheme}
                  onChange={(e) => setSetting('autoTheme_dayTheme', e.target.value)}
                  className="bg-surface text-body border border-muted rounded px-2 py-1 text-sm outline-none focus:border-primary mobile:text-base"
                  aria-label="Day theme"
                >
                  {themes.map((t) => (
                    <option key={t.filename} value={t.filename}>{t.name}</option>
                  ))}
                </select>
                <span className="text-xs text-muted">at</span>
                <input
                  type="time"
                  value={autoThemeDayTime}
                  onChange={(e) => setSetting('autoTheme_dayTime', e.target.value)}
                  className="bg-surface text-body border border-muted rounded px-2 py-1 text-sm outline-none focus:border-primary mobile:text-base"
                  aria-label="Day transition time"
                />
              </div>
            </div>

            {/* Night theme row */}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-body">Night theme</span>
              <div className="flex items-center gap-2">
                <select
                  value={autoThemeNightTheme}
                  onChange={(e) => setSetting('autoTheme_nightTheme', e.target.value)}
                  className="bg-surface text-body border border-muted rounded px-2 py-1 text-sm outline-none focus:border-primary mobile:text-base"
                  aria-label="Night theme"
                >
                  {themes.map((t) => (
                    <option key={t.filename} value={t.filename}>{t.name}</option>
                  ))}
                </select>
                <span className="text-xs text-muted">at</span>
                <input
                  type="time"
                  value={autoThemeNightTime}
                  onChange={(e) => setSetting('autoTheme_nightTime', e.target.value)}
                  className="bg-surface text-body border border-muted rounded px-2 py-1 text-sm outline-none focus:border-primary mobile:text-base"
                  aria-label="Night transition time"
                />
              </div>
            </div>
          </>
        )}
      </div>
```

**Step 5: Add auto-theme click dialog JSX**

Insert right before the closing `</div>` of the component (before line 478), add:

```tsx
      {/* Auto-theme click dialog */}
      {autoThemeDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'var(--color-overlay)' }}>
          <div className="bg-surface rounded-lg p-4 max-w-xs w-full shadow-lg border border-muted">
            <h3 className="text-sm font-semibold text-body mb-3">
              Apply "{autoThemeDialog.name}"
            </h3>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  setSetting('autoTheme_dayTheme', autoThemeDialog.filename)
                  applyTheme(autoThemeDialog)
                  setAutoThemeDialog(null)
                }}
                className="px-3 py-2 rounded text-sm font-medium text-left transition-colors hover:bg-deep text-body"
              >
                Set as day theme
              </button>
              <button
                onClick={() => {
                  setSetting('autoTheme_nightTheme', autoThemeDialog.filename)
                  applyTheme(autoThemeDialog)
                  setAutoThemeDialog(null)
                }}
                className="px-3 py-2 rounded text-sm font-medium text-left transition-colors hover:bg-deep text-body"
              >
                Set as night theme
              </button>
              <button
                onClick={() => {
                  setSetting('autoTheme_enabled', 'false')
                  applyTheme(autoThemeDialog)
                  setAutoThemeDialog(null)
                }}
                className="px-3 py-2 rounded text-sm font-medium text-left transition-colors hover:bg-deep text-muted"
              >
                Apply globally (disable auto)
              </button>
            </div>
            <button
              onClick={() => setAutoThemeDialog(null)}
              className="mt-3 w-full px-3 py-2 rounded text-sm font-medium transition-colors bg-deep text-body"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
```

**Step 6: Build and verify**

Run: `npx tsc --noEmit 2>&1 | tail -10`
Expected: No type errors

**Step 7: Commit**

```bash
git add src/renderer/components/settings/AppearanceSettings.tsx
git commit -m "feat(theme): add auto day/night theme UI in appearance settings"
```

---

## Task 4: Integration Test + Final Build

**Files:**
- Read-only: all modified files

**Step 1: Run full test suite**

Run: `npm test 2>&1 | tail -20`
Expected: ALL PASS

**Step 2: Run full build**

Run: `npm run build 2>&1 | tail -10`
Expected: 0 errors, 0 warnings

**Step 3: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix(theme): integration fixups for auto day/night theme"
```
