.pragma library

// Routing for FilePreview.qml — a single pure function that decides which
// surface a path lands on, plus the size threshold that gates loading a file
// into a TextArea, plus the CSV parser the table surface relies on.
//
// Why in JS rather than in QML bindings: the routing is testable and
// reproducible here, and a size threshold with reasoning lives next to the
// tests that defend it. QML keeps the lifecycle; JS keeps the decision.
//
// The kinds are the render decisions the QML surface knows how to fulfil:
//   text     -> TextArea + lib/highlight.js, with a save action
//   image    -> Image (data URL coming back from files:readFile)
//   svg      -> Image fed an SVG data URL; QML's QtSvg plugin renders it
//   csv      -> Table with a header row, built by parseCsv() below
//   markdown -> MarkdownBlock.qml (Text.MarkdownText + fenced code)
//   source   -> Monospace view of the bytes + "open externally" + one-line
//               reason. Used when a faithful inline render is NOT possible
//               in QML (HTML, Mermaid, anything else that needs a web
//               engine) but the user should still see the source they
//               clicked on, not a dead-end placeholder.
//   model    -> "3D model — open externally" + button. STL/3MF/PLY have
//               no QML equivalent; we surface the reason instead of faking
//               it.
//   external -> Everything else (binary blobs, .ipynb, unknown types).
//               Same shape as before: size label + open-externally button.

var MAX_TEXT_PREVIEW_BYTES = 512 * 1024   // 512 KiB

// Markdown is intentionally NOT in TEXT_EXTS: the routing rule has markdown
// win over generic text so a `.md` file renders through MarkdownBlock.qml
// (with fenced-code highlighting and GFM tables) rather than as a flat
// TextArea. The decision lives here, not in two separate maps, so adding
// a new text extension cannot silently swallow markdown.
var TEXT_EXTS = {
  txt: 1, log: 1,
  html: 1, htm: 1, xml: 1, css: 1,
  js: 1, jsx: 1, ts: 1, tsx: 1, mjs: 1, cjs: 1,
  json: 1, jsonc: 1,
  py: 1, rb: 1, rs: 1, go: 1, java: 1, kt: 1, swift: 1, c: 1, h: 1,
  cpp: 1, cxx: 1, cc: 1, hpp: 1, hxx: 1,
  sh: 1, bash: 1, zsh: 1,
  yml: 1, yaml: 1, toml: 1, ini: 1, env: 1,
  sql: 1, graphql: 1, gql: 1,
  scad: 1,
  diff: 1, patch: 1,
  vue: 1, svelte: 1, lua: 1, php: 1
}

var MARKDOWN_EXTS = { md: 1, markdown: 1 }

var IMAGE_EXTS = {
  png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1,
  bmp: 1, ico: 1, avif: 1, tiff: 1, tif: 1
}

// SVG is rendered via QML's QtSvg plugin (the Image element on a `data:
// image/svg+xml;base64,...` URL). We do not hand-roll an SVG parser; the
// plugin ships with Qt and is loaded transparently when the source is SVG.
var SVG_EXTS = { svg: 1 }

// CSV/TSV route to the table surface. The parser auto-detects tab vs
// comma on the first non-empty line (a tab in the first row, comma
// otherwise), so the QML pane does not have to pick the dialect.
var CSV_EXTS = { csv: 1, tsv: 1 }

// Mermaid is text but cannot be rendered inline — Qt has no Mermaid
// renderer. The source surface shows it monospace and offers an external
// open in a browser. HTML is in the same boat (no web engine in QML).
var SOURCE_EXTS = { mmd: 1 }

// Binary 3D model formats: no QML 3D viewer. The model surface shows
// the reason and a button.
var MODEL_EXTS = { stl: 1, "3mf": 1, ply: 1, obj: 1, gltf: 1, glb: 1 }

// Pure: returns the lowercase extension of a path, or "" when there is none.
// `foo.tar.gz` -> "gz"; `foo` -> ""; `foo.` -> ""; `.bashrc` -> "" (leading
// dot is a dotfile, not an extension).
function extOf(path) {
  if (!path) return ""
  var s = String(path)
  var slash = s.lastIndexOf("/")
  var base = slash >= 0 ? s.slice(slash + 1) : s
  if (base.length === 0) return ""
  // Dotfiles: ".bashrc" has no extension by this definition, matching the
  // rest of the plugin (and matching the server's classifyFileExt).
  if (base.charAt(0) === "." && base.indexOf(".", 1) < 0) return ""
  var dot = base.lastIndexOf(".")
  if (dot <= 0) return ""
  return base.slice(dot + 1).toLowerCase()
}

