pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import qs.Commons
import qs.Ui

import "../lib/filePreview.js" as FP
import "../lib/highlight.js" as HL
import "../lib/palette.js" as Palette

// The right-hand side of FilesPane.qml: a preview of the file the user
// clicked in FileTree.qml.
//
// Routing lives in lib/filePreview.js (`kindFor` / `kindForTextAware`) so
// the decision is node-testable. This file owns the seven surfaces:
//   text     -> TextArea coloured with lib/highlight.js, save action
//   image    -> Image with the data URL from files:readFile
//   svg      -> Image fed an SVG data URL; QML's QtSvg plugin renders it
//               natively, fitted to the pane with no upscaling beyond 1:1
//   csv      -> Table built by lib/filePreview.parseCsv, with a header
//               row and a "Showing first N of M" notice when the file
//               exceeds the parser's row/column caps (200 / 32)
//   markdown -> MarkdownBlock.qml (Phase 2)
//   source   -> Monospace view of the bytes + a working "Open externally"
//               button + a one-line reason. Used for HTML, Mermaid, and
//               anything that needs a web engine QML does not have.
//   model    -> "3D model — open externally" affordance. STL/3MF/PLY
//               have no QML equivalent; the surface states the reason
//               rather than faking a render.
//   external -> Catch-all: size/mime label + "open externally" button.
//               Catches binary blobs (.ipynb, .bin, ...).
Item {
  id: root

  required property var store
  // Optional path to display. When set, the preview pane reads it on
  // load. The page typically sets this from a FileTree `nodeActivated`
  // signal — the pane then asks the store to fetch.
  property string path: ""

  // Re-derive the kind whenever path changes. The byte size is unknown
  // (no stable channel for it), so kindForTextAware falls back to its
  // "no size -> always allow text" branch. The server's 10 MiB hard cap
  // in files:readFile (src/core/handlers/files.ts:18) is the backstop.
  readonly property string kind: FP.kindForTextAware(root.path, root.store && root.store.activeReadSize && root.store.activeReadSize())

  // The server classifies by extension and emits a language code
  // ("javascript", "python", "json", "markdown", "image", "model", etc.).
  // For the highlighter we want the lib/highlight.js keys ("js", "ts",
  // "py", "json", "bash", "diff"); for everything else we fall through to
  // plain text.
  readonly property string highlightLang: {
    if (!root.store || !root.store.activeRead) return ""
    // `activeRead()` returns NULL when nothing is selected — the guard above
    // only proves the FUNCTION exists, not that it returned a row. Reading
    // `.language` off the null threw on every Files-pane visit with no file
    // picked, which is the pane's normal starting state.
    var read = root.store.activeRead()
    if (!read) return ""
    var lang = read.language
    if (!lang) return ""
    var l = String(lang).toLowerCase()
    // The server uses "javascript" / "typescript" / "shell"; the lib
    // aliases accept those. Anything else passes through unchanged.
    return l
  }

  // ---- content shaping -------------------------------------------------

  // The text content the TextArea and the highlighter see. Files:readFile
  // returns utf-8 content for text-like files; the data-URL prefix on
  // images and base64 on models are not text and are routed to the image
  // / external surfaces before this binding is read.
  readonly property string textContent: {
    if (!root.store || !root.store.activeRead) return ""
    var r = root.store.activeRead()
    return r && r.content ? String(r.content) : ""
  }

  // Per-class colours for the highlighter. Derived from the active theme
  // accent by hue rotation in lib/palette.js, so a file preview belongs to
  // whatever theme is currently active. Both this file and CodeBlock.qml
  // share the one derivation rather than each carrying a copy.
  readonly property var _colors: Palette.syntaxColors(
    String(Color.accent), String(Color.urgent), String(Color.muted),
    String(Color.foreground), Style.font.family)

  // ---- derived content for the new surfaces -----------------------------
  //
  // SVG: QML's Image element loads a `data:image/svg+xml;base64,...` URL
  // via Qt's SVG image plugin. The plugin refuses unencoded SVG (the
  // data: prefix is strict), so we base64-encode the raw utf-8 bytes
  // the server returned. The data URL is built by lib/filePreview.js
  // so the encoding is unit-tested.
  readonly property string svgUrl: FP.svgDataUrl(root.textContent || "")

  // CSV: parsed into { headers, rows, totalRows, totalCols, truncatedRows,
  // truncatedCols, dialect } by lib/filePreview.js. The QML side feeds
  // the result into a header row + a Repeater over rows; the notice
  // appears whenever the parser truncated the file.
  readonly property var csv: {
    if (root.kind !== "csv") return ({ headers: [], rows: [], totalRows: 0, totalCols: 0, truncatedRows: false, truncatedCols: false, dialect: "," })
    return FP.parseCsv(root.textContent || "")
  }

  // One short line explaining why a non-rendered file is not rendered.
  // The source / model / external surfaces show this verbatim.
  readonly property string reason: FP.reasonFor(root.path || "")

  function _richText() {
    return HL.toRichText(root.textContent || "", root.highlightLang || "", root._colors)
  }

// ---- local-command helpers (CONTRACTS.md §8) -----------------------

  // The pane never imports Quickshell.execDetached outside click handlers
  // — the components emit signals, Main wires them. But this file is a
  // component, and CONTRACTS.md §2 says only stores must stay free of
  // Quickshell imports. A component can shell out directly, which keeps
  // the wiring single-purpose.
  function openExternally() {
    if (!root.path) return
    Quickshell.execDetached(["xdg-open", root.path])
  }

  // ---- save action (text surface only) -------------------------------

  // The TextArea's text and a hidden copy used by the save action.
  property string _draft: ""
  property bool _dirty: false

  // When the path changes, reset the draft to the freshly-read content.
  onPathChanged: {
    root._draft = root.textContent
    root._dirty = false
  }
  onTextContentChanged: {
    if (!root._dirty) root._draft = root.textContent
  }

  function saveDraft() {
    if (!root.path) return
    if (!root.store || typeof root.store.write !== "function") return
    root.store.write(root.path, root._draft, function() {
      root._dirty = false
    }, function(err) {
      // Surface the error in the pane; the store also records it.
      root.error_ = String(err)
    })
  }

  property string error_: ""

  // ---- layout ---------------------------------------------------------

  // A parent that mounts this with width only (a Column row, a ListView
  // delegate, a Loader) adopts the item's implicitHeight. Without it the root
  // Item is zero-high and the whole body is invisible — which is how assistant
  // messages vanished from the transcript while the store held them. Ignored
  // when a parent sets an explicit height, so it is safe everywhere.
  implicitHeight: bodyRoot.implicitHeight

  ColumnLayout {
    id: bodyRoot
    anchors.fill: parent
    spacing: Style.spacing.md

    // Header: path + (when applicable) Save button.
    RowLayout {
      Layout.fillWidth: true
      Layout.margins: Style.spacing.md
      spacing: Style.spacing.sm

      Text {
        Layout.fillWidth: true
        text: root.path ? String(root.path) : "Select a file"
        color: Color.foreground
        opacity: root.path ? 0.9 : 0.5
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        elide: Text.ElideMiddle
      }

      // Save button: only meaningful in the text surface, and only when
      // there are unsaved edits.
      Button {
        visible: root.kind === "text" && root._dirty
        text: "Save"
        onClicked: root.saveDraft()
      }
    }

    PanelSeparator {
      Layout.fillWidth: true
    }

    // Empty state.
    Text {
      Layout.fillWidth: true
      Layout.fillHeight: true
      visible: !root.path
      text: "Pick a file in the tree to preview it."
      color: Color.foreground
      opacity: 0.5
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
      horizontalAlignment: Text.AlignHCenter
      verticalAlignment: Text.AlignVCenter
    }

    // Text surface.
    ScrollView {
      Layout.fillWidth: true
      Layout.fillHeight: true
      visible: root.kind === "text"
      clip: true

      Column {
        width: parent.width
        spacing: 0

        // Highlighted read-only header. The TextArea below is for edits;
        // Wrap the read-only rendered text in an Item so padding works
        // without `textMargin` (Text doesn't expose that property; it's
        // only on TextEdit/TextArea). leftPadding/rightPadding is the
        // idiomatic Qt 6 fix.
        Text {
          width: parent.width - 2 * Style.spacing.sm
          x: Style.spacing.sm
          textFormat: Text.RichText
          text: root._richText()
          wrapMode: Text.Wrap
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
          leftPadding: 0
          rightPadding: 0
        }
      }
    }

    // Editable draft surface. Hidden when the path isn't loaded yet —
    // avoids an empty TextArea appearing before files:readFile answers.
    Column {
      Layout.fillWidth: true
      Layout.fillHeight: true
      visible: root.kind === "text" && root.textContent.length > 0
      spacing: 0

      PanelSeparator {
        width: parent.width
      }
      Text {
        width: parent.width - 2 * Style.spacing.sm
        x: Style.spacing.sm
        text: root._dirty ? "Editing (unsaved)" : "Edit draft"
        color: Color.muted
        opacity: 0.7
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
      }

      ScrollView {
        width: parent.width
        height: Math.max(Style.spacing.controlHeight * 8, parent.height * 0.5)
        clip: true

        TextArea {
          width: parent.width
          text: root._draft
          wrapMode: TextEdit.Wrap
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
          color: Color.foreground
          selectByMouse: true
          onTextChanged: {
            if (text !== root._draft) {
              root._draft = text
              root._dirty = (text !== root.textContent)
            }
          }
        }
      }
    }

    // Image surface.
    Item {
      Layout.fillWidth: true
      Layout.fillHeight: true
      visible: root.kind === "image"
      clip: true

      Image {
        anchors.centerIn: parent
        width: Math.min(parent.width, sourceSize.width)
        height: Math.min(parent.height, sourceSize.height)
        fillMode: Image.PreserveAspectFit
        source: root.textContent
        asynchronous: false
        cache: true
      }
    }

    // SVG surface. QML's Image element with the QtSvg image plugin
    // renders SVG natively when given a `data:image/svg+xml;base64,...`
    // URL (built by FP.svgDataUrl). We cap the rendered size to the
    // source's intrinsic size so a small SVG never upscales into a
    // blurry mess, and we fit the rest of the available space. The
    // image never auto-loads (asynchronous: false) — a broken SVG
    // would otherwise show empty pixels for hundreds of ms.
    Item {
      Layout.fillWidth: true
      Layout.fillHeight: true
      visible: root.kind === "svg"
      clip: true

      Image {
        anchors.centerIn: parent
        width: Math.min(parent.width, sourceSize.width)
        height: Math.min(parent.height, sourceSize.height)
        fillMode: Image.PreserveAspectFit
        source: root.svgUrl
        asynchronous: false
        cache: true
      }
    }

    // CSV surface. A header row + a Repeater over the parsed rows, in
    // a ScrollView. The visible slice is bounded by the parser's caps
    // (200 rows / 32 columns); when the file exceeds either cap, a
    // one-line "Showing first N of M" notice appears so the user
    // knows the table is not the whole file. An empty file renders an
    // "empty" hint instead of a 1-cell placeholder.
    Item {
      Layout.fillWidth: true
      Layout.fillHeight: true
      visible: root.kind === "csv"
      clip: true

      ColumnLayout {
        anchors.fill: parent
        spacing: Style.spacing.sm

        // Truncation notice — only when the parser materialised a
        // strict subset of the file. We state the cap, not just the
        // count, so the user knows whether to open externally.
        Text {
          Layout.fillWidth: true
          Layout.leftMargin: Style.spacing.sm
          Layout.rightMargin: Style.spacing.sm
          visible: root.csv && (root.csv.truncatedRows || root.csv.truncatedCols)
          text: {
            if (!root.csv) return ""
            var parts = []
            if (root.csv.truncatedRows) {
              parts.push("showing first " + root.csv.rows.length + " of " + root.csv.totalRows + " rows")
            }
            if (root.csv.truncatedCols) {
              parts.push("first " + root.csv.headers.length + " of " + root.csv.totalCols + " columns")
            }
            return "Truncated: " + parts.join(", ") + "."
          }
          color: Color.muted
          opacity: 0.85
          font.family: Style.font.family
          font.pixelSize: Style.font.caption
          wrapMode: Text.Wrap
        }

        // Empty-file hint.
        Text {
          Layout.fillWidth: true
          Layout.fillHeight: true
          visible: root.csv && root.csv.headers.length === 0
          text: "Empty CSV."
          color: Color.muted
          opacity: 0.6
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
          horizontalAlignment: Text.AlignHCenter
          verticalAlignment: Text.AlignVCenter
        }

        // The table. Header row is a RowLayout so cells line up; data
        // rows are a Repeater of identical RowLayouts, with one cell
        // per column. The header repeats visually but we do not pin
        // it (the file is small enough that a single scroll is fine).
        ScrollView {
          Layout.fillWidth: true
          Layout.fillHeight: true
          visible: root.csv && root.csv.headers.length > 0
          clip: true

          Column {
            width: parent.width
            spacing: 0

            // Header row. Same column count as the data, so cell
            // widths match.
            Row {
              width: parent.width
              spacing: Style.spacing.sm

              Repeater {
                model: root.csv ? root.csv.headers : []
                delegate: Rectangle {
                  required property var modelData
                  // Bind to a named property so child Text can read it
                  // without triggering qmllint's "Unqualified access"
                  // warning for modelData.
                  readonly property string cell: String(modelData || "")
                  width: parent.width / Math.max(1, (root.csv ? root.csv.headers.length : 1))
                  height: Style.spacing.controlHeight
                  color: "transparent"
                  border.color: Color.muted
                  border.width: 1
                  Text {
                    anchors.fill: parent
                    anchors.margins: Style.spacing.xs
                    text: parent.cell
                    color: Color.foreground
                    font.family: Style.font.family
                    font.pixelSize: Style.font.bodySmall
                    font.bold: true
                    elide: Text.ElideRight
                    verticalAlignment: Text.AlignVCenter
                  }
                }
              }
            }

            // Data rows. One Row per parsed row; each cell is a
            // rectangle with the cell value, elided on the right.
            Repeater {
              model: root.csv ? root.csv.rows : []
              delegate: Row {
                id: dataRow
                required property var modelData
                width: parent.width
                spacing: Style.spacing.sm

                Repeater {
                  model: dataRow.modelData
                  delegate: Rectangle {
                    required property var modelData
                    // Bind to a named property to avoid qmllint's
                    // "Unqualified access" warning.
                    readonly property string cell: String(modelData || "")
                    width: parent.parent.width / Math.max(1, (root.csv ? root.csv.headers.length : 1))
                    height: Style.spacing.controlHeight
                    color: "transparent"
                    border.color: Color.muted
                    border.width: 1
                    Text {
                      anchors.fill: parent
                      anchors.margins: Style.spacing.xs
                      text: parent.cell
                      color: Color.foreground
                      font.family: Style.font.family
                      font.pixelSize: Style.font.bodySmall
                      elide: Text.ElideRight
                      verticalAlignment: Text.AlignVCenter
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // Source surface. HTML, Mermaid, XML — anything that needs a web
    // engine the shell does not have. We show the bytes in monospace
    // (NOT highlighted — these are not code) and offer the working
    // "open externally" button. The reason line names the missing
    // engine so the user is not left wondering why the source is
    // shown raw.
    ColumnLayout {
      Layout.fillWidth: true
      visible: root.kind === "source"
      spacing: Style.spacing.md

      // One-line reason, then the source. Reading order matches what
      // the user came for: "why is this not rendered" first, then the
      // source they clicked on.
      Text {
        Layout.fillWidth: true
        Layout.leftMargin: Style.spacing.sm
        Layout.rightMargin: Style.spacing.sm
        text: root.reason
        color: Color.muted
        opacity: 0.9
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        wrapMode: Text.Wrap
      }

      ScrollView {
        Layout.fillWidth: true
        Layout.fillHeight: true
        clip: true
        TextArea {
          readOnly: true
          text: root.textContent
          wrapMode: TextEdit.NoWrap
          font.family: "monospace"
          font.pixelSize: Style.font.bodySmall
          color: Color.foreground
          selectByMouse: true
        }
      }

      RowLayout {
        Layout.fillWidth: true
        spacing: Style.spacing.md
        Button {
          text: "Open externally"
          onClicked: root.openExternally()
        }
      }
    }

    // 3D model surface. STL/3MF/PLY have no QML 3D viewer. The reason
    // names the missing capability; the button is the affordance.
    ColumnLayout {
      Layout.fillWidth: true
      visible: root.kind === "model"
      spacing: Style.spacing.md

      Text {
        Layout.fillWidth: true
        text: root.reason
        color: Color.foreground
        opacity: 0.7
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        wrapMode: Text.Wrap
      }

      Text {
        Layout.fillWidth: true
        text: "Path: " + (root.path || "")
        color: Color.muted
        opacity: 0.7
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
        wrapMode: Text.WrapAnywhere
      }

      Button {
        text: "Open externally"
        onClicked: root.openExternally()
      }
    }

    // External surface. Catch-all for binary blobs (.ipynb, .bin, ...)
    // the user might click on. Sized to one row so a long file list
    // doesn't push the affordance off-screen.
    ColumnLayout {
      Layout.fillWidth: true
      visible: root.kind === "external"
      spacing: Style.spacing.md

      Text {
        Layout.fillWidth: true
        text: root.reason || "No inline preview for this file type."
        color: Color.foreground
        opacity: 0.7
        font.family: Style.font.family
        font.pixelSize: Style.font.bodySmall
        wrapMode: Text.Wrap
      }

      Text {
        Layout.fillWidth: true
        text: "Path: " + (root.path || "")
        color: Color.muted
        opacity: 0.7
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
        wrapMode: Text.WrapAnywhere
      }

      // Sizing: the server doesn't expose a stable size channel, so we
      // show the language code it returned, when present.
      Text {
        Layout.fillWidth: true
        text: {
          var r = root.store && root.store.activeRead && root.store.activeRead()
          if (!r) return ""
          if (r.language === "model") return "Binary 3D model — open externally to view."
          if (r.language === "image") return "Image."
          return "Language: " + String(r.language || "unknown")
        }
        color: Color.muted
        opacity: 0.7
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
      }

      RowLayout {
        Layout.fillWidth: true
        spacing: Style.spacing.md
        Button {
          text: "Open externally"
          onClicked: root.openExternally()
        }
      }
    }

    // Footer error line.
    Text {
      Layout.fillWidth: true
      visible: root.error_.length > 0
      text: "Error: " + root.error_
      color: Color.urgent
      font.family: Style.font.family
      font.pixelSize: Style.font.caption
      wrapMode: Text.Wrap
    }
  }
}
