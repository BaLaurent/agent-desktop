import type { StreamPart } from '../../../shared/types'

export type ToolPart = Extract<StreamPart, { type: 'tool' }>

export type GroupedPart =
  | { kind: 'task_group'; tasks: ToolPart[] }
  | { kind: 'single'; part: StreamPart }

export function groupStreamParts(parts: StreamPart[]): GroupedPart[] {
  const result: GroupedPart[] = []
  let i = 0

  while (i < parts.length) {
    const part = parts[i]

    if (part.type === 'tool' && part.name === 'Task') {
      const tasks: ToolPart[] = [part]
      let j = i + 1
      while (j < parts.length && parts[j].type === 'tool' && (parts[j] as ToolPart).name === 'Task') {
        tasks.push(parts[j] as ToolPart)
        j++
      }

      if (tasks.length >= 2) {
        result.push({ kind: 'task_group', tasks })
      } else {
        result.push({ kind: 'single', part })
      }
      i = j
    } else {
      result.push({ kind: 'single', part })
      i++
    }
  }

  return result
}
