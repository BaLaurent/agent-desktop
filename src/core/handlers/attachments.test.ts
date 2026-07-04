import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { DispatchRegistry } from '../dispatch'
import { registerAttachmentsHandlers } from './attachments'
import { createTestDb } from '../__tests__/db-helper'

describe('attachments handlers', () => {
  let dispatch: DispatchRegistry
  let tmpDir: string

  beforeEach(async () => {
    dispatch = new DispatchRegistry()
    const db = await createTestDb()
    registerAttachmentsHandlers(dispatch, db as any)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attachments-test-'))
  })

  it('registers attachments:readFile handler', () => {
    expect(dispatch.has('attachments:readFile')).toBe(true)
  })

  it('registers attachments:getInfo handler', () => {
    expect(dispatch.has('attachments:getInfo')).toBe(true)
  })

  it('attachments:readFile reads a text file', async () => {
    const filePath = path.join(tmpDir, 'test.txt')
    fs.writeFileSync(filePath, 'hello world')

    const readFile = dispatch.get('attachments:readFile')!
    const result = await readFile(filePath) as { name: string; content: string; type: string; size: number }

    expect(result.name).toBe('test.txt')
    expect(result.content).toBe('hello world')
    expect(result.type).toBe('text/plain')
    expect(result.size).toBe(11)
  })

  it('attachments:getInfo returns file metadata', async () => {
    const filePath = path.join(tmpDir, 'info.md')
    fs.writeFileSync(filePath, '# Hello')

    const getInfo = dispatch.get('attachments:getInfo')!
    const result = await getInfo(filePath) as { name: string; size: number; type: string }

    expect(result.name).toBe('info.md')
    expect(result.type).toBe('text/markdown')
    expect(result.size).toBeGreaterThan(0)
  })

  it('attachments:readFile rejects blocked paths', async () => {
    const readFile = dispatch.get('attachments:readFile')!
    await expect(readFile('/etc/passwd')).rejects.toThrow('protected directory')
  })
})
