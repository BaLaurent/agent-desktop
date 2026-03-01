# Conversation Color — Design Document

**Date:** 2026-02-28
**Status:** Approved

## Summary

Add the ability to assign a color to individual conversations, using the same visual system as folder colors.

## Decisions

- **Priority:** conversation.color > folder manual color > heatmap color > transparent
- **Access:** context menu (right-click) for both single and multi-select
- **Shared component:** extract ColorPicker from FolderTree into shared component (DRY — 2 consumers)

## Schema

```sql
ALTER TABLE conversations ADD COLUMN color TEXT
```

Nullable, validated as `#rrggbb` server-side.

## Changes

### 1. Backend
- **schema.ts** — migration: `ALTER TABLE conversations ADD COLUMN color TEXT`
- **shared/types.ts** — add `color: string | null` to `Conversation` interface
- **conversations.ts** — add `'color'` to `allowed` list in `conversations:update`, add `#rrggbb` validation

### 2. Shared ColorPicker component
- **New file:** `src/renderer/components/shared/ColorPicker.tsx`
- Props: `currentColor`, `onColorChange`, `onClose`
- Contains: 8 preset swatches, "+" button (opens HSV picker), "x" button (reset to null), full HSV picker (SV square + Hue bar + hex input)
- Extracted from FolderTree.tsx inline picker code

### 3. FolderTree refactor
- Replace inline picker code with `<ColorPicker>` component
- No behavior change

### 4. ConversationItem context menu
- **Single-select:** add "Set color" entry before the Delete divider, opens ColorPicker
- **Multi-select:** add swatch palette, applies color to all selected conversations via batch update

### 5. ConversationItem visual rendering
- Replace `folderColor` with `effectiveColor = conversation.color || folderColor` in style computation
- Same `color-mix`, `borderLeft`, `boxShadow` logic as today

### 6. Store
- `updateConversationColor(id, color)` — calls IPC `conversations:update` with `{ color }`
- Batch update for multi-select via existing `updateMany` or new dedicated method
