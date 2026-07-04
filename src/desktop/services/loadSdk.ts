// Claude (non-omp) backend enablement under `deno desktop`.
//
// Ported from src/main/index.ts:296-300, which used `Function('return import(...)')`
// to hide the specifier from esbuild (so it wouldn't bundle the SDK into the asar,
// where node couldn't read it). Under `deno desktop` there is no asar and no esbuild:
// a literal `import('@anthropic-ai/claude-agent-sdk')` specifier IS statically
// analyzable, so `deno desktop` embeds the package into the compiled VFS. Verified:
// the package resolves under deno node-compat as pure-JS ESM (no N-API addon), so —
// unlike sherpa-onnx-node — it needs NO sidecar.
//
// The dynamic `await import()` (rather than a top-level static import) is REQUIRED
// for graceful degradation: a top-level import failure aborts the whole desktop
// module graph and kills the still-working omp backend. Here a failure is caught
// and logged; `registerAgentSDK` simply stays uncalled and `loadAgentSDK()` throws
// only if a user actually selects the Claude backend.
import { registerAgentSDK } from "../../core/services/anthropic";
import { createLogger, errToCtx } from "../../core/utils/logger";

const log = createLogger("desktop/loadSdk");

/**
 * Resolve and register the Claude Agent SDK with Core so the non-omp (Claude)
 * backend is available. Call once at startup, before the engine handles a Claude
 * turn. Non-fatal on failure — the omp backend does not depend on this.
 */
export async function loadAndRegisterClaudeSDK(): Promise<void> {
  try {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    registerAgentSDK(sdk);
    log.info("Claude Agent SDK registered");
  } catch (err) {
    log.warn("Claude Agent SDK failed to load (Claude backend disabled; omp backend unaffected)", errToCtx(err));
  }
}
