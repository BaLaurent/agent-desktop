# Conversation Color — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to assign a color to individual conversations, with the same UX as folder colors (swatches + HSV picker), and support multi-select bulk color assignment.

**Architecture:** Add `color TEXT` column to conversations, extract folder color picker into shared `ColorPicker` component, wire it into ConversationItem's context menu. Priority: `conversation.color > folderColor > transparent`.

**Tech Stack:** SQLite migration, React, Zustand, Tailwind CSS, Vitest

---

### Task 1: DB Migration + Type + Backend Validation

**Files:**
- Modify: `src/main/db/schema.ts:215-218` (add migration after `sdk_session_id`)
- Modify: `src/shared/types.ts:31-46` (add `color` to `Conversation`)
- Modify: `src/main/services/conversations.ts:57-88` (add `color` to allowed + validation)
- Modify: `src/preload/api.d.ts:40` (no change needed — `Partial<Conversation>` already covers `color`)
- Test: `src/main/services/conversations.test.ts`

**Step 1: Write failing tests for color support**

Add these tests at the end of `conversations.test.ts`, inside the main `describe` block:

```ts
describe('color', () => {
  it('sets color on a conversation via update', async () => {
    const conv = await ipc.invoke('conversations:create', 'Colored') as any
    await ipc.invoke('conversations:update', conv.id, { color: '#ef4444' })
    const updated = await ipc.invoke('conversations:get', conv.id) as any
    expect(updated.color).toBe('#ef4444')
  })

  it('clears color with null', async () => {
    const conv = await ipc.invoke('conversations:create', 'Colored') as any
    await ipc.invoke('conversations:update', conv.id, { color: '#ef4444' })
    await ipc.invoke('conversations:update', conv.id, { color: null })
    const updated = await ipc.invoke('conversations:get', conv.id) as any
    expect(updated.color).toBeNull()
  })

  it('rejects invalid color format', async () => {
    const conv = await ipc.invoke('conversations:create', 'Bad') as any
    await expect(
      ipc.invoke('conversations:update', conv.id, { color: 'red' })
    ).rejects.toThrow('color must be a valid hex color')
  })

  it('defaults color to null on new conversations', async () => {
    const conv = await ipc.invoke('conversations:create', 'No Color') as any
    expect(conv.color).toBeNull()
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/services/conversations.test.ts`
Expected: FAIL — `color` not in allowed list, column doesn't exist

**Step 3: Add migration in schema.ts**

In `src/main/db/schema.ts`, after the `sdk_session_id` migration (line ~218), add:

```ts
  // Add color column to conversations (visual conversation tinting in sidebar)
  const convCols5 = db.pragma('table_info(conversations)') as { name: string }[]
  if (!convCols5.some((c) => c.name === 'color')) {
    try { db.exec('ALTER TABLE conversations ADD COLUMN color TEXT') } catch (e) { console.warn('[migration] conversations.color:', e) }
  }
```

**Step 4: Add `color` to Conversation type**

In `src/shared/types.ts`, add `color: string | null` to the `Conversation` interface, after `sdk_session_id`:

```ts
export interface Conversation {
  // ... existing fields ...
  sdk_session_id: string | null
  color: string | null          // <-- ADD THIS
  created_at: string
  updated_at: string
}
```

**Step 5: Add `color` to allowed list + validation in conversations.ts**

In `src/main/services/conversations.ts`:

1. Add validation after the `folder_id` check (line ~66):
```ts
if (data.color !== undefined && data.color !== null) {
  const c = data.color as string
  if (!/^#[0-9a-fA-F]{6}$/.test(c)) throw new Error('color must be a valid hex color (#rrggbb)')
}
```

2. Add `'color'` to the `allowed` array (line 67):
```ts
const allowed = ['title', 'folder_id', 'position', 'model', 'system_prompt', 'kb_enabled', 'cwd', 'ai_overrides', 'cleared_at', 'compact_summary', 'sdk_session_id', 'color']
```

**Step 6: Run tests to verify they pass**