// Routing. mimeOrNull is optional — if present, an image/* MIME promotes the
// file to 'image' even when its extension is missing or unknown (driven by
// `xdg-mime` from the host, if we ever wire that up). For now the function
// ignores it for non-images, so a misclassified plain-text-with-image-mime
// does not silently route to <Image/>.
//
// Precedence (each first match wins):
//   1. raster image  -> "image"
//   2. SVG           -> "svg"  (rendered via Qt's SVG image plugin)
//   3. CSV/TSV       -> "csv"  (rendered as an aligned table)
//   4. markdown      -> "markdown"
//   5. 3D model      -> "model" (no inline viewer)
//   6. mermaid       -> "source" (no inline renderer)
//   7. html/htm/xml  -> "source" (no web engine in QML)
//   8. known text    -> "text"
//   9. otherwise     -> "external"
//  10. no path       -> "" (nothing is selected; render no surface at all)
// SVG/HTML are real text and stay in TEXT_EXTS, but they win their slot
// first so they do not get syntax-highlighted as plain code.
function kindFor(path, mimeOrNull) {
  // An empty path is not "a file of unknown type", it is NO file. Falling
  // through to "external" made the preview pane draw its whole catch-all
  // chrome — "No inline preview for this file type.", "Path: ", and an
  // "Open externally" button — beside the pane's own "Pick a file in the
  // tree to preview it." empty state, with nothing selected.
  if (!path) return ""
  var ext = extOf(path)
  if (IMAGE_EXTS[ext] === 1) return "image"
  if (SVG_EXTS[ext] === 1) return "svg"
  if (CSV_EXTS[ext] === 1) return "csv"
  if (MARKDOWN_EXTS[ext] === 1) return "markdown"
  if (MODEL_EXTS[ext] === 1) return "model"
  if (SOURCE_EXTS[ext] === 1) return "source"
  // HTML/XML are real text but Quickshell has no web engine. Route to the
  // source surface so the user sees the bytes + a one-line reason + an
  // open-externally action. CSS and SVG/CSV are no longer in TEXT_EXTS,
  // so they cannot reach this branch.
  if (ext === "html" || ext === "htm" || ext === "xml") return "source"
  if (TEXT_EXTS[ext] === 1) return "text"
  // MIME-driven fallback for files without a known extension. Only the
  // two image kinds and text/markdown are recognised — anything else
  // falls through to 'external', so an unknown application/octet-stream
  // MIME on a `.bin` file does not silently route to text or image.
  if (mimeOrNull && typeof mimeOrNull === "string") {
    var m = String(mimeOrNull).toLowerCase()
    if (m.indexOf("image/") === 0) return "image"
    if (m === "text/markdown") return "markdown"
  }
  return "external"
}

// ---- CSV surface ---------------------------------------------------------
//
// A 100k-row CSV must not lock the UI, so the parser materialises a
// bounded slice and reports how much it skipped. The QML side renders
// the slice in a header + table and shows a one-line "Showing first N of
// M rows / K columns" notice whenever the slice is truncated.
//
// Edge cases the parser explicitly handles:
//   - Quoted fields containing commas: `"a,b",c` -> `["a,b", "c"]`.
//   - Embedded double-quotes (RFC 4180): `"he said ""hi"""` -> `he said "hi"`.
//   - CRLF, LF, and CR line endings all split rows.
//   - Ragged rows: shorter rows are right-padded with ""; longer rows
//     are clamped to the header width (so an exploded row does not blow
//     up the table layout).
//   - Empty input returns zero rows and zero columns — the QML side
//     shows an "empty file" hint instead of a 1-cell placeholder.
//   - Empty lines inside the body are skipped (a final newline produces
//     no extra blank row).
//
// Dialect auto-detect: if the first non-empty line contains a tab, we
// treat the file as TSV; otherwise comma. Quoted fields can still wrap
// the delimiter without splitting (e.g. `"a,b"\tc\td`).

// Materialisation caps. These are independent of the server's 10 MiB
// preview cap: a 200 KiB CSV with 50k rows still has to be bounded, or
// the QML table instantiates a column-repeater per row and the panel
// crawls. The numbers are picked to keep the table responsive while
// showing the "head" of the data; the notice tells the user.
var MAX_CSV_ROWS = 200
var MAX_CSV_COLS = 32

// Dialect detection on a single physical line. Returns true if the line
// contains a tab OUTSIDE a quoted field — i.e. the file is TSV-shaped.
// A line with no commas or tabs is a "neither" header row and the
// caller falls back to comma (the RFC 4180 default).
function _looksLikeTsv(line) {
  var inQ = false
  for (var i = 0; i < line.length; i++) {
    var ch = line.charAt(i)
    if (ch === '"') inQ = !inQ
    else if (!inQ && ch === "\t") return true
  }
  return false
}

