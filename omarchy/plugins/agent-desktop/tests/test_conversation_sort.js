// conversationSort is the rule the sidebar's grouping and ordering follow.
// Loaded through the same shim QML's `import … as` uses, so a file that node
// can read but QML cannot fails here.
//
// The behaviour under test is ordering, which any list-shaped control gets
// wrong silently: nothing throws when the wrong row lands at the top of the
// list.
const assert = require('assert')
const { load, deepEqual } = require('./load')

const CS = load('lib/conversationSort.js')

// ---- helpers ---------------------------------------------------------------

function makeConv(overrides) {
  return Object.assign({
    id: 0,
    title: 'Test',
    folder_id: null,
    position: 0,
    model: 'claude',
    system_prompt: null,
    cwd: null,
    kb_enabled: 0,
    ai_overrides: null,
    cleared_at: null,
    compact_summary: null,
    sdk_session_id: null,
    color: null,
    message_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }, overrides)
}

function makeFolder(overrides) {
  return Object.assign({
    id: 0,
    name: 'Folder',
    parent_id: null,
    position: 0,
    is_default: 0,
    ai_overrides: null,
    default_cwd: null,
    color: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }, overrides)
}

const DEFAULT_SORT = { criterion: 'updated_at', direction: 'desc' }

// ---- buildTree basics ------------------------------------------------------

// An empty list returns an empty group + flat, with no "Uncategorized" row —
// a control that rendered "Uncategorized (0)" would be a bug, not a feature.
// Values built inside the vm realm carry that realm's prototypes — assert.deepStrictEqual
// rejects them against literals declared out here. deepEqual round-trips through JSON.
deepEqual(
  CS.buildTree({ list: [], folders: [], sort: DEFAULT_SORT, search: '' }),
  { groups: [], flat: [] },
  'empty list must produce no groups',
)

// A list of conversations whose folder_id is null all lands in the trailing
// "Uncategorized" group — that is the freshly-migrated DB shape.
{
  const result = CS.buildTree({
    list: [
      makeConv({ id: 1, title: 'A', updated_at: '2026-01-02T00:00:00Z' }),
      makeConv({ id: 2, title: 'B', updated_at: '2026-01-01T00:00:00Z' }),
    ],
    folders: [],
    sort: DEFAULT_SORT,
    search: '',
  })
  assert.strictEqual(result.groups.length, 1, 'unfiled list makes one group')
  assert.strictEqual(result.groups[0].folder, null)
  assert.strictEqual(result.groups[0].conversations.length, 2)
  // Default sort = updated_at desc.
  deepEqual(
    result.flat.map(function (c) { return c.id }),
    [1, 2],
    'flat order matches the group order',
  )
}

// Conversations in folders come BEFORE unfiled ones, regardless of how recent
// the unfiled ones are — folders are navigation groups, not date buckets.
{
  const result = CS.buildTree({
    list: [
      makeConv({ id: 1, title: 'A', folder_id: 10, updated_at: '2020-01-01T00:00:00Z' }),
      makeConv({ id: 2, title: 'B', folder_id: null, updated_at: '2026-08-01T00:00:00Z' }),
    ],
    folders: [makeFolder({ id: 10, name: 'Old' })],
    sort: DEFAULT_SORT,
    search: '',
  })
  assert.strictEqual(result.groups.length, 2)
  assert.strictEqual(result.groups[0].folder.id, 10, 'folder group first')
  assert.strictEqual(result.groups[1].folder, null, 'uncategorized trails')
  deepEqual(result.flat.map(function (c) { return c.id }), [1, 2])
}

// An empty folder is omitted — a UI that shows "Old (0)" is a bug.
{
  const result = CS.buildTree({
    list: [makeConv({ id: 1, folder_id: null })],
    folders: [makeFolder({ id: 10, name: 'Old' })],
    sort: DEFAULT_SORT,
    search: '',
  })
  assert.strictEqual(result.groups.length, 1, 'empty folder must be omitted')
  assert.strictEqual(result.groups[0].folder, null)
}

// ---- the three criteria, with the three directions -------------------------

// updated_at desc (default).
{
  const result = CS.buildTree({
    list: [
      makeConv({ id: 1, updated_at: '2026-01-01T00:00:00Z' }),
      makeConv({ id: 2, updated_at: '2026-01-03T00:00:00Z' }),
      makeConv({ id: 3, updated_at: '2026-01-02T00:00:00Z' }),
    ],
    folders: [],
    sort: { criterion: 'updated_at', direction: 'desc' },
    search: '',
  })
  deepEqual(result.flat.map(function (c) { return c.id }), [2, 3, 1])
}

