import QtQuick

// KnowledgeStore — the kb:listCollections / kb:getCollectionFiles surface.
//
// `kb:listCollections` returns `KnowledgeCollection[]`
// ({ name, path, fileCount, totalSize }). `kb:getCollectionFiles(name)`
// returns a list of file descriptors (`{ name, path, size }`) for the
// collection's detail pane.
//
// The store keeps the collection list as the authoritative state and
// loads the detail list lazily when the page opens a row — `detail` is
// reset to [] when the user picks a different row, so a stale detail
// view never lingers.
//
// The settings page also surfaces the per-conversation selection
// (`ai_knowledgeFolders`) as raw JSON; the page reads that through
// SettingsStore directly rather than going through a method here.
QtObject {
  id: store

  // Service.qml, which owns invoke/subscribe.
  required property var rpc

  property var collections: []    // KnowledgeCollection[]
  property bool loaded: false
  property bool loading: false
  property string error: ""

  // The detail list for the currently-selected collection. The page
  // calls `loadDetail(name)` when a row is opened; `detailName` tracks
  // which collection the current detail belongs to.
  property var detail: []
  property string detailName: ""
  property bool detailLoading: false

  function load() {
    loading = true
    rpc.invoke("kb:listCollections", [], applyList, function(err) {
      loading = false
      loaded = false
      error = String(err)
    })
  }

  function applyList(rows) {
    collections = Array.isArray(rows) ? rows : []
    loading = false
    loaded = true
  }

  // Open the detail list for `name`. Resets `detail` first so the page
  // shows a spinner rather than a stale row's contents during the
  // round-trip.
  function loadDetail(name) {
    var requested = String(name || "")
    detailName = requested
    detail = []
    detailLoading = true
    rpc.invoke("kb:getCollectionFiles", [requested], function(rows) {
      // A subsequent open() may have come in while this was in flight —
      // discard the late reply so the detail view always shows the
      // current selection.
      if (detailName !== requested) return
      detail = Array.isArray(rows) ? rows : []
      detailLoading = false
    }, function(err) {
      if (detailName !== requested) return
      detailLoading = false
      error = String(err)
    })
  }
}