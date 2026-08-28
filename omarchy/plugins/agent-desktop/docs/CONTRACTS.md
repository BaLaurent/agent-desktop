# Plugin contracts

Everything a new store, component or JS library in this plugin must obey. Written down once so no
phase has to re-derive it, and because several of these were found the hard way.

## 1. `lib/` and `generated/` are QML JS *resources*, not ES modules

A `.js` file here is a QML JS resource: `.pragma library` on the first line, then top-level
`var` and `function` declarations. QML consumes it as
`import "lib/foo.js" as Foo` → `Foo.someFunction(...)`.

**`export` / `import` syntax does not work.** The QML engine is not an ES module loader.

Node tests load the exact same bytes through `tests/load.js`, which strips the two QML-only
directives (`.pragma library`, `.import "x.js" as X`) and runs the rest in a `vm` context:

```js
const { load, deepEqual } = require('./load')
const Foo = load('lib/foo.js')
```

`deepEqual` (not `assert.deepStrictEqual`) is required whenever you compare a value produced inside
the vm against a literal declared in the test: vm-realm objects carry that realm's prototypes and
`deepStrictEqual` rejects them. `load.js` documents this.

## 2. Quickshell types cannot be instantiated by `qmltestrunner`

Quickshell's QML plugin is statically linked into the `quickshell` binary
(`/usr/lib/qt6/qml/Quickshell/qmldir` names `quickshell-coreplugin`, and no such `.so` exists).
So `qmltestrunner` cannot load **any** `.qml` that transitively imports `Quickshell`,
`Quickshell.Io` or `Quickshell.Wayland` — which is why `App.qml` and `Service.qml` have no QML test.

Consequence, and it is the architectural rule of this plugin: **a decision goes in `lib/*.js`**, so
it is testable. QML keeps Qt lifecycle, layout and input. `lib/surface.js` exists precisely because
`App.qml`'s payload routing would otherwise be untestable.

A `stores/*.qml` file that imports only `QtQuick` **is** testable — see
`tests/qml/tst_settings_store.qml`. Keep stores free of Quickshell imports; if a store needs
`Quickshell.execDetached`, take the command runner as an injected function property instead.

## 3. The RPC surface (`Service.qml`, passed to every store as `rpc`)

```qml
rpc.invoke(channel, args, onOk, onErr) -> rid   // onOk(result) / onErr(errorString); both optional
rpc.cancel(rid)                                 // abandon a pending reply
rpc.subscribe(channel, handler)                 // handler(data) for every server push
rpc.unsubscribe(channel, handler)
rpc.respond(requestId, { value?, confirmed?, cancelled? })   // answer a pi:uiRequest
rpc.recStart() / rpc.recStop() / rpc.recCancel()             // push-to-talk capture
```

Signals on `rpc`: `recordingChanged(bool active)`, `audioReady(string b64)`.

State on `rpc`: `serverUp`, `bridgeAlive`, `connected`, `lastError`, `busy`, `pluginId`, `pluginDir`,
`shell`, `settings` (plugin-local shell knobs; read via `rpc.setting(key, fallback)`),
`settingsStore`.

- `args` is positional and matches the server handler's signature exactly.
- A byte payload is spelled `[{ "__b64": "<base64>" }]`. The bridge rewrites it to the server's
  `{"__type":"binary","data":…}` form. QML cannot build a `Uint8Array`, so never try.
- There is no timeout. `messages:send` resolves only at turn end; a long-pending rid is normal and
  must not be treated as an error.
- On a dropped socket every pending rid is failed with the exact string
  `"WebSocket disconnected"`. Test for that literal to tell "reconnecting" from "failed".

## 4. Store shape

```qml
import QtQuick

QtObject {
  required property var rpc
  property var items: []
  function load() { rpc.invoke("thing:list", [], function (r) { items = r || [] }) }
}
```

- One authoritative owner per mutable value. A store owns exactly the state its channels produce.
- `load()` is called by `Service.qml` when the bridge authenticates, **not** at
  `Component.onCompleted` — the socket is not up yet then, and the server's token rotates on every
  restart, so a store must be reloadable.
- Reassign containers (`items = items.concat([x])`), never mutate in place: QML change signals fire
  on assignment only.

## 5. Omarchy owns the palette