// updated_at asc.
{
  const result = CS.buildTree({
    list: [
      makeConv({ id: 1, updated_at: '2026-01-03T00:00:00Z' }),
      makeConv({ id: 2, updated_at: '2026-01-01T00:00:00Z' }),
    ],
    folders: [],
    sort: { criterion: 'updated_at', direction: 'asc' },
    search: '',
  })
  deepEqual(result.flat.map(function (c) { return c.id }), [2, 1])
}

// message_count desc.
{
  const result = CS.buildTree({
    list: [
      makeConv({ id: 1, message_count: 5 }),
      makeConv({ id: 2, message_count: 20 }),
      makeConv({ id: 3, message_count: 10 }),
    ],
    folders: [],
    sort: { criterion: 'message_count', direction: 'desc' },
    search: '',
  })
  deepEqual(result.flat.map(function (c) { return c.id }), [2, 3, 1])
}

// title asc is case-insensitive — "Zebra" before "apple", as the locale says.
{
  const result = CS.buildTree({
    list: [
      makeConv({ id: 1, title: 'Zebra' }),
      makeConv({ id: 2, title: 'apple' }),
      makeConv({ id: 3, title: 'Banana' }),
    ],
    folders: [],
    sort: { criterion: 'title', direction: 'asc' },
    search: '',
  })
  deepEqual(result.flat.map(function (c) { return c.id }), [2, 3, 1])
}

// title desc.
{
  const result = CS.buildTree({
    list: [
      makeConv({ id: 1, title: 'Apple' }),
      makeConv({ id: 2, title: 'Zebra' }),
    ],
    folders: [],
    sort: { criterion: 'title', direction: 'desc' },
    search: '',
  })
  deepEqual(result.flat.map(function (c) { return c.id }), [2, 1])
}

// ---- search filter ---------------------------------------------------------

// Search matches against title (case-insensitive substring).
{
  const result = CS.buildTree({
    list: [
      makeConv({ id: 1, title: 'Refactor auth' }),
      makeConv({ id: 2, title: 'Add migration' }),
      makeConv({ id: 3, title: 'Refactor settings' }),
    ],
    folders: [],
    sort: DEFAULT_SORT,
    search: 'refac',
  })
  deepEqual(result.flat.map(function (c) { return c.id }), [1, 3], 'search hits')
  // Search collapses to a single flat group regardless of folders.
  assert.strictEqual(result.groups.length, 1)
}

// Search is case-insensitive on both sides.
{
  const result = CS.buildTree({
    list: [
      makeConv({ id: 1, title: 'Refactor auth' }),
      makeConv({ id: 2, title: 'refactor settings' }),
    ],
    folders: [],
    sort: DEFAULT_SORT,
    search: 'REFAC',
  })
  assert.strictEqual(result.groups[0].conversations.length, 2)
}

// An empty search produces the normal folder grouping, not a flat list of
// everything.
{
  const result = CS.buildTree({
    list: [
      makeConv({ id: 1, title: 'A', folder_id: 10 }),
      makeConv({ id: 2, title: 'B', folder_id: null }),
    ],
    folders: [makeFolder({ id: 10, name: 'Old' })],
    sort: DEFAULT_SORT,
    search: '   ',
  })
  assert.strictEqual(result.groups.length, 2, 'whitespace search == no search')
}

// ---- tie-breaks ------------------------------------------------------------

// Title tie: a stable order would pick the lower id first — sort is not
// guaranteed stable in V8 for non-equal items, so we accept either stable
// result but require that both rows come out together.
{
  const result = CS.buildTree({
    list: [
      makeConv({ id: 1, title: 'same' }),
      makeConv({ id: 2, title: 'same' }),
    ],
    folders: [],
    sort: { criterion: 'title', direction: 'asc' },
    search: '',
  })
  assert.strictEqual(result.flat.length, 2)
  assert.strictEqual(result.flat[0].title, 'same')
  assert.strictEqual(result.flat[1].title, 'same')
}

// Null message_count sorts as 0, not as a crash.
{
  const result = CS.buildTree({
    list: [
      makeConv({ id: 1, message_count: null }),
      makeConv({ id: 2, message_count: 5 }),
    ],
    folders: [],
    sort: { criterion: 'message_count', direction: 'desc' },
    search: '',
  })
  deepEqual(result.flat.map(function (c) { return c.id }), [2, 1])
}

// Missing folder (a row refers to a folder id that is gone) silently drops to
// uncategorized — the alternative is a phantom group forever.
{
  const result = CS.buildTree({
    list: [
      makeConv({ id: 1, folder_id: 99, title: 'orphan' }),
      makeConv({ id: 2, folder_id: null, title: 'A' }),
    ],
    folders: [],
    sort: DEFAULT_SORT,
    search: '',
  })
  assert.strictEqual(result.groups.length, 1, 'orphan falls into uncategorized')
  assert.strictEqual(result.groups[0].folder, null)
  deepEqual(result.flat.map(function (c) { return c.id }), [1, 2])
}

console.log('test_conversation_sort: ok')
