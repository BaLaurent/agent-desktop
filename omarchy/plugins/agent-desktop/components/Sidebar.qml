pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

import qs.Commons
import qs.Ui

// The conversations sidebar.
//
// Owns the search box, the sort controls, and the conversation tree. Emits
// openImportPicker() / openExportPicker() so the integration owner (App.qml)
// can show a file dialog and pipe the chosen path back through
// `store.importJson(...)` / a Quickshell.Io write.
//
// There is one render. The previous "collapsed" mode was a second BorderSurface
// with its own search, FolderTree and ConversationActionBar — visually similar
// but laid out differently, so the same width produced two different widths.
// That is gone now: the sidebar is always the same component, and App.qml
// chooses between pushing the content (≥ 720 px) and overlaying it (< 720 px).
Item {
  id: root

  property var store: null

  signal openImportPicker()
  signal openExportPicker(var conversationId, string format)

  // Local — open state of the overflow menu (`⋯` button). Lives in the
  // sidebar because the menu anchors to the button and must dismiss when a
  // click lands outside it.
  property bool menuOpen: false

  readonly property var sortCriteria: [
    { value: "updated_at",    label: "Updated" },
    { value: "message_count", label: "Messages" },
    { value: "title",         label: "Title" }
  ]

  readonly property bool _hasSelection: root.store
    && root.store.selection
    && Object.keys(root.store.selection).length > 0

  ColumnLayout {
    id: chrome
    anchors.fill: parent
    spacing: 0

    // Toolbar: sort dropdown, sort-direction toggle, overflow menu.
    //
    // The height comes from the row's own content, NOT from
    // `Style.bar.sizeHorizontal`. That token is 26 px — a BAR widget's
    // height — while these are full-size controls: `Dropdown.implicitHeight`
    // is `Style.spacing.controlHeight` (28 px). Constraining the box to 26 px
    // left 14 px after padding, so the dropdown overflowed its parent by
    // 14 px and drew straight through the search field below it. The wrapper
    // Item stays because the scrim and the overflow menu anchor to it.
    //
    // Uses qs.Ui.Button, NOT PanelActionButton — PanelActionButton is a
    // 22×22 icon-only widget designed for inline row actions; for a full
    // toolbar of labelled controls it would render as bare glyphs with no
    // text (PanelActionButton uses `iconText`, not `text`).
    Item {
      id: toolbarBox
      Layout.fillWidth: true
      Layout.preferredHeight: toolbarRow.implicitHeight
        + 2 * Style.spacing.controlPaddingY

      RowLayout {
        id: toolbarRow
        anchors.fill: parent
        anchors.margins: Style.spacing.controlPaddingY
        spacing: Style.spacing.controlGap

        Dropdown {
          id: sortDropdown
          Layout.fillWidth: true
          options: root.sortCriteria
          // Dropdown's `value` is the selected entry's `value` field;
          // a plain {value,label}[] becomes the popup rows.
          value: root.store && root.store.sort ? root.store.sort.criterion : "updated_at"
          // Update the store when the user picks an option. Dropdown's
          // `changed(value)` payload is the string value field.
          onChanged: function (newValue) {
            if (!root.store) return
            var sd = (root.store.sort && root.store.sort.direction) || "desc"
            root.store.setSort(String(newValue), sd)
          }
        }

        Button {
          // No preferredWidth: the label decides. `Style.bar.sizeHorizontal`
          // (26 px) was clipping "Desc"/"Asc" — it is a bar-widget metric,
          // not a text-button one.
          text: root.store && root.store.sort && root.store.sort.direction === "asc" ? "Asc" : "Desc"
          tooltipText: "Toggle sort direction"
          onClicked: {
            if (!root.store) return
            var sc = (root.store.sort && root.store.sort.criterion) || "updated_at"
            var sd = (root.store.sort && root.store.sort.direction === "asc") ? "desc" : "asc"
            root.store.setSort(sc, sd)
          }
        }

        Button {
          id: overflowButton
          text: "⋯"
          tooltipText: "More actions"
          onClicked: root.menuOpen = !root.menuOpen
        }
      }
    }

    // Search field — server-side search runs only when there is content.
    Item {
      Layout.fillWidth: true
      Layout.preferredHeight: Style.bar.sizeHorizontal

      TextField {
        id: searchField
        anchors.fill: parent
        anchors.leftMargin: Style.spacing.controlPaddingX
        anchors.rightMargin: Style.spacing.controlPaddingX
        placeholderText: "Search…"
        text: root.store ? root.store.search : ""
        onTextChanged: { if (root.store) root.store.setSearch(text) }
      }
    }

    Item {
      Layout.fillWidth: true
      Layout.fillHeight: true

      FolderTree {
        anchors.fill: parent
        store: root.store
        // Bubbles a per-row export up to the same App.qml FileDialog the
        // overflow menu uses. Without this hop, ConversationRow's two export
        // menu entries reached nothing.
        onExportRequested: function (conversationId, format) {
          root.openExportPicker(conversationId, String(format))
        }
      }
    }

    ConversationActionBar {
      Layout.fillWidth: true
      visible: root._hasSelection
      store: root.store
      // The bar's "Move…" button was visible, enabled whenever conversations
      // were selected, and wired to nothing: it emitted `requestMovePicker()`
      // and this mount had no handler, so clicking it silently did nothing.
      // Worse than an invisible control, because the tooltip promises
      // "Move selected conversations into a folder".
      onRequestMovePicker: root.movePickerOpen = true
    }
  }

  // ---- overflow menu (the `⋯` button) ------------------------------------
  //
  // A root-level sibling of `chrome`, not a child of the toolbar row, and both
  // halves of that matter.
  //
  // The menu has to PAINT above the search field and the conversation tree it
  // overlaps, and `z` only ranks SIBLINGS: living inside the toolbar Item, the
  // menu inherited that Item's rank as the ColumnLayout's first child and drew
  // under everything below it no matter what z it carried itself. And the
  // outside-click scrim has to cover the whole sidebar — filling the toolbar
  // Item meant a click on a conversation row selected the row AND left the menu
  // open on top of it.
  //
  // Anchors cannot reach `toolbarBox` from out here (it is a child of `chrome`,
  // so not a sibling and not a parent), so the position is a binding on the
  // toolbar's own geometry instead. `chrome` fills the root, so its x/y are
  // structurally 0; they are in the expression anyway so that adding a margin
  // to `chrome` later moves the menu with it rather than detaching it.
  //
  // Same in-window BorderSurface shape as the move picker below, for the same
  // reason: qs.Ui.PopupCard is a Quickshell PopupWindow and cannot be anchored
  // against in-window ids (CONTRACTS.md §6d).
  MouseArea {
    anchors.fill: parent
    visible: root.menuOpen
    z: 6
    enabled: root.menuOpen
    onClicked: root.menuOpen = false
  }

  BorderSurface {
    id: overflowMenu
    visible: root.menuOpen
    z: 7
    // `height` is the bug this menu shipped with. A BorderSurface IS a
    // Rectangle, and a Rectangle with no height is zero-high: the fill and the
    // border drew nothing at all, while the Column inside still painted its
    // buttons — a positioner lays children out from y=0 downwards regardless of
    // its own height, and nothing here clips. So the menu read as four lines of
    // loose text floating over the conversation list, with no surface under it.
    width: Math.min(280, root.width - 2 * Style.spacing.md)
    height: menuCol.implicitHeight + 2 * Style.spacing.sm
    x: chrome.x + toolbarBox.x + Style.spacing.controlPaddingY
    y: chrome.y + toolbarBox.y + toolbarBox.height + Style.spacing.xs
    // `menu`, not `popups`: this is literally a menu, and the theme names that
    // surface separately (background / text / border / selected-*) so a theme
    // that styles Omarchy's own menus styles this one too.
    color: Color.menu.background
    borderSpec: Border.flat(Color.menu.border, 1)
    radius: Style.cornerRadius

    Column {
      id: menuCol
      anchors { left: parent.left; right: parent.right; top: parent.top; margins: Style.spacing.sm }
      spacing: Style.spacing.xs

      // `width: menuCol.width`, and no `Layout.fillWidth`: a Column is a
      // positioner, not a Layout, so the attached Layout property these buttons
      // used to carry was inert and only implied that something was honouring
      // it.
      //
      // `leftAlign` is what makes a full-width row read as a MENU ITEM rather
      // than as a centred push button — it is how the shell's own menu and
      // dropdown rows are laid out (qs.Ui.Button:155). CONTRACTS.md §6e used to
      // say Button has no such property; the shell has it, and the note is
      // corrected there.
      Button {
        text: "New conversation"
        width: menuCol.width
        leftAlign: true
        onClicked: {
          root.menuOpen = false
          if (root.store) root.store.create()
        }
      }
      Button {
        text: "New folder"
        width: menuCol.width
        leftAlign: true
        onClicked: {
          root.menuOpen = false
          if (root.store) root.store.createFolder()
        }
      }
      Button {
        text: "Import…"
        width: menuCol.width
        leftAlign: true
        onClicked: {
          root.menuOpen = false
          root.openImportPicker()
        }
      }
      Button {
        text: "Export active as Markdown"
        width: menuCol.width
        leftAlign: true
        enabled: root.store && root.store.activeId !== null
        onClicked: {
          root.menuOpen = false
          if (root.store && root.store.activeId !== null) {
            root.openExportPicker(root.store.activeId, "markdown")
          }
        }
      }
    }
  }

  // ---- move-to-folder picker --------------------------------------------
  //
  // Same in-window BorderSurface shape as the overflow menu above, for the
  // same reason: `qs.Ui.PopupCard` is a Quickshell `PopupWindow` and cannot be
  // anchored against in-window ids.
  property bool movePickerOpen: false

  function _moveSelectedTo(folderId) {
    root.movePickerOpen = false
    if (!root.store) return
    var ids = root.store.selectedIds()
    if (!ids || ids.length === 0) return
    // `null` is the store's spelling for "no folder"; it clears `selection`
    // itself on success, which is what dismisses the action bar.
    root.store.moveMany(ids, folderId)
  }

  MouseArea {
    anchors.fill: parent
    visible: root.movePickerOpen
    z: 4
    enabled: root.movePickerOpen
    onClicked: root.movePickerOpen = false
  }

  BorderSurface {
    id: movePicker
    visible: root.movePickerOpen
    z: 5
    width: Math.min(260, root.width - 2 * Style.spacing.md)
    height: Math.min(320, moveCol.implicitHeight + 2 * Style.spacing.sm)
    anchors.centerIn: parent
    color: Color.menu.background
    borderSpec: Border.flat(Color.menu.border, 1)
    radius: Style.cornerRadius

    Column {
      id: moveCol
      anchors { left: parent.left; right: parent.right; top: parent.top; margins: Style.spacing.sm }
      spacing: Style.spacing.xs

      Text {
        width: parent.width
        text: "Move to folder"
        color: Color.menu.text
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
        opacity: 0.8
      }

      // Offered first: it is the only destination that always exists, and
      // it is how a user undoes a move without hunting for the old folder.
      // `leftAlign` for the same reason as the overflow menu's rows: these are
      // menu destinations, not push buttons.
      Button {
        width: parent.width
        text: "No folder"
        leftAlign: true
        onClicked: root._moveSelectedTo(null)
      }

      Repeater {
        model: root.store && root.store.folders ? root.store.folders : []
        delegate: Button {
          id: folderChoice
          required property var modelData
          width: moveCol.width
          leftAlign: true
          text: folderChoice.modelData ? String(folderChoice.modelData.name || "(unnamed)") : ""
          onClicked: root._moveSelectedTo(folderChoice.modelData ? folderChoice.modelData.id : null)
        }
      }
    }
  }
}
