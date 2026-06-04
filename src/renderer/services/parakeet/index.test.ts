import { describe, it, expect, beforeAll, vi } from 'vitest'

/**
 * Fake Worker that records posted messages and lets the test drive `onmessage`,
 * standing in for the real Parakeet inference worker so we can exercise the
 * facade's message-protocol → promise wiring without onnxruntime-web.
 */
class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  posted: unknown[] = []
  constructor() {
    FakeWorker.instances.push(this)
  }
  postMessage(msg: unknown) {
    this.posted.push(msg)
  }
  terminate() {}
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent)
  }
}

vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)

// Imported after the Worker stub is in place. The facade keeps a module-level
// singleton worker, so these tests run sequentially against one FakeWorker instance.
let mod: typeof import('./index')
function worker(): FakeWorker {
  return FakeWorker.instances[0]
}

beforeAll(async () => {
  mod = await import('./index')
})

describe('parakeet facade', () => {
  it('selftest posts a request and resolves with the worker result', async () => {
    const p = mod.selftestParakeet('auto')
    const sent = worker().posted.at(-1) as { type: string; wasmPaths: string }
    expect(sent.type).toBe('selftest')
    expect(sent.wasmPaths).toBe('agent-model://ort/')

    worker().emit({ type: 'selftest-result', ortLoaded: true, webgpu: false, backend: 'wasm', detail: '' })
    await expect(p).resolves.toEqual({ ortLoaded: true, webgpu: false, backend: 'wasm', detail: '' })
  })

  it('load forwards source/backend, reports progress, and resolves on loaded', async () => {
    expect(mod.isParakeetLoaded()).toBe(false)
    const onProgress = vi.fn()
    const p = mod.loadParakeet({ source: 'download', backend: 'auto', decoderQuant: 'int8' }, onProgress)

    const sent = worker().posted.at(-1) as { type: string; source: string; decoderQuant: string; modelBaseUrl?: string }
    expect(sent.type).toBe('load')
    expect(sent.source).toBe('download')
    expect(sent.decoderQuant).toBe('int8')
    expect(sent.modelBaseUrl).toBeUndefined() // only set for manual mode

    worker().emit({ type: 'progress', loaded: 50, total: 100, file: 'encoder-model.onnx' })
    expect(onProgress).toHaveBeenCalledWith({ loaded: 50, total: 100, file: 'encoder-model.onnx' })

    worker().emit({ type: 'loaded' })
    await expect(p).resolves.toBeUndefined()
    expect(mod.isParakeetLoaded()).toBe(true)
  })

  it('transcribe correlates the result by id', async () => {
    const pcm = new Float32Array([0.1, 0.2, 0.3])
    const p = mod.transcribeParakeet(pcm, 16000)

    const sent = worker().posted.at(-1) as { type: string; id: number; sampleRate: number }
    expect(sent.type).toBe('transcribe')
    expect(sent.sampleRate).toBe(16000)

    worker().emit({ type: 'result', id: sent.id, text: 'bonjour le monde' })
    await expect(p).resolves.toBe('bonjour le monde')
  })

  it('transcribe rejects when the worker reports an error for that id', async () => {
    const p = mod.transcribeParakeet(new Float32Array([0]), 16000)
    const sent = worker().posted.at(-1) as { id: number }
    worker().emit({ type: 'error', id: sent.id, message: 'inference failed' })
    await expect(p).rejects.toThrow('inference failed')
  })
})
