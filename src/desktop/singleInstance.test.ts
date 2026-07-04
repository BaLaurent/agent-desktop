// Durability regression tests for the Chromium-format SingletonLock that singleInstance.ts
// reproduces. The lock is the ONLY signal the headless taskRunner uses to stand down while the
// desktop owns the sql.js DB (dual live writers = last-flush-wins data loss), so its exact shape
// is load-bearing: a DANGLING symlink whose target string is `${hostname}-${pid}`.
//
// XDG_CONFIG_HOME is redirected per test so userDataDir() (read at call time) — and thus the
// instance.sock path — is isolated: each acquire hits a fresh dir with no socket, so it always
// wins the primary role rather than connecting to a prior test's still-listening server. The
// two-process race is out of scope (documented in the assignment).
//
// acquireSingleInstance intentionally leaves a listening primary server with NO exported
// shutdown (in production the primary listens for the app's lifetime); the sanitizers are
// therefore disabled on the acquiring tests — the leak is the contract, not a bug.
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { hostname } from "node:os";
import { join } from "node:path";
import { acquireSingleInstance, releaseSingletonLock } from "./singleInstance.ts";
import { userDataDir } from "./paths.ts";

Deno.test({
  name: "acquireSingleInstance becomes primary and writes a dangling ${hostname}-${pid} SingletonLock that release() removes",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const tmp = await Deno.makeTempDir({ prefix: "single-instance-primary-" });
  Deno.env.set("XDG_CONFIG_HOME", tmp);
  const dataDir = userDataDir();
  Deno.mkdirSync(dataDir, { recursive: true }); // caller contract: the dir must exist before acquire
  const lock = join(dataDir, "SingletonLock");

  let handoffArgv: string[] | null = null;
  const isPrimary = await acquireSingleInstance((argv) => {
    handoffArgv = argv;
  });

  assertEquals(isPrimary, true);
  // It is a symlink …
  assertEquals(Deno.lstatSync(lock).isSymlink, true);
  // … whose target is the Chromium-format host-pid string …
  assertEquals(Deno.readLinkSync(lock), `${hostname()}-${Deno.pid}`);
  // … and DANGLING: the target is not a real path, so following it (statSync) fails.
  assertThrows(() => Deno.statSync(lock));
  // No hand-off happened — we are the sole primary.
  assertEquals(handoffArgv, null);

  // Clean shutdown removes the lock.
  releaseSingletonLock();
  assertThrows(() => Deno.lstatSync(lock));
});

Deno.test({
  name: "acquireSingleInstance overwrites a stale SingletonLock with the current process's target",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const tmp = await Deno.makeTempDir({ prefix: "single-instance-stale-" });
  Deno.env.set("XDG_CONFIG_HOME", tmp);
  const dataDir = userDataDir();
  Deno.mkdirSync(dataDir, { recursive: true });
  const lock = join(dataDir, "SingletonLock");

  // A stale lock left by a dead process / the Electron era: a symlink to a bogus host-pid target.
  Deno.symlinkSync("ghost-host-999999", lock);
  assertEquals(Deno.readLinkSync(lock), "ghost-host-999999");

  const isPrimary = await acquireSingleInstance(() => {});

  assertEquals(isPrimary, true);
  // The stale target is replaced with THIS process's identity.
  assertEquals(Deno.readLinkSync(lock), `${hostname()}-${Deno.pid}`);

  releaseSingletonLock();
});

Deno.test({
  name: "a second acquire in the same process forwards its argv to the primary and resolves false",
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const tmp = await Deno.makeTempDir({ prefix: "single-instance-handoff-" });
  Deno.env.set("XDG_CONFIG_HOME", tmp);
  Deno.mkdirSync(userDataDir(), { recursive: true });

  // The primary listens; its callback captures any forwarded argv (the sole Linux deep-link path).
  const { promise: gotHandoff, resolve: sawHandoff } = Promise.withResolvers<string[]>();
  const primary = await acquireSingleInstance((argv) => sawHandoff(argv));
  assertEquals(primary, true);

  // A later launch in THIS process connects to the live primary, hands off argv, and exits —
  // it must NEVER open a second server (dual sql.js writers = data loss).
  const secondary = await acquireSingleInstance(() => {});
  assertEquals(secondary, false);

  // The primary received the forwarded argv over the socket.
  assertEquals(await gotHandoff, Deno.args);

  releaseSingletonLock();
});
