import { getMimeType } from './attachments'

describe('getMimeType', () => {
  it('returns image/png for .png', () => {
    expect(getMimeType('.png')).toBe('image/png')
  })

  it('returns image/jpeg for .jpg', () => {
    expect(getMimeType('.jpg')).toBe('image/jpeg')
  })

  it('returns application/json for .json', () => {
    expect(getMimeType('.json')).toBe('application/json')
  })

  it('returns application/pdf for .pdf', () => {
    expect(getMimeType('.pdf')).toBe('application/pdf')
  })

  it('returns application/octet-stream for unknown extension', () => {
    expect(getMimeType('.unknown')).toBe('application/octet-stream')
  })

  it('maps all 16 supported extensions correctly', () => {
    const expected: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.js': 'text/javascript',
      '.ts': 'text/typescript',
      '.py': 'text/x-python',
      '.json': 'application/json',
      '.csv': 'text/csv',
      '.yaml': 'application/x-yaml',
      '.yml': 'application/x-yaml',
      '.pdf': 'application/pdf',
    }

    for (const [ext, mime] of Object.entries(expected)) {
      expect(getMimeType(ext)).toBe(mime)
    }
  })
})
