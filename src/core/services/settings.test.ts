import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestDb } from '../../main/__tests__/db-helper'
import { SettingsService } from './settings'

// The runtime here is sql.js, not better-sqlite3, so `better-sqlite3` is a
// TYPE-only import. The adapter implements the `prepare`/`exec` subset the
// services actually touch, not the whole better-sqlite3 surface, and no
// runtime check could establish the rest — so this is a named unchecked cast
// rather than a schema parse.
async function service(): Promise<SettingsService> {
  const adapter = await createTestDb()
  const db = adapter as unknown as Database.Database
  return new SettingsService(db)
}

describe('SettingsService allowlist', () => {
  // The allowlist is what a client may write. The Omarchy shell plugin has no
  // storage of its own — it persists its layout through these keys — so a key
  // missing here does not fail loudly, it silently reverts the user's UI on
  // every restart. Both of these shipped missing:
  //
  //   sidebar_collapsed       the sidebar reopened expanded every time
  //   active_conversation_id  no conversation was selected on open, and
  //                           ChatStore.send() drops a message (typed OR a
  //                           finished voice transcript) with none active
  it.each([
    ['sidebar_collapsed', 'true'],
    ['active_conversation_id', '14'],
  ])("persists the UI-state key %s", async (key, value) => {
    const s = await service()
    s.set(key, value)
    expect(s.getAll()[key]).toBe(value)
  })

  it('rejects a key that is not on the allowlist', async () => {
    const s = await service()
    expect(() => s.set('definitely_not_a_setting', 'x')).toThrow(/Unknown setting key/)
  })

  // Empty means "forget it", not "store an empty string" — which is how the
  // shell clears the active conversation when the last one is deleted.
  it('deletes the row when the value is empty', async () => {
    const s = await service()
    s.set('active_conversation_id', '14')
    s.set('active_conversation_id', '')
    expect('active_conversation_id' in s.getAll()).toBe(false)
  })
})
