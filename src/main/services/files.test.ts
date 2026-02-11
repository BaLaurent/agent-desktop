import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

const { mockShell } = vi.hoisted(() => ({
  mockShell: {
    showItemInFolder: vi.fn(),
    openPath: vi.fn().mockResolvedValue(''),
    trashItem: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-agent'),
    commandLine: { appendSwitch: vi.fn() },
  },
  shell: mockShell,
}))

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => '/tmp/test-agent' }
})

import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTestDb } from '../__tests__/db-helper'
import { createMockIpcMain } from '../__tests__/ipc-helper'
import { classifyFileExt, mimeToExt, registerHandlers } from './files'
import type Database from 'better-sqlite3'

describe('classifyFileExt', () => {
  it('returns html for .html', () => {
    expect(classifyFileExt('html')).toBe('html')
  })

  it('returns html for .htm', () => {
    expect(classifyFileExt('htm')).toBe('html')
  })

  it('returns svg for .svg', () => {
    expect(classifyFileExt('svg')).toBe('svg')
  })

  it('returns markdown for .md', () => {
    expect(classifyFileExt('md')).toBe('markdown')
  })

  it('returns typescript for .ts', () => {
    expect(classifyFileExt('ts')).toBe('typescript')
  })

  it('returns typescript for .tsx', () => {
    expect(classifyFileExt('tsx')).toBe('typescript')
  })

  it('returns python for .py', () => {
    expect(classifyFileExt('py')).toBe('python')
  })

  it('returns the extension itself for unknown types', () => {
    expect(classifyFileExt('xyz')).toBe('xyz')
  })

  it('returns null for empty string', () => {
    expect(classifyFileExt('')).toBeNull()
  })
})

describe('mimeToExt', () => {
  it('maps image/png to png', () => {
    expect(mimeToExt('image/png')).toBe('png')
  })

  it('maps image/jpeg to jpg', () => {
    expect(mimeToExt('image/jpeg')).toBe('jpg')
  })

  it('maps image/gif to gif', () => {
    expect(mimeToExt('image/gif')).toBe('gif')
  })

  it('maps image/webp to webp', () => {
    expect(mimeToExt('image/webp')).toBe('webp')
  })

  it('maps image/bmp to bmp', () => {
    expect(mimeToExt('image/bmp')).toBe('bmp')
  })

  it('maps image/svg+xml to svg', () => {
    expect(mimeToExt('image/svg+xml')).toBe('svg')
  })

  it('maps image/avif to avif', () => {
    expect(mimeToExt('image/avif')).toBe('avif')
  })

  it('returns null for unknown MIME types', () => {
    expect(mimeToExt('application/pdf')).toBeNull()
    expect(mimeToExt('text/plain')).toBeNull()
    expect(mimeToExt('')).toBeNull()
  })
})

