// Tripwire for lib/filePreview.js:parseCsv.
//
// The QML CSV surface hands every parser error to the user as a wrong
// table, so the test defends the five edge cases the assignment called
// out, plus the truncation notice logic and the dialect auto-detect.
//
// Test loading goes through the same vm-based harness the rest of the
// suite uses (tests/load.js), so the parser under test is the exact
// bytes the shell loads, not a parallel copy. The vm realm's Array
// prototype is NOT the host's, so array comparisons go through the
// load.js `deepEqual` helper (JSON round-trip) rather than node's
// assert.deepStrictEqual, which would falsely fail on prototype
// mismatch. Primitive scalars stay on assert.strictEqual.
const assert = require('assert')
const { load, deepEqual } = require('./load')
const eq = deepEqual

const FP = load('lib/filePreview.js')

// ---- empty file ----------------------------------------------------------
// An empty input is the most-misrendered case in editors: the parser
// must not produce a 1-row / 1-column placeholder that the QML side
// would then try to draw as a single cell.
{
  const r = FP.parseCsv('')
  assert.strictEqual(r.headers.length, 0, 'empty -> no headers')
  assert.strictEqual(r.rows.length, 0, 'empty -> no rows')
  assert.strictEqual(r.totalRows, 0, 'empty -> totalRows 0')
  assert.strictEqual(r.totalCols, 0, 'empty -> totalCols 0')
  assert.strictEqual(r.truncatedRows, false, 'empty -> not truncated')
  assert.strictEqual(r.truncatedCols, false, 'empty -> not truncated')
}

// Whitespace-only is also empty for our purposes: a CSV with only
// newlines has no header and no data rows.
{
  const r = FP.parseCsv('\n\n\n')
  assert.strictEqual(r.headers.length, 0, 'only newlines -> no headers')
  assert.strictEqual(r.rows.length, 0, 'only newlines -> no rows')
}

// null / undefined coerce to empty input — the QML binding guards
// against missing textContent, but a defensive parser handles it.
eq(FP.parseCsv(null).headers, [], 'null -> empty')
eq(FP.parseCsv(undefined).headers, [], 'undefined -> empty')

// ---- quoted fields with embedded commas ----------------------------------
// The whole reason the parser has to track quotes: a comma inside
// `"a,b"` is part of the field, not a column separator.
{
  const r = FP.parseCsv('name,note\n"a,b",c')
  eq(r.headers, ['name', 'note'], 'header split')
  assert.strictEqual(r.rows.length, 1, 'one data row')
  eq(r.rows[0], ['a,b', 'c'], 'embedded comma stays inside the quoted field')
}

// ---- embedded double-quotes (RFC 4180) -----------------------------------
// `""` inside a quoted field decodes to a single `"`. The test covers
// the canonical shape and the multi-escape case (two escaped quotes
// in a single field).
{
  const r = FP.parseCsv('msg\n"he said ""hi"""')
  eq(r.rows[0], ['he said "hi"'], 'doubled "" inside a quoted field collapses to a single "')
}

{
  // Multiple escaped quotes in separate fields, RFC 4180 valid form.
  // The source for a field whose content is `"x"` is exactly 7 chars:
  // open + "" (escape) + x + "" (escape) + close. A 6-char form
  // (`""x"""`) is invalid RFC; the parser is allowed to either reject
  // or lenient-parse it. We test the canonical form here. The header
  // has 2 cells so the data row is not clamped to one column.
  const r = FP.parseCsv('h1,h2\n"""x""","""y"""')
  assert.strictEqual(r.rows.length, 1, 'one data row')
  eq(r.rows[0], ['"x"', '"y"'], 'two fields, each with an embedded quote')
}
{
  const r = FP.parseCsv('a,b\r\n1,2\r\n3,4\r\n')
  eq(r.headers, ['a', 'b'], 'CRLF header has no \\r')
  assert.strictEqual(r.rows.length, 2, 'CRLF -> 2 data rows (no trailing blank)')
  eq(r.rows[0], ['1', '2'], 'CRLF row 1 no trailing \\r')
  eq(r.rows[1], ['3', '4'], 'CRLF row 2 no trailing \\r')
}

// Plain LF still works (Unix files).
{
  const r = FP.parseCsv('a,b\n1,2\n3,4\n')
  eq(r.headers, ['a', 'b'], 'LF header')
  assert.strictEqual(r.rows.length, 2, 'LF -> 2 data rows')
  eq(r.rows[0], ['1', '2'], 'LF row 1')
  eq(r.rows[1], ['3', '4'], 'LF row 2')
}

