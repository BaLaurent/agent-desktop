import { describe, it, expect } from 'vitest'
import { getImageMime, getMimeType, IMAGE_EXTS, TEXT_EXTENSIONS } from './mime'

describe('getImageMime', () => {
  it('maps common image extensions', () => {
    expect(getImageMime('png')).toBe('image/png')
    expect(getImageMime('jpg')).toBe('image/jpeg')
    expect(getImageMime('jpeg')).toBe('image/jpeg')
    expect(getImageMime('gif')).toBe('image/gif')
    expect(getImageMime('webp')).toBe('image/webp')
    expect(getImageMime('bmp')).toBe('image/bmp')
    expect(getImageMime('ico')).toBe('image/x-icon')
    expect(getImageMime('avif')).toBe('image/avif')
    expect(getImageMime('tiff')).toBe('image/tiff')
    expect(getImageMime('tif')).toBe('image/tiff')
  })

  it('returns octet-stream for unknown extensions', () => {
    expect(getImageMime('xyz')).toBe('application/octet-stream')
    expect(getImageMime('')).toBe('application/octet-stream')
  })
})

describe('getMimeType', () => {
  it('maps dotted image extensions', () => {
    expect(getMimeType('.png')).toBe('image/png')
    expect(getMimeType('.jpg')).toBe('image/jpeg')
    expect(getMimeType('.svg')).toBe('image/svg+xml')
  })

  it('maps dotted text extensions', () => {
    expect(getMimeType('.txt')).toBe('text/plain')
    expect(getMimeType('.md')).toBe('text/markdown')
    expect(getMimeType('.json')).toBe('application/json')
    expect(getMimeType('.py')).toBe('text/x-python')
    expect(getMimeType('.csv')).toBe('text/csv')
    expect(getMimeType('.yaml')).toBe('application/x-yaml')
    expect(getMimeType('.yml')).toBe('application/x-yaml')
  })

  it('returns octet-stream for unknown extensions', () => {
    expect(getMimeType('.zzz')).toBe('application/octet-stream')
    expect(getMimeType('')).toBe('application/octet-stream')
  })
})

describe('extension sets', () => {
  it('IMAGE_EXTS contains standard raster formats', () => {
    expect(IMAGE_EXTS.has('png')).toBe(true)
    expect(IMAGE_EXTS.has('jpg')).toBe(true)
    expect(IMAGE_EXTS.has('gif')).toBe(true)
    expect(IMAGE_EXTS.has('svg')).toBe(false) // SVG is not in IMAGE_EXTS (non-raster)
  })

  it('TEXT_EXTENSIONS contains code/doc formats', () => {
    expect(TEXT_EXTENSIONS.has('.ts')).toBe(true)
    expect(TEXT_EXTENSIONS.has('.py')).toBe(true)
    expect(TEXT_EXTENSIONS.has('.exe')).toBe(false)
  })
})
