type PISdk = typeof import('@mariozechner/pi-coding-agent')
let _piCache: PISdk | null = null

async function loadPISdk(): Promise<PISdk> {
  if (!_piCache) {
    _piCache = await (Function(
      'return import("@mariozechner/pi-coding-agent")'
    )() as Promise<PISdk>)
  }
  return _piCache
}

export { loadPISdk }
