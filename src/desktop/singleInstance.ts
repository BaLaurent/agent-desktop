// Single-instance guard — replaces Electron's app.requestSingleInstanceLock(), preserving
// the single-DB-writer guarantee. Uses a node:net IPC socket (unix domain socket on
// Linux/macOS, named pipe on Windows) at <userDataDir>/instance.sock — same pattern as
// src/core/services/schedulerBridge.ts.
//
// The first process to listen is the primary. A later launch connects, hands off its argv
// (for agent:// deep links — on Linux this is the ONLY deep-link delivery path, since deno
// desktop does not yet deliver opened URLs at runtime), and exits. The primary reacts via
// `onSecondInstance`. A stale socket (primary crashed → ECONNREFUSED) is unlinked and
// reclaimed. On a simultaneous-launch race the loser NEVER becomes a second primary.
//
// The caller MUST ensure userDataDir() exists (mkdir) before calling, so listen() cannot
// fail for a missing directory.
import net from "node:net";
import { Buffer } from "node:buffer";
import { hostname } from "node:os";
import { join } from "node:path";
import { userDataDir } from "./paths";

// Chromium-format singleton lock: a DANGLING symlink whose TARGET string encodes
// `${hostname}-${pid}`. Electron/Chromium created this automatically next to agent.db; the
// headless taskRunner reads it (src/headless/taskRunner.ts desktopInstanceAlive) and stands
// down while the desktop owns the DB — critical under sql.js, where two live writers mean
// last-flush-wins data loss. The deno shell must reproduce it. POSIX-only, matching both
// Chromium and the reader (Windows Electron never had a SingletonLock either).
function writeSingletonLock(): void {
  if (Deno.build.os === "windows") return;
  const lock = join(userDataDir(), "SingletonLock");
  try {
    Deno.removeSync(lock); // stale lock from a crash or the Electron era
  } catch {
    // no stale lock
  }
  try {
    Deno.symlinkSync(`${hostname()}-${Deno.pid}`, lock);
  } catch {
    // the lock is advisory — never block startup on it
  }
}

/** Remove the singleton lock on clean shutdown (crash-left locks are inert: the reader
 *  pid-liveness-checks the target). */
export function releaseSingletonLock(): void {
  if (Deno.build.os === "windows") return;
  try {
    Deno.removeSync(join(userDataDir(), "SingletonLock"));
  } catch {
    // already gone
  }
}

function socketPath(): string {
  return Deno.build.os === "windows"
    ? "\\\\.\\pipe\\agent-desktop-single"
    : join(userDataDir(), "instance.sock");
}

function errorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return undefined;
}

/**
 * Resolves `true` if this process is the primary (it now owns the lock and listens for
 * hand-offs), or `false` if another primary is already running (our argv was forwarded and
 * the caller should exit immediately).
 */
export function acquireSingleInstance(onSecondInstance: (argv: string[]) => void): Promise<boolean> {
  const path = socketPath();
  const { promise, resolve } = Promise.withResolvers<boolean>();

  function forwardArgv(conn: net.Socket): void {
    conn.end(JSON.stringify({ argv: Deno.args }));
    resolve(false);
  }

  function becomePrimary(): void {
    const server = net.createServer((conn) => {
      const chunks: Buffer[] = [];
      conn.on("data", (c: Buffer) => chunks.push(c));
      conn.on("end", () => {
        try {
          const msg = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
          if (msg && Array.isArray(msg.argv)) onSecondInstance(msg.argv);
        } catch {
          // malformed hand-off — ignore
        }
      });
    });
    server.once("error", (err: unknown) => {
      if (errorCode(err) === "EADDRINUSE") {
        // Lost a simultaneous-launch race — a peer already listens. Forward argv to it and
        // exit; NEVER open a second server (would create dual agent.db writers).
        const retry = net.createConnection(path);
        retry.once("connect", () => forwardArgv(retry));
        retry.once("error", () => resolve(false));
        return;
      }
      // Unexpected listen failure (not a race) — run as primary rather than fail to start.
      writeSingletonLock();
      resolve(true);
    });
    server.listen(path, () => {
      writeSingletonLock();
      resolve(true);
    });
  }

  const client = net.createConnection(path);
  client.once("connect", () => forwardArgv(client));
  client.once("error", (err: unknown) => {
    // ECONNREFUSED = stale socket left by a dead primary → unlink and reclaim.
    // ENOENT / other = no live primary → just listen.
    if (Deno.build.os !== "windows" && errorCode(err) === "ECONNREFUSED") {
      try {
        Deno.removeSync(path);
      } catch {
        // already gone
      }
    }
    becomePrimary();
  });

  return promise;
}
