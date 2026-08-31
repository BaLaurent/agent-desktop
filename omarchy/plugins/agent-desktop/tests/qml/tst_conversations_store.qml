import QtQuick
import QtTest

// ConversationsStore's RPC contract, exercised in a real QML engine.
//
// The behaviour under test is layout — a list that patches in place across a
// push, a sort that persists across reloads, and the quick-chat reuse-vs-
// create branches — which a node test on a plain object cannot observe.
//
// Note on signals: QML's auto-property-change signal on `property var`
// fires with NO arguments (the new value is NOT in the payload — verified
// by a separate diag this session). Connections below counts emissions,
// not values; the integration owner uses the same `activeId` property to
// read the new id.
Item {
  width: 200
  height: 200

  // Per-call-capture fake of the rpc surface Service.qml hands to stores.
  // invoke lands as {channel, args, ok, err}; subscribe registers a handler
  // by channel; accept/refuse drive the most-recent matching invoke; emit
  // dispatches to all subscribed handlers for that channel.
  QtObject {
    id: fakeRpc

    property var calls: []
    property var handlers: ({})
    property var settingsStore: fakeSettingsStore

    function invoke(channel, args, onOk, onErr) {
      calls = calls.concat([{
        channel: channel, args: args || [], ok: onOk, err: onErr
      }])
      return calls.length
    }
    function subscribe(channel, handler) {
      var list = handlers[channel]
      if (!list) { list = []; handlers[channel] = list }
      if (list.indexOf(handler) === -1) list.push(handler)
    }
    function unsubscribe(channel, handler) {
      var list = handlers[channel]
      if (!list) return
      var i = list.indexOf(handler)
      if (i >= 0) list.splice(i, 1)
    }
    function accept(channel, result) { callFor(channel).ok(result) }
    function refuse(channel, message) { callFor(channel).err(message) }
    function callFor(channel) {
      for (var i = calls.length - 1; i >= 0; i--) {
        if (calls[i].channel === channel) return calls[i]
      }
      throw new Error("no call to " + channel)
    }
    function emit(channel, data) {
      var list = handlers[channel]
      if (!list) return
      var snapshot = list.slice()
      for (var i = 0; i < snapshot.length; i++) snapshot[i](data)
    }
    function reset() { calls = []; handlers = ({}) }
  }

  // SettingsStore stand-in.
  QtObject {
    id: fakeSettingsStore
    property var values: ({})
    function get(key, fallback) {
      if (values[key] !== undefined) return values[key]
      return fallback === undefined ? "" : fallback
    }
    function set(key, value) {
      var next = {}
      for (var k in values) next[k] = values[k]
      next[key] = String(value)
      values = next
    }
  }

  Loader {
    id: storeLoader
    Component.onCompleted: setSource("../../stores/ConversationsStore.qml", ({ rpc: fakeRpc }))
  }

  // Counted record of every activeId change the store emitted in this run.
  // The auto-property-change signal on `property var` carries no arg, so we
  // count emissions; the actual id at each tick is observable via the
  // store.activeId property right after.
  property int activeIdChanges: 0

  Connections {
    target: storeLoader.item
    function onActiveIdChanged() {
      activeIdChanges = activeIdChanges + 1
    }
  }

  TestCase {
    name: "ConversationsStore"
    when: windowShown

    property var store: storeLoader.item

    function initTestCase() {
      tryCompare(storeLoader, "status", Loader.Ready)
      verify(store !== null, "ConversationsStore.qml loaded")
    }

    function init() {
      fakeRpc.reset()
      fakeRpc.settingsStore = fakeSettingsStore
      fakeSettingsStore.values = ({})
      store.list = []
      store.folders = []
      store.activeId = null
      store.search = ""
      store.selection = ({})
      store.sort = ({ criterion: "updated_at", direction: "desc" })
      store.loading = false
      store.loaded = false
      store.error = ""
      // The store caches _subscribed; reset it so the next load() actually
      // re-wires handlers against the (just-reset) fakeRpc.
      if ("_subscribed" in store) store._subscribed = false
      activeIdChanges = 0
    }

    // ----- load -----

    function test_load_fetches_list_and_folders() {
      store.load()
      compare(store.loading, true)
      var sawList = false
      var sawFolders = false
      for (var i = 0; i < fakeRpc.calls.length; i++) {
        if (fakeRpc.calls[i].channel === "conversations:list") sawList = true
        if (fakeRpc.calls[i].channel === "folders:list") sawFolders = true
      }
      verify(sawList, "load requests conversations:list")
      verify(sawFolders, "load requests folders:list")
    }

    function test_load_populates_state() {
      store.load()
      fakeRpc.accept("conversations:list", [
        { id: 1, title: "First", folder_id: null, message_count: 4, updated_at: "2026-08-01T00:00:00Z" },
        { id: 2, title: "Second", folder_id: 10, message_count: 9, updated_at: "2026-08-02T00:00:00Z" },
      ])
      compare(store.list.length, 2)
      compare(store.loading, false)
      compare(store.loaded, true)

      fakeRpc.accept("folders:list", [
        { id: 10, name: "Old", position: 0, parent_id: null, is_default: 0 }
      ])
      compare(store.folders.length, 1)
    }

    function test_load_hydrates_sort_persistence() {
      fakeSettingsStore.values = ({ sort_criterion: "title", sort_direction: "asc" })
      store.sort = ({ criterion: "updated_at", direction: "desc" })
      store.load()
      var saw = false
      var call = null
      for (var i = 0; i < fakeRpc.calls.length; i++) {
        if (fakeRpc.calls[i].channel === "settings:get") {
          saw = true
          call = fakeRpc.calls[i]
        }
      }
      verify(saw, "sort persistence calls settings:get")
      compare(call.args[0], "sort_criterion")
      compare(call.args[1], "sort_direction")
      call.ok({ sort_criterion: "title", sort_direction: "asc" })
      compare(store.sort.criterion, "title")
      compare(store.sort.direction, "asc")
    }

    // ----- titleUpdated patches in place -----

    function test_title_updated_patches_in_place() {
      store.load()
      fakeRpc.accept("conversations:list", [
        { id: 1, title: "Old", folder_id: null, message_count: 0, updated_at: "2026-08-01T00:00:00Z" },
        { id: 2, title: "Two", folder_id: null, message_count: 0, updated_at: "2026-08-02T00:00:00Z" }
      ])
      compare(store.list[0].title, "Old")
      fakeRpc.emit("conversations:titleUpdated", { id: 1, title: "Renamed" })
      compare(store.list[0].title, "Renamed", "title patched in place")
      compare(store.list[1].title, "Two", "untouched row preserved")
      var listCount = 0
      for (var i = 0; i < fakeRpc.calls.length; i++) {
        if (fakeRpc.calls[i].channel === "conversations:list") listCount++
      }
      compare(listCount, 1, "no conversations:list reload (preserves scroll)")
    }

    function test_title_updated_ignores_bad_payloads() {
      store.load()
      fakeRpc.accept("conversations:list", [
        { id: 1, title: "Old", folder_id: null, message_count: 0, updated_at: "2026-08-01T00:00:00Z" }
      ])
      fakeRpc.emit("conversations:titleUpdated", null)
      fakeRpc.emit("conversations:titleUpdated", { id: "not a number", title: "x" })
      fakeRpc.emit("conversations:titleUpdated", { id: 0, title: "x" })
      fakeRpc.emit("conversations:titleUpdated", { id: 99999, title: "ghost" })
      compare(store.list[0].title, "Old")
    }

    // ----- active id -----

    function test_set_active_id_marks_opened() {
      store.load()
      fakeRpc.accept("conversations:list", [
        { id: 5, title: "Five", folder_id: null, message_count: 0, updated_at: "2026-01-01T00:00:00Z" }
      ])
      store.setActiveId(5)
      compare(store.activeId, 5)
      var saw = false
      for (var i = 0; i < fakeRpc.calls.length; i++) {
        if (fakeRpc.calls[i].channel === "conversations:markOpened") saw = true
      }
      verify(saw, "setActiveId triggers conversations:markOpened")
    }

    function test_set_active_id_emits_signal() {
      store.load()
      fakeRpc.accept("conversations:list", [])
      activeIdChanges = 0
      store.setActiveId(7)
      store.setActiveId(7)        // duplicate — must NOT re-emit
      store.setActiveId(null)
      // Auto property-change signal fires on every reassignment even if
      // the new value equals the old (QML optimisation may or may not
      // dedupe at this level). The store explicitly returns on same value,
      // so we expect exactly 2 emissions: null→7 then 7→null.
      compare(activeIdChanges, 2,
        "duplicate id is deduped; null transition fires — got " + activeIdChanges)
      compare(store.activeId, null)
    }

    function test_set_active_id_coerces_string_and_garbage() {
      store.load()
      fakeRpc.accept("conversations:list", [])
      store.setActiveId("42")
      compare(store.activeId, 42)
      store.setActiveId(0)
      compare(store.activeId, null)
      store.setActiveId("garbage")
      compare(store.activeId, null)
      store.setActiveId(-1)
      compare(store.activeId, null)
    }

    // ----- selection -----

    function test_selection_toggle_replace_clear() {
      store.toggleSelection(1)
      verify(store.isSelected(1))
      store.toggleSelection(2)
      verify(store.isSelected(1))
      verify(store.isSelected(2))
      store.toggleSelection(1)
      verify(!store.isSelected(1))
      store.setSelection([3, 4])
      verify(!store.isSelected(2))
      verify(store.isSelected(3))
      verify(store.isSelected(4))
      store.clearSelection()
      compare(store.selectedIds().length, 0)
    }

    // ----- sort persistence -----

    function test_set_sort_persists_via_settings_store() {
      store.setSort("title", "asc")
      compare(store.sort.criterion, "title")
      compare(store.sort.direction, "asc")
      compare(fakeSettingsStore.values.sort_criterion, "title")
      compare(fakeSettingsStore.values.sort_direction, "asc")
    }

    function test_set_sort_falls_back_to_channel_when_no_store() {
      fakeRpc.settingsStore = null
      store.setSort("message_count", "asc")
      compare(store.sort.criterion, "message_count")
      var count = 0
      for (var i = 0; i < fakeRpc.calls.length; i++) {
        if (fakeRpc.calls[i].channel === "settings:set") count++
      }
      verify(count >= 2, "two settings:set fired when no SettingsStore")
      fakeRpc.settingsStore = fakeSettingsStore
    }

    // ----- ensureQuickChat: reuse vs create -----

    function _makeQuickChatRows(id) {
      return [{ id: id, title: "Quick Chat", folder_id: null, message_count: 0, updated_at: "2026-01-01T00:00:00Z" }]
    }

    function test_ensure_quick_chat_reuses_pinned_id() {
      fakeSettingsStore.values = ({ quickChat_conversationId: "11" })
      store.ensureQuickChat("text")
      var sawGet = false
      var sawCreate = false
      for (var i = 0; i < fakeRpc.calls.length; i++) {
        if (fakeRpc.calls[i].channel === "conversations:get") sawGet = true
        if (fakeRpc.calls[i].channel === "conversations:create") sawCreate = true
      }
      verify(sawGet, "reused id calls conversations:get")
      verify(!sawCreate, "reused id does NOT create")
      fakeRpc.accept("conversations:get", {
        id: 11, title: "Quick Chat", folder_id: null, message_count: 0, updated_at: "2026-01-01T00:00:00Z"
      })
      compare(store.activeId, 11, "the pinned id is activated")
    }

    function test_ensure_quick_chat_creates_when_pin_points_nowhere() {
      fakeSettingsStore.values = ({ quickChat_conversationId: "12345" })
      store.ensureQuickChat("text")
      var sawGet = false
      for (var i = 0; i < fakeRpc.calls.length; i++) {
        if (fakeRpc.calls[i].channel === "conversations:get") sawGet = true
      }
      verify(sawGet, "probes a stale pinned id")
      fakeRpc.refuse("conversations:get", "Conversation not found")
      var sawCreateAfter = false
      for (var j = 0; j < fakeRpc.calls.length; j++) {
        if (fakeRpc.calls[j].channel === "conversations:create") sawCreateAfter = true
      }
      verify(sawCreateAfter, "missing id => create + pin via list fallback")
    }

    function test_ensure_quick_chat_creates_when_no_pin() {
      fakeSettingsStore.values = ({})
      store.ensureQuickChat("voice")
      fakeRpc.accept("conversations:create", 17)
      fakeRpc.accept("conversations:list", _makeQuickChatRows(17))
      compare(store.activeId, 17, "create-then-list id activates")
      compare(fakeSettingsStore.values.quickChat_conversationId, "17")
    }

    // The live-evidenced null-create workaround.
    function test_ensure_quick_chat_null_create_falls_back_to_list() {
      fakeSettingsStore.values = ({})
      store.ensureQuickChat("text")
      fakeRpc.accept("conversations:create", null)
      fakeRpc.accept("conversations:list", [
        { id: 14, title: "Other", folder_id: null, message_count: 0, updated_at: "2026-01-01T00:00:00Z" },
        { id: 15, title: "Quick Chat", folder_id: null, message_count: 0, updated_at: "2026-01-01T00:00:00Z" },
      ])
      compare(store.activeId, 15, "list fallback picks the inserted id")
      compare(fakeSettingsStore.values.quickChat_conversationId, "15")
    }

    function test_ensure_quick_chat_string_pin_is_normalised() {
      fakeSettingsStore.values = ({ quickChat_conversationId: "null" })
      store.ensureQuickChat("text")
      var sawGet = false
      for (var i = 0; i < fakeRpc.calls.length; i++) {
        if (fakeRpc.calls[i].channel === "conversations:get") sawGet = true
      }
      verify(!sawGet, "string 'null' must not trigger a conversations:get")
    }

    function test_ensure_quick_chat_voice_slot_when_separate() {
      fakeSettingsStore.values = ({ quickChat_separateVoiceConversation: "true" })
      store.ensureQuickChat("voice")
      fakeRpc.accept("conversations:create", 8)
      fakeRpc.accept("conversations:list", _makeQuickChatRows(8))
      compare(fakeSettingsStore.values.quickChat_voiceConversationId, "8")
      compare(fakeSettingsStore.values.quickChat_conversationId, undefined,
        "voice mode with separate on must not touch the shared slot")
    }

    // The whole reason no conversation could ever be created from this front.
    //
    // The server signature is `create(title?, folderId?)` and treats an ABSENT
    // folderId as "use the default folder" — but an explicit null is a value
    // and `validatePositiveInt` refuses it. Measured live:
    //   ["Quick Chat (Voice)", null] -> "folderId must be a positive integer"
    //   ["Quick Chat (Voice)"]       -> row inserted
    // Both creation paths padded their arguments with null, so every create
    // was refused — silently, because the quick-chat invoke had no error
    // callback. These assert the ARGS, which is the part that was wrong.
    function _argsFor(channel) {
      for (var i = fakeRpc.calls.length - 1; i >= 0; i--) {
        if (fakeRpc.calls[i].channel === channel) return fakeRpc.calls[i].args
      }
      return null
    }

    function test_create_omits_folder_id_rather_than_sending_null() {
      store.create("Hello", null)
      var args = _argsFor("conversations:create")
      compare(args.length, 1, "no folder means a ONE-argument call, not [title, null]")
      compare(args[0], "Hello")
    }

    function test_create_sends_a_positive_folder_id() {
      store.create("Hello", 4)
      var args = _argsFor("conversations:create")
      compare(args.length, 2)
      compare(args[1], 4)
    }

    function test_create_drops_a_non_positive_folder_id() {
      store.create("Hello", 0)
      compare(_argsFor("conversations:create").length, 1, "0 is not a folder id")
      store.create("Hello", -3)
      compare(_argsFor("conversations:create").length, 1, "a negative is not a folder id")
    }

    function test_create_sends_an_empty_title_not_null() {
      store.create(null, null)
      var args = _argsFor("conversations:create")
      compare(args.length, 1)
      compare(args[0], "", "an absent title is sent as '' — the server refuses a null")
    }

    function test_quick_chat_create_omits_folder_id() {
      fakeSettingsStore.values = ({})
      store.ensureQuickChat("voice")
      var args = _argsFor("conversations:create")
      compare(args.length, 1, "quick chat must not send a null folderId either")
      compare(args[0], "Quick Chat (Voice)")
    }

    // A null create reply for a VOICE quick chat must resolve through the
    // voice title. Scanning for "Quick Chat" found the highest TEXT row and
    // pinned that into the voice slot as though it were newly created.
    function test_voice_null_create_resolves_by_voice_title() {
      fakeSettingsStore.values = ({ quickChat_separateVoiceConversation: "true" })
      store.ensureQuickChat("voice")
      fakeRpc.accept("conversations:create", null)
      fakeRpc.accept("conversations:list", [
        { id: 30, title: "Quick Chat", folder_id: null, message_count: 0, updated_at: "2026-01-01T00:00:00Z" },
        { id: 31, title: "Quick Chat (Voice)", folder_id: null, message_count: 0, updated_at: "2026-01-01T00:00:00Z" },
      ])
      compare(store.activeId, 31, "the VOICE row is the one that was just created")
      compare(fakeSettingsStore.values.quickChat_voiceConversationId, "31")
    }

    // ----- tree -----

    function test_tree_groups_folders_then_uncategorized() {
      store.load()
      fakeRpc.accept("conversations:list", [
        { id: 1, title: "A", folder_id: 10, message_count: 0, updated_at: "2026-08-01T00:00:00Z" },
        { id: 2, title: "Z", folder_id: null, message_count: 0, updated_at: "2026-08-02T00:00:00Z" }
      ])
      fakeRpc.accept("folders:list", [
        { id: 10, name: "Old", position: 0, parent_id: null, is_default: 0 }
      ])
      var tree = store.tree()
      compare(tree.groups.length, 2)
      compare(tree.groups[0].folder.id, 10)
      compare(tree.groups[1].folder, null)
      var got = JSON.stringify(tree.flat.map(function (c) { return c.id }))
      verify(got === JSON.stringify([1, 2]),
        "flat order, got=" + got + " want=[1,2]")
    }
  }
}
