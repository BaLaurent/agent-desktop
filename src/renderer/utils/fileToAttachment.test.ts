import { describe, it, expect, afterEach, vi } from 'vitest'
import { fileToAttachment } from './fileToAttachment'

afterEach(() => {
  delete (window as any).__AGENT_WEB_MODE__
  vi.clearAllMocks()
})

describe('fileToAttachment', () => {
  describe('desktop mode (Electron)', () => {
    it('returns attachment with path from getPathForFile', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/home/user/test.txt')
      const file = new File(['hello world'], 'test.txt', { type: 'text/plain' })

      const result = await fileToAttachment(file)

      expect(result).toEqual({
        name: 'test.txt',
        path: '/home/user/test.txt',
        type: 'text/plain',
        size: file.size,
      })
      expect(window.agent.system.getPathForFile).toHaveBeenCalledWith(file)
      expect(window.agent.files.savePastedFile).not.toHaveBeenCalled()
    })

    it('uses file.type when available', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/tmp/image.png')
      const file = new File(['content'], 'image.png', { type: 'image/png' })

      const result = await fileToAttachment(file)

      expect(result?.type).toBe('image/png')
    })

    it('falls back to extension-based detection when file.type is empty', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/tmp/document.pdf')
      // jsdom sets type to '' when omitted; .pdf is not in jsdom's sniff list
      const file = new File(['content'], 'document.pdf')
      expect(file.type).toBe('')

      const result = await fileToAttachment(file)

      expect(result?.type).toBe('application/pdf')
    })

    it('returns octet-stream for unknown extensions', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/tmp/unknown.xyz')
      const file = new File(['data'], 'unknown.xyz')

      const result = await fileToAttachment(file)

      expect(result?.type).toBe('application/octet-stream')
    })

    it('preserves file size in attachment', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/tmp/large.bin')
      const content = new Uint8Array(1024)
      const file = new File([content], 'large.bin')

      const result = await fileToAttachment(file)

      expect(result?.size).toBe(1024)
    })

    it('detects mimetype for .json file', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/tmp/data.json')
      const file = new File(['{}'], 'data.json')

      const result = await fileToAttachment(file)

      expect(result?.type).toBe('application/json')
    })

    it('detects mimetype for .md file', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/tmp/README.md')
      const file = new File(['# Title'], 'README.md')

      const result = await fileToAttachment(file)

      expect(result?.type).toBe('text/markdown')
    })

    it('detects mimetype for .py file', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/tmp/script.py')
      const file = new File(['print("hi")'], 'script.py')

      const result = await fileToAttachment(file)

      expect(result?.type).toBe('text/x-python')
    })

    it('detects mimetype for .csv file', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/tmp/data.csv')
      const file = new File(['a,b,c'], 'data.csv')

      const result = await fileToAttachment(file)

      expect(result?.type).toBe('text/csv')
    })

    it('detects mimetype for .yaml file', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/tmp/config.yaml')
      const file = new File(['key: value'], 'config.yaml')

      const result = await fileToAttachment(file)

      expect(result?.type).toBe('text/yaml')
    })

    it('detects mimetype for .yml file', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/tmp/config.yml')
      const file = new File(['key: value'], 'config.yml')

      const result = await fileToAttachment(file)

      expect(result?.type).toBe('text/yaml')
    })

    it('detects mimetype for .svg file', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/tmp/icon.svg')
      const file = new File(['<svg></svg>'], 'icon.svg')

      const result = await fileToAttachment(file)

      expect(result?.type).toBe('image/svg+xml')
    })

    it('detects mimetype for .webp file', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/tmp/image.webp')
      const file = new File(['fake webp'], 'image.webp')

      const result = await fileToAttachment(file)

      expect(result?.type).toBe('image/webp')
    })

    it('detects mimetype for .jpeg file', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/tmp/photo.jpeg')
      const file = new File(['fake jpeg'], 'photo.jpeg')

      const result = await fileToAttachment(file)

      expect(result?.type).toBe('image/jpeg')
    })

    it('detects mimetype for .jpg file (alias for jpeg)', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/tmp/photo.jpg')
      const file = new File(['fake jpg'], 'photo.jpg')

      const result = await fileToAttachment(file)

      expect(result?.type).toBe('image/jpeg')
    })

    it('detects mimetype for .gif file', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/tmp/animation.gif')
      const file = new File(['fake gif'], 'animation.gif')

      const result = await fileToAttachment(file)

      expect(result?.type).toBe('image/gif')
    })

    it('detects mimetype for .js file', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/tmp/script.js')
      const file = new File(['console.log()'], 'script.js')

      const result = await fileToAttachment(file)

      expect(result?.type).toBe('text/javascript')
    })

    it('detects mimetype for .ts file', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/tmp/app.ts')
      const file = new File(['const x: number = 1'], 'app.ts')

      const result = await fileToAttachment(file)

      expect(result?.type).toBe('text/typescript')
    })
  })

  describe('web mode (remote access)', () => {
    /**
     * jsdom's File does not implement arrayBuffer(). We patch each File instance
     * directly so the source code path (file.arrayBuffer()) works in tests.
     */
    function makeWebFile(content: string, name: string, type?: string): File {
      const file = type !== undefined ? new File([content], name, { type }) : new File([content], name)
      const bytes = new TextEncoder().encode(content)
      ;(file as any).arrayBuffer = () => Promise.resolve(bytes.buffer)
      return file
    }

    it('reads file buffer and calls savePastedFile', async () => {
      ;(window as any).__AGENT_WEB_MODE__ = true
      vi.mocked(window.agent.files.savePastedFile).mockResolvedValue('/tmp/uploaded/test.txt')
      const file = makeWebFile('Hello', 'test.txt', 'text/plain')

      const result = await fileToAttachment(file)

      expect(result).toEqual({
        name: 'test.txt',
        path: '/tmp/uploaded/test.txt',
        type: 'text/plain',
        size: file.size,
      })
      expect(window.agent.system.getPathForFile).not.toHaveBeenCalled()
      const callArgs = vi.mocked(window.agent.files.savePastedFile).mock.calls[0]
      expect(callArgs[0]).toBeInstanceOf(Uint8Array)
      expect(callArgs[1]).toBe('text/plain')
    })

    it('uses file.type when available in web mode', async () => {
      ;(window as any).__AGENT_WEB_MODE__ = true
      vi.mocked(window.agent.files.savePastedFile).mockResolvedValue('/tmp/uploaded/image.png')
      const file = makeWebFile('content', 'image.png', 'image/png')

      const result = await fileToAttachment(file)

      expect(result?.type).toBe('image/png')
      const callArgs = vi.mocked(window.agent.files.savePastedFile).mock.calls[0]
      expect(callArgs[1]).toBe('image/png')
    })

    it('falls back to extension-based detection when file.type is empty in web mode', async () => {
      ;(window as any).__AGENT_WEB_MODE__ = true
      vi.mocked(window.agent.files.savePastedFile).mockResolvedValue('/tmp/uploaded/document.pdf')
      const file = makeWebFile('content', 'document.pdf')
      expect(file.type).toBe('')

      const result = await fileToAttachment(file)

      expect(result?.type).toBe('application/pdf')
      const callArgs = vi.mocked(window.agent.files.savePastedFile).mock.calls[0]
      expect(callArgs[1]).toBe('application/pdf')
    })

    it('returns null on savePastedFile failure', async () => {
      ;(window as any).__AGENT_WEB_MODE__ = true
      vi.mocked(window.agent.files.savePastedFile).mockRejectedValue(new Error('Upload failed'))
      const file = makeWebFile('content', 'test.txt', 'text/plain')

      const result = await fileToAttachment(file)

      expect(result).toBeNull()
    })

    it('logs error on savePastedFile failure', async () => {
      ;(window as any).__AGENT_WEB_MODE__ = true
      const error = new Error('Network error')
      vi.mocked(window.agent.files.savePastedFile).mockRejectedValue(error)
      const file = makeWebFile('content', 'test.txt', 'text/plain')
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await fileToAttachment(file)

      expect(consoleSpy).toHaveBeenCalledWith('[fileToAttachment] Upload failed:', error)
      consoleSpy.mockRestore()
    })

    it('preserves file size even when uploading', async () => {
      ;(window as any).__AGENT_WEB_MODE__ = true
      vi.mocked(window.agent.files.savePastedFile).mockResolvedValue('/tmp/uploaded/large.bin')
      const file = makeWebFile('x'.repeat(2048), 'large.bin')

      const result = await fileToAttachment(file)

      expect(result?.size).toBe(2048)
    })

    it('handles large files in web mode', async () => {
      ;(window as any).__AGENT_WEB_MODE__ = true
      vi.mocked(window.agent.files.savePastedFile).mockResolvedValue('/tmp/uploaded/large.bin')
      const file = makeWebFile('x'.repeat(1024), 'large.bin', 'application/octet-stream')

      const result = await fileToAttachment(file)

      expect(result?.size).toBe(1024)
      expect(result?.path).toBe('/tmp/uploaded/large.bin')
    })
  })

  describe('extension detection edge cases', () => {
    it('handles filename with no extension — uses provided file.type', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/tmp/README')
      const file = new File(['content'], 'README', { type: 'text/plain' })

      const result = await fileToAttachment(file)

      expect(result?.type).toBe('text/plain')
    })

    it('handles filename with uppercase extension', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/tmp/PHOTO.JPG')
      const file = new File(['fake'], 'PHOTO.JPG')

      const result = await fileToAttachment(file)

      expect(result?.type).toBe('image/jpeg')
    })

    it('handles filename with multiple dots — uses final extension', async () => {
      vi.mocked(window.agent.system.getPathForFile).mockReturnValue('/tmp/archive.tar.gz')
      const file = new File(['fake'], 'archive.tar.gz')

      const result = await fileToAttachment(file)

      // 'gz' is not in the map, falls back to octet-stream
      expect(result?.type).toBe('application/octet-stream')
    })
  })
})
