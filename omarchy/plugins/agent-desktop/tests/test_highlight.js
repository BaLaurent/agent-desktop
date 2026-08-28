const assert = require('assert')
const { load, deepEqual } = require('./load')

const H = load('lib/highlight.js')

// ---- HTML escaping is mandatory -----------------------------------------
// An unescaped `<` in source code silently eats the rest of the block in
// any rich-text engine. The escape runs BEFORE spans are wrapped.
assert.strictEqual(H.escapeHtml('a < b'), 'a &lt; b')
assert.strictEqual(H.escapeHtml('a > b'), 'a &gt; b')
assert.strictEqual(H.escapeHtml('a & b'), 'a &amp; b')
assert.strictEqual(H.escapeHtml('<div>'), '&lt;div&gt;')
// & must be replaced FIRST so the other replacements don't double-encode.
assert.strictEqual(H.escapeHtml('&<>'), '&amp;&lt;&gt;')

// ---- tokens(code, lang): each language produces its own class set -------
// JavaScript: keyword, string, number, function call.
const jsTokens = H.tokens('const x = 1; fn(2);', 'js')
const jsTypes = jsTokens.map(function (t) { return t.cls })
assert.ok(jsTypes.indexOf('kw') >= 0, 'js: const is a keyword')
assert.ok(jsTypes.indexOf('num') >= 0, 'js: 1 is a number')
assert.ok(jsTypes.indexOf('fn') >= 0, 'js: fn() is a function call')
assert.strictEqual(jsTokens.map(function (t) { return t.text }).join(''), 'const x = 1; fn(2);',
  'token texts reassemble to the original input')

// JavaScript comments — both // and /* */.
const jsCommentTokens = H.tokens('// hello\n/* block */ code', 'js')
const cmtTexts = jsCommentTokens.filter(function (t) { return t.cls === 'cmt' }).map(function (t) { return t.text })
deepEqual(cmtTexts, ['// hello', '/* block */'])

// Python keywords and strings.
const pyTokens = H.tokens('def foo(x):\n    return "hi"', 'py')
const pyTypes = pyTokens.map(function (t) { return t.cls })
assert.ok(pyTypes.indexOf('kw') >= 0, 'py: def is a keyword')
assert.ok(pyTypes.indexOf('str') >= 0, 'py: "hi" is a string')

// JSON: keys, string values, numbers, booleans.
const jsonTokens = H.tokens('{"a": 1, "b": true, "c": null}', 'json')
const jsonTexts = jsonTokens.map(function (t) { return t.text }).join('')
assert.strictEqual(jsonTexts, '{"a": 1, "b": true, "c": null}')
// Keys ("a", "b", "c") should hit the kw class via the first JSON rule.
const jsonKwTexts = jsonTokens.filter(function (t) { return t.cls === 'kw' }).map(function (t) { return t.text })
assert.ok(jsonKwTexts.indexOf('"a"') >= 0, 'json: "a" is a key')
assert.ok(jsonKwTexts.indexOf('"b"') >= 0)
assert.ok(jsonKwTexts.indexOf('"c"') >= 0)

// Bash: $VAR and `${VAR}` variables, command substitution style.
const bashTokens = H.tokens('echo "$HOME/${USER}"', 'bash')
const bashText = bashTokens.map(function (t) { return t.text }).join('')
assert.strictEqual(bashText, 'echo "$HOME/${USER}"')

// Diff: + line is the "add" class; - line is the "del" class; @@ is "typ".
const diffTokens = H.tokens('@@ -1,2 +1,3 @@\n+added\n-removed\nunchanged', 'diff')
const diffMap = {}
diffTokens.forEach(function (t) {
  if (!diffMap[t.cls]) diffMap[t.cls] = []
  diffMap[t.cls].push(t.text)
})
assert.ok(diffMap.add && diffMap.add.join('').indexOf('+added') >= 0, 'diff: + line is add')
assert.ok(diffMap.del && diffMap.del.join('').indexOf('-removed') >= 0, 'diff: - line is del')

// Language aliases: 'javascript' -> 'js', 'python' -> 'py', etc.
assert.strictEqual(H.tokens('const x = 1', 'javascript').map(function (t) { return t.cls }).indexOf('kw') >= 0, true,
  'javascript alias routes to js')
assert.strictEqual(H.tokens('def f(): pass', 'python').map(function (t) { return t.cls }).indexOf('kw') >= 0, true,
  'python alias routes to py')
assert.strictEqual(H.tokens('const x = 1', 'tsx').map(function (t) { return t.cls }).indexOf('kw') >= 0, true,
  'tsx alias routes to ts')

// Unknown language -> a single plain token wrapping the entire input.
const plain = H.tokens('whatever <here>', 'cobol')
assert.strictEqual(plain.length, 1)
assert.strictEqual(plain[0].cls, 'plain')
assert.strictEqual(plain[0].text, 'whatever <here>')

// Null / empty code -> empty token list.
deepEqual(H.tokens('', 'js'), [])
deepEqual(H.tokens(null, 'js'), [])

// No overlapping tokens: hits are sorted and dropped when overlapped.
const overlap = H.tokens('"hello world"', 'js')
assert.strictEqual(overlap.length, 1, 'one string literal = one token')
assert.strictEqual(overlap[0].cls, 'str')

// ---- toRichText: HTML-escape integrity ----------------------------------
const rich = H.toRichText('a < b && c > d', 'cobol', { defaultColor: '#abcdef' })
assert.ok(rich.indexOf('a &lt; b &amp;&amp; c &gt; d') >= 0,
  'all of <, >, & are escaped before wrapping in spans')
assert.ok(rich.indexOf('#abcdef') >= 0, 'default colour is included')
// No raw `<` survives.
assert.ok(!/a < b/.test(rich), 'no raw < survives into the output')

// Per-class colour overrides.
const colored = H.toRichText('const x = 1', 'js', {
  defaultColor: '#fff',
  kw: '#0f0'
})
assert.ok(colored.indexOf('color:#0f0') >= 0, 'keyword colour applied')
assert.ok(colored.indexOf('<span style="font-family:') >= 0, 'root span sets the font family')

console.log('test_highlight: ok')