// Plain CR (old Mac line endings — vanishingly rare but covered).
{
  const r = FP.parseCsv('a,b\r1,2\r3,4')
  eq(r.headers, ['a', 'b'], 'CR header')
  assert.strictEqual(r.rows.length, 2, 'CR -> 2 data rows')
  eq(r.rows[0], ['1', '2'], 'CR row 1')
}

// ---- ragged rows ---------------------------------------------------------
// A 3-column header with one 2-column row and one 4-column row. The
// short row gets padded; the long row gets clamped. The result is
// uniform width and the table does not blow up the layout.
{
  const r = FP.parseCsv('a,b,c\n1,2\n3,4,5,6')
  eq(r.headers, ['a', 'b', 'c'], 'ragged header')
  eq(r.rows[0], ['1', '2', ''], 'short row padded with ""')
  eq(r.rows[1], ['3', '4', '5'], 'long row clamped to 3 cols')
  assert.strictEqual(r.totalCols, 3, 'totalCols reflects header width')
}

// ---- quoted field with embedded newline ----------------------------------
// A field that contains a real newline (RFC 4180 allows this) is one
// logical row, even though the file has two physical lines for it. The
// line splitter must track quotes across newlines.
{
  const r = FP.parseCsv('a,b\n"line1\nline2",2')
  assert.strictEqual(r.rows.length, 1, 'embedded newline -> 1 data row')
  eq(r.rows[0], ['line1\nline2', '2'], 'newline preserved inside quoted field')
}

// ---- dialect auto-detect (TSV) -------------------------------------------
// A file whose first non-empty line contains a tab is TSV. The detection
// is quoting-aware so a quoted header that mentions a tab inside a
// quoted field does not fool the detector.
{
  const r = FP.parseCsv('a\tb\tc\n1\t2\t3')
  assert.strictEqual(r.dialect, '\t', 'tab in header -> TSV')
  eq(r.headers, ['a', 'b', 'c'], 'TSV header')
  eq(r.rows[0], ['1', '2', '3'], 'TSV row 1')
}

// Quoted CSV-shaped header that mentions a tab OUTSIDE quotes —
// auto-detect must still see the real tab and pick TSV.
{
  const r = FP.parseCsv('"a,b"\tc\td\n1\t2\t3')
  assert.strictEqual(r.dialect, '\t', 'tab outside quotes wins, even with quoted comma')
  eq(r.headers, ['a,b', 'c', 'd'], 'TSV header with quoted comma')
}

// Single-line file (no newlines) still gets dialect-detected.
{
  const r = FP.parseCsv('a\tb\tc')
  assert.strictEqual(r.dialect, '\t', 'single TSV line -> TSV')
  eq(r.headers, ['a', 'b', 'c'], 'single TSV line -> one row')
}

// forceDialect overrides auto-detect.
{
  const r = FP.parseCsv('a,b\n1,2', { forceDialect: '\t' })
  assert.strictEqual(r.dialect, '\t', 'forceDialect wins over auto')
  // Tab-separated against comma data: only the first cell is captured
  // per line because ',' is not a delimiter under TSV.
  eq(r.headers, ['a,b'], 'forced TSV: comma is literal')
  eq(r.rows[0], ['1,2'], 'forced TSV: comma is literal in data')
}

// ---- truncation ----------------------------------------------------------
// A file with more rows than maxRows must NOT materialise every row.
// The QML surface renders the slice and shows a notice.
{
  const header = 'a,b'
  const lines = [header]
  for (let i = 0; i < 50; i++) lines.push(i + ',' + (i + 1))
  const text = lines.join('\n')
  const r = FP.parseCsv(text, { maxRows: 10 })
  assert.strictEqual(r.totalRows, 50, 'totalRows is the file row count')
  assert.strictEqual(r.rows.length, 10, 'materialised rows are capped')
  assert.strictEqual(r.truncatedRows, true, 'truncatedRows true when over cap')
}

// Below the cap, the flag is false.
{
  const r = FP.parseCsv('a,b\n1,2\n3,4', { maxRows: 10 })
  assert.strictEqual(r.truncatedRows, false, 'no truncation below cap')
}

