// macOS OAuth token freshness for the Claude (non-omp) SDK session path.
//
// Ported from the macOS-only slice of src/main/utils/env.ts (ensureFreshMacOSToken +
// its readCliOAuthConfig helper). It is the sole dependency of sessionManager/setupAuth.ts
// that had no core home, so it lives beside its only consumer.
//
// Deno-desktop adaptations vs the Electron original:
//   - node builtins gained the `node:` prefix.
//   - `require.resolve('@anthropic-ai/claude-agent-sdk/cli.js')` → resourcePath(...) from
//     ../../paths (dev → Deno.cwd(); packaged → embedded VFS). The advisory is that node_modules
//     assets resolve via resourcePath, not createRequire(import.meta.url).
//
// Every path here is a no-op on non-Darwin (guarded by `process.platform !== 'darwin'`), so on
// the Linux verification target this module never touches Keychain / fetch. See report note: this
// overlaps the env porter's `setEnsureFreshToken` concern for the core-streaming path — the two
// SHOULD be consolidated onto one implementation once that porter lands.
import { userInfo } from "node:os";
import { promises as fsp } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { resourcePath } from "../../paths";
import { createLogger } from "../../../core/utils/logger";

const log = createLogger("macosToken");

/**
 * Read OAuth config from the installed Claude Agent SDK CLI bundle.
 * The client ID, token URL and scopes are defined in cli.js — reading them at
 * runtime means we stay in sync if the SDK is updated, instead of hardcoding.
 * Falls back to the values that were current when this was written.
 */
async function readCliOAuthConfig(): Promise<{ tokenUrl: string; clientId: string }> {
  try {
    // cli.js is a bundled JS file inside the package; resolve it as a repo/VFS asset.
    const cliPath = resourcePath("node_modules/@anthropic-ai/claude-agent-sdk/cli.js");
    const content = await fsp.readFile(cliPath, "utf8");
    // Matches: TOKEN_URL:"https://platform.claude.com/v1/oauth/token"
    const tokenUrl = content.match(/TOKEN_URL:"(https:\/\/[^"]+\/v1\/oauth\/token)"/)?.[1];
    // Matches: CLIENT_ID:"9d1c250a-e61b-44d9-88ed-5944d1962f5e"
    const clientId = content.match(/CLIENT_ID:"([0-9a-f-]{36})"/)?.[1];
    // Also respect the env var override the CLI itself uses
    return {
      tokenUrl: tokenUrl ?? "https://platform.claude.com/v1/oauth/token",
      clientId: process.env.CLAUDE_CODE_OAUTH_CLIENT_ID ?? clientId ?? "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    };
  } catch {
    return {
      tokenUrl: "https://platform.claude.com/v1/oauth/token",
      clientId: process.env.CLAUDE_CODE_OAUTH_CLIENT_ID ?? "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    };
  }
}

/**
 * Ensure process.env.CLAUDE_CODE_OAUTH_TOKEN is set and not expired.
 * If the token is expired, attempts a refresh_token grant against Claude's OAuth endpoint.
 * Updates the macOS Keychain with the refreshed credentials on success.
 * No-op on non-Darwin platforms.
 */
export async function ensureFreshMacOSToken(): Promise<void> {
  if (process.platform !== "darwin") return;

  try {
    const username = process.env.USER || userInfo().username;
    const credJson = execFileSync("security", [
      "find-generic-password", "-a", username, "-s", "Claude Code-credentials", "-w",
    ], { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();

    const creds = JSON.parse(credJson);
    const oauth = creds?.claudeAiOauth;
    if (!oauth?.accessToken) return;

    const expiresAt: number = oauth.expiresAt ?? 0;
    const isExpired = expiresAt > 0 && Date.now() > expiresAt;

    if (!isExpired) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = oauth.accessToken;
      return;
    }

    const refreshToken: string | undefined = oauth.refreshToken;
    if (!refreshToken) {
      log.error("OAuth token expired and no refresh token available");
      return;
    }

    log.info("OAuth token expired, refreshing");
    const { tokenUrl, clientId } = await readCliOAuthConfig();
    // Use the scopes from the stored credentials (exact scopes originally granted)
    const scopes = Array.isArray(oauth.scopes) ? oauth.scopes.join(" ") : "";
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        ...(scopes && { scope: scopes }),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error("token refresh failed", undefined, { status: res.status, body: body.slice(0, 200) });
      throw new Error(
        "Claude session expired. Run `claude login` in your terminal to re-authenticate, then try again.",
      );
    }

    const tokens = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!tokens.access_token) {
      log.error("token refresh response missing access_token");
      return;
    }

    const newExpiresAt = Date.now() + ((tokens.expires_in ?? 3600) * 1000);
    const updatedCreds = {
      ...creds,
      claudeAiOauth: {
        ...oauth,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? refreshToken,
        expiresAt: newExpiresAt,
      },
    };

    // Write refreshed credentials back to Keychain
    spawnSync(
      "security",
      ["add-generic-password", "-a", username, "-s", "Claude Code-credentials", "-w", JSON.stringify(updatedCreds), "-U"],
      { stdio: "ignore" },
    );

    process.env.CLAUDE_CODE_OAUTH_TOKEN = tokens.access_token;
    log.info("CLAUDE_CODE_OAUTH_TOKEN refreshed successfully");
  } catch (err) {
    // Re-throw auth errors (session expired, invalid_grant) so they surface in the UI.
    // Only swallow unexpected failures (network, JSON parsing, Keychain read).
    if (err instanceof Error && err.message.includes("claude login")) {
      throw err;
    }
    log.error("ensureFreshMacOSToken unexpected error", err);
  }
}
