// Tripwire for lib/notebook.js — both parseNotebook and reduceOutput
// exercised with realistic nbformat-4 fixtures.
const assert = require('assert')
const { load, deepEqual } = require('./load')

const NB = load('lib/notebook.js')

// ---- parseNotebook: minimal nbformat-4 ------------------------------------

const minimal = JSON.stringify({
  nbformat: 4,
  nbformat_minor: 5,
  cells: [
    {
      cell_type: 'code',
      execution_count: null,
      metadata: {},
      outputs: [],
      source: 'print("hi")'
    },
    {
      cell_type: 'markdown',
      metadata: {},
      source: '# Title\n\nHello world'
    }
  ],
  metadata: { kernelspec: { name: 'python3' } }
})

const parsed = NB.parseNotebook(minimal)
assert.strictEqual(parsed.error, undefined)
assert.strictEqual(parsed.cells.length, 2)
assert.strictEqual(parsed.cells[0].kind, 'code')
assert.strictEqual(parsed.cells[0].source, 'print("hi")')
assert.strictEqual(parsed.cells[1].kind, 'markdown')
assert.strictEqual(parsed.cells[1].source, '# Title\n\nHello world')

// ---- parseNotebook: source as ARRAY of strings ----------------------------

const arraySource = JSON.stringify({
  nbformat: 4,
  nbformat_minor: 5,
  cells: [
    {
      cell_type: 'code',
      execution_count: null,
      metadata: {},
      outputs: [],
      // nbformat allows source to be an array of lines. When the lines
      // already end in \n (the canonical save shape), the parser joins
      // them with ''. Otherwise it joins with '\n' so the source stays
      // readable.
      source: ['print("a")\n', 'print("b")\n']
    }
  ]
})

const p2 = NB.parseNotebook(arraySource)
assert.strictEqual(p2.cells.length, 1)
assert.strictEqual(p2.cells[0].source, 'print("a")\nprint("b")\n',
  'array of newline-terminated lines joins with ""')

const arrayNoNL = JSON.stringify({
  nbformat: 4, nbformat_minor: 5,
  cells: [{ cell_type: 'code', execution_count: null, metadata: {}, outputs: [],
            source: ['print("a")', 'print("b")'] }]
})
assert.strictEqual(NB.parseNotebook(arrayNoNL).cells[0].source,
  'print("a")\nprint("b")',
  'array without trailing \\n joins with "\\n"')

// ---- parseNotebook: outputs (stream, display_data with base64 PNG) -------

const pngB64 = 'iVBORw0KGgo='  // any non-empty string; we only verify routing
const withOutputs = JSON.stringify({
  nbformat: 4, nbformat_minor: 5,
  cells: [
    {
      cell_type: 'code',
      execution_count: 3,
      metadata: {},
      outputs: [
        {
          output_type: 'stream',
          name: 'stdout',
          text: 'hello\n'
        },
        {
          output_type: 'execute_result',
          execution_count: 3,
          data: { 'text/plain': '42', 'image/png': pngB64 },
          metadata: {}
        },
        {
          output_type: 'error',
          ename: 'NameError',
          evalue: "name 'x' is not defined",
          traceback: ['Traceback...', 'NameError: x']
        }
      ],
      source: 'x'
    }
  ]
})

const p3 = NB.parseNotebook(withOutputs)
assert.strictEqual(p3.cells[0].outputs.length, 3)
assert.strictEqual(p3.cells[0].outputs[0].type, 'stream')
assert.strictEqual(p3.cells[0].outputs[0].text, 'hello\n')
assert.strictEqual(p3.cells[0].outputs[1].type, 'execute_result')
assert.strictEqual(p3.cells[0].outputs[1].data['image/png'], pngB64,
  'display_data base64 PNG passes through')
assert.strictEqual(p3.cells[0].outputs[2].type, 'error')
assert.strictEqual(p3.cells[0].outputs[2].ename, 'NameError')

