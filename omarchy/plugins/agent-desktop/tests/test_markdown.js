const assert = require('assert')
const { load, deepEqual } = require('./load')

const M = load('lib/markdown.js')

// Empty / null input -> empty list.
deepEqual(M.split(''), [])
deepEqual(M.split(null), [])
deepEqual(M.split(undefined), [])

// Plain markdown text with no fenced code -> one md block.
deepEqual(M.split('Hello **world**'), [
  { kind: 'md', text: 'Hello **world**' }
])

// Single fenced code block, backticks, with a language tag.
// The split preserves the surrounding newlines so a Text{MarkdownText} that
// receives the md block still sees the blank-line paragraph boundary.
deepEqual(M.split('Before\n\n```js\nconst x = 1\n```\n\nAfter'), [
  { kind: 'md', text: 'Before\n' },
  { kind: 'code', text: 'const x = 1', lang: 'js' },
  { kind: 'md', text: '\nAfter' }
])

// Tilde fence.
const tilde = M.split('A\n\n~~~\npython code\n~~~\nB')
assert.strictEqual(tilde.length, 3)
assert.strictEqual(tilde[0].kind, 'md')
assert.strictEqual(tilde[0].text, 'A\n')
assert.strictEqual(tilde[1].kind, 'code')
assert.strictEqual(tilde[1].text, 'python code')
assert.strictEqual(tilde[2].kind, 'md')
assert.strictEqual(tilde[2].text, 'B')

// Unterminated fence runs to end of input — copy/paste of a half-typed
// snippet still has to render as code, not as text.
const unterminated = M.split('Intro\n\n```py\ndef f():\n    pass\n')
assert.strictEqual(unterminated.length, 2)
assert.strictEqual(unterminated[0].kind, 'md')
assert.strictEqual(unterminated[0].text, 'Intro\n')
assert.strictEqual(unterminated[1].kind, 'code')
assert.strictEqual(unterminated[1].lang, 'py')
assert.strictEqual(unterminated[1].text, 'def f():\n    pass\n')

// Fence with no language tag — lang is undefined in the output block.
const noLang = M.split('```\nplain\n```')
assert.strictEqual(noLang.length, 1)
assert.strictEqual(noLang[0].kind, 'code')
assert.strictEqual(noLang[0].text, 'plain')
assert.strictEqual(noLang[0].lang, undefined, 'a fence with no info string carries no lang key')

// Multi-line code block preserves newlines and indentation inside.
const multi = M.split('```ts\nfunction f() {\n  return 42\n}\n```')
assert.strictEqual(multi.length, 1)
assert.strictEqual(multi[0].text, 'function f() {\n  return 42\n}')
assert.strictEqual(multi[0].kind, 'code')

// Adjacent code and markdown blocks with no blank line between.
const adj = M.split('```\na\n```\n## heading\n```\nb\n```')
assert.strictEqual(adj.length, 3)
assert.strictEqual(adj[0].kind, 'code')
assert.strictEqual(adj[1].kind, 'md')
assert.strictEqual(adj[1].text, '## heading')
assert.strictEqual(adj[2].kind, 'code')

// A "closing" fence with more backticks than the opener is still a close.
const longerClose = M.split('```js\nx\n`````')
assert.strictEqual(longerClose.length, 1)
assert.strictEqual(longerClose[0].kind, 'code')

// A shorter fence is NOT a close.
const shorterClose = M.split('`````js\nx\n```')
assert.strictEqual(shorterClose.length, 1)
assert.strictEqual(shorterClose[0].kind, 'code')
assert.strictEqual(shorterClose[0].text, 'x\n```')

// Two separate fenced blocks of different languages.
const twoLangs = M.split('```js\njs1\n```\n\n```py\npy1\n```')
assert.strictEqual(twoLangs.length, 3, 'two fences with a blank line between them yield code + empty md + code')
assert.strictEqual(twoLangs[0].kind, 'code')
assert.strictEqual(twoLangs[0].lang, 'js')
assert.strictEqual(twoLangs[0].text, 'js1')
assert.strictEqual(twoLangs[2].kind, 'code')
assert.strictEqual(twoLangs[2].lang, 'py')
assert.strictEqual(twoLangs[2].text, 'py1')

// Indented fences still open.
const indented = M.split('   ```js\n   hi\n   ```')
assert.strictEqual(indented.length, 1)
assert.strictEqual(indented[0].kind, 'code')
assert.strictEqual(indented[0].lang, 'js')

// A tilde fence is NOT closed by a backtick fence.
const mismatched = M.split('~~~\nx\n```')
assert.strictEqual(mismatched.length, 1)
assert.strictEqual(mismatched[0].kind, 'code')

// No-space info string is recognised too (`\`\`\`js` -> lang "js").
const noSpace = M.split('```js\nx\n```')
assert.strictEqual(noSpace[0].lang, 'js', 'a fence without a separator space still records the language')

console.log('test_markdown: ok')
