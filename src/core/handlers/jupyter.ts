import type { HandleRegistrar } from '../dispatch'
import { createJupyterService, shutdownAllKernels, type JupyterService, type JupyterServiceOptions } from '../services/jupyter'
import { validateString } from '../utils/validate'

export interface JupyterHandlerOptions extends JupyterServiceOptions {}

/**
 * Registers the Jupyter kernel channel surface. The service is constructed
 * once per call and the kernels map is module-level state (mirroring the
 * former `src/main/services/jupyter.ts`); `shutdownAllKernels` is exported so
 * Electron shutdown / headless server stop can flush them.
 */
export function registerJupyterHandlers(registrar: HandleRegistrar, options: JupyterHandlerOptions): void {
  const service: JupyterService = createJupyterService(options)

  registrar.handle('jupyter:startKernel', (_e, filePath: unknown, kernelName?: unknown) => {
    const fp = validateString(filePath, 'filePath')
    const kn = kernelName != null ? validateString(kernelName, 'kernelName', 100) : undefined
    return service.startKernel(fp, kn)
  })

  registrar.handle('jupyter:executeCell', (_e, filePath: unknown, code: unknown) => {
    const fp = validateString(filePath, 'filePath')
    const c = validateString(code, 'code', 10_000_000)
    return service.executeCell(fp, c)
  })

  registrar.handle('jupyter:interruptKernel', (_e, filePath: unknown) => {
    service.interruptKernel(validateString(filePath, 'filePath'))
  })

  registrar.handle('jupyter:restartKernel', (_e, filePath: unknown) => {
    service.restartKernel(validateString(filePath, 'filePath'))
  })

  registrar.handle('jupyter:shutdownKernel', (_e, filePath: unknown) => {
    service.shutdownKernel(validateString(filePath, 'filePath'))
  })

  registrar.handle('jupyter:getStatus', (_e, filePath: unknown) => {
    return service.getStatus(validateString(filePath, 'filePath'))
  })

  registrar.handle('jupyter:detectJupyter', () => {
    return service.detectJupyter()
  })
}

export { shutdownAllKernels }