// ---- parseNotebook: malformed inputs return error, never throw -----------

const bad1 = NB.parseNotebook('{not json')
assert.ok(bad1.error, 'invalid JSON returns error string')
assert.strictEqual(bad1.cells.length, 0)
const bad2 = NB.parseNotebook('null')
assert.ok(bad2.error, 'null JSON returns error')

const bad3 = NB.parseNotebook('[1,2,3]')
assert.ok(bad2.error, 'array root returns error')
assert.strictEqual(bad3.cells.length, 0)

const bad4 = NB.parseNotebook('{"nbformat": 3, "cells": []}')
assert.ok(bad4.error, 'nbformat 3 reports unsupported')
assert.strictEqual(bad4.cells.length, 0)

const bad5 = NB.parseNotebook('{"nbformat": 4}')
assert.ok(bad5.error, 'missing cells array reports error')

assert.doesNotThrow(function () { NB.parseNotebook('') })
assert.doesNotThrow(function () { NB.parseNotebook(undefined) })
assert.doesNotThrow(function () { NB.parseNotebook(null) })

// ---- reduceOutput: stream coalescing --------------------------------------

let out = []
out = NB.reduceOutput(out, { type: 'stream', name: 'stdout', text: 'a' })
out = NB.reduceOutput(out, { type: 'stream', name: 'stdout', text: 'b' })
assert.strictEqual(out.length, 1, 'adjacent same-name streams coalesce')
assert.strictEqual(out[0].text, 'ab')

// Different name -> new output.
out = NB.reduceOutput(out, { type: 'stream', name: 'stderr', text: 'oops' })
assert.strictEqual(out.length, 2)
assert.strictEqual(out[1].name, 'stderr')

// Different name even though adjacent.
out = []
out = NB.reduceOutput(out, { type: 'stream', name: 'stdout', text: 'a' })
out = NB.reduceOutput(out, { type: 'stream', name: 'stderr', text: 'b' })
assert.strictEqual(out.length, 2, 'different name -> new output (no coalesce)')

// ---- reduceOutput: execute_result / display_data / error -----------------

out = []
out = NB.reduceOutput(out, { type: 'execute_result', execution_count: 1,
                              data: { 'text/plain': '42' } })
assert.strictEqual(out.length, 1)
assert.strictEqual(out[0].type, 'execute_result')

out = []
out = NB.reduceOutput(out, { type: 'display_data',
                              data: { 'image/png': pngB64 } })
assert.strictEqual(out[0].data['image/png'], pngB64,
  'display_data base64 PNG preserved through reduceOutput')

out = []
out = NB.reduceOutput(out, { type: 'error', ename: 'E', evalue: 'v', traceback: ['t1'] })
assert.strictEqual(out[0].type, 'error')
assert.strictEqual(out[0].ename, 'E')
assert.strictEqual(out[0].traceback[0], 't1')

// ---- reduceOutput: status / ready ----------------------------------------

out = []
out = NB.reduceOutput(out, { type: 'ready', language: 'python', state: 'idle' })
assert.strictEqual(out[0].type, 'ready')
assert.strictEqual(out[0].language, 'python')

out = []
out = NB.reduceOutput(out, { type: 'status', state: 'busy' })
assert.strictEqual(out[0].type, 'status')
assert.strictEqual(out[0].state, 'busy')

// ---- reduceOutput: unknown chunk type is preserved (not silently dropped)

out = []
out = NB.reduceOutput(out, { type: 'something-new', payload: 42 })
assert.strictEqual(out[0].type, 'unknown', 'unknown type -> unknown output')

// ---- reduceOutput: empty / null inputs are safe ---------------------------

out = []
out = NB.reduceOutput(out, null)
out = NB.reduceOutput(out, undefined)
out = NB.reduceOutput(out, {})
assert.strictEqual(out.length, 0, 'garbage chunks produce no outputs')

console.log('test_notebook: ok')