// State machine for one physical line:
//   OUTSIDE   - between fields, accumulating text. A `"` here either
//               opens a quoted field (only at the start of a field) or
//               is a literal (lenient: a stray quote after text).
//   INSIDE    - inside a quoted field. Every `"` is either part of an
//               `""` escape (consume both, emit one `"`) or the closing
//               quote (transition back to OUTSIDE without consuming any
//               text).
// The `cur.length === 0` invariant at OUTSIDE distinguishes "field
// start" (a `"` opens a quoted field) from "mid-field" (a `"` is a
// literal). This is the lenient path Excel/Sheets take; strict RFC
// 4180 would reject the mid-field quote, but no real tool does.
function _parseCsvLine(line, dialect) {
  var out = []
  var cur = ""
  var inQ = false
  var i = 0
  while (i < line.length) {
    var ch = line.charAt(i)
    if (inQ) {
      if (ch === '"') {
        if (i + 1 < line.length && line.charAt(i + 1) === '"') {
          // `""` inside a quoted field is an escape for a single `"`.
          // This rule applies regardless of position: the first `""` at
          // the start of a quoted field is the escape for the field's
          // leading literal quote (the canonical way to put a `"` at
          // the start of a field), not a premature closing pair.
          cur += '"'
          i += 2
          continue
        }
        inQ = false
        i++
        continue
      }
      cur += ch
      i++
      continue
    }
    if (ch === '"') {
      // Field start (cur.length === 0): a `"` opens a quoted field.
      // We do NOT need a special "leading escape" branch: the inQ=true
      // branch above already handles `""` as an escape (consume both,
      // emit one `"`, stay inQ). The sequence at field start is: open
      // quote (inQ=true), next iteration sees `"` while inQ=true, the
      // escape rule fires. This is what makes `"""a"""` correctly
      // parse to the field value `"a"`.
      if (cur.length === 0) {
        inQ = true
        i++
        continue
      }
      // Mid-field quote (lenient path: a stray `"` after text becomes
      // a literal, matching Excel/Sheets; strict RFC 4180 would reject
      // this input).
      cur += ch
      i++
      continue
    }
    if (ch === dialect) {
      out.push(cur)
      cur = ""
      i++
      continue
    }
    cur += ch
    i++
  }
  out.push(cur)
  return out
}

// Normalise row length: pad short rows to `width` with "" and clamp
// long rows. We clamp rather than expand so an exploded row does not
// widen every other row's layout.
function _fitRow(row, width) {
  if (row.length === width) return row
  if (row.length > width) return row.slice(0, width)
  var padded = []
  for (var i = 0; i < row.length; i++) padded.push(row[i])
  for (var j = row.length; j < width; j++) padded.push("")
  return padded
}

