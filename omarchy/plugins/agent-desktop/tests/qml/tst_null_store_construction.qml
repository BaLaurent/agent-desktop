import QtQuick
import QtTest

// Every Loader-hosted page must survive being built with a NULL store.
//
// This is the gap `tst_component_load.qml` leaves open by design. Its own header
// says it COMPILES rather than instantiates, deliberately, because instantiating
// would fail on unset `required property`. But compiling never evaluates a
// binding — so a construction-time binding that dereferences a null injected
// store compiles clean and throws the moment the engine builds the item.
//
// That is not hypothetical. It shipped, and only a live plugin reload found it:
//
//   PiUIChrome.qml[232]: TypeError: Cannot read property 'headerNode' of null
//   PiUIChrome.qml[249]: TypeError: Cannot read property 'footerNode' of null
//
// The cause is the standard wiring in App.qml:
//
//   PiUIChrome { store: root.service ? root.service.piUiStore : null }
//
// `service` is injected by the shell AFTER the item is created, so every page
// is built with `store === null` at least once, every single time.
//
// Why these pages specifically: they live behind `windowContent`'s Loader, so
// they are not constructed when the plugin loads. A live-reload scan of the
// shell log therefore CANNOT reach them — the only place they get built with a
// null store is here.
//
// Mechanism: `failOnWarning` turns a QML binding TypeError, which is only ever
// printed as a warning, into a test failure. Without it `createObject` succeeds
// and the error scrolls past.
Item {
  id: harness
  width: 400
  height: 300

  // Each page with the EXACT set of properties it declares, all null.
  //
  // Explicit per page rather than one shared blob: QML warns on every
  // property the type does not have ("Setting initial properties failed:
  // NotebookPane does not have a property called cwd"), and a hundred such
  // warnings bury the one finding this test exists to surface. Derived from
  // the `required property` declarations in each file — if a page gains a
  // required property, `createObject` returns null and the `verify` below
  // fails loudly, which is the right way to learn about it.
  //
  // FilesPane and FilePreview are absent for the reason tst_component_load
  // excludes them too: they import Quickshell, which is statically linked
  // into the quickshell binary and unavailable here.
  readonly property var pages: [
    { path: "../../components/NotebookPane.qml",           props: ({ store: null }) },
    { path: "../../components/OpenScadPage.qml",            props: ({ store: null }) },
    { path: "../../components/SchedulerPage.qml",           props: ({ store: null }) },
    { path: "../../components/GitPane.qml",                 props: ({ store: null }) },
    { path: "../../components/PiUIChrome.qml",              props: ({ store: null }) },
    { path: "../../components/PiUIModal.qml",               props: ({ store: null }) },
    { path: "../../components/QueuePanel.qml",              props: ({ store: null }) },
    { path: "../../components/FileTree.qml",                props: ({ store: null }) },
    { path: "../../components/StatusLine.qml",
      props: ({ store: null, settingsStore: null, conversationsStore: null }) },
    // No required properties; still built, because their optional stores
    // default to null and their bindings run all the same.
    { path: "../../components/MessageList.qml",             props: ({}) },
    { path: "../../components/ConversationActionBar.qml",   props: ({}) },
    { path: "../../components/FolderTree.qml",              props: ({}) },
    { path: "../../components/Sidebar.qml",                 props: ({}) },
  ]
  Item { id: container }

  TestCase {
    name: "NullStoreConstruction"
    when: windowShown

    function init() {
      // A binding TypeError is reported as a warning, never thrown. Without
      // this the object builds "successfully" and the error is invisible.
      failOnWarning(/TypeError/)
      failOnWarning(/ReferenceError/)
      failOnWarning(/Cannot read property/)
    }

    function test_pages_build_with_a_null_store_data() {
      var rows = []
      for (var i = 0; i < harness.pages.length; i++) {
        var p = harness.pages[i]
        rows.push({ tag: p.path, path: p.path, props: p.props })
      }
      return rows
    }

    function test_pages_build_with_a_null_store(row) {
      var c = Qt.createComponent(row.path, Component.PreferSynchronous)
      compare(c.status, Component.Ready,
        row.path + " did not compile: " + c.errorString())

      var obj = c.createObject(container, row.props)
      verify(obj !== null,
        row.path + " failed to build with a null store. If this page gained a " +
        "`required property`, add it (as null) to the map above.")

      // Force a layout pass so deferred bindings — height/implicitHeight, and
      // anything a Loader defers — actually evaluate instead of sitting unread.
      // Without this the test would pass on a page whose worst binding never
      // ran.
      obj.width = 400
      obj.height = 300
      wait(0)

      obj.destroy()
    }
  }
}
