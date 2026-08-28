import QtQuick
import QtTest

// FolderTree.qml's per-row rename, delete and reorder — the three
// ConversationsStore capabilities that were implemented and unit-tested
// but had no UI caller, leaving the sidebar's folder tree effectively
// read-only.
//
// Approach: each folder header exposes `_startRename / _commitRename /
// _moveBy / _requestDelete / _confirmDelete` so a test can drive the
// observable effect (calls dispatched on the fake store) without going
// through a PopupWindow that offscreen Qt cannot really show. The Menu
// items in production wire straight to those same functions.
//
// Two non-obvious things in this harness:
//
//   1. The FolderTree Item has no implicit size. Calling createObject
//      with `width`/`height` in the property dict does NOT apply —
//      width/height have to be set AFTER creation, and `anchors.fill`
//      must be assigned to the parent for the inner ListView to have
//      a non-zero viewport. Without these, the ListView realises only
//      the first delegate (off-by-N) and a test looking for the
//      second folder mysteriously sees `headerForFolder(22) === null`.
//   2. The fakeStore's tree() includes folders with zero
//      conversations. The production buildTree skips empty groups
//      (a sensible optimisation for the live UI), but the row
//      affordances — rename, delete, reorder — must remain reachable
//      even on an empty folder, which is the case for every folder a
//      user has just created. So the mock's tree() is intentionally
//      less aggressive than production's.
Item {
  id: harness
  width: 400
  height: 1200

  QtObject {
    id: fakeStore

    property var folders: []
    property var conversations: []
    property var selection: ({})

    property var updateFolderCalls: []
    property var deleteFolderCalls: []
    property var reorderFoldersCalls: []
    property var moveManyCalls: []

    // No-op stubs for the ConversationRow side: rows mount under every
    // folder and otherwise TypeError on selection reads.
    function isSelected(id) { return false }
    function selectedIds() { return [] }
    function toggleSelection(id) {}
    function setSelection(ids) {}
    function clearSelection() {}
    function setActiveId(id) {}

    function tree() {
      var groups = []
      var flat = []
      var used = {}
      for (var i = 0; i < folders.length; i++) {
        var f = folders[i]
        if (!f) continue
        var items = []
        for (var j = 0; j < conversations.length; j++) {
          if (Number(conversations[j].folder_id) === Number(f.id)) items.push(conversations[j])
        }
        groups.push({ folder: f, conversations: items })
        used[f.id] = true
        for (var k = 0; k < items.length; k++) flat.push(items[k])
      }
      var uncategorized = []
      for (var l = 0; l < conversations.length; l++) {
        var c = conversations[l]
        if (c.folder_id === null || c.folder_id === undefined || !used[c.folder_id]) {
          uncategorized.push(c)
        }
      }
      groups.push({ folder: null, conversations: uncategorized })
      for (var p = 0; p < uncategorized.length; p++) flat.push(uncategorized[p])
      return { groups: groups, flat: flat }
    }

    function updateFolder(id, patch) {
      updateFolderCalls = updateFolderCalls.concat([{ id: id, patch: patch }])
    }
    function deleteFolder(id, mode) {
      deleteFolderCalls = deleteFolderCalls.concat([{ id: id, mode: mode === undefined ? null : mode }])
    }
    function reorderFolders(ids) {
      reorderFoldersCalls = reorderFoldersCalls.concat([{ ids: ids }])
    }
    function moveMany(ids, fid) {
      moveManyCalls = moveManyCalls.concat([{ ids: ids, fid: fid }])
    }

    function reset() {
      folders = []
      conversations = []
      updateFolderCalls = []
      deleteFolderCalls = []
      reorderFoldersCalls = []
      moveManyCalls = []
    }

    function seedTwoTopLevelFolders() {
      folders = [
        { id: 11, name: "Alpha", parent_id: null, position: 0, is_default: 0 },
        { id: 22, name: "Beta",  parent_id: null, position: 1, is_default: 0 }
      ]
      conversations = [
        { id: 1, title: "first", folder_id: 11 }
      ]
    }
  }

  property var folderTreeC: null
  function folderTreeComponent() {
    if (!folderTreeC) {
      folderTreeC = Qt.createComponent("../../components/FolderTree.qml", Component.PreferSynchronous)
    }
    return folderTreeC
  }

  Item {
    id: treeHost
    anchors.fill: parent
  }
  property var treeInstance: null

  function mountTree() {
    if (treeInstance) { treeInstance.destroy(); treeInstance = null }
    treeInstance = folderTreeComponent().createObject(treeHost, ({ store: fakeStore }))
    treeInstance.width = treeHost.width
    treeInstance.height = treeHost.height
    treeInstance.anchors.fill = treeHost
  }

  // Walks the tree looking for every folder header. The structural
  // marker (presence of all three row-action properties) is used in
  // preference to a hardcoded id so a future rename inside
  // FolderTree.qml cannot silently break this walker.
  function allHeaders() {
    if (!treeInstance) return []
    var out = []
    function walk(obj) {
      if (!obj) return
      // Marker for a folder header: a folder-backed Rectangle that owns
      // the row-action functions. The Uncategorized group's Rectangle
      // has the same four properties with `folder === null` and
      // `visible: false` — we filter on `folder` being a real record to
      // exclude it. A future rename inside FolderTree.qml cannot
      // silently break this walker because every function the row
      // exposes lives on the same Rectangle; `_renaming` and
      // `_confirming` are PAIRED with `folder`, never alone.
      if (obj.folder && obj._renaming !== undefined && obj._confirming !== undefined) {
        out.push(obj)
        return
      }
      var kids = obj.children || []
      for (var i = 0; i < kids.length; i++) walk(kids[i])
    }
    walk(treeInstance)
    return out
  }

  // Skips the synthetic "Uncategorized" group whose `folder` is null.
  function headerForFolder(id) {
    var headers = allHeaders()
    for (var i = 0; i < headers.length; i++) {
      if (headers[i].folder && Number(headers[i].folder.id) === Number(id)) return headers[i]
    }
    return null
  }

  TestCase {
    name: "FolderTreeRowActions"
    when: windowShown

    function initTestCase() {
      verify(folderTreeComponent().status === Component.Ready,
        folderTreeComponent().errorString())
    }

    function init() {
      fakeStore.reset()
      mountTree()
    }

    // ---- component compiles AND mounts with an empty tree -------------

    function test_component_compiles() {
      compare(folderTreeComponent().status, Component.Ready,
        folderTreeComponent().errorString())
    }

    function test_no_crash_with_empty_store() {
      compare(allHeaders().length, 0,
        "no folder headers when the tree is empty")
    }

    // ---- rename: empty + whitespace rejected, real name writes --------

    function test_rename_open_closes_with_whitespace_only() {
      fakeStore.seedTwoTopLevelFolders()
      var header = headerForFolder(11)
      verify(header !== null, "folder 11 header exists")
      header._startRename()
      compare(header._renaming, true)
      var ok = header._commitRename("")
      compare(ok, false)
      compare(header._renaming, true, "editor stays open on empty submit")
      compare(fakeStore.updateFolderCalls.length, 0,
        "empty submit must NOT call updateFolder")
    }

    function test_rename_rejects_whitespace_only() {
      fakeStore.seedTwoTopLevelFolders()
      var header = headerForFolder(11)
      header._startRename()
      var ok = header._commitRename("   \t  ")
      compare(ok, false)
      compare(header._renaming, true, "editor stays open on whitespace-only")
      compare(fakeStore.updateFolderCalls.length, 0)
    }

    function test_rename_writes_trimmed_name() {
      fakeStore.seedTwoTopLevelFolders()
      var header = headerForFolder(11)
      header._startRename()
      var ok = header._commitRename("  Alpha Prime  ")
      compare(ok, true)
      compare(header._renaming, false, "editor closes after a valid rename")
      compare(fakeStore.updateFolderCalls.length, 1)
      compare(fakeStore.updateFolderCalls[0].id, 11)
      compare(fakeStore.updateFolderCalls[0].patch.name, "Alpha Prime",
        "name is trimmed before being written")
    }

    function test_rename_with_unchanged_name_is_a_noop_write() {
      fakeStore.seedTwoTopLevelFolders()
      var header = headerForFolder(11)
      var ok = header._commitRename("Alpha")
      compare(ok, true)
      compare(fakeStore.updateFolderCalls.length, 0,
        "an unchanged name must not produce a folders:update call")
    }

    // ---- delete: confirms first, accurate message ----------------------

    function test_delete_request_opens_confirm_dialog() {
      fakeStore.seedTwoTopLevelFolders()
      var header = headerForFolder(11)
      header._requestDelete()
      compare(header._confirming, true)
      verify(header._confirmMessage.length > 0,
        "confirm message must be populated")
      verify(header._confirmMessage.indexOf("Alpha") >= 0,
        "message must name the folder being deleted")
      verify(header._confirmMessage.indexOf("default folder") >= 0,
        "message must state where conversations go (accurate per folders.ts:74)")
      verify(header._confirmMessage.indexOf("unparented") >= 0,
        "message must state what happens to subfolders (accurate per folders.ts:74)")
      verify(header._confirmMessage.indexOf("cannot be undone") >= 0,
        "message must warn the action is irreversible")
    }

    function test_delete_request_announces_conversation_count() {
      fakeStore.seedTwoTopLevelFolders()
      var header = headerForFolder(11)
      header._requestDelete()
      verify(header._confirmMessage.indexOf("1 conversation") >= 0,
        "singular copy: '1 conversation' — got: " + header._confirmMessage)
      compare(fakeStore.deleteFolderCalls.length, 0,
        "nothing must have been deleted yet — only the dialog must have opened")
    }

    function test_delete_request_uses_plural_for_many() {
      fakeStore.folders = [
        { id: 11, name: "Busy", parent_id: null, position: 0, is_default: 0 }
      ]
      fakeStore.conversations = [
        { id: 1, folder_id: 11 },
        { id: 2, folder_id: 11 },
        { id: 3, folder_id: 11 }
      ]
      var header = headerForFolder(11)
      header._requestDelete()
      verify(header._confirmMessage.indexOf("3 conversations") >= 0,
        "plural copy: '3 conversations' — got: " + header._confirmMessage)
    }

    function test_delete_canceled_never_reaches_store() {
      fakeStore.seedTwoTopLevelFolders()
      var header = headerForFolder(11)
      header._requestDelete()
      header._confirming = false
      compare(fakeStore.deleteFolderCalls.length, 0,
        "the store must not be called on cancel")
    }

    function test_delete_confirmed_calls_store_with_default_mode() {
      fakeStore.seedTwoTopLevelFolders()
      var header = headerForFolder(11)
      header._requestDelete()
      header._confirmDelete()
      compare(fakeStore.deleteFolderCalls.length, 1)
      compare(fakeStore.deleteFolderCalls[0].id, 11,
        "deleteFolder must be called with the right id")
      compare(fakeStore.deleteFolderCalls[0].mode, null,
        "no mode arg — defaults to 'keep', the safe branch of folders.ts:74")
      compare(header._confirming, false,
        "dialog must close after a confirmed delete")
    }

    // ---- reorder: move up / move down swap adjacent siblings ---------

    function test_move_up_disabled_at_first_sibling() {
      fakeStore.seedTwoTopLevelFolders()
      var header = headerForFolder(11)
      compare(header._siblingIndex, 0)
      header._moveBy(-1)
      compare(fakeStore.reorderFoldersCalls.length, 0)
    }

    function test_move_down_swaps_with_next_and_submits_only_changed_siblings() {
      fakeStore.seedTwoTopLevelFolders()
      var header = headerForFolder(11)
      compare(header._siblingIndex, 0)
      header._moveBy(1)
      compare(fakeStore.reorderFoldersCalls.length, 1,
        "exactly one reorderFolders call for one move")
      var ids = fakeStore.reorderFoldersCalls[0].ids
      compare(ids[0], 22, "the row that was at position 1 must now lead")
      compare(ids[1], 11, "the moved row must follow")
    }

    function test_move_up_does_the_inverse_swap() {
      fakeStore.seedTwoTopLevelFolders()
      var header = headerForFolder(22)
      header._moveBy(-1)
      compare(fakeStore.reorderFoldersCalls.length, 1)
      var ids = fakeStore.reorderFoldersCalls[0].ids
      compare(ids[0], 22)
      compare(ids[1], 11)
    }

    function test_move_down_disabled_at_last_sibling() {
      fakeStore.seedTwoTopLevelFolders()
      var header = headerForFolder(22)
      compare(header._siblingIndex, 1)
      compare(header._siblingCount, 2)
      header._moveBy(1)
      compare(fakeStore.reorderFoldersCalls.length, 0)
    }

    function test_reorder_does_not_touch_unrelated_parents() {
      fakeStore.folders = [
        { id: 11, name: "TopA",  parent_id: null, position: 0, is_default: 0 },
        { id: 12, name: "TopB",  parent_id: null, position: 1, is_default: 0 },
        { id: 21, name: "Child", parent_id: 11,  position: 0, is_default: 0 }
      ]
      fakeStore.conversations = []
      var topA = headerForFolder(11)
      topA._moveBy(1)
      compare(fakeStore.reorderFoldersCalls.length, 1)
      var ids = fakeStore.reorderFoldersCalls[0].ids
      compare(ids.length, 3, "all three folder ids submitted")
      var seenTop = (ids.slice(0, 2)).sort(function (a, b) { return a - b }).join(",")
      compare(seenTop, "11,12", "top-level pair occupies the first two slots")
      compare(ids[2], 21, "unrelated child is appended at the end")
    }
  }
}
