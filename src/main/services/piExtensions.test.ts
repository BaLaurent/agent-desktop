import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReload = vi.fn().mockResolvedValue(undefined)
const mockGetExtensions = vi.fn().mockReturnValue({ extensions: [] })

vi.mock('./piSdk', () => {
  const _mockReload = vi.fn().mockResolvedValue(undefined)
  const _mockGetExtensions = vi.fn().mockReturnValue({ extensions: [] })
  return {
    loadPISdk: vi.fn().mockResolvedValue({
      DefaultResourceLoader: function DefaultResourceLoader(opts: Record<string, unknown>) {
        // Store opts for assertion
        ;(DefaultResourceLoader as unknown as { lastOpts: unknown }).lastOpts = opts
        return { reload: _mockReload, getExtensions: _mockGetExtensions }
      },
    }),
    // Re-export internal mocks for test access
    __mocks: { reload: _mockReload, getExtensions: _mockGetExtensions },
  }
})

import { discoverPIExtensions, registerHandlers } from './piExtensions'
import { loadPISdk } from './piSdk'

// Access internal mocks from the factory
const piSdkModule = await vi.importMock<{
  loadPISdk: ReturnType<typeof vi.fn>
  __mocks: { reload: ReturnType<typeof vi.fn>; getExtensions: ReturnType<typeof vi.fn> }
}>('./piSdk')

describe('discoverPIExtensions', () => {
  beforeEach(() => {
    piSdkModule.__mocks.reload.mockClear()
    piSdkModule.__mocks.getExtensions.mockClear()
    piSdkModule.__mocks.getExtensions.mockReturnValue({ extensions: [] })
  })

  it('returns empty array when no extensions discovered', async () => {
    const result = await discoverPIExtensions()
    expect(result).toEqual([])
  })

  it('maps discovered extensions to PIExtensionInfo shape', async () => {
    piSdkModule.__mocks.getExtensions.mockReturnValue({
      extensions: [
        { name: 'code-review', resolvedPath: '/home/user/.pi/extensions/code-review.ts' },
        { name: 'test-runner', resolvedPath: '/tmp/project/.pi/extensions/test-runner.ts' },
      ],
    })

    const result = await discoverPIExtensions()

    expect(result).toEqual([
      { name: 'code-review', path: '/home/user/.pi/extensions/code-review.ts' },
      { name: 'test-runner', path: '/tmp/project/.pi/extensions/test-runner.ts' },
    ])
  })

  it('calls reload on the resource loader', async () => {
    await discoverPIExtensions()
    expect(piSdkModule.__mocks.reload).toHaveBeenCalledOnce()
  })

  it('passes additionalExtensionPaths when extensionsDir provided', async () => {
    await discoverPIExtensions('/custom/extensions')

    const pi = await loadPISdk()
    const lastOpts = (pi.DefaultResourceLoader as unknown as { lastOpts: Record<string, unknown> }).lastOpts
    expect(lastOpts).toEqual(
      expect.objectContaining({
        additionalExtensionPaths: ['/custom/extensions'],
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
      })
    )
  })

  it('does not include additionalExtensionPaths when extensionsDir is undefined', async () => {
    await discoverPIExtensions()

    const pi = await loadPISdk()
    const lastOpts = (pi.DefaultResourceLoader as unknown as { lastOpts: Record<string, unknown> }).lastOpts
    expect(lastOpts).not.toHaveProperty('additionalExtensionPaths')
  })
})

describe('registerHandlers', () => {
  let mockHandle: ReturnType<typeof vi.fn>
  let mockOn: ReturnType<typeof vi.fn>
  let mockDb: { prepare: ReturnType<typeof vi.fn> }
  let mockPrepare: { get: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockHandle = vi.fn()
    mockOn = vi.fn()
    mockPrepare = { get: vi.fn().mockReturnValue(undefined) }
    mockDb = { prepare: vi.fn().mockReturnValue(mockPrepare) }

    piSdkModule.__mocks.reload.mockClear()
    piSdkModule.__mocks.getExtensions.mockClear()
    piSdkModule.__mocks.getExtensions.mockReturnValue({ extensions: [] })
  })

  it('registers pi:listExtensions handler', () => {
    registerHandlers({ handle: mockHandle, on: mockOn } as never, mockDb as never)
    expect(mockHandle).toHaveBeenCalledWith('pi:listExtensions', expect.any(Function))
  })

  it('reads pi_extensionsDir from settings db', async () => {
    registerHandlers({ handle: mockHandle, on: mockOn } as never, mockDb as never)

    const handler = mockHandle.mock.calls[0][1]
    await handler()

    expect(mockDb.prepare).toHaveBeenCalledWith(
      "SELECT value FROM settings WHERE key = 'pi_extensionsDir'"
    )
    expect(mockPrepare.get).toHaveBeenCalled()
  })

  it('passes extensionsDir to discoverPIExtensions when set in db', async () => {
    mockPrepare.get.mockReturnValue({ value: '/custom/ext/dir' })
    registerHandlers({ handle: mockHandle, on: mockOn } as never, mockDb as never)

    const handler = mockHandle.mock.calls[0][1]
    await handler()

    const pi = await loadPISdk()
    const lastOpts = (pi.DefaultResourceLoader as unknown as { lastOpts: Record<string, unknown> }).lastOpts
    expect(lastOpts).toEqual(
      expect.objectContaining({ additionalExtensionPaths: ['/custom/ext/dir'] })
    )
  })

  it('passes undefined when pi_extensionsDir not in db', async () => {
    mockPrepare.get.mockReturnValue(undefined)
    registerHandlers({ handle: mockHandle, on: mockOn } as never, mockDb as never)

    const handler = mockHandle.mock.calls[0][1]
    await handler()

    const pi = await loadPISdk()
    const lastOpts = (pi.DefaultResourceLoader as unknown as { lastOpts: Record<string, unknown> }).lastOpts
    expect(lastOpts).not.toHaveProperty('additionalExtensionPaths')
  })
})