Run: `npx vitest run src/main/services/conversations.test.ts`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/main/db/schema.ts src/shared/types.ts src/main/services/conversations.ts src/main/services/conversations.test.ts
git commit -m "feat(db): add color column to conversations with validation"
```

---

### Task 2: Add `colorMany` batch IPC handler

**Files:**
- Modify: `src/main/services/conversations.ts` (add `conversations:colorMany` handler after `moveMany`)
- Modify: `src/preload/index.ts:29` (add `colorMany` preload binding)
- Modify: `src/preload/api.d.ts:43` (add type declaration)
- Test: `src/main/services/conversations.test.ts`

**Step 1: Write failing tests**

Add inside the `describe('color')` block from Task 1:

```ts
it('colorMany sets color on multiple conversations', async () => {
  const c1 = await ipc.invoke('conversations:create', 'A') as any
  const c2 = await ipc.invoke('conversations:create', 'B') as any
  await ipc.invoke('conversations:colorMany', [c1.id, c2.id], '#22c55e')
  const u1 = await ipc.invoke('conversations:get', c1.id) as any
  const u2 = await ipc.invoke('conversations:get', c2.id) as any
  expect(u1.color).toBe('#22c55e')
  expect(u2.color).toBe('#22c55e')
})

it('colorMany clears color with null', async () => {
  const c1 = await ipc.invoke('conversations:create', 'A') as any
  await ipc.invoke('conversations:update', c1.id, { color: '#ef4444' })
  await ipc.invoke('conversations:colorMany', [c1.id], null)
  const u1 = await ipc.invoke('conversations:get', c1.id) as any
  expect(u1.color).toBeNull()
})

it('colorMany rejects invalid ids', async () => {
  await expect(ipc.invoke('conversations:colorMany', [-1], '#ef4444')).rejects.toThrow()
})

