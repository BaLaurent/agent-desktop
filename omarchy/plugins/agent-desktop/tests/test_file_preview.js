// Tripwire for lib/filePreview.js: every public surface is exercised, with
// the boundaries called out in the plan (extension matrix, MIME fallback,
// size cap, dotfile behaviour, no-extension behaviour, uppercase folding)
// and with a negative size-or-unknown check so a bug in the guard surfaces
// here, not in a frozen TextArea.
const assert = require('assert')
const { load } = require('./load')

const FP = load('lib/filePreview.js')

// ---- extOf ----------------------------------------------------------------
// A helper exposed for tests; it's not on the public surface but the routing
// rules above ride on it, so locking it down makes the routing tests honest.

assert.strictEqual(FP.extOf('foo.ts'), 'ts', 'plain ext')
assert.strictEqual(FP.extOf('foo.TS'), 'ts', 'uppercase folds')
assert.strictEqual(FP.extOf('foo.tar.gz'), 'gz', 'last dot wins')
assert.strictEqual(FP.extOf('foo'), '', 'no extension -> empty')
assert.strictEqual(FP.extOf('foo.'), '', 'trailing dot -> empty')
assert.strictEqual(FP.extOf('.bashrc'), '', 'dotfile -> empty')
assert.strictEqual(FP.extOf('/abs/path/Image.PNG'), 'png', 'absolute path / uppercase')
assert.strictEqual(FP.extOf('a/b/c.markdown'), 'markdown', 'nested path keeps ext')
assert.strictEqual(FP.extOf(''), '', 'empty string -> empty')
assert.strictEqual(FP.extOf(null), '', 'null -> empty')
assert.strictEqual(FP.extOf(undefined), '', 'undefined -> empty')

// ---- kindFor -------------------------------------------------------------
//
// The extension matrix the plan called out: every extension the preview pane
// might encounter in a real chat-driven workflow, including the deliberately
// 'external' cases (notebook, 3D model, binary) and the markdown routing.
// No-extension, uppercase, and dotfile also belong here because they are the
// shapes the routing decision has to be defined for, not just the happy paths.

var matrix = [
  // [path, expected]
  ['src/foo.ts', 'text'],
  ['app.js', 'text'],
  ['script.py', 'text'],
  ['README.md', 'markdown'],
  ['doc.markdown', 'markdown'],
  ['icon.svg', 'svg'],            // SVG renders via Qt's SVG image plugin
  ['notebook.ipynb', 'external'], // Phase 9 owns the real notebook surface
  ['model.stl', 'model'],         // 3D model, no QML equivalent
  ['model.3mf', 'model'],         // 3D model, no QML equivalent
  ['part.scad', 'text'],          // we have a highlighter for scad
  ['blob.bin', 'external'],       // truly binary
  ['doc.html', 'source'],         // no web engine in QML — source + open externally
  ['page.htm', 'source'],         // ditto
  ['feed.xml', 'source'],         // ditto
  ['chart.mmd', 'source'],        // Mermaid needs a web engine
  ['sales.csv', 'csv'],           // table surface
  ['data.tsv', 'csv'],            // table surface (dialect auto-detected)

  // No extension at all: external — there is literally nothing to route on.
  ['Makefile', 'external'],
  ['LICENSE', 'external'],

  // Uppercase extensions fold before the lookup.
  ['FOO.TS', 'text'],
  ['IMAGE.PNG', 'image'],

  // Dotfiles do not pick up an extension — `.bashrc` is treated as a
  // dotfile and routes to external.
  ['.bashrc', 'external'],
  ['.gitignore', 'external']
]

for (var i = 0; i < matrix.length; i++) {
  var row = matrix[i]
  assert.strictEqual(
    FP.kindFor(row[0], null),
    row[1],
    'kindFor(' + JSON.stringify(row[0]) + ') -> ' + row[1]
  )
}