Available from `qs.Commons`: `Color`, `Style`, `Border`, `Util`.
Available from `qs.Ui`: `BarIndicator BarIconButton BarWidget BorderOverlay BorderSurface Button
ButtonGroup ConfirmDialog CursorSurface Dropdown KeyboardPanel MultiSelect NumberField OpticalGlyph
Panel PanelActionButton PanelController PanelKeyCatcher PanelHero PanelSectionHeader PanelSeparator
PanelSlider PanelToolTip PointerMoveGate ScreenMoveRemap PopupCard SearchableDropdown
SpeedTestOverlay TextField Toggle ToggleSwitch WidgetButton`.

**There is no `ScrollView` in `qs.Ui`** — use `QtQuick.Controls`'.

Spacing: `Style.spacing.{hairline,xxs,xs,sm,md,lg,xl,xxl,xxxl,huge,controlGap,controlPaddingX,
controlPaddingY,inputPaddingY,controlHeight,popupRowHeight,dropdownWidth,searchableDropdownWidth,
numberFieldWidth,searchablePopupMinHeight,rowGap,rowPaddingX,labelGap,panelGap,panelPadding,
popupPadding}` plus `Style.cornerRadius` and `Style.gapsOut`.

Typography: `Style.font.{family,resolvedFamily,menuFamily,baseSize,caption,bodySmall,body,subtitle,
title,heading,display,displayLarge,iconSmall,icon,iconLarge}`.

Bar: `Style.bar.{sizeHorizontal,sizeVertical,iconSlot,iconCanvas,iconFont,statusSlot}`.

Colour: `Color.{foreground,background,accent,urgent,muted}` and the surface groups
`Color.{bar,popups,tooltip,notifications,menu,polkit,lock,imagePicker}`.

**`Style.gapsIn` and `Style.bar.height` do not exist.** Bindings to them evaluate to `undefined`
silently; the old `Overlay.qml` was full of them. `make qml-check` catches this class now.

### 5a. No component owns a colour

A literal colour in a `.qml` file is a bug unless it is user data. Everything visual derives from the
five theme tokens plus the surface groups, so the plugin follows a theme switch with no code change —
that is what `Color.*` bindings buy, and twelve components each carrying their own hex threw it away.

The two rules that are not obvious, both in `lib/palette.js`:

- **Elevation is a translucent FOREGROUND wash, never `Qt.darker(Color.background, n)`.** Darkening
  lifts a card on a dark theme and buries it on a light one — the same binding, a dark box on a pale
  page. `Util.alpha(Color.foreground, Palette.surfaceAlpha(level))` reads as raised either way, and it
  is the shell's own idiom (`Color.menu.selectedBackground` *is* `foreground` at 0.08). Levels: 1 a
  card, 2 a strip that must be read before the text around it, 3 an inset well.
