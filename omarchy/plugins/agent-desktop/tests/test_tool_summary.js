const assert = require('assert')
const { load } = require('./load')

const T = load('lib/toolSummary.js')

// File-path tools — Read / NotebookRead / View — read the path field.
// Short paths stay whole; long ones are truncated to the last 3 segments.
assert.strictEqual(T.summarize('Read', { file_path: '/a/b/c.txt' }),
  'Read /a/b/c.txt',
  'short paths are not truncated')
assert.strictEqual(T.summarize('Read', { file_path: '/var/log/x.log' }),
  'Read /var/log/x.log',
  'Read falls back to path')
assert.strictEqual(T.summarize('NotebookRead', { notebook_path: '/nb.ipynb' }),
  'NotebookRead /nb.ipynb')

// Edit / MultiEdit / NotebookEdit: diff summary, both spellings.
assert.strictEqual(T.summarize('Edit', { old_str: 'aaa', new_str: 'aaaa' }),
  'edit (3 → 4, +1)',
  'edit shows character count delta, Claude spelling')
assert.strictEqual(T.summarize('Edit', { oldText: 'a', newText: 'bbb' }),
  'edit (1 → 3, +2)',
  'edit supports the PI spelling oldText/newText')
// Edit without a recognised old/new pair falls back to the file path.
assert.strictEqual(T.summarize('Edit', { file_path: '/x.py' }), 'edit /x.py')

// Write shows the file path.
assert.strictEqual(T.summarize('Write', { file_path: '/a/b.txt' }), 'write /a/b.txt')

// Bash shows the command, truncated.
assert.strictEqual(T.summarize('Bash', { command: 'ls -la' }), '$ ls -la')
const longCmd = 'x'.repeat(500)
const bashSummary = T.summarize('Bash', { command: longCmd })
assert.ok(bashSummary.indexOf('$ ') === 0)
assert.ok(bashSummary.length < 220, 'bash summary is truncated')

// Glob / Grep show the pattern.
assert.strictEqual(T.summarize('Glob', { pattern: '**/*.ts' }), 'glob **/*.ts')
assert.strictEqual(T.summarize('Grep', { pattern: 'TODO' }), 'grep TODO')

// Task shows the prompt (truncated).
assert.strictEqual(T.summarize('Task', { prompt: 'investigate the bug' }),
  'task: investigate the bug')
// Falls back to description.
assert.strictEqual(T.summarize('Task', { description: 'search the codebase' }),
  'task: search the codebase')

// WebFetch / WebSearch
assert.strictEqual(T.summarize('WebFetch', { url: 'https://example.com/foo' }),
  'fetch example.com/foo')

// MCP tools show server and tool segments.
assert.strictEqual(T.summarize('mcp__github__search_repos', { q: 'pi' }),
  'mcp:github search_repos')
assert.strictEqual(T.summarize('mcp__a__b__c', {}),
  'mcp:a b__c',
  'multiple __ are kept verbatim past the first separator')

// Generic fallback: tool name + first 120 chars of JSON input.
const longInput = { x: 'a'.repeat(200) }
const generic = T.summarize('SomethingElse', longInput)
assert.ok(generic.indexOf('SomethingElse ') === 0)
assert.ok(generic.length <= 'SomethingElse '.length + 121, 'generic summary truncates to ~120 chars')

// Generic fallback with a string input (some tools pass input as JSON string).
assert.strictEqual(T.summarize('Other', '{"a":1}'), 'Other {"a":1}')

// Null / undefined input / null name produce sensible strings, never throw.
assert.strictEqual(T.summarize('AnyName', null), 'AnyName')
assert.strictEqual(T.summarize('AnyName', undefined), 'AnyName')
assert.strictEqual(T.summarize('', { file_path: '/x' }), '')

// No input AND no recognised fields -> the bare name.
assert.strictEqual(T.summarize('PlainTool', {}), 'PlainTool {}',
  'plain tool with empty input still includes the input shape, matching the renderer')

// Long path: keeps the last 3 segments + filename.
assert.strictEqual(T.summarize('Read', { file_path: '/one/two/three/four/five.txt' }),
  'Read two/three/four/five.txt',
  'long paths keep the last 3 segments')

console.log('test_tool_summary: ok')
