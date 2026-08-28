.pragma library

// Order + folder-group a list of conversations for the sidebar.
//
// One pure function (buildTree) plus a tiny helper (sortConversations) pulled
// out so each unit test exercises exactly one thing. Mirrors the renderer's
// `sortConversations` tie-breaks in `src/renderer/utils/sort.ts` so the two
// surfaces stay in lockstep:
//
//   updated_at    dir * a.updated_at.localeCompare(b.updated_at)
//   message_count dir * ((a.message_count ?? 0) - (b.message_count ?? 0))
//   title         dir * a.title.toLowerCase().localeCompare(b.title.toLowerCase())
//
// Folder grouping: a conversation whose `folder_id` is null, undefined, or
// refers to a folder that no longer exists lives in the trailing
// "Uncategorized" group. Folders keep their input order — the renderer's
// sortFolders keeps position order on the default sort, which is what users
// expect from drag-and-drop reordering. Search results collapse everything
// into one flat, header-less group because the server-side search already
// filters and the folders are no longer navigation groups.

function sortConversations(list, sort) {
  var copy = list.slice()
  var dir = (sort && sort.direction === 'asc') ? 1 : -1
  copy.sort(function (a, b) {
    switch (sort && sort.criterion) {
      case 'message_count':
        return dir * ((a.message_count || 0) - (b.message_count || 0))
      case 'title':
        return dir * String(a.title || '').toLowerCase()
          .localeCompare(String(b.title || '').toLowerCase())
      default: // updated_at and unknown criteria share the default
        return dir * String(a.updated_at || '').localeCompare(String(b.updated_at || ''))
    }
  })
  return copy
}

function buildFolderIndex(folders) {
  var idx = {}
  for (var i = 0; i < folders.length; i++) {
    var f = folders[i]
    if (f && f.id !== undefined && f.id !== null) idx[f.id] = f
  }
  return idx
}

// A conversation falls into "Uncategorized" when folder_id is null/undefined
// OR when the folder it points to no longer exists. The latter happens after
// a delete-without-keep during migration: the server reparents to the default
// on a kept-delete, so a folder_id that points nowhere is a mid-flight state
// the UI must not pin with a phantom header.
function findUncategorizedGroup(conversations, foldersById) {
  var items = []
  for (var i = 0; i < conversations.length; i++) {
    var row = conversations[i]
    var f = row.folder_id
    if (f === null || f === undefined) { items.push(row); continue }
    if (!foldersById.hasOwnProperty(f)) items.push(row)
  }
  return items
}

function findFolderItems(conversations, folderId) {
  var items = []
  for (var i = 0; i < conversations.length; i++) {
    if (conversations[i].folder_id === folderId) items.push(conversations[i])
  }
  return items
}

// buildTree({ list, folders, sort, search }) returns:
//   { groups: [{ folder: Folder|null, conversations: Conversation[] }, ...],
//     flat: [Conversation] }
//
// `flat` is the concatenation of every group's conversations in tree order,
// so keyboard navigation has a single, well-defined order.
function buildTree(input) {
  var list = (input && input.list) || []
  var folders = (input && input.folders) || []
  var sort = input && input.sort
  var search = (input && input.search) ? String(input.search).trim() : ""

  var groups = []
  var flat = []

  if (search.length > 0) {
    var matched = []
    var needle = search.toLowerCase()
    for (var i = 0; i < list.length; i++) {
      var c = list[i]
      var title = String(c.title || '').toLowerCase()
      if (title.indexOf(needle) >= 0) matched.push(c)
    }
    matched = sortConversations(matched, sort)
    return { groups: [{ folder: null, conversations: matched }], flat: matched }
  }

  var foldersById = buildFolderIndex(folders)

  // Each folder in `folders` gets a group in the order returned by the
  // server — the renderer's sortFolders also keeps position order on the
  // default sort, which is what the user expects from drag-and-drop.
  for (var f = 0; f < folders.length; f++) {
    var items = sortConversations(findFolderItems(list, folders[f].id), sort)
    if (items.length === 0) continue
    groups.push({ folder: folders[f], conversations: items })
    for (var k = 0; k < items.length; k++) flat.push(items[k])
  }

  // Unfiled and orphan conversations trail the folders. The renderer's UI
  // marks this group "Uncategorized" and the seed migration places every
  // existing conversation there, so a freshly-migrated DB has all rows in
  // exactly this group.
  var uncategorized = sortConversations(
    findUncategorizedGroup(list, foldersById), sort)
  if (uncategorized.length > 0) {
    groups.push({ folder: null, conversations: uncategorized })
    for (var j = 0; j < uncategorized.length; j++) flat.push(uncategorized[j])
  }

  return { groups: groups, flat: flat }
}