it('colorMany rejects invalid color', async () => {
  const c1 = await ipc.invoke('conversations:create', 'A') as any
  await expect(ipc.invoke('conversations:colorMany', [c1.id], 'bad')).rejects.toThrow('color must be a valid hex color')
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/services/conversations.test.ts`
Expected: FAIL — `conversations:colorMany` handler not registered

**Step 3: Add `colorMany` handler in conversations.ts**

After the `conversations:moveMany` handler (line ~111), add:

```ts
ipcMain.handle('conversations:colorMany', (_e, ids: number[], color: string | null) => {
  if (!Array.isArray(ids) || ids.length === 0) return
  for (const id of ids) validatePositiveInt(id, 'conversationId')
  if (color !== null) {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('color must be a valid hex color (#rrggbb)')
  }
  const stmt = db.prepare("UPDATE conversations SET color = ?, updated_at = datetime('now') WHERE id = ?")
  db.transaction(() => { for (const id of ids) stmt.run(color, id) })()
})
```

**Step 4: Add preload binding**

In `src/preload/index.ts`, after `moveMany` (line 29), add:

```ts
colorMany: (ids: number[], color: string | null) => withTimeout(ipcRenderer.invoke('conversations:colorMany', ids, color)),
```

**Step 5: Add type declaration**

In `src/preload/api.d.ts`, after `moveMany` (line 43), add:

```ts
colorMany(ids: number[], color: string | null): Promise<void>
```

**Step 6: Run tests to verify they pass**

Run: `npx vitest run src/main/services/conversations.test.ts`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/main/services/conversations.ts src/main/services/conversations.test.ts src/preload/index.ts src/preload/api.d.ts
git commit -m "feat(ipc): add conversations:colorMany batch handler"
```

---

### Task 3: Extract shared ColorPicker component from FolderTree

**Files:**
- Create: `src/renderer/components/shared/ColorPicker.tsx`
- Create: `src/renderer/components/shared/ColorPicker.test.tsx`
- Modify: `src/renderer/components/sidebar/FolderTree.tsx` (replace inline picker with `<ColorPicker>`)

**Step 1: Write test for ColorPicker**

Create `src/renderer/components/shared/ColorPicker.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ColorPicker } from './ColorPicker'

describe('ColorPicker', () => {
  it('renders 8 preset color swatches', () => {
    const { container } = render(
      <ColorPicker currentColor={null} onColorChange={vi.fn()} onClose={vi.fn()} position={{ x: 100, y: 100 }} />
    )
    const swatches = container.querySelectorAll('[aria-label^="Set color to"]')
    expect(swatches).toHaveLength(8)
  })

  it('calls onColorChange when a swatch is clicked', () => {
    const onChange = vi.fn()
    const { container } = render(
      <ColorPicker currentColor={null} onColorChange={onChange} onClose={vi.fn()} position={{ x: 100, y: 100 }} />
    )
    const swatch = container.querySelector('[aria-label="Set color to #ef4444"]') as HTMLElement
    fireEvent.click(swatch)
    expect(onChange).toHaveBeenCalledWith('#ef4444')
  })

  it('shows remove button only when currentColor is set', () => {
    const { rerender, container } = render(
      <ColorPicker currentColor={null} onColorChange={vi.fn()} onClose={vi.fn()} position={{ x: 100, y: 100 }} />
    )
    expect(container.querySelector('[aria-label="Remove color"]')).toBeNull()

    rerender(
      <ColorPicker currentColor="#ef4444" onColorChange={vi.fn()} onClose={vi.fn()} position={{ x: 100, y: 100 }} />
    )
    expect(container.querySelector('[aria-label="Remove color"]')).not.toBeNull()
  })

  it('calls onColorChange(null) when remove button is clicked', () => {
    const onChange = vi.fn()
    const { container } = render(
      <ColorPicker currentColor="#ef4444" onColorChange={onChange} onClose={vi.fn()} position={{ x: 100, y: 100 }} />
    )
    const removeBtn = container.querySelector('[aria-label="Remove color"]') as HTMLElement
    fireEvent.click(removeBtn)
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('highlights the currently selected swatch', () => {
    const { container } = render(
      <ColorPicker currentColor="#ef4444" onColorChange={vi.fn()} onClose={vi.fn()} position={{ x: 100, y: 100 }} />
    )
    const swatch = container.querySelector('[aria-label="Set color to #ef4444"]') as HTMLElement
    expect(swatch.style.outline).toContain('2px solid')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/shared/ColorPicker.test.tsx`
Expected: FAIL — module not found

**Step 3: Create ColorPicker component**

Create `src/renderer/components/shared/ColorPicker.tsx`:

```tsx
import { useState, useRef, useEffect, useCallback } from 'react'
import { ContextMenu } from './ContextMenu'

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
]

function hsvToHex(h: number, s: number, v: number): string {
  const s1 = s / 100, v1 = v / 100
  const c = v1 * s1
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = v1 - c
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 }
}

export { PRESET_COLORS, hsvToHex, hexToHsv }

interface SwatchesProps {
  currentColor: string | null
  onColorChange: (color: string | null) => void
  onOpenPicker: () => void
}

export function ColorSwatches({ currentColor, onColorChange, onOpenPicker }: SwatchesProps) {
  return (
    <div className="px-3 py-1.5 mobile:py-2.5">
      <div className="text-xs mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Color</div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onColorChange(c)}
            className="w-5 h-5 rounded-full flex-shrink-0 transition-transform hover:scale-110"
            style={{
              backgroundColor: c,
              outline: currentColor === c ? '2px solid var(--color-text)' : 'none',
              outlineOffset: '1px',
            }}
            aria-label={`Set color to ${c}`}
          />
        ))}
        <button
          onClick={onOpenPicker}
          className="w-5 h-5 rounded-full flex-shrink-0 transition-transform hover:scale-110 flex items-center justify-center text-xs"
          style={{
            border: '1px dashed var(--color-text-muted)',
            color: 'var(--color-text-muted)',
          }}
          title="Custom color"
          aria-label="Pick custom color"
        >
          +
        </button>
        {currentColor && (
          <button
            onClick={() => onColorChange(null)}
            className="w-5 h-5 rounded-full flex-shrink-0 transition-transform hover:scale-125 flex items-center justify-center text-xs font-bold"
            style={{
              color: 'var(--color-text)',
              border: '1px solid var(--color-text-muted)',
            }}
            title="Remove color"
            aria-label="Remove color"
          >
            &times;
          </button>
        )}
      </div>
    </div>
  )
}

interface ColorPickerProps {
  currentColor: string | null
  onColorChange: (color: string | null) => void
  onClose: () => void
  position: { x: number; y: number }
}

export function ColorPicker({ currentColor, onColorChange, onClose, position }: ColorPickerProps) {
  const [pickerHsv, setPickerHsv] = useState(() => hexToHsv(currentColor || '#3b82f6'))
  const hsvRef = useRef(pickerHsv)
  const hexInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    hsvRef.current = pickerHsv
    if (hexInputRef.current && document.activeElement !== hexInputRef.current) {
      hexInputRef.current.value = hsvToHex(pickerHsv.h, pickerHsv.s, pickerHsv.v)
    }
  }, [pickerHsv])

  const handleClose = useCallback(() => {
    const { h, s, v } = hsvRef.current
    onColorChange(hsvToHex(h, s, v))
    onClose()
  }, [onColorChange, onClose])

  const handleSVMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const update = (ev: { clientX: number; clientY: number }) => {
      const s = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100))
      const v = Math.max(0, Math.min(100, (1 - (ev.clientY - rect.top) / rect.height) * 100))
      setPickerHsv(prev => ({ ...prev, s, v }))
    }
    update(e)
    const onMove = (ev: MouseEvent) => update(ev)
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const handleHueMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const update = (ev: { clientX: number }) => {
      const h = Math.max(0, Math.min(360, ((ev.clientX - rect.left) / rect.width) * 360))
      setPickerHsv(prev => ({ ...prev, h }))
    }
    update(e)
    const onMove = (ev: MouseEvent) => update(ev)
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  return (
    <ContextMenu position={position} onClose={handleClose} style={{ width: 220 }}>
      <div className="px-2.5 pb-2.5">
        {/* Saturation-Value square */}
        <div
          style={{
            width: '100%', height: 140, position: 'relative',
            backgroundColor: `hsl(${pickerHsv.h}, 100%, 50%)`,
            borderRadius: 4, cursor: 'crosshair',
          }}
          onMouseDown={handleSVMouseDown}
        >
          <div style={{ position: 'absolute', inset: 0, borderRadius: 4, background: 'linear-gradient(to right, white, transparent)' }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: 4, background: 'linear-gradient(to bottom, transparent, black)' }} />
          <div style={{
            position: 'absolute',
            left: `${pickerHsv.s}%`, top: `${100 - pickerHsv.v}%`,
            width: 12, height: 12, borderRadius: '50%',
            border: '2px solid white', boxShadow: '0 0 2px rgba(0,0,0,0.6)',
            transform: 'translate(-50%, -50%)', pointerEvents: 'none',
          }} />
        </div>
        {/* Hue bar */}
        <div
          style={{
            width: '100%', height: 14, marginTop: 8, position: 'relative',
            background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
            borderRadius: 4, cursor: 'crosshair',
          }}
          onMouseDown={handleHueMouseDown}
        >
          <div style={{
            position: 'absolute',
            left: `${(pickerHsv.h / 360) * 100}%`, top: '50%',
            width: 8, height: 14, borderRadius: 3,
            border: '2px solid white', boxShadow: '0 0 2px rgba(0,0,0,0.6)',
            transform: 'translate(-50%, -50%)', pointerEvents: 'none',
          }} />
        </div>
        {/* Preview swatch + hex input */}
        <div className="flex items-center gap-2 mt-2">
          <div
            style={{
              width: 28, height: 28, borderRadius: 4, flexShrink: 0,
              backgroundColor: hsvToHex(pickerHsv.h, pickerHsv.s, pickerHsv.v),
              border: '1px solid var(--color-text-muted)',
            }}
          />
          <input
            ref={hexInputRef}
            type="text"
            defaultValue={hsvToHex(pickerHsv.h, pickerHsv.s, pickerHsv.v)}
            className="flex-1 px-2 py-1 rounded text-xs font-mono"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-text-muted)',
              outline: 'none',
            }}
            onChange={(e) => {
              const val = e.target.value
              if (/^#[0-9a-fA-F]{6}$/.test(val)) {
                setPickerHsv(hexToHsv(val))
              }
            }}
            maxLength={7}
          />
        </div>
      </div>
    </ContextMenu>
  )
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/shared/ColorPicker.test.tsx`
Expected: ALL PASS

**Step 5: Refactor FolderTree to use shared ColorPicker**

In `src/renderer/components/sidebar/FolderTree.tsx`:

1. Remove local `hsvToHex`, `hexToHsv` functions (lines 18-48)
2. Remove local `FOLDER_COLORS` array (lines 13-16)
3. Remove color picker state: `pickerHsv`, `colorPickerPos`, `hsvRef`, `hexInputRef` (lines 87-90)
4. Remove `handleSVMouseDown`, `handleHueMouseDown` callbacks (lines 92-117)
5. Remove `pickerHsv` sync effect (lines 174-183)
6. Simplify `closeColorPicker` — it no longer needs to compute hex from HSV
7. Import: `import { ColorSwatches, ColorPicker, hsvToHex, hexToHsv } from '../shared/ColorPicker'`
8. Replace the inline swatch section (lines 683-740) with `<ColorSwatches>`
9. Replace the inline HSV picker (lines 831-901) with `<ColorPicker>`
10. Keep `colorPickerTarget` and `colorPickerLive` state — they control which folder is being edited and the live preview color

The folder context menu color section (lines 683-740) becomes:
```tsx
<ColorSwatches
  currentColor={folders.find((f) => f.id === menuFolderId)?.color ?? null}
  onColorChange={(c) => {
    updateFolder(menuFolderId!, { color: c })
    setMenuFolderId(null)
  }}
  onOpenPicker={() => {
    const currentColor = folders.find(f => f.id === menuFolderId)?.color || '#3b82f6'
    setColorPickerTarget(menuFolderId!)
    setColorPickerInitialColor(currentColor)
    setColorPickerPos({ x: menuPos.x, y: menuPos.y })
    setMenuFolderId(null)
  }}
/>
```

The HSV picker section (lines 831-901) becomes:
```tsx
{colorPickerTarget !== null && (
  <ColorPicker
    currentColor={colorPickerInitialColor}
    onColorChange={(c) => {
      if (c !== null) {
        updateFolder(colorPickerTarget!, { color: c })
        setColorPickerLive(c)
      }
    }}
    onClose={() => {
      setColorPickerTarget(null)
      setColorPickerLive(null)
    }}
    position={colorPickerPos}
  />
)}
```

NOTE: The live preview during drag (colorPickerLive) can be maintained by calling `onColorChange` during the picker's interaction. The `ColorPicker` component commits the final value on close. The `FolderTree` live preview of color-during-drag uses `colorPickerLive` which is set from the `onColorChange` callback. This needs careful wiring — the `ColorPicker`'s internal `useEffect` on `pickerHsv` should call an optional `onLiveChange` prop, OR FolderTree can set `colorPickerLive` in the `onColorChange` callback (which fires on close). For simplicity, we can accept that the live preview only works on close (same UX, the user sees color change when they dismiss the picker). If the user misses live preview: add an `onLiveChange` prop later.

Alternatively (simpler): keep the FolderTree's existing live preview mechanism unchanged. Only extract the HSV picker *rendering* into `ColorPicker`, but let FolderTree still manage `pickerHsv` state and pass it down. This avoids breaking the live preview. **Choose the simpler path: keep FolderTree's live preview state, just move the rendering.**

REVISED approach for FolderTree refactor:
- `ColorSwatches`: fully extracted, used by both FolderTree and ConversationItem
- `ColorPicker` (HSV): fully extracted with self-contained state. On close, it calls `onColorChange` with final hex. FolderTree loses live preview during drag (acceptable trade-off).
- The `hsvToHex`/`hexToHsv` helpers are exported from ColorPicker for FolderTree's heatmap computation.

**Step 6: Run all tests**

Run: `npx vitest run src/renderer/components/sidebar/FolderTree.test.tsx src/renderer/components/shared/ColorPicker.test.tsx`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/renderer/components/shared/ColorPicker.tsx src/renderer/components/shared/ColorPicker.test.tsx src/renderer/components/sidebar/FolderTree.tsx
git commit -m "refactor: extract shared ColorPicker from FolderTree"
```

---

### Task 4: Add color to ConversationItem context menu + visual rendering

**Files:**
- Modify: `src/renderer/components/sidebar/ConversationItem.tsx`
- Modify: `src/renderer/stores/conversationsStore.ts`

**Step 1: Add store methods**

In `src/renderer/stores/conversationsStore.ts`, add `colorSelected` method (following `moveSelectedToFolder` pattern):

```ts
colorSelected: async (color: string | null) => {
  const { selectedIds, conversations } = get()
  const ids = [...selectedIds]
  if (ids.length === 0) return
  const prev = conversations
  set({
    conversations: conversations.map((c) =>
      selectedIds.has(c.id) ? { ...c, color } : c
    ),
    selectedIds: new Set(),
    lastClickedId: null,
  })
  try {
    await window.agent.conversations.colorMany(ids, color)
  } catch {
    set({ conversations: prev })
  }
},
```

Also add it to the interface/type declaration at the top of the store and to the destructured exports where needed.

**Step 2: Wire color into ConversationItem visual rendering**

In `src/renderer/components/sidebar/ConversationItem.tsx`:

1. Add import: `import { ColorSwatches, ColorPicker } from '../shared/ColorPicker'`

2. Compute effective color (add before the `return`):
```ts
const effectiveColor = conversation.color || folderColor || null
```

3. Replace all occurrences of `folderColor` in the style block (lines 172-184) with `effectiveColor`. There are 4 references to replace.

4. Add state for color picker:
```ts
const [showColorPicker, setShowColorPicker] = useState(false)
const [colorPickerPos, setColorPickerPos] = useState({ x: 0, y: 0 })
```

5. Add `colorSelected` to the store destructure (line 26-27).

**Step 3: Add color to single-conversation context menu**

In the single-conversation context menu (lines 304-366), add before `<ContextMenuDivider />` (line 362):

```tsx
<ContextMenuDivider />
<ColorSwatches
  currentColor={conversation.color}
  onColorChange={(c) => {
    updateConversation(conversation.id, { color: c })
    setShowMenu(false)
  }}
  onOpenPicker={() => {
    setColorPickerPos({ x: menuPos.x, y: menuPos.y })
    setShowColorPicker(true)
    setShowMenu(false)
  }}
/>
```

**Step 4: Add color to multi-select context menu**

In the multi-select context menu (lines 248-303), add before `<ContextMenuDivider />` (line 291):

```tsx
<ColorSwatches
  currentColor={null}
  onColorChange={(c) => {
    colorSelected(c)
    setShowMenu(false)
  }}
  onOpenPicker={() => {
    setColorPickerPos({ x: menuPos.x, y: menuPos.y })
    setShowColorPicker(true)
    setShowMenu(false)
  }}
/>
<ContextMenuDivider />
```

**Step 5: Add ColorPicker popup**

After the context menu rendering (after line 367), add:

```tsx
{showColorPicker && (
  <ColorPicker
    currentColor={conversation.color}
    onColorChange={(c) => {
      if (selectedIds.size > 1) {
        colorSelected(c)
      } else {
        updateConversation(conversation.id, { color: c })
      }
    }}
    onClose={() => setShowColorPicker(false)}
    position={colorPickerPos}
  />
)}
```

**Step 6: Verify build compiles**

Run: `npx vitest run src/renderer/components/sidebar/FolderTree.test.tsx`
Expected: ALL PASS (FolderTree mocks ConversationItem, so this validates the overall integration)

**Step 7: Commit**

```bash
git add src/renderer/components/sidebar/ConversationItem.tsx src/renderer/stores/conversationsStore.ts
git commit -m "feat(ui): add color picker to conversation context menu"
```

---

### Task 5: Full integration test + build verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: ALL PASS

**Step 2: Run build**

Run: `npm run build`
Expected: 0 errors, 0 warnings

**Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Final commit if any fixups needed**

Only if tests or build revealed issues.