// Public: parse a CSV/TSV string into a structured slice. Pure.
//   text   - the file contents (utf-8, may include \r, \n, \r\n, or all)
//   opts   - optional { maxRows, maxCols, forceDialect: "," | "\t" | null }
//            - maxRows defaults to MAX_CSV_ROWS; maxCols to MAX_CSV_COLS.
//            - forceDialect: null (default) auto-detects from the header
//              line; "csv" forces comma; "tsv" forces tab.
// Returns:
//   { headers: string[], rows: string[][], totalRows: number, totalCols: number,
//     truncatedRows: bool, truncatedCols: bool, dialect: "," | "\t" }
function parseCsv(text, opts) {
  var s = (text === null || text === undefined) ? "" : String(text)
  var maxRows = MAX_CSV_ROWS
  var maxCols = MAX_CSV_COLS
  var forceDialect = null
  if (opts && typeof opts === "object") {
    if (opts.maxRows && opts.maxRows > 0) maxRows = Math.floor(opts.maxRows)
    if (opts.maxCols && opts.maxCols > 0) maxCols = Math.floor(opts.maxCols)
    if (opts.forceDialect === "," || opts.forceDialect === "\t") {
      forceDialect = opts.forceDialect
    }
  }

  if (s.length === 0) {
    return {
      headers: [],
      rows: [],
      totalRows: 0,
      totalCols: 0,
      truncatedRows: false,
      truncatedCols: false,
      dialect: ","
    }
  }
  // Split on any of \r\n, \n, \r. We do this in two passes: a scan that
  // respects quoted fields (so a newline inside `"a\nb"` does not split
  // the row) and the actual split. The scan also picks the dialect.
  var dialect = ","
  if (forceDialect === "\t") {
    dialect = "\t"
  } else if (forceDialect === ",") {
    dialect = ","
  } else {
    // Auto-detect on the first non-empty physical line. We have to
    // do a quoting-aware scan just for the header, so a header like
    // `"a,b"\tc,d` is correctly seen as TSV — the tab is inside quotes
    // in the CSV dialect, and we need to read past it.
    var scanInQ = false
    var header = ""
    var foundHeader = false
    for (var si = 0; si < s.length; si++) {
      var sch = s.charAt(si)
      if (scanInQ) {
        if (sch === '"') {
          if (si + 1 < s.length && s.charAt(si + 1) === '"') { header += '"'; si++; continue }
          scanInQ = !scanInQ
        }
        header += sch
        continue
      }
      if (sch === '"') { scanInQ = true; header += sch; continue }
      if (sch === "\n" || sch === "\r") {
        if (!foundHeader) {
          // Skip leading blank lines.
          if (header.length === 0) continue
          foundHeader = true
          dialect = _looksLikeTsv(header) ? "\t" : ","
          break
        }
      }
      header += sch
    }
    if (!foundHeader) {
      // File has no newlines at all (single line). Decide on that line.
      if (header.length > 0) dialect = _looksLikeTsv(header) ? "\t" : ","
    }
  }

  // Now split into physical lines, respecting quoted newlines. The
  // splitter is intentionally dumb: it copies characters verbatim into
  // the current line, ONLY using the quote state to decide whether a
  // newline is a row separator or part of a quoted field. The actual
  // field split (and `""` escape decoding) is _parseCsvLine's job.
  //
  // The quote state machine matches _parseCsvLine's so a `""` escape
  // never flips inQ back to false. Without this, a field whose content
  // starts with `""` (e.g. the canonical "a field containing a literal
  // quote at the start") would have the splitter close the field at
  // the second `"` and the line parser would see a different shape.
  var lines = []
  var cur = ""
  var inQ = false
  for (var li = 0; li < s.length; li++) {
    var ch2 = s.charAt(li)
    if (inQ) {
      if (ch2 === '"') {
        // `""` is an escape (stay inQ, copy both chars); a lone `"`
        // closes the field (inQ=false, copy the `"`).
        if (li + 1 < s.length && s.charAt(li + 1) === '"') {
          cur += '""'
          li++
          continue
        }
        inQ = false
        cur += ch2
        continue
      }
      cur += ch2
      continue
    }
    if (ch2 === '"') {
      inQ = true
      cur += ch2
      continue
    }
    if (ch2 === "\n" || ch2 === "\r") {
      // CRLF: eat the \n after a \r so the row stays clean.
      if (ch2 === "\r" && li + 1 < s.length && s.charAt(li + 1) === "\n") {
        li++
      }
      lines.push(cur)
      cur = ""
      continue
    }
    cur += ch2
  }
  if (cur.length > 0 || lines.length > 0) lines.push(cur)

  // Drop leading blank lines.
  while (lines.length > 0 && lines[0].length === 0) lines.shift()

  if (lines.length === 0) {
    return {
      headers: [],
      rows: [],
      totalRows: 0,
      totalCols: 0,
      truncatedRows: false,
      truncatedCols: false,
      dialect: dialect
    }
  }

  // First non-blank line is the header.
  var rawHeaders = _parseCsvLine(lines[0], dialect)
  var dataLines = lines.slice(1)
  // Trailing blank lines (a final newline) do not become blank rows.
  while (dataLines.length > 0 && dataLines[dataLines.length - 1].length === 0) {
    dataLines.pop()
  }

  // We cap columns at maxCols INCLUDING the header. If the header is
  // wider than maxCols, the headers slice is truncated AND the data
  // rows are clamped. A file with 50 columns and a 32-cap produces 32
  // columns and a "showing first 32 of 50 columns" notice.
  var totalCols = rawHeaders.length
  var colWidth = Math.min(totalCols, maxCols)
  var headers = _fitRow(rawHeaders, colWidth)

  // Materialise data rows. totalRows reflects the *file's* row count
  // (excluding the header), so the notice can show "first N of M rows".
  var totalRows = dataLines.length
  var visibleRows = Math.min(totalRows, maxRows)
  var rows = []
  for (var ri = 0; ri < visibleRows; ri++) {
    var parsed = _parseCsvLine(dataLines[ri], dialect)
    rows.push(_fitRow(parsed, colWidth))
  }

  return {
    headers: headers,
    rows: rows,
    totalRows: totalRows,
    totalCols: totalCols,
    truncatedRows: totalRows > maxRows,
    truncatedCols: totalCols > maxCols,
    dialect: dialect
  }
}