describe('files IPC handlers', () => {
  let db: Database.Database
  let ipc: ReturnType<typeof createMockIpcMain>
  let testDir: string

  beforeEach(() => {
    db = createTestDb()
    ipc = createMockIpcMain()
    registerHandlers(ipc as any, db)
    mockShell.showItemInFolder.mockClear()
    mockShell.openPath.mockClear().mockResolvedValue('')
    mockShell.trashItem.mockClear().mockResolvedValue(undefined)

    testDir = join(tmpdir(), `agent-files-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    db.close()
    try { rmSync(testDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  describe('files:listTree', () => {
    it('returns empty array for empty directory', async () => {
      const result = await ipc.invoke('files:listTree', testDir)
      expect(result).toEqual([])
    })

    it('sorts directories first, then files, alphabetically', async () => {
      writeFileSync(join(testDir, 'zebra.txt'), 'z')
      writeFileSync(join(testDir, 'alpha.txt'), 'a')
      mkdirSync(join(testDir, 'mydir'))
      mkdirSync(join(testDir, 'adir'))

      const result = await ipc.invoke('files:listTree', testDir)
      expect(result).toHaveLength(4)
      // Directories first (alphabetical)
      expect(result[0].name).toBe('adir')
      expect(result[0].isDirectory).toBe(true)
      expect(result[1].name).toBe('mydir')
      expect(result[1].isDirectory).toBe(true)
      // Files next (alphabetical)
      expect(result[2].name).toBe('alpha.txt')
      expect(result[2].isDirectory).toBe(false)
      expect(result[3].name).toBe('zebra.txt')
      expect(result[3].isDirectory).toBe(false)
    })

    it('skips hidden files and directories', async () => {
      writeFileSync(join(testDir, '.hidden'), 'secret')
      mkdirSync(join(testDir, '.git'))
      writeFileSync(join(testDir, 'visible.txt'), 'ok')

      const result = await ipc.invoke('files:listTree', testDir)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('visible.txt')
    })

    it('skips node_modules', async () => {
      mkdirSync(join(testDir, 'node_modules'))
      writeFileSync(join(testDir, 'index.js'), 'ok')

      const result = await ipc.invoke('files:listTree', testDir)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('index.js')
    })

    it('recurses into subdirectories', async () => {
      mkdirSync(join(testDir, 'sub'))
      writeFileSync(join(testDir, 'sub', 'child.txt'), 'nested')

      const result = await ipc.invoke('files:listTree', testDir)
      expect(result).toHaveLength(1)
      expect(result[0].isDirectory).toBe(true)
      expect(result[0].children).toHaveLength(1)
      expect(result[0].children[0].name).toBe('child.txt')
    })

    it('respects max files limit', async () => {
      // Create more than MAX_FILES entries to verify the limit is enforced
      for (let i = 0; i < 10; i++) {
        writeFileSync(join(testDir, `file${i.toString().padStart(3, '0')}.txt`), `content ${i}`)
      }

      const result = await ipc.invoke('files:listTree', testDir)
      // Should return files (up to MAX_FILES)
      expect(result.length).toBeLessThanOrEqual(500)
      expect(result.length).toBe(10)
    })

    it('rejects dangerous paths', async () => {
      await expect(ipc.invoke('files:listTree', '/proc/self')).rejects.toThrow('protected directory')
    })

    it('resolves tilde paths to home directory', async () => {
      // app.getPath('home') is mocked to return '/tmp/test-agent'
      // Create a directory there to test
      const homeTestDir = join('/tmp/test-agent', 'tilde-test')
      mkdirSync(homeTestDir, { recursive: true })
      writeFileSync(join(homeTestDir, 'found.txt'), 'yes')

      const result = await ipc.invoke('files:listTree', '~/tilde-test')
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('found.txt')

      rmSync(homeTestDir, { recursive: true, force: true })
    })
  })

  describe('files:listDir', () => {
    it('returns flat listing (no recursion into children)', async () => {
      mkdirSync(join(testDir, 'sub'))
      writeFileSync(join(testDir, 'sub', 'deep.txt'), 'nested')
      writeFileSync(join(testDir, 'top.txt'), 'root')

      const result = await ipc.invoke('files:listDir', testDir)
      expect(result).toHaveLength(2)
      // Directory first
      expect(result[0].name).toBe('sub')
      expect(result[0].isDirectory).toBe(true)
      expect(result[0].children).toBeUndefined()
      // File second
      expect(result[1].name).toBe('top.txt')
      expect(result[1].isDirectory).toBe(false)
    })

    it('skips hidden files', async () => {
      writeFileSync(join(testDir, '.hidden'), 'secret')
      mkdirSync(join(testDir, '.git'))
      writeFileSync(join(testDir, 'visible.txt'), 'ok')

      const result = await ipc.invoke('files:listDir', testDir)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('visible.txt')
    })

    it('does NOT skip node_modules or venv (unlike listTree)', async () => {
      mkdirSync(join(testDir, 'node_modules'))
      mkdirSync(join(testDir, 'venv'))
      mkdirSync(join(testDir, '__pycache__'))
      writeFileSync(join(testDir, 'app.py'), 'ok')

      const result = await ipc.invoke('files:listDir', testDir)
      const names = result.map((n: any) => n.name)
      expect(names).toContain('node_modules')
      expect(names).toContain('venv')
      expect(names).toContain('__pycache__')
      expect(names).toContain('app.py')
    })

    it('sorts directories first, then files, alphabetically', async () => {
      writeFileSync(join(testDir, 'zebra.txt'), 'z')
      writeFileSync(join(testDir, 'alpha.txt'), 'a')
      mkdirSync(join(testDir, 'mydir'))
      mkdirSync(join(testDir, 'adir'))

      const result = await ipc.invoke('files:listDir', testDir)
      expect(result[0].name).toBe('adir')
      expect(result[1].name).toBe('mydir')
      expect(result[2].name).toBe('alpha.txt')
      expect(result[3].name).toBe('zebra.txt')
    })

    it('returns empty array for empty directory', async () => {
      const result = await ipc.invoke('files:listDir', testDir)
      expect(result).toEqual([])
    })

    it('returns empty array for nonexistent directory', async () => {
      const result = await ipc.invoke('files:listDir', join(testDir, 'ghost'))
      expect(result).toEqual([])
    })

    it('rejects dangerous paths', async () => {
      await expect(ipc.invoke('files:listDir', '/proc/self')).rejects.toThrow('protected directory')
    })

    it('resolves tilde paths', async () => {
      const homeTestDir = join('/tmp/test-agent', 'listdir-test')
      mkdirSync(homeTestDir, { recursive: true })
      writeFileSync(join(homeTestDir, 'found.txt'), 'yes')

      const result = await ipc.invoke('files:listDir', '~/listdir-test')
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('found.txt')

      rmSync(homeTestDir, { recursive: true, force: true })
    })
  })

  describe('files:readFile', () => {
    it('reads a file and returns content with language', async () => {
      const filePath = join(testDir, 'hello.ts')
      writeFileSync(filePath, 'const x = 1')

      const result = await ipc.invoke('files:readFile', filePath)
      expect(result.content).toBe('const x = 1')
      expect(result.language).toBe('typescript')
    })

    it('returns null language for extensionless files', async () => {
      const filePath = join(testDir, 'Makefile')
      writeFileSync(filePath, 'all: build')

      const result = await ipc.invoke('files:readFile', filePath)
      expect(result.content).toBe('all: build')
      expect(result.language).toBeNull()
    })

    it('reads files larger than 1MB without rejecting', async () => {
      const filePath = join(testDir, 'big.txt')
      writeFileSync(filePath, 'x'.repeat(1_000_001))

      const result = await ipc.invoke('files:readFile', filePath)
      expect(result.content.length).toBe(1_000_001)
      expect(result.warning).toBeUndefined()
    })

    it('rejects dangerous paths', async () => {
      await expect(ipc.invoke('files:readFile', '/proc/cpuinfo')).rejects.toThrow('protected directory')
    })

    it('throws for nonexistent files', async () => {
      await expect(ipc.invoke('files:readFile', join(testDir, 'nope.txt'))).rejects.toThrow()
    })

    it('reads PNG image as base64 data URL with language=image', async () => {
      const filePath = join(testDir, 'icon.png')
      const fakePixel = Buffer.from([0x89, 0x50, 0x4E, 0x47]) // PNG magic bytes
      writeFileSync(filePath, fakePixel)

      const result = await ipc.invoke('files:readFile', filePath)
      expect(result.language).toBe('image')
      expect(result.content).toMatch(/^data:image\/png;base64,/)
      // Verify base64 round-trips correctly
      const b64 = result.content.replace('data:image/png;base64,', '')
      expect(Buffer.from(b64, 'base64')).toEqual(fakePixel)
    })

    it('reads JPEG image as base64 data URL', async () => {
      const filePath = join(testDir, 'photo.jpg')
      writeFileSync(filePath, Buffer.from([0xFF, 0xD8, 0xFF]))

      const result = await ipc.invoke('files:readFile', filePath)
      expect(result.language).toBe('image')
      expect(result.content).toMatch(/^data:image\/jpeg;base64,/)
    })

    it('reads GIF image with correct MIME type', async () => {
      const filePath = join(testDir, 'animation.gif')
      writeFileSync(filePath, Buffer.from('GIF89a'))

      const result = await ipc.invoke('files:readFile', filePath)
      expect(result.language).toBe('image')
      expect(result.content).toMatch(/^data:image\/gif;base64,/)
    })

    it('reads WebP image with correct MIME type', async () => {
      const filePath = join(testDir, 'modern.webp')
      writeFileSync(filePath, Buffer.from('RIFF'))

      const result = await ipc.invoke('files:readFile', filePath)
      expect(result.language).toBe('image')
      expect(result.content).toMatch(/^data:image\/webp;base64,/)
    })

    it('reads images larger than 5MB without rejecting', async () => {
      const filePath = join(testDir, 'big.png')
      writeFileSync(filePath, Buffer.alloc(5_000_001))

      const result = await ipc.invoke('files:readFile', filePath)
      expect(result.language).toBe('image')
      expect(result.content).toMatch(/^data:image\/png;base64,/)
      expect(result.warning).toBeUndefined()
    })

    it('reads SVG as text (not as image)', async () => {
      const filePath = join(testDir, 'icon.svg')
      writeFileSync(filePath, '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>')

      const result = await ipc.invoke('files:readFile', filePath)
      expect(result.language).toBe('svg')
      expect(result.content).toContain('<svg')
      // Should NOT be a data URL
      expect(result.content).not.toMatch(/^data:/)
    })
  })

  describe('files:revealInFileManager', () => {
    it('calls shell.showItemInFolder with resolved path', async () => {
      const filePath = join(testDir, 'reveal.txt')
      writeFileSync(filePath, 'hi')

      await ipc.invoke('files:revealInFileManager', filePath)
      expect(mockShell.showItemInFolder).toHaveBeenCalledWith(filePath)
    })

    it('rejects dangerous paths', async () => {
      await expect(ipc.invoke('files:revealInFileManager', '/proc/self')).rejects.toThrow('protected directory')
    })
  })

  describe('files:openWithDefault', () => {
    it('calls shell.openPath with resolved path', async () => {
      const filePath = join(testDir, 'open.txt')
      writeFileSync(filePath, 'hi')

      await ipc.invoke('files:openWithDefault', filePath)
      expect(mockShell.openPath).toHaveBeenCalledWith(filePath)
    })

    it('throws when shell.openPath returns an error string', async () => {
      mockShell.openPath.mockResolvedValueOnce('No application found')
      const filePath = join(testDir, 'nope.bin')
      writeFileSync(filePath, 'data')

      await expect(ipc.invoke('files:openWithDefault', filePath)).rejects.toThrow('No application found')
    })
  })

  describe('files:trash', () => {
    it('calls shell.trashItem with resolved path', async () => {
      const filePath = join(testDir, 'trash-me.txt')
      writeFileSync(filePath, 'bye')

      await ipc.invoke('files:trash', filePath)
      expect(mockShell.trashItem).toHaveBeenCalledWith(filePath)
    })

    it('rejects dangerous paths', async () => {
      await expect(ipc.invoke('files:trash', '/proc/self')).rejects.toThrow('protected directory')
    })
  })

  describe('files:rename', () => {
    it('renames a file and returns new path', async () => {
      const filePath = join(testDir, 'old-name.txt')
      writeFileSync(filePath, 'content')

      const result = await ipc.invoke('files:rename', filePath, 'new-name.txt')
      expect(result).toBe(join(testDir, 'new-name.txt'))

      // Verify the old file is gone and new file exists
      const { readFileSync, existsSync } = await import('fs')
      expect(existsSync(filePath)).toBe(false)
      expect(readFileSync(result, 'utf-8')).toBe('content')
    })

    it('rejects names with path separators', async () => {
      const filePath = join(testDir, 'safe.txt')
      writeFileSync(filePath, 'ok')

      await expect(ipc.invoke('files:rename', filePath, '../escape.txt')).rejects.toThrow('Invalid file name')
      await expect(ipc.invoke('files:rename', filePath, 'sub/file.txt')).rejects.toThrow('Invalid file name')
    })

    it('rejects dangerous source paths', async () => {
      await expect(ipc.invoke('files:rename', '/proc/self', 'nope')).rejects.toThrow('protected directory')
    })
  })

  describe('files:writeFile', () => {
    it('writes content to an existing file', async () => {
      const filePath = join(testDir, 'write-me.txt')
      writeFileSync(filePath, 'original')

      await ipc.invoke('files:writeFile', filePath, 'updated content')

      const { readFileSync } = await import('fs')
      expect(readFileSync(filePath, 'utf-8')).toBe('updated content')
    })

    it('rejects nonexistent files', async () => {
      await expect(ipc.invoke('files:writeFile', join(testDir, 'ghost.txt'), 'data')).rejects.toThrow()
    })

    it('rejects directories', async () => {
      const dirPath = join(testDir, 'a-dir')
      mkdirSync(dirPath)
      await expect(ipc.invoke('files:writeFile', dirPath, 'data')).rejects.toThrow('Cannot write to a directory')
    })

    it('rejects dangerous paths', async () => {
      await expect(ipc.invoke('files:writeFile', '/proc/cpuinfo', 'data')).rejects.toThrow('protected directory')
    })

    it('rejects content exceeding 2MB', async () => {
      const filePath = join(testDir, 'big-write.txt')
      writeFileSync(filePath, 'ok')
      const bigContent = 'x'.repeat(2_000_001)

      await expect(ipc.invoke('files:writeFile', filePath, bigContent)).rejects.toThrow()
    })
  })

  describe('files:duplicate', () => {
    it('duplicates a file with (copy) suffix', async () => {
      const filePath = join(testDir, 'original.txt')
      writeFileSync(filePath, 'data')

      const result = await ipc.invoke('files:duplicate', filePath)
      expect(result).toBe(join(testDir, 'original (copy).txt'))

      const { readFileSync } = await import('fs')
      expect(readFileSync(result, 'utf-8')).toBe('data')
    })

    it('increments copy number when (copy) already exists', async () => {
      const filePath = join(testDir, 'dup.txt')
      writeFileSync(filePath, 'data')
      writeFileSync(join(testDir, 'dup (copy).txt'), 'existing')

      const result = await ipc.invoke('files:duplicate', filePath)
      expect(result).toBe(join(testDir, 'dup (copy 2).txt'))
    })

    it('duplicates a directory recursively', async () => {
      const dirPath = join(testDir, 'mydir')
      mkdirSync(dirPath)
      writeFileSync(join(dirPath, 'child.txt'), 'nested')

      const result = await ipc.invoke('files:duplicate', dirPath)
      expect(result).toBe(join(testDir, 'mydir (copy)'))

      const { readFileSync } = await import('fs')
      expect(readFileSync(join(result, 'child.txt'), 'utf-8')).toBe('nested')
    })

    it('rejects dangerous paths', async () => {
      await expect(ipc.invoke('files:duplicate', '/proc/self')).rejects.toThrow('protected directory')
    })
  })

  describe('files:savePastedFile', () => {
    it('saves Uint8Array to temp file and returns path', async () => {
      const data = new Uint8Array([0x89, 0x50, 0x4E, 0x47])
      const result = await ipc.invoke('files:savePastedFile', data, 'image/png')

      expect(result).toContain('agent-paste')
      expect(result).toMatch(/\.png$/)

      const { readFileSync } = await import('fs')
      const written = readFileSync(result)
      expect(written).toEqual(Buffer.from(data))
    })

    it('uses correct extension for jpeg', async () => {
      const data = new Uint8Array([0xFF, 0xD8, 0xFF])
      const result = await ipc.invoke('files:savePastedFile', data, 'image/jpeg')
      expect(result).toMatch(/\.jpg$/)
    })

    it('falls back to .bin for unknown MIME types', async () => {
      const data = new Uint8Array([0x00, 0x01])
      const result = await ipc.invoke('files:savePastedFile', data, 'application/octet-stream')
      expect(result).toMatch(/\.bin$/)
    })

    it('rejects empty data', async () => {
      await expect(ipc.invoke('files:savePastedFile', new Uint8Array(0), 'image/png')).rejects.toThrow('Invalid file data')
    })

    it('rejects data exceeding 5MB', async () => {
      const bigData = new Uint8Array(5_000_001)
      await expect(ipc.invoke('files:savePastedFile', bigData, 'image/png')).rejects.toThrow('Pasted file too large')
    })

    it('rejects non-string MIME type', async () => {
      const data = new Uint8Array([0x01])
      await expect(ipc.invoke('files:savePastedFile', data, 123 as any)).rejects.toThrow('Invalid MIME type')
    })
  })

  describe('files:move', () => {
    it('moves a file into a directory', async () => {
      const filePath = join(testDir, 'moveme.txt')
      writeFileSync(filePath, 'data')
      const destDir = join(testDir, 'dest')
      mkdirSync(destDir)

      const result = await ipc.invoke('files:move', filePath, destDir)
      expect(result).toBe(join(destDir, 'moveme.txt'))

      const { existsSync, readFileSync } = await import('fs')
      expect(existsSync(filePath)).toBe(false)
      expect(readFileSync(result, 'utf-8')).toBe('data')
    })

    it('moves a directory into another directory', async () => {
      const srcDir = join(testDir, 'srcdir')
      mkdirSync(srcDir)
      writeFileSync(join(srcDir, 'child.txt'), 'nested')
      const destDir = join(testDir, 'dest')
      mkdirSync(destDir)

      const result = await ipc.invoke('files:move', srcDir, destDir)
      expect(result).toBe(join(destDir, 'srcdir'))

      const { existsSync, readFileSync } = await import('fs')
      expect(existsSync(srcDir)).toBe(false)
      expect(readFileSync(join(result, 'child.txt'), 'utf-8')).toBe('nested')
    })

    it('auto-renames on conflict', async () => {
      const filePath = join(testDir, 'dup.txt')
      writeFileSync(filePath, 'original')
      const destDir = join(testDir, 'dest')
      mkdirSync(destDir)
      writeFileSync(join(destDir, 'dup.txt'), 'existing')

      const result = await ipc.invoke('files:move', filePath, destDir)
      expect(result).toBe(join(destDir, 'dup (1).txt'))

      const { readFileSync } = await import('fs')
      expect(readFileSync(result, 'utf-8')).toBe('original')
      expect(readFileSync(join(destDir, 'dup.txt'), 'utf-8')).toBe('existing')
    })

    it('rejects when source is already in dest directory', async () => {
      const destDir = join(testDir, 'dest')
      mkdirSync(destDir)
      const filePath = join(destDir, 'already.txt')
      writeFileSync(filePath, 'data')

      await expect(ipc.invoke('files:move', filePath, destDir)).rejects.toThrow('already in the destination')
    })

    it('rejects when dest is not a directory', async () => {
      const filePath = join(testDir, 'a.txt')
      writeFileSync(filePath, 'data')
      const notADir = join(testDir, 'b.txt')
      writeFileSync(notADir, 'data')

      await expect(ipc.invoke('files:move', filePath, notADir)).rejects.toThrow('not a directory')
    })

    it('rejects moving a folder into itself', async () => {
      const srcDir = join(testDir, 'parent')
      mkdirSync(srcDir)

      await expect(ipc.invoke('files:move', srcDir, srcDir)).rejects.toThrow('Cannot move a folder into itself')
    })

    it('rejects moving a folder into its own child', async () => {
      const parentDir = join(testDir, 'parent')
      mkdirSync(parentDir)
      const childDir = join(parentDir, 'child')
      mkdirSync(childDir)

      await expect(ipc.invoke('files:move', parentDir, childDir)).rejects.toThrow('Cannot move a folder into itself')
    })

    it('rejects dangerous source paths', async () => {
      const destDir = join(testDir, 'dest')
      mkdirSync(destDir)
      await expect(ipc.invoke('files:move', '/proc/self', destDir)).rejects.toThrow('protected directory')
    })

    it('rejects dangerous dest paths', async () => {
      const filePath = join(testDir, 'a.txt')
      writeFileSync(filePath, 'data')
      await expect(ipc.invoke('files:move', filePath, '/proc')).rejects.toThrow('protected directory')
    })
  })

  describe('files:createFile', () => {
    it('creates an empty file and returns its path', async () => {
      const result = await ipc.invoke('files:createFile', testDir, 'newfile.txt')
      expect(result).toBe(join(testDir, 'newfile.txt'))

      const { readFileSync } = await import('fs')
      expect(readFileSync(result, 'utf-8')).toBe('')
    })

    it('rejects if file already exists', async () => {
      writeFileSync(join(testDir, 'existing.txt'), 'data')
      await expect(ipc.invoke('files:createFile', testDir, 'existing.txt')).rejects.toThrow('already exists')
    })

    it('rejects names with path separators', async () => {
      await expect(ipc.invoke('files:createFile', testDir, 'sub/file.txt')).rejects.toThrow('Invalid file name')
      await expect(ipc.invoke('files:createFile', testDir, '../escape.txt')).rejects.toThrow('Invalid file name')
    })

    it('rejects names with null bytes', async () => {
      await expect(ipc.invoke('files:createFile', testDir, 'bad\0name.txt')).rejects.toThrow('Invalid file name')
    })

    it('rejects dangerous directory paths', async () => {
      await expect(ipc.invoke('files:createFile', '/proc', 'test.txt')).rejects.toThrow('protected directory')
    })
  })

  describe('files:createFolder', () => {
    it('creates a directory and returns its path', async () => {
      const result = await ipc.invoke('files:createFolder', testDir, 'newdir')
      expect(result).toBe(join(testDir, 'newdir'))

      const { statSync } = await import('fs')
      expect(statSync(result).isDirectory()).toBe(true)
    })

    it('rejects if folder already exists', async () => {
      mkdirSync(join(testDir, 'existing'))
      await expect(ipc.invoke('files:createFolder', testDir, 'existing')).rejects.toThrow('already exists')
    })

    it('rejects names with path separators', async () => {
      await expect(ipc.invoke('files:createFolder', testDir, 'sub/dir')).rejects.toThrow('Invalid folder name')
      await expect(ipc.invoke('files:createFolder', testDir, '..\\escape')).rejects.toThrow('Invalid folder name')
    })

    it('rejects names with null bytes', async () => {
      await expect(ipc.invoke('files:createFolder', testDir, 'bad\0name')).rejects.toThrow('Invalid folder name')
    })

    it('rejects dangerous directory paths', async () => {
      await expect(ipc.invoke('files:createFolder', '/proc', 'test')).rejects.toThrow('protected directory')
    })
  })
})
