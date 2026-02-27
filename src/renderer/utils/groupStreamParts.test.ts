import { describe, it, expect } from 'vitest'
import type { StreamPart } from '../../../shared/types'
import { groupStreamParts } from './groupStreamParts'

const text = (content: string): StreamPart => ({ type: 'text', content })
const task = (id: string, status: 'running' | 'done' = 'running'): StreamPart => ({ type: 'tool', name: 'Task', id, status })
const tool = (name: string, id: string): StreamPart => ({ type: 'tool', name, id, status: 'done' })

describe('groupStreamParts', () => {
  it('returns empty array for empty input', () => {
    expect(groupStreamParts([])).toEqual([])
  })

  it('returns single for a lone Task tool', () => {
    const t = task('t1')
    expect(groupStreamParts([t])).toEqual([{ kind: 'single', part: t }])
  })

  it('groups two adjacent Task tools into a task_group', () => {
    const t1 = task('t1')
    const t2 = task('t2')
    expect(groupStreamParts([t1, t2])).toEqual([
      { kind: 'task_group', tasks: [t1, t2] },
    ])
  })

  it('groups three adjacent Task tools into a task_group', () => {
    const t1 = task('t1')
    const t2 = task('t2')
    const t3 = task('t3')
    expect(groupStreamParts([t1, t2, t3])).toEqual([
      { kind: 'task_group', tasks: [t1, t2, t3] },
    ])
  })

  it('does not group Tasks separated by text', () => {
    const t1 = task('t1')
    const txt = text('hello')
    const t2 = task('t2')
    expect(groupStreamParts([t1, txt, t2])).toEqual([
      { kind: 'single', part: t1 },
      { kind: 'single', part: txt },
      { kind: 'single', part: t2 },
    ])
  })

  it('does not group Tasks separated by other tools', () => {
    const t1 = task('t1')
    const bash = tool('Bash', 'b1')
    const t2 = task('t2')
    expect(groupStreamParts([t1, bash, t2])).toEqual([
      { kind: 'single', part: t1 },
      { kind: 'single', part: bash },
      { kind: 'single', part: t2 },
    ])
  })

  it('handles mix of text, adjacent Tasks, other tool, and text', () => {
    const txt1 = text('start')
    const t1 = task('t1')
    const t2 = task('t2')
    const t3 = task('t3')
    const bash = tool('Bash', 'b1')
    const txt2 = text('end')
    expect(groupStreamParts([txt1, t1, t2, t3, bash, txt2])).toEqual([
      { kind: 'single', part: txt1 },
      { kind: 'task_group', tasks: [t1, t2, t3] },
      { kind: 'single', part: bash },
      { kind: 'single', part: txt2 },
    ])
  })

  it('keeps non-Task tools adjacent as individual singles', () => {
    const b1 = tool('Bash', 'b1')
    const b2 = tool('Read', 'r1')
    const b3 = tool('Grep', 'g1')
    expect(groupStreamParts([b1, b2, b3])).toEqual([
      { kind: 'single', part: b1 },
      { kind: 'single', part: b2 },
      { kind: 'single', part: b3 },
    ])
  })

  it('creates separate groups for Tasks at start and end with non-Task parts in between', () => {
    const t1 = task('t1')
    const t2 = task('t2')
    const txt = text('middle')
    const bash = tool('Bash', 'b1')
    const t3 = task('t3')
    const t4 = task('t4')
    const t5 = task('t5')
    expect(groupStreamParts([t1, t2, txt, bash, t3, t4, t5])).toEqual([
      { kind: 'task_group', tasks: [t1, t2] },
      { kind: 'single', part: txt },
      { kind: 'single', part: bash },
      { kind: 'task_group', tasks: [t3, t4, t5] },
    ])
  })
})