// ---- data URL helpers (used by the QML side) -----------------------------
//
// The server's files:readFile returns the raw utf-8 string for text files
// (including SVG, CSV, HTML, MMD). The QML `Image` element wants a data
// URL with the right MIME, so we build one here. The QML side cannot
// construct a Uint8Array, so we use Buffer equivalents via TextEncoder-
// compatible btoa: in a QML JS resource, "btoa" is a JS engine builtin on
// Qt 6.4+. We fall back to a per-char code path if absent.
//
// Note: "btoa" exists in V4 (QML's JS engine) since Qt 5.13; if it ever
// stops, replace with a hand-rolled base64. Tested on this machine.

function _btoa(s) {
  if (typeof btoa === "function") {
    try { return btoa(s) } catch (e) { /* fall through */ }
  }
  // Hand-rolled base64 (RFC 4648) — slow but always available. Only hit
  // when btoa is missing; tests for SVG/CSS never reach this branch.
  var A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  var out = ""
  for (var i = 0; i < s.length; i += 3) {
    var b1 = s.charCodeAt(i) & 0xff
    var b2 = (i + 1 < s.length) ? (s.charCodeAt(i + 1) & 0xff) : NaN
    var b3 = (i + 2 < s.length) ? (s.charCodeAt(i + 2) & 0xff) : NaN
    out += A.charAt(b1 >> 2)
    out += A.charAt(((b1 & 0x3) << 4) | ((isNaN(b2) ? 0 : b2) >> 4))
    out += isNaN(b2) ? "=" : A.charAt(((b2 & 0xf) << 2) | ((isNaN(b3) ? 0 : b3) >> 6))
    out += isNaN(b3) ? "=" : A.charAt(b3 & 0x3f)
  }
  return out
}

// Build the data URL the QML Image element wants. mime is the SVG/PNG/etc
// content type. Encoding: utf-8, base64. SVG data must be base64-encoded
// in the data URL or Qt's image loader rejects it (QtSvg's loader is
// strict about the data: prefix format).
function svgDataUrl(svgText) {
  var s = (svgText === null || svgText === undefined) ? "" : String(svgText)
  return "data:image/svg+xml;base64," + _btoa(s)
}

// ---- reason helpers (used by the source / model / external surfaces) ----
//
// The user sees ONE short line explaining why the file is not rendered
// inline. A reader should not have to infer the reason from the surface
// shape. Kept here so the QML binding is a single function call.
function reasonFor(path) {
  var ext = extOf(path)
  if (ext === "html" || ext === "htm") {
    return "Inline HTML needs a web engine. Open externally to view in a browser."
  }
  if (ext === "xml") {
    return "Inline XML rendering is not available. Open externally for a tree view."
  }
  if (ext === "mmd") {
    return "Mermaid diagrams need a web engine. Open externally to view in a browser."
  }
  if (MODEL_EXTS[ext] === 1) {
    return "3D models cannot be rendered in the shell. Open externally to view."
  }
  if (ext === "ipynb") {
    // Actionable, not internal roadmap jargon: the Notebook rail tab is a
    // real surface the user can reach right now, and it renders cells and
    // outputs properly. Pointing at it beats naming a phase number.
    return "Open this in the Notebook tab to run cells and see outputs."
  }
  return "No inline preview for this file type."
}

// Size guard. A TextArea holding hundreds of KiB of source text still
// scrolls fine; a megabyte of text starts to chew the offscreen QML test
// harness AND the live compositor at the same time. 512 KiB matches the
// renderer's effective cap on what it tries to syntax-colour before
// bailing — above that, we route to 'external' and show the size.
function tooLargeForText(bytes) {
  if (bytes === null || bytes === undefined) return false
  var n = Number(bytes)
  if (!isFinite(n) || n < 0) return false
  return n > MAX_TEXT_PREVIEW_BYTES
}

// Composed: when a text file is over the cap, downgrade to external so the
// caller only has to ask once. sizeOrNull is the byte count from
// files:readFile's stat (the handler reads `stat.size` before reading
// contents) — or null when the size is unknown.
function kindForTextAware(path, sizeOrNull) {
  if (kindFor(path, null) !== "text") return kindFor(path, null)
  if (tooLargeForText(sizeOrNull)) return "external"
  return "text"
}

// Human-readable size label for the 'external' fallback.
function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return "unknown size"
  var n = Number(bytes)
  if (!isFinite(n) || n < 0) return "unknown size"
  if (n < 1024) return n + " B"
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KiB"
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MiB"
  return (n / 1024 / 1024 / 1024).toFixed(1) + " GiB"
}
