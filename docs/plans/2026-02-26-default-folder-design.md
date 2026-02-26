# Default Folder — Replace "Unfiled" Conversations

**Date:** 2026-02-26
**Status:** Approved

## Problem

Conversations without a folder (`folder_id = NULL`) are handled as a special "Unfiled" section in the sidebar with its own expand state, color, drag handlers, and context menu. This separate codepath causes recurring issues and adds complexity.

## Solution

Replace the "unfiled" concept with a **default folder** named "Unsorted" that is:
- Automatically created at startup if it doesn't exist
- A real row in the `folders` table (not a special case)
- Protected from deletion (`is_default = 1`)
- Renommable by the user
- The destination for all new conversations (unless a specific folder is chosen)
- The fallback when a folder is deleted (its conversations migrate here)

## Schema Changes

### Migration: Add `is_default` column
```sql
ALTER TABLE folders ADD COLUMN is_default INTEGER DEFAULT 0;
```

### Startup logic (after migration)
```sql
-- If no default folder exists, create one
INSERT INTO folders (name, is_default, position)
SELECT 'Unsorted', 1, -1
WHERE NOT EXISTS (SELECT 1 FROM folders WHERE is_default = 1);

-- Migrate all NULL folder_id conversations to the default folder
UPDATE conversations SET folder_id = (SELECT id FROM folders WHERE is_default = 1)
WHERE folder_id IS NULL;
```

`position = -1` ensures the default folder sorts first.

## Service Changes

### `conversations:create`
- Accept optional `folderId` parameter
- If not provided, resolve default folder (`SELECT id FROM folders WHERE is_default = 1`)
- Insert with `folder_id` directly (no more 2-step create+move)

### `folders:delete`
- Refuse if `is_default = 1`
- Before deleting a normal folder: `UPDATE conversations SET folder_id = <default_id> WHERE folder_id = ?`
- Then delete the folder

### `folders:deleteMany`
- Filter out IDs with `is_default = 1`
- Migrate conversations from remaining folders to default, then delete

### New: `folders:getDefault`
- Returns the default folder row

## Renderer Changes

### FolderTree.tsx — Remove "Unfiled" section entirely
- Remove: `unfiled` filter, `dragOverUnfiled`, `unfiledMenuPos`, `unfiledMenuRef`, `handleUnfiledDrag*`
- Remove: entire "Unfiled" JSX block and its context menu
- The "Unsorted" folder renders as a normal folder in the folder list
- Only difference: no delete option in its context menu

### conversationsStore.ts
- `createConversation` result now has a real `folder_id` (never null)

## Settings Cleanup

Remove from allowlist:
- `sidebar_unfiledExpanded`
- `sidebar_unfiledColor`

## Backward Compatibility

- Startup migration catches all existing `folder_id = NULL` conversations
- Any future `NULL` folder_id (old DB backup, etc.) is caught by the startup guard
- `ON DELETE SET NULL` FK remains in schema (SQLite can't alter FKs) but is never reached for the default folder; for normal folders, explicit migration runs before delete

## Decisions

| Decision | Choice |
|---|---|
| Folder name | "Unsorted" |
| Deletable? | No |
| Renommable? | Yes |
| Identification | `is_default` column on `folders` table |
| Position | `-1` (always first) |