// MIME fallback: an extensionless file with image/png mime still routes to
// image. A text/markdown mime on an unknown extension still routes to
// markdown (the contract that the QML pane can lean on if xdg-mime is ever
// plumbed through).
assert.strictEqual(FP.kindFor('mystery', 'image/png'), 'image',
  'MIME image/* promotes extensionless file to image')
assert.strictEqual(FP.kindFor('mystery', 'text/markdown'), 'markdown',
  'MIME text/markdown promotes to markdown')
// Non-image mime is ignored — we do not silently route an unknown
// application/octet-stream to text just because the extension is unknown.
assert.strictEqual(FP.kindFor('blob', 'application/octet-stream'), 'external',
  'non-image MIME on unknown ext still routes to external')
// An explicit extension wins over a contradicting MIME. An SVG named
// `image.svg` still routes to 'svg' (the SVG surface), not to 'image'
// (the raster surface) — even when mime=image/svg+xml would qualify it
// as a raster. The routing order is raster image FIRST, then svg.
assert.strictEqual(FP.kindFor('image.svg', 'image/svg+xml'), 'svg',
  'extension wins: image.svg -> svg, not image')

// ---- size guard -----------------------------------------------------------

assert.strictEqual(FP.tooLargeForText(0), false, 'zero is not too large')
assert.strictEqual(FP.tooLargeForText(1024), false, '1 KiB is fine')
assert.strictEqual(FP.tooLargeForText(512 * 1024), false,
  'at the cap (512 KiB) is fine')
assert.strictEqual(FP.tooLargeForText(512 * 1024 + 1), true,
  'one byte over the cap is too large')
assert.strictEqual(FP.tooLargeForText(2 * 1024 * 1024), true,
  '2 MiB is too large')
assert.strictEqual(FP.tooLargeForText(null), false, 'null size -> not too large')
assert.strictEqual(FP.tooLargeForText(undefined), false,
  'undefined size -> not too large')
assert.strictEqual(FP.tooLargeForText(-1), false, 'negative size -> not too large')
assert.strictEqual(FP.tooLargeForText(NaN), false, 'NaN size -> not too large')

// kindForTextAware: a small text file routes to text; a too-large text file
// routes to external; an image or markdown file is unaffected by the size
// guard.
assert.strictEqual(FP.kindForTextAware('foo.ts', 1024), 'text',
  'small text file routes to text')
assert.strictEqual(FP.kindForTextAware('foo.ts', 1024 * 1024), 'external',
  'large text file routes to external')
assert.strictEqual(FP.kindForTextAware('foo.png', 1024 * 1024), 'image',
  'image is unaffected by text size guard')
assert.strictEqual(FP.kindForTextAware('foo.md', 1024 * 1024), 'markdown',
  'markdown is unaffected by text size guard')
assert.strictEqual(FP.kindForTextAware('foo.ts', null), 'text',
  'unknown size on a small text file routes to text')

// ---- formatSize ----------------------------------------------------------

assert.strictEqual(FP.formatSize(0), '0 B', 'zero bytes')
assert.strictEqual(FP.formatSize(512), '512 B', 'sub-KiB')
assert.strictEqual(FP.formatSize(1024), '1.0 KiB', 'exact KiB')
assert.strictEqual(FP.formatSize(1536), '1.5 KiB', 'fractional KiB')
assert.strictEqual(FP.formatSize(1024 * 1024), '1.0 MiB', 'exact MiB')
assert.strictEqual(FP.formatSize(1024 * 1024 * 1024), '1.0 GiB', 'exact GiB')
assert.strictEqual(FP.formatSize(null), 'unknown size', 'null -> unknown')
assert.strictEqual(FP.formatSize(undefined), 'unknown size', 'undefined -> unknown')
assert.strictEqual(FP.formatSize(NaN), 'unknown size', 'NaN -> unknown')
assert.strictEqual(FP.formatSize(-1), 'unknown size', 'negative -> unknown')

console.log('test_file_preview: ok')