- **What the tokens cannot name is DERIVED from them, not invented.** A seven-class syntax palette
  and a three-step gauge need more hues than the theme names, so `Palette.syntaxColors(...)` rotates
  them off the accent and `Palette.warningColor(...)` takes the hue midpoint on the short arc between
  accent and urgent. Both are pure functions on hex strings, so `tests/test_palette.js` proves the
  properties callers depend on (the classes stay mutually distinguishable even for a grey accent; the
  gauge's mid step really lands between its two endpoints).

Two traps found by doing this sweep:

- `Color.popups` has **only** `background`, `text`, `border`. `selectedBackground` / `selectedText` /
  `scrim` live on `Color.menu`. `qmllint` does not resolve inline `QtObject` group members, so
  `Color.popups.selectedBackground` passed every gate and silently left the active conversation row
  with no highlight at all. Read `/usr/share/omarchy/shell/Commons/Color.qml` before reaching into a
  group.
- A comment line may not START with `// qmllint ` — the linter parses `// qmllint <word>` as a lint
  DIRECTIVE and reports the following words as unknown categories, which the gate then fails on.

### 5b. The transcript is laid out bottom-to-top, over a REVERSED model

`MessageList.qml`'s ListView sets `verticalLayoutDirection: ListView.BottomToTop`, and its `rows`
binding ends with `rows.reverse()`. **Model index 0 is the NEWEST row.** Anything reading `rows`,
`itemAtIndex`, or an index must account for that — `isLast` is still computed in reading order, before
the reverse.

This is not a style choice, it is the only shape in which "keep the newest message in view" is
expressible. A top-to-bottom ListView pins the newest row by scrolling to `contentHeight - height`,
and `contentHeight` is an ESTIMATE whenever delegates are unrealized: the realized rows' real heights
plus an average for the rest. Repositioning changes WHICH rows are realized, which changes the
average, which changes the target. Measured on a 14-message transcript, `contentHeight` flapped
between 1814 and 893 indefinitely while `contentY` swung 486 → -442 → 293 with no fixed point, so the
transcript came to rest wherever the retry budget ran out — sometimes a line short of the newest
message, sometimes past it. Bottom-to-top makes the pinned position index 0's own edge, which no
unrealized row can move.

Two rules that go with it:

- **`atTail` is the user's INTENT, written only from `onMovementEnded`.** Qt raises movement signals
  for real gestures (drag, flick, wheel) and never for a programmatic position write or a relayout, so
  that is the one signal that separates "the user scrolled away" from "the content moved". Deriving it
  from `contentY` cannot work — contentY lags the content, so at the instant a delegate resolves its
  height the answer is always "the user left".
- **`atTail` gates the MOVE, not just the re-arm.** Checking it only when re-arming the timer left an
  in-flight burst dragging the view back for another ~1 s after the user had scrolled away.

Known limitation, tracked in issue #16: the model is a plain JS array that the store REPLACES on every
update, and Qt resets a view whose array model is replaced. A reset lands on the model's beginning —
the newest row — so following works, but a view the user had scrolled away from is re-pinned anyway,
and the `autoScroll` setting cannot be honoured across an update. Both need an incremental model
(an int `model` plus a `rows[index]` lookup, or a real `ListModel`), not more positioning code.

## 6. `make qml-check` is a hard gate

`tests/qml-check.sh` runs `qmllint` against the real `qs.Commons`/`qs.Ui` (via a `qs` symlink import
root — pointing `-I` at the shell directory makes every `qs.*` import fail silently) and fails the
build on anything outside a documented suppression list.

Suppression is per warning BLOCK, not per line. A qmllint warning is a header
(`Warning: file:line:col: message [category]`) plus a source line plus a caret line; filtering
line-by-line deletes a suppressed header and leaves its context lines, after which a
`grep '^Warning:'` finds nothing and the check reports a false "clean". That bug hid a real syntax
error until the shell refused to load the file. If you add a suppression, add it to the `suppressed()`
case statement with the reason.

The two things it catches constantly:

- **Unqualified access.** Inside a nested scope, `service.foo` is a warning; write `root.service.foo`.
  Add `id: root` to your root object and qualify everything.
- **A binding to a `Style`/`Color` token that does not exist.**

Add every new `.qml` file to nothing — the script discovers them. Add every new node test to the
`test-js` target in the `Makefile` (the integration owner does this if you report the filename).

## 6b. List delegates need `pragma ComponentBehavior: Bound`

`qmllint` reports `Unqualified access` for `root.something` inside a `Repeater`/`ListView`/`Component`
delegate, because a delegate is a separate component scope and the linter will not resolve an outer
`id` into it by default. This is NOT a reason to avoid `Repeater` or to build rows with
`Qt.createComponent` — that trades a correct declarative list for imperative object churn.

The fix is the first line of the file:

```qml
pragma ComponentBehavior: Bound
import QtQuick
```

qmllint suggests it itself. It also gives the safer semantics: outer IDs are bound when the delegate
is created rather than resolved late, so a delegate cannot silently start reading a different object.
Verified: a `Repeater` delegate reading `root.label` and `Color.foreground` is fully lint-clean with
the pragma and warns without it.

Pair it with `required property var modelData` (and `required property int index` when needed) on the
delegate — that is the Qt 6 idiom and makes the delegate's inputs explicit.

## 6c. Syntax traps the QML engine rejects

`make qml-check` is the ONLY gate that sees these: a component importing Quickshell cannot be
instantiated by `qmltestrunner`, so a syntax error in it is invisible to the test suite and only
surfaces as `Type X unavailable` in the shell's journal at runtime. qmllint reports a syntax error as
a mere `Warning`, which is why the gate must fail on warnings rather than on qmllint's exit code
(it exits 0).

Real ones already hit in this plugin:

- `Signal foo()` instead of `signal foo()`. Capitalised, it parses as a type declaration and the
  engine reports `Expected token ':'` for the whole file.
- `id: modelData.id`. **`id` is a reserved keyword**, not a property: it names the object for the
  engine and must be a static identifier. Binding it to an expression makes the engine refuse the
  file. Carry a data id through a normal property (`property string partId`) instead.
- `function root._summary() { … }`. A function declaration cannot be qualified with an object name.
  Declare `function _summary()` and call it as `root._summary()`.
- A hand-written `signal fooChanged(...)` for an existing `property var foo`. QML already generates
  the change signal, so this is `Duplicated signal name`. Bind the property and let the signal fire;
  note the auto-generated change signal takes NO argument, so read the new value off the object.
- Using `ColumnLayout` / `RowLayout` / `Layout.*` without `import QtQuick.Layouts`.

## 6d. `qs.Ui` types that are NOT Items

`PopupCard` is a Quickshell `PopupWindow`, not an `Item`
(`/usr/share/omarchy/shell/Ui/PopupCard.qml`). It declares
`required property Item anchorItem` and `required property QtObject bar`, positions itself against a
BAR window, and uses `HyprlandFocusGrab` for click-outside dismissal. It has no `anchors`.

Assigning `anchors` to it makes the QML engine refuse the whole file with
`Cannot assign to non-existent property "anchors"`, which cascades — one bad popup took out
`StatusLine`, and with it `ChatView`, and with it the entire chat surface.

For an in-window dropdown inside the `FloatingWindow` or the quick-chat card, use `Dropdown`,
`SearchableDropdown` or `MultiSelect` from `qs.Ui`, or a plain `Rectangle` + `BorderSurface`
positioned with ordinary anchors against the trigger's id plus a full-area `MouseArea` beneath it for
outside-click dismissal. Avoid `QtQuick.Controls` `Popup`: its overlay and z-order model fights the
layer-shell overlay surface.

Before using any `qs.Ui` type, read its source and check what its ROOT is. `BarWidget`,
`BarIndicator`, `BarIconButton`, `PopupCard`, `PanelWindow`-adjacent and `*Overlay` types are
bar/window machinery; the plain controls (`Button`, `TextField`, `Dropdown`, `NumberField`, `Toggle`,
`ToggleSwitch`, `MultiSelect`, `PanelSeparator`, `PanelSectionHeader`, `BorderSurface`) are the
in-window ones.

## 6e. The compile gate, and why the stubs must not lie

`tests/qml/tst_component_load.qml` compiles every component the engine can see (everything not
importing Quickshell) with `Qt.createComponent` and asserts `status !== Component.Error`, reporting
`errorString()` on failure. It COMPILES rather than instantiates on purpose: instantiating would also
fail on every unset `required property`, which is a property of the caller, not of the component.

This is the only gate that catches:
- a syntax error (qmllint reports it as a Warning and exits 0),
- an assignment to a property the type does not have,
- a component that references ITSELF (`X is instantiated recursively` — QML refuses it; recursive
  trees need a `Loader { source: "X.qml" }` indirection, resolved at runtime, plus a depth clamp).

Because components nest, one bad file takes out everything above it, and only the top-level symptom
(`Type ChatView unavailable`) reaches the journal.

**The stubs under `tests/qml/imports/qs/` MUST mirror the real components' property and signal names
exactly.** A stub that invents an API makes every test using it pass against a fiction. That really
happened: the stub `Button` once carried properties the shell's `Button` did not have, so a settings
file compiled in tests and was refused by the shell. Before adding a property to a stub, read the real
file under `/usr/share/omarchy/shell/Ui/`. The generated stubs are derived from it, so the honest fix
for a name mismatch is `node tests/gen-stubs.js`, never hand-editing.

Real APIs worth memorising, since they are the ones most often guessed wrong:

| type | properties | signals |
| --- | --- | --- |
| `Button` | `text iconText tooltipText selected active hasCursor focusable bordered leftAlign foreground background accent fontFamily fontSize` | `clicked() rightClicked() hovered(bool)` |
| `Dropdown` | `label value options showLabel` | `changed(string value)` |
| `SearchableDropdown` | `label value options placeholderText emptyText triggerLabel` | `changed(string value)` |
| `MultiSelect` | `label values options placeholderText emptyText noSelectionText triggerLabel` | `changed(var values)` |
| `NumberField` | `label value from to stepSize fieldWidth` | `modified(int value)` |
| `Toggle` | `label description checked rounded` | `clicked() hovered(bool)` |
| `ToggleSwitch` | `checked busy interactive` | `toggled()` (no argument) |
| `ConfirmDialog` | `title message confirmText cancelText` | `confirmed() canceled()` |

`Button` has no `released` signal; `ToggleSwitch.toggled()` takes no argument. It DOES have
`leftAlign`, which anchors the label to the left instead of centring it — that is what makes a
full-width row read as a menu item, and the sidebar's overflow menu and move picker use it.

## 7. QML JS gotchas

- `catch { }` is a syntax error in QML. Always `catch (e) { }`.
- Optional chaining and `??` are unavailable in QML JS resources; use explicit checks.
- `Object.keys`, `Array.prototype.*`, `JSON.*` are fine.

## 8. Host integrations are local commands, not channels

Never call `files:revealInFileManager`, `files:openWithDefault`, `files:trash`,
`kb:openKnowledgesFolder`, `system:openExternal`, `system:showNotification`, `system:selectFolder`,
`system:selectFile` or `system:getInfo` — they are Electron-only by design and unreachable here.

| capability | do this instead |
| --- | --- |
| reveal in file manager | `Quickshell.execDetached(["xdg-open", <parent dir>])` |
| open with default app | `Quickshell.execDetached(["xdg-open", <path>])` |
| move to trash | `Quickshell.execDetached(["gio", "trash", <path>])` |
| open a URL | `Quickshell.execDetached(["xdg-open", <url>])`, refusing anything but `http:`/`https:` |
| desktop notification | `Quickshell.execDetached(["notify-send", "-a", "Agent Desktop", <title>, <body>])` |
| pick a folder / file | `components/FilePicker.qml` — **never** `Qt.labs.platform` |
| system info | read it locally; there is no channel |

### Platform limits measured, not assumed

Two Electron affordances have no equivalent here, and both were verified by
measurement rather than reasoned away:

**Drag-and-drop onto the composer.** Electron uses a `FileDropZone`
(src/renderer/components/file-attach/FileDropZone.tsx:10). A QML `DropArea`
never fires: with the `keys` filter removed and a probe on `onEntered`,
dragging a file from Nautilus onto the window produced NO event, because
Quickshell's Wayland surfaces are not `wl_data_device` drop destinations. The
DropArea was written, measured, and removed — a control that cannot act is the
defect this plugin keeps fixing. Use the "+" button.

**Continuous voice / wake word.** Electron runs VAD and openwakeword-js in a
Web Worker over `AudioContext` frames, entirely in the renderer. There is no
server channel that accepts a raw frame stream, so this is not a wiring gap
but a subsystem: it needs a frame-streaming channel plus a VAD worker. See
components/VoiceSettings.qml for the same note beside the settings that would
drive it.

### `Qt.labs.platform` dialogs SEGFAULT the shell

`FileDialog` / `FolderDialog` from `Qt.labs.platform` crash the whole Quickshell
process — the user's bar, their panels and every other plugin, not just this
window. With `QT_QPA_PLATFORMTHEME=gtk3` the "native" dialog is `libqgtk3.so`,
which pulls gvfs file monitoring into Quickshell's glib main loop and corrupts
the heap. Measured (crash report `i1gw228gkt`, SIGSEGV):

```
#20 libgtk-3.so.0 (platformthemes)
#19 g_file_monitor          <- gvfs, over D-Bus
#15 g_dbus_proxy_call_sync
#10 g_variant_unref         <- refcount corruption
 #2 calloc (jemalloc)
```

Six call sites shipped that dialog (attach, conversation cwd, import, export,
notebook open, scad open/export STL) and every one was a button that killed the
desktop shell. `components/FilePicker.qml` runs the picker OUT OF PROCESS, which
is how the Electron front stayed safe — its dialogs are the OS portal. A leaf
pane still may not open one (§2): it raises a signal and App.qml picks.

A file that needs `Quickshell.execDetached` cannot be a QML-tested store (see §2) — put it in a
component, or inject the runner.

## 9. Corrections to the plan, found by reading the handlers

- `mcp:testConnection(id)` takes a **persisted server id**, not a config
  (`src/core/handlers/mcp.ts:48`). A new server must be saved with `mcp:addServer(config)` first,
  then tested by the returned id. Verified live: passing a config returns
  `{success:false, output:"Test failed: MCP server ID must be a positive integer"}`.
