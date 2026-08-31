import QtQuick
import "../lib/conversationSort.js" as CS
import "../lib/quickChat.js" as QC

// Owns the sidebar's list of conversations + folders, the active conversation
// id, search/sort/selection, and every channel needed to drive them.
//
// Does NOT hold messages: ChatStore (Phase 2) owns the transcript. When
// activeId changes, the store emits activeIdChanged(id) so the integration
// owner wires `chatStore.load(id)` against it.
//
// Reusable list refresh: conversations:refresh broadcasts when something on
// the server (a quick-chat create, an import, an external delete) makes the
// local list stale. We always reload both the list and folders in response
// — these are cheap, and partial patches drift if a future schema change
// adds a field a sibling consumer relies on.
//
// In-place patches: conversations:titleUpdated patches a single title
// without reloading the list, which preserves the user's scroll position and
// selection across auto-title generation.
QtObject {
  id: store

  // Service.qml, which owns invoke/subscribe.
  required property var rpc

  // ---- owned state --------------------------------------------------------

  // Server view. Conversations loaded via conversations:list.
  property var list: []

  // Folders, with their manual position preserved.
  property var folders: []

  // The currently-open conversation. null when nothing is selected, in
  // which case the chat pane renders its empty state.
  property var activeId: null

  // Search box content. Server-side search runs on conversations:search
  // only when the box has non-whitespace content; empty is implicit
  // conversations:list.
  property string search: ""

  // Multi-select ids. Object-keyed for cheap `isSelected` lookup.
  // Reassigned on every mutation so change signals fire.
  property var selection: ({})

  // Sort, persisted as `sort_criterion` and `sort_direction` settings.
  property var sort: ({ criterion: "updated_at", direction: "desc" })

  property bool loading: false
  property bool loaded: false
  property string error: ""

  // activeIdChanged is the auto-generated property-change signal on
  // `activeId`. Reassignments always fire it (even with no live binding),
  // so the integration owner can connect once and never miss a transition.

  // ---- subscriptions ------------------------------------------------------

  // Wired on first load(); see Service.qml for why not at Component.onCompleted.
  property bool _subscribed: false

  function _ensureSubscriptions() {
    if (_subscribed) return
    _subscribed = true
    rpc.subscribe("conversations:refresh", function () {
      store.load()
    })
    rpc.subscribe("conversations:titleUpdated", function (data) {
      if (!data || typeof data !== "object") return
      var id = Number(data.id)
      var title = String(data.title || "")
      if (!isFinite(id) || id <= 0) return
      var current = list || []
      var patched = []
      var found = false
      for (var i = 0; i < current.length; i++) {
        if (current[i].id === id) {
          var merged = {}
          for (var k in current[i]) merged[k] = current[i][k]
          merged.title = title
          patched.push(merged)
          found = true
        } else {
          patched.push(current[i])
        }
      }
      if (!found) return
      list = patched
    })
  }

  // ---- load ---------------------------------------------------------------

  function load() {
    loading = true
    _ensureSubscriptions()
    rpc.invoke("conversations:list", [], function (rows) {
      list = Array.isArray(rows) ? rows : []
      loading = false
      loaded = true
      error = ""
      _restoreActiveId()
    }, function (err) {
      loading = false
      error = String(err)
    })
    rpc.invoke("folders:list", [], function (rows) {
      folders = Array.isArray(rows) ? rows : []
    }, function () { /* an older server has no folders:list — empty is fine */ })
    rpc.invoke("settings:get", ["sort_criterion", "sort_direction"], function (r) {
      if (r && typeof r === "object") {
        var sc = String(r.sort_criterion || "")
        var sd = String(r.sort_direction || "")
        if (sc === "updated_at" || sc === "message_count" || sc === "title") {
          if (sd === "asc" || sd === "desc") sort = ({ criterion: sc, direction: sd })
        }
      }
    })
  }

  // ---- list / tree --------------------------------------------------------

  function tree() {
    return CS.buildTree({ list: list, folders: folders, sort: sort, search: search })
  }

  // The row for one id, or null. ChatView reads a conversation's `cwd` through
  // this to scope the `@` file picker and the Files/Git panes; without it every
  // consumer would either keep its own copy of the list or re-fetch a row it
  // already has.
  //
  // The row is returned BY REFERENCE, deliberately. This store is the single
  // authoritative owner of a conversation's fields, so a caller sees a
  // `conversations:titleUpdated` patch without re-reading — and handing out a
  // clone would create exactly the second copy that ownership rule exists to
  // prevent. The contract is therefore: **do not mutate the returned object.**
  // To change a conversation, pass its id to `update()` / `rename()` /
  // `colorMany()` and let the patch come back through the store.
  function findById(id) {
    var wanted = Number(id)
    if (!isFinite(wanted) || wanted <= 0) return null
    for (var i = 0; i < list.length; i++) {
      if (Number(list[i].id) === wanted) return list[i]
    }
    return null
  }

  // The active conversation's working directory, which is what "the files" and
  // "the repo" mean everywhere in this front end.
  readonly property string activeCwd: {
    var conv = findById(activeId)
    return conv && conv.cwd ? String(conv.cwd) : ""
  }

  // ---- active id ----------------------------------------------------------
  //
  // Persisted, because the window is closed and reopened constantly and the
  // shell restarts on its own. Without this `activeId` was null on every
  // open: the chat pane showed its "Send a message to start the conversation"
  // empty state with 14 conversations in the database, and — worse —
  // `ChatStore.send()` returns silently when `conversationId <= 0`, so both a
  // typed message and a finished VOICE TRANSCRIPT were discarded without a
  // word. Dictation looked broken end to end when only this was missing.
  //
  // Stored through the same `settings:set` channel the sort criterion uses,
  // so there is one persistence mechanism rather than two.

  function setActiveId(id) {
    var next = (id === null || id === undefined) ? null : Number(id)
    if (next !== null && (!isFinite(next) || next <= 0)) next = null
    if (activeId === next) return
    activeId = next
    // Reassignment fires the auto-generated activeIdChanged signal.
    if (next !== null) {
      rpc.invoke("conversations:markOpened", [next], function () {}, function () {})
    }
    rpc.invoke("settings:set",
      ["active_conversation_id", next === null ? "" : String(next)],
      function () {}, function () {})
  }

  // Adopt the persisted conversation once the list is known, so a stale id
  // (deleted since last run) is dropped rather than selecting nothing at all.
  // Falls back to the most recently updated conversation: an empty chat pane
  // with a populated sidebar is never the useful state.
  function _restoreActiveId() {
    if (activeId !== null) return
    rpc.invoke("settings:get", ["active_conversation_id"], function (r) {
      var want = r && typeof r === "object" ? Number(r.active_conversation_id) : NaN
      if (isFinite(want) && want > 0 && findById(want)) {
        setActiveId(want)
        return
      }
      if (list.length === 0) return
      var newest = list[0]
      for (var i = 1; i < list.length; i++) {
        if (Number(list[i].updated_at || 0) > Number(newest.updated_at || 0)) newest = list[i]
      }
      if (newest && newest.id) setActiveId(Number(newest.id))
    }, function () { /* older server without the key: leave it unset */ })
  }

  // ---- mutations ----------------------------------------------------------

  // Build the argument list for `conversations:create`.
  //
  // ABSENT, never null. The server signature is `create(title?, folderId?)`
  // and it treats an UNDEFINED folderId as "use the default folder" — but an
  // explicit null is a value, and `validatePositiveInt` refuses it. Measured
  // live against the running server:
  //     conversations:create ["Quick Chat (Voice)", null]
  //       -> "Failed to create conversation: folderId must be a positive integer"
  //     conversations:create ["Quick Chat (Voice)"]        -> row inserted
  // Both creation paths in this store used to pad their arguments with null,
  // so NO conversation could be created from this front at all: the sidebar's
  // new-conversation button and every quick-chat resolution were refused, and
  // the quick-chat one swallowed the refusal because its invoke carried no
  // error callback. That is why this database has no "Quick Chat (Voice)" row
  // despite the separate-voice setting being on.
  //
  // An empty title is fine to SEND (`validateString` accepts it) and the
  // server substitutes its own default, so the title slot is always present
  // and only the folder is conditional.
  function _createArgs(title, folderId) {
    var t = (title === undefined || title === null) ? "" : String(title)
    var f = Number(folderId)
    if (folderId !== undefined && folderId !== null && isFinite(f) && f > 0) {
      return [t, Math.floor(f)]
    }
    return [t]
  }

  function create(title, folderId) {
    rpc.invoke("conversations:create", _createArgs(title, folderId), function (row) {
      // Server broadcasts conversations:refresh, so the list reload is
      // owned by the subscription. Just activate what came back.
      if (row && row.id) setActiveId(row.id)
    }, function (err) {
      store.error = "Could not create conversation: " + String(err)
    })
  }

  function update(id, data) {
    if (!id || !data || typeof data !== "object") return
    rpc.invoke("conversations:update", [Number(id), data], function () {})
  }

  function rename(id, title) {
    if (!id) return
    var next = String(title || "")
    var idNum = Number(id)
    var patched = []
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === idNum) {
        var merged = {}
        for (var k in list[i]) merged[k] = list[i][k]
        merged.title = next
        merged.updated_at = new Date().toISOString()
        patched.push(merged)
      } else {
        patched.push(list[i])
      }
    }
    list = patched
    rpc.invoke("conversations:update", [idNum, { title: next }], function () {}, function (err) {
      error = String(err)
      store.load()
    })
  }

  function deleteConversation(id) {
    if (!id) return
    var idNum = Number(id)
    rpc.invoke("conversations:delete", [idNum], function () {
      if (activeId === idNum) setActiveId(null)
    })
  }

  // ---- folders ------------------------------------------------------------

  function createFolder(name, parentId) {
    var args = [String(name || "New Folder")]
    if (parentId !== undefined && parentId !== null) {
      var p = Number(parentId)
      if (isFinite(p) && p > 0) args.push(Math.floor(p))
    }
    rpc.invoke("folders:create", args, function () {
      store.load()
    })
  }

  function updateFolder(id, data) {
    if (!id || !data) return
    rpc.invoke("folders:update", [Number(id), data], function () {
      store.load()
    })
  }

  function deleteFolder(id, mode) {
    var args = [Number(id)]
    if (mode === "keep" || mode === "delete") args.push(mode)
    rpc.invoke("folders:delete", args, function () {
      store.load()
    })
  }

  function reorderFolders(ids) {
    if (!Array.isArray(ids)) return
    rpc.invoke("folders:reorder", [ids.map(function (n) { return Number(n) })], function () {
      store.load()
    })
  }

  // ---- bulk actions on selection -----------------------------------------

  function deleteMany(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return
    var nums = ids.map(function (n) { return Number(n) }).filter(function (n) { return isFinite(n) && n > 0 })
    if (nums.length === 0) return
    rpc.invoke("conversations:deleteMany", [nums], function () {
      selection = ({})
      if (activeId !== null && nums.indexOf(activeId) >= 0) setActiveId(null)
    })
  }

  function moveMany(ids, folderId) {
    if (!Array.isArray(ids) || ids.length === 0) return
    var nums = ids.map(function (n) { return Number(n) }).filter(function (n) { return isFinite(n) && n > 0 })
    if (nums.length === 0) return
    var arg = (folderId === null || folderId === undefined) ? null : Math.floor(Number(folderId))
    rpc.invoke("conversations:moveMany", [nums, arg], function () {
      selection = ({})
    })
  }

  function colorMany(ids, color) {
    if (!Array.isArray(ids) || ids.length === 0) return
    var nums = ids.map(function (n) { return Number(n) }).filter(function (n) { return isFinite(n) && n > 0 })
    if (nums.length === 0) return
    var arg = (color === null || color === undefined) ? null : String(color)
    rpc.invoke("conversations:colorMany", [nums, arg], function () {})
  }

  // ---- search, sort, selection -------------------------------------------

  function setSearch(value) {
    var v = value === undefined || value === null ? "" : String(value)
    search = v
    if (v.trim().length === 0) {
      store.load()
      return
    }
    rpc.invoke("conversations:search", [v], function (rows) {
      list = Array.isArray(rows) ? rows : []
    })
  }

  function setSort(criterion, direction) {
    var c = criterion
    var d = direction
    if (c !== "updated_at" && c !== "message_count" && c !== "title") c = "updated_at"
    if (d !== "asc" && d !== "desc") d = "desc"
    sort = ({ criterion: c, direction: d })
    if (rpc.settingsStore && typeof rpc.settingsStore.set === "function") {
      rpc.settingsStore.set("sort_criterion", c)
      rpc.settingsStore.set("sort_direction", d)
    } else {
      rpc.invoke("settings:set", ["sort_criterion", c], function () {}, function () {})
      rpc.invoke("settings:set", ["sort_direction", d], function () {}, function () {})
    }
  }

  function toggleSelection(id) {
    var idNum = Number(id)
    if (!isFinite(idNum) || idNum <= 0) return
    var next = selection || {}
    if (Object.prototype.hasOwnProperty.call(next, String(idNum))) {
      var copy = {}
      for (var k in next) if (k !== String(idNum)) copy[k] = next[k]
      selection = copy
    } else {
      var add = {}
      for (var k2 in next) add[k2] = next[k2]
      add[String(idNum)] = true
      selection = add
    }
  }

  function setSelection(ids) {
    var next = {}
    if (Array.isArray(ids)) {
      for (var i = 0; i < ids.length; i++) {
        var n = Number(ids[i])
        if (isFinite(n) && n > 0) next[String(n)] = true
      }
    }
    selection = next
  }

  function clearSelection() { selection = ({}) }

  function isSelected(id) {
    return Boolean(selection && selection[String(Number(id))])
  }

  function selectedIds() {
    if (!selection) return []
    return Object.keys(selection).map(function (k) { return Number(k) })
  }

  // ---- generate / fork / export / import ---------------------------------

  function generateTitle(id) {
    if (!id) return
    rpc.invoke("conversations:generateTitle", [Number(id)], function () {
      // conversations:titleUpdated broadcasts the new title; the
      // subscription patches in place.
    })
  }

  function fork(convId, messageId) {
    if (!convId) return
    var args = [Number(convId)]
    if (messageId !== undefined && messageId !== null) args.push(Number(messageId))
    rpc.invoke("conversations:fork", args, function (row) {
      if (row && row.id) setActiveId(row.id)
    })
  }

  // QML JS has no Promise constructor; the consumer treats the third
  // argument as the callback. (`export` is a reserved word in QML's
  // grammar — also follows the renderer's `exportConversation`.)
  function exportConversation(id, format, onOk, onErr) {
    var fmt = (format === "json") ? "json" : "markdown"
    rpc.invoke("conversations:export", [Number(id), fmt], function (data) {
      if (typeof onOk === "function") onOk(String(data || ""))
    }, function (err) {
      error = String(err)
      if (typeof onErr === "function") onErr(String(err))
    })
  }

  function importJson(data) {
    rpc.invoke("conversations:import", [String(data)], function () {
      store.load()
    })
  }

  // ---- quick chat ---------------------------------------------------------
  //
  // The bridge used to do this; with the bridge feature-agnostic, the
  // resolution moves into QML. `mode` is one of "text" / "voice"; the
  // separate-voice setting decides which slot to use.

  function ensureQuickChat(mode) {
    mode = (mode === "voice") ? "voice" : "text"
    var separate = ""
    try {
      separate = String(rpc.settingsStore && rpc.settingsStore.get
        ? rpc.settingsStore.get("quickChat_separateVoiceConversation", "")
        : "")
    } catch (e) { separate = "" }
    var key = QC.settingKeyFor(mode, separate)

    function persistKey(value) {
      if (rpc.settingsStore && typeof rpc.settingsStore.set === "function") {
        rpc.settingsStore.set(key, String(value))
      } else {
        rpc.invoke("settings:set", [key, String(value)], function () {}, function () {})
      }
    }

    var raw = ""
    try {
      raw = String(rpc.settingsStore && rpc.settingsStore.get
        ? rpc.settingsStore.get(key, "")
        : "")
    } catch (e) { raw = "" }
    var storedId = QC.normalizeStoredId(raw)
    if (storedId > 0) {
      rpc.invoke("conversations:get", [storedId], function (conv) {
        if (conv && conv.id) { setActiveId(conv.id); return }
        store._createQuickChatAndPin(mode, key, persistKey)
      }, function () {
        store._createQuickChatAndPin(mode, key, persistKey)
      })
      return
    }

    store._createQuickChatAndPin(mode, key, persistKey)
  }

  function _createQuickChatAndPin(mode, key, persistKey) {
    var title = (mode === "voice") ? "Quick Chat (Voice)" : "Quick Chat"
    rpc.invoke("conversations:create", _createArgs(title, null), function (created) {
      rpc.invoke("conversations:list", [], function (rows) {
        // `title` is passed through: the list fallback matches on it, and a
        // VOICE quick chat is titled "Quick Chat (Voice)". Without it the scan
        // looked only for "Quick Chat" and so could never find the row it had
        // just created — it would either find nothing or, worse, adopt the
        // TEXT quick chat and pin that into the voice slot.
        var id = QC.pickCreatedId(created, rows, title)
        if (id > 0) {
          setActiveId(id)
          persistKey(id)
          return
        }
        store.error = "Quick chat: created a conversation but could not find it."
      }, function (err) {
        store.error = "Quick chat: " + String(err)
      })
    }, function (err) {
      // NOT swallowed. An invoke with no error callback is how the null-folderId
      // refusal above went unnoticed for the entire life of this front.
      store.error = "Quick chat: could not create a conversation — " + String(err)
    })
  }
}