// Column cap: a wide file is clamped and reported.
{
  const header = []
  for (let i = 0; i < 50; i++) header.push('c' + i)
  const text = header.join(',') + '\n' + header.join(',')
  const r = FP.parseCsv(text, { maxCols: 8 })
  assert.strictEqual(r.totalCols, 50, 'totalCols is the file col count')
  assert.strictEqual(r.headers.length, 8, 'headers clamped to maxCols')
  assert.strictEqual(r.rows[0].length, 8, 'data rows clamped to maxCols')
  assert.strictEqual(r.truncatedCols, true, 'truncatedCols true when over cap')
}

// Below the column cap, the flag is false.
{
  const r = FP.parseCsv('a,b,c\n1,2,3', { maxCols: 8 })
  assert.strictEqual(r.truncatedCols, false, 'no col truncation below cap')
}

// ---- routing integration: kindFor matches the surface --------------------
// (Not strictly a parseCsv test, but lives here because the two were
// added together and the same suite is the gate that catches a
// refactor that desyncs the parser from the routing.)
assert.strictEqual(FP.kindFor('sales.csv'), 'csv', 'csv -> csv kind')
assert.strictEqual(FP.kindFor('data.tsv'), 'csv', 'tsv -> csv kind')
assert.strictEqual(FP.kindFor('icon.svg'), 'svg', 'svg -> svg kind')
assert.strictEqual(FP.kindFor('chart.mmd'), 'source', 'mmd -> source kind')
assert.strictEqual(FP.kindFor('doc.html'), 'source', 'html -> source kind')
assert.strictEqual(FP.kindFor('feed.xml'), 'source', 'xml -> source kind')
assert.strictEqual(FP.kindFor('model.stl'), 'model', 'stl -> model kind')
assert.strictEqual(FP.kindFor('model.3mf'), 'model', '3mf -> model kind')

// No selection is not a kind. Every FilePreview surface is gated on
// `kind === "<something>"`, and "external" is the catch-all — so returning it
// for an empty path drew the whole "No inline preview for this file type." /
// "Path: " / "Open externally" block next to the pane's own "Pick a file in
// the tree to preview it." message, with nothing selected.
assert.strictEqual(FP.kindFor(''), '', 'no path -> no kind')
assert.strictEqual(FP.kindFor(null), '', 'null path -> no kind')
assert.strictEqual(FP.kindFor(undefined), '', 'undefined path -> no kind')
assert.strictEqual(FP.kindForTextAware('', null), '',
  'the text-aware wrapper must not resurrect a kind for an empty path')

// ---- reasonFor: one short line per unrenderable kind ---------------------
// The QML side shows reasonFor(path) verbatim, so each branch matters.
assert.strictEqual(
  FP.reasonFor('doc.html'),
  'Inline HTML needs a web engine. Open externally to view in a browser.',
  'html reason names the missing web engine'
)
assert.strictEqual(
  FP.reasonFor('chart.mmd'),
  'Mermaid diagrams need a web engine. Open externally to view in a browser.',
  'mermaid reason names the missing web engine'
)
assert.strictEqual(
  FP.reasonFor('model.stl'),
  '3D models cannot be rendered in the shell. Open externally to view.',
  'stl reason names the missing 3D viewer'
)
assert.strictEqual(
  FP.reasonFor('notebook.ipynb'),
  'Open this in the Notebook tab to run cells and see outputs.',
  'ipynb reason points the user at the Notebook tab, not at an internal phase number'
)
assert.strictEqual(
  FP.reasonFor('mystery.bin'),
  'No inline preview for this file type.',
  'unknown ext reason is generic'
)

// ---- svgDataUrl: a base64 data URL with the right MIME -------------------
// Qt's SVG image plugin loads the data URL format strictly; missing or
// wrong prefix means the Image element silently draws nothing.
{
  const url = FP.svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"/>')
  assert.ok(url.startsWith('data:image/svg+xml;base64,'), 'svgDataUrl has the right MIME prefix')
  // Empty input is still a valid (empty) data URL — Qt's loader handles it.
  assert.ok(FP.svgDataUrl('').startsWith('data:image/svg+xml;base64,'), 'empty input still produces a valid URL')
  // null / undefined coerce to empty.
  assert.ok(FP.svgDataUrl(null).startsWith('data:image/svg+xml;base64,'), 'null -> valid URL')
  assert.ok(FP.svgDataUrl(undefined).startsWith('data:image/svg+xml;base64,'), 'undefined -> valid URL')
}

console.log('test_csv: ok')
