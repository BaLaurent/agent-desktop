# Auto Theme Day/Night — Design Document

**Date:** 2026-02-28
**Status:** Approved

## Overview

Add automatic day/night theme switching to appearance settings. Users can define a day theme and a night theme, configure transition hours (HH:MM), and the app switches automatically based on system time.

## Settings (DB)

5 new keys in `ALLOWED_SETTING_KEYS`:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `autoTheme_enabled` | `'true'`/`'false'` | `'false'` | Master toggle |
| `autoTheme_dayTheme` | string (filename) | `'default-light.css'` | Day theme filename |
| `autoTheme_nightTheme` | string (filename) | `'default-dark.css'` | Night theme filename |
| `autoTheme_dayTime` | `'HH:MM'` | `'07:00'` | Transition to day |
| `autoTheme_nightTime` | `'HH:MM'` | `'21:00'` | Transition to night |

## Mechanism — Scheduler Tick (Main Process)

Piggyback on the existing 60-second `setInterval` in `scheduler.ts`:

1. `tick()` calls `checkAutoTheme(db)` on each cycle
2. `checkAutoTheme()` reads the 5 `autoTheme_*` settings
3. If disabled → return early
4. Compute expected theme for current time
5. Read current `activeTheme` setting
6. If mismatch → update `activeTheme` in DB + broadcast IPC `theme:autoSwitch` with filename
7. Renderer listens to `theme:autoSwitch`, finds the `ThemeFile`, calls `applyTheme()`

**At startup:** `startScheduler()` calls `checkAutoTheme()` once before the interval begins.

### Expected Theme Calculation

```
getExpectedTheme(dayTime, nightTime, now):
  if dayTime < nightTime:       // e.g. 07:00 → 21:00
    return (now >= dayTime && now < nightTime) ? dayTheme : nightTheme
  else:                          // e.g. 22:00 → 06:00 (night crosses midnight)
    return (now >= dayTime || now < nightTime) ? dayTheme : nightTheme
```

## UI — AppearanceSettings

New section above the theme grid: **"Thème automatique Jour/Nuit"**

```
┌─────────────────────────────────────────────────┐
│ ☀ Thème automatique Jour/Nuit          [Toggle] │
│                                                 │
│ (visible only when toggle ON)                   │
│                                                 │
│  Thème jour:  [dropdown]  à  [07:00]            │
│  Thème nuit:  [dropdown]  à  [21:00]            │
└─────────────────────────────────────────────────┘
```

- Dropdowns list all available themes (from `settingsStore.themes`)
- Time inputs are `<input type="time">` (HH:MM)
- Changes persist immediately via `setSetting()`

## Manual Theme Click in Auto Mode

When `autoTheme_enabled === 'true'` and user clicks a theme in the grid, show a choice dialog:

1. **"Définir comme thème jour"** → updates `autoTheme_dayTheme`
2. **"Définir comme thème nuit"** → updates `autoTheme_nightTheme`
3. **"Appliquer globalement"** → disables auto-theme, applies theme normally

## Files Impacted

| File | Change |
|------|--------|
| `src/main/services/settings.ts` | Add 5 keys to `ALLOWED_SETTING_KEYS` |
| `src/main/services/scheduler.ts` | Add `checkAutoTheme()` + call in `tick()` and `startScheduler()` |
| `src/renderer/components/settings/AppearanceSettings.tsx` | Add auto-theme section + manual click dialog |
| `src/renderer/stores/settingsStore.ts` | Listen to `theme:autoSwitch` IPC event |
| `src/preload/index.ts` + `src/preload/api.d.ts` | Expose `theme:autoSwitch` listener |

## Edge Cases

- **App startup between transitions**: `startScheduler()` initial check handles this
- **Night crosses midnight** (e.g. 22:00→06:00): Handled by the dual-branch time comparison
- **Theme deleted while referenced**: Graceful fallback — if referenced theme not found, skip switch (keep current)
- **Both themes set to same file**: No-op on every tick (activeTheme always matches)
