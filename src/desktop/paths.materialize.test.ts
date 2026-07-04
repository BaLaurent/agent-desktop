// Durability regression tests for materializeResource(): copying a resource out of deno's
// read-only compiled VFS into a real, version-keyed userData dir so external processes (STT
// sidecar, cron/systemd taskRunner) can open it. The contracts pinned here (from the paths.ts
// doc comment): dev short-circuits to the cwd path with no copy; packaged copies once,
// byte-exact, into <userData>/materialized/<version>/<rel>; a cache hit re-uses that path
// without re-copying; a crash-left `.partial` is cleared before the copy; and older version
// dirs are pruned after a successful materialize.
//
// paths.ts reads AGENT_DEV / XDG_CONFIG_HOME at CALL time, and resourcePath() in packaged mode
// resolves ../../<rel> from src/desktop/paths.ts (= repo root) via import.meta.url. Under a bare
// `deno test` from the repo root that yields a real on-disk source, so we materialize an EXISTING
// small repo file read-only (never writing into the repo). Each case gets a fresh temp
// XDG_CONFIG_HOME so its userData/materialized tree is isolated.
import { assert, assertEquals } from "jsr:@std/assert";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { appVersion, materializeResource, resourcePath, userDataDir } from "./paths.ts";

// A tiny, stable resource that ships in the repo (see resources/stt/sttWorker.cjs).
const REL = "resources/stt/sttWorker.cjs";

Deno.test("materializeResource in dev mode returns the cwd path and copies nothing", () => {
  const tmp = Deno.makeTempDirSync({ prefix: "materialize-dev-" });
  Deno.env.set("XDG_CONFIG_HOME", tmp);
  Deno.env.set("AGENT_DEV", "1");
  try {
    assertEquals(materializeResource(REL), join(Deno.cwd(), REL));
    // No version-keyed cache is created — the dev path never touches userData.
    assertEquals(existsSync(join(userDataDir(), "materialized")), false);
  } finally {
    Deno.env.delete("AGENT_DEV");
  }
});

Deno.test("materializeResource (packaged)", async (t) => {
  Deno.env.delete("AGENT_DEV"); // packaged := AGENT_DEV !== "1"

  await t.step("copies the resource into <userData>/materialized/<version>/<rel>, byte-equal to the source", () => {
    const tmp = Deno.makeTempDirSync({ prefix: "materialize-copy-" });
    Deno.env.set("XDG_CONFIG_HOME", tmp);

    const dest = materializeResource(REL);

    assertEquals(dest, join(userDataDir(), "materialized", appVersion(), REL));
    assertEquals(Deno.readFileSync(dest), Deno.readFileSync(resourcePath(REL)));
    // The atomic-rename staging file is gone.
    assertEquals(existsSync(dest + ".partial"), false);
  });

  await t.step("returns the cached path on the second call without re-copying", () => {
    const tmp = Deno.makeTempDirSync({ prefix: "materialize-cache-" });
    Deno.env.set("XDG_CONFIG_HOME", tmp);

    const first = materializeResource(REL);
    // Tamper the materialized copy: a re-copy would overwrite this sentinel with the source bytes.
    Deno.writeTextFileSync(first, "SENTINEL-NOT-THE-SOURCE");

    const second = materializeResource(REL);

    assertEquals(second, first);
    assertEquals(Deno.readTextFileSync(second), "SENTINEL-NOT-THE-SOURCE"); // untouched → cache hit, no re-copy
  });

  await t.step("clears a crash-left .partial before copying, then materializes cleanly", () => {
    const tmp = Deno.makeTempDirSync({ prefix: "materialize-partial-" });
    Deno.env.set("XDG_CONFIG_HOME", tmp);

    const dest = join(userDataDir(), "materialized", appVersion(), REL);
    const partial = dest + ".partial";
    // A crash mid-copy left a bogus .partial DIRECTORY. If it were not cleared, copyFileSync
    // into it would fail (EISDIR) and materialize would throw.
    Deno.mkdirSync(partial, { recursive: true });
    Deno.writeTextFileSync(join(partial, "junk"), "stale");

    const result = materializeResource(REL);

    assertEquals(result, dest);
    assertEquals(existsSync(partial), false);
    assertEquals(Deno.readFileSync(dest), Deno.readFileSync(resourcePath(REL)));
  });

  await t.step("prunes materialized dirs from other app versions after a new materialize", () => {
    const tmp = Deno.makeTempDirSync({ prefix: "materialize-prune-" });
    Deno.env.set("XDG_CONFIG_HOME", tmp);

    const root = join(userDataDir(), "materialized");
    const staleVersionDir = join(root, "0.0.1-ancient");
    Deno.mkdirSync(staleVersionDir, { recursive: true });
    Deno.writeTextFileSync(join(staleVersionDir, "old.bin"), "old");

    const dest = materializeResource(REL);

    assertEquals(dest, join(root, appVersion(), REL));
    assert(existsSync(join(root, appVersion())));
    // The previous version's cache was pruned.
    assertEquals(existsSync(staleVersionDir), false);
  });
});
