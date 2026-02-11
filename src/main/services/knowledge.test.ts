import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../__tests__/db-helper'
import { createMockIpcMain } from '../__tests__/ipc-helper'
import { registerHandlers } from './knowledge'
import type Database from 'better-sqlite3'

// Mock electron modules
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock-home'),
  },
  shell: {
    showItemInFolder: vi.fn(),
  },
}))

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs')
  return {
    ...actual,
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn(),
      stat: vi.fn(),
      readFile: vi.fn(),
    },
  }
})

describe('Knowledge Service (filesystem-based)', () => {
  let db: Database.Database
  let ipc: ReturnType<typeof createMockIpcMain>

  beforeEach(() => {
    db = createTestDb()
    ipc = createMockIpcMain()
    registerHandlers(ipc as any, db)
  })

  afterEach(() => {
    db.close()
    vi.clearAllMocks()
  })

  describe('kb:listCollections', () => {
    it('returns empty array when no directories exist', async () => {
      const fs = await import('fs')
      vi.mocked(fs.promises.readdir).mockResolvedValue([] as any)

      const collections = await ipc.invoke('kb:listCollections')
      expect(collections).toEqual([])
    })

    it('returns collections with fileCount and totalSize', async () => {
      const fs = await import('fs')

      // First readdir: top-level knowledges directory
      vi.mocked(fs.promises.readdir)
        .mockResolvedValueOnce([
          { name: 'my-project', isDirectory: () => true } as any,
        ])
        // Second readdir: inside the collection folder (findSupportedFiles)
        .mockResolvedValueOnce([
          { name: 'readme.md', isDirectory: () => false } as any,
          { name: 'notes.txt', isDirectory: () => false } as any,
        ])

      vi.mocked(fs.promises.stat).mockResolvedValue({ size: 256 } as any)

      const collections = await ipc.invoke('kb:listCollections') as any[]
      expect(collections).toHaveLength(1)
      expect(collections[0].name).toBe('my-project')
      expect(collections[0].fileCount).toBe(2)
      expect(collections[0].totalSize).toBe(512)
      expect(collections[0].path).toContain('my-project')
    })

    it('skips hidden directories', async () => {
      const fs = await import('fs')
      vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
        { name: '.hidden', isDirectory: () => true } as any,
        { name: 'visible', isDirectory: () => true } as any,
      ])
      // readdir for 'visible' collection scan
      vi.mocked(fs.promises.readdir).mockResolvedValueOnce([])

      const collections = await ipc.invoke('kb:listCollections') as any[]
      expect(collections).toHaveLength(1)
      expect(collections[0].name).toBe('visible')
    })

    it('skips non-directory entries', async () => {
      const fs = await import('fs')
      vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
        { name: 'stray-file.txt', isDirectory: () => false } as any,
        { name: 'real-collection', isDirectory: () => true } as any,
      ])
      // readdir for 'real-collection' scan
      vi.mocked(fs.promises.readdir).mockResolvedValueOnce([])

      const collections = await ipc.invoke('kb:listCollections') as any[]
      expect(collections).toHaveLength(1)
      expect(collections[0].name).toBe('real-collection')
    })

    it('skips unsupported file extensions', async () => {
      const fs = await import('fs')
      vi.mocked(fs.promises.readdir)
        .mockResolvedValueOnce([
          { name: 'collection', isDirectory: () => true } as any,
        ])
        .mockResolvedValueOnce([
          { name: 'photo.png', isDirectory: () => false } as any,
          { name: 'binary.exe', isDirectory: () => false } as any,
          { name: 'valid.ts', isDirectory: () => false } as any,
        ])

      vi.mocked(fs.promises.stat).mockResolvedValue({ size: 100 } as any)

      const collections = await ipc.invoke('kb:listCollections') as any[]
      expect(collections[0].fileCount).toBe(1) // only valid.ts
    })
  })

  describe('kb:getCollectionFiles', () => {
    it('returns files in a collection', async () => {
      const fs = await import('fs')
      vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
        { name: 'file1.md', isDirectory: () => false } as any,
        { name: 'file2.ts', isDirectory: () => false } as any,
      ])
      vi.mocked(fs.promises.stat).mockResolvedValue({ size: 300 } as any)

      const files = await ipc.invoke('kb:getCollectionFiles', 'my-collection') as any[]
      expect(files).toHaveLength(2)
      expect(files[0].name).toBe('file1.md')
      expect(files[0].size).toBe(300)
      expect(files[1].name).toBe('file2.ts')
    })

    it('throws on directory traversal with ..', async () => {
      await expect(ipc.invoke('kb:getCollectionFiles', '../etc')).rejects.toThrow(
        'Invalid collection name'
      )
    })

    it('throws on directory traversal with /', async () => {
      await expect(ipc.invoke('kb:getCollectionFiles', 'foo/bar')).rejects.toThrow(
        'Invalid collection name'
      )
    })

    it('throws on directory traversal with backslash', async () => {
      await expect(ipc.invoke('kb:getCollectionFiles', 'foo\\bar')).rejects.toThrow(
        'Invalid collection name'
      )
    })

    it('recursively scans subdirectories', async () => {
      const fs = await import('fs')
      vi.mocked(fs.promises.readdir)
        .mockResolvedValueOnce([
          { name: 'subdir', isDirectory: () => true } as any,
          { name: 'root.txt', isDirectory: () => false } as any,
        ])
        .mockResolvedValueOnce([
          { name: 'nested.md', isDirectory: () => false } as any,
        ])

      vi.mocked(fs.promises.stat).mockResolvedValue({ size: 50 } as any)

      const files = await ipc.invoke('kb:getCollectionFiles', 'my-collection') as any[]
      expect(files).toHaveLength(2)
    })

    it('skips hidden files in collection', async () => {
      const fs = await import('fs')
      vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
        { name: '.gitignore', isDirectory: () => false } as any,
        { name: 'visible.md', isDirectory: () => false } as any,
      ])
      vi.mocked(fs.promises.stat).mockResolvedValue({ size: 50 } as any)

      const files = await ipc.invoke('kb:getCollectionFiles', 'my-collection') as any[]
      expect(files).toHaveLength(1)
      expect(files[0].name).toBe('visible.md')
    })
  })

  describe('kb:openKnowledgesFolder', () => {
    it('calls shell.showItemInFolder with knowledges directory', async () => {
      const { shell } = await import('electron')

      await ipc.invoke('kb:openKnowledgesFolder')

      expect(shell.showItemInFolder).toHaveBeenCalledTimes(1)
      const calledPath = vi.mocked(shell.showItemInFolder).mock.calls[0][0]
      expect(calledPath).toContain('knowledges')
    })

    it('ensures directory exists before opening', async () => {
      const fs = await import('fs')

      await ipc.invoke('kb:openKnowledgesFolder')

      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('knowledges'),
        { recursive: true }
      )
    })
  })
})
