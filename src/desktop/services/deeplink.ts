// Ported from src/main/services/deeplink.ts. Under deno desktop the `agent://` scheme is
// registered declaratively via deno.json `app.deepLinks` (no runtime app.setAsDefaultProtocolClient),
// and opened URLs are delivered on Linux/Windows as argv to a fresh process instance that the
// single-instance guard forwards to the primary (see src/desktop/main.ts + singleInstance.ts,
// which broadcast `deeplink:navigate` with the parsed conversation id). This module owns only
// the URL -> conversationId parsing that the primary applies to the forwarded argv.
//
// DEGRADATION: macOS deep-link delivery has no deno-desktop equivalent yet — Electron's
// `app.on('open-url')` is gone and deno desktop does not yet deliver opened URLs at runtime.
// Linux/Windows argv delivery works; the macOS gap is recorded in the backlog.

/**
 * Parse an `agent://conversation/<id>` deep link into its conversation id.
 *
 * Returns null for any other host/shape or a non-numeric id — faithful to the Electron original,
 * which navigated only on the `conversation` host with a numeric first path segment and logged
 * (then ignored) anything else.
 */
export function parseDeepLink(url: string): number | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.host !== "conversation") return null;
  const first = parsed.pathname.replace(/^\/+/, "").split("/")[0];
  if (!first) return null;
  const id = parseInt(first, 10);
  return Number.isNaN(id) ? null : id;
}
