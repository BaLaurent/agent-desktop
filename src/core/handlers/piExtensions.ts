import type { HandleRegistrar } from '../dispatch'
import type { PIExtensionInfo } from '../../shared/constants'
import { discoverOmpCommands } from '../services/pi/ompCommands'

/**
 * PI (Oh My Pi) extension discovery — core IPC surface.
 *
 * Under the omp RPC backend, omp owns its own extensions/skills (~/.omp + <cwd>/.omp)
 * inside the subprocess. We enumerate extension-sourced commands over RPC via
 * `discoverOmpCommands` (see `ompCommands.ts`) rather than touching an in-process SDK.
 *
 * `discoverPIExtensions` surfaces omp's `extension`-sourced commands to the
 * settings panel. Enforcement of the per-extension disable toggle
 * (`pi_disabledExtensions`) IS wired for agent turns: `streamingOmp` builds a
 * per-run `omp --config` overlay whose `disabledExtensions` is the UNION of
 * omp's effective list + the app's ids (see `ompConfigOverlay.ts`).
 * Residual: bundled/command-named extensions whose omp `extension-module:<derivedName>`
 * id (path-derived) differs from the command name are NOT reliably disable-able —
 * omp does not expose that derived id over RPC. `skill:`/`mcp:`/`slash-command:`
 * ids disable cleanly.
 */
export async function discoverPIExtensions(): Promise<PIExtensionInfo[]> {
  const commands = await discoverOmpCommands({ cwd: process.cwd() })
  return commands
    .filter((c) => c.source === 'extension')
    .map((c) => ({ name: c.name, path: c.name }))
}

/**
 * Extension-contributed slash commands. Under the omp backend these already flow
 * through `commands:list` (the pi branch calls `discoverOmpCommands` directly),
 * so this legacy hook — invoked only on the CLAUDE command path — returns [].
 */
export async function discoverPIExtensionCommands(): Promise<never[]> {
  return []
}

export function registerPIExtensionsHandlers(registrar: HandleRegistrar): void {
  registrar.handle('pi:listExtensions', async () => {
    try {
      return await discoverPIExtensions()
    } catch (err) {
      throw new Error(`Failed to list PI extensions: ${(err as Error).message}`)
    }
  })
}