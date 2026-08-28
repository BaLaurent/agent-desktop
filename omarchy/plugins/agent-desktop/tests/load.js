// Loads a QML JS *resource* into node.
//
// Everything under lib/ and generated/ is a QML JS resource, not an ES module:
// `.pragma library` plus top-level `var`/`function` declarations, which is the
// only shape `import "lib/foo.js" as Foo` can consume. Two directives are
// QML-only — `.pragma library` and `.import "Other.js" as Other` — so stripping
// the first and resolving the second by hand leaves ordinary JavaScript that
// runs in a vm context. The tests therefore exercise exactly the bytes the shell
// loads, not a parallel copy that can drift.
//
// Same technique as ~/.config/omarchy/plugins/omamail/tests/load.js.
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.dirname(__dirname)

const IMPORT_SOURCE = '^\\s*\\.import\\s+"([^"]+)"\\s+as\\s+(\\w+)\\s*$'

function load(relativePath) {
  const file = path.join(ROOT, relativePath)
  const raw = fs.readFileSync(file, 'utf8')

  const context = { console }
  vm.createContext(context)

  // Collect every match before following any of them: a global regexp carries
  // `lastIndex` across calls, and recursing out of the middle of an exec loop —
  // which is what following an import does — leaves the outer loop reading a
  // position into a string it has never seen.
  const imports = [...raw.matchAll(new RegExp(IMPORT_SOURCE, 'gm'))]

  // QML resolves an import against the importing file's own directory.
  for (const [, target, qualifier] of imports) {
    context[qualifier] = load(path.relative(ROOT, path.resolve(path.dirname(file), target)))
  }

  const source = raw
    .replace(/^\.pragma library\s*$/m, '')
    .replace(new RegExp(IMPORT_SOURCE, 'gm'), '')

  vm.runInContext(source, context)
  return context
}

// Values built inside the vm context carry that realm's prototypes, so
// assert.deepStrictEqual rejects them against literals declared out here.
// Round-tripping through JSON compares the values, which is what the tests are
// about.
function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function deepEqual(actual, expected, message) {
  const assert = require('assert')
  if (message === undefined) assert.deepStrictEqual(plain(actual), plain(expected))
  else assert.deepStrictEqual(plain(actual), plain(expected), message)
}

module.exports = { load, ROOT, plain, deepEqual }
