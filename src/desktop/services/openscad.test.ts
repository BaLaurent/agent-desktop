// Ported from src/main/services/openscad.test.ts. The Electron test mocked child_process.spawn and
// fs/promises to simulate the OpenSCAD subprocess. A plain `deno test` can't replace the
// node:child_process binding, so instead of mocking we point `openscad_binaryPath` (read from the DB)
// at REAL stub shell scripts written to a temp dir — the ported openscad.ts spawns them for real,
// faithfully exercising success (base64 + warnings), non-zero exit, ENOENT, output-too-large, custom
// binary path, and validateConfig's found/not-found + version paths.
//
// Faithful divergence: the SIGTERM timeout case is NOT ported — TIMEOUT_MS is a hardcoded 60s and
// can't be shortened without editing the service, so exercising it would mean a 60s real wait (which
// the no-real-timers rule forbids). It is listed in the skip report.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { join } from "node:path";
import { writeFileSync, chmodSync } from "node:fs";
import type Database from "better-sqlite3";
import { createTestDb } from "../../core/__tests__/db-helper.ts";
import { compile, validateConfig } from "./openscad.ts";

const STUB_DIR = await Deno.makeTempDir({ prefix: "agent-openscad-stub-" });

function writeStub(name: string, body: string): string {
  const p = join(STUB_DIR, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

// Versatile stub: `--version` → prints a version line; otherwise (compile mode: -o <out> <scad>)
// writes fake 3mf bytes to the output arg ($2).
const OK_STUB = writeStub(
  "openscad-ok",
  'if [ "$1" = "--version" ]; then echo "OpenSCAD version 2024.12.06"; exit 0; fi\nprintf \'fake 3mf data\' > "$2"',
);
const WARN_STUB = writeStub("openscad-warn", 'printf \'fake 3mf data\' > "$2"\necho "WARNING: some deprecation" >&2');
const EXIT1_STUB = writeStub("openscad-exit1", 'echo "ERROR: syntax error" >&2\nexit 1');
const LARGE_STUB = writeStub("openscad-large", 'head -c 53477376 /dev/zero > "$2"');
const MISSING_BIN = "/nonexistent/openscad-xyzzy";

async function dbWithBinary(binaryPath: string): Promise<Database.Database> {
  const db = await createTestDb();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('openscad_binaryPath', ?)").run(binaryPath);
  // createTestDb returns the SqlJsAdapter; compile/validateConfig declare better-sqlite3's Database
  // (structurally satisfied by the adapter) — same boundary bridge registerServices.ts applies.
  return db as unknown as Database.Database;
}

Deno.test("openscad compile", async (t) => {
  await t.step("returns base64-encoded .3mf on success", async () => {
    const db = await dbWithBinary(OK_STUB);
    try {
      const result = await compile(db, "/tmp/test.scad");
      assertEquals(result.data, btoa("fake 3mf data"));
      assertEquals(result.warnings, "");
    } finally {
      db.close();
    }
  });

  await t.step("returns warnings from stderr on success", async () => {
    const db = await dbWithBinary(WARN_STUB);
    try {
      const result = await compile(db, "/tmp/test.scad");
      assertEquals(result.data, btoa("fake 3mf data"));
      assertEquals(result.warnings, "WARNING: some deprecation");
    } finally {
      db.close();
    }
  });

  await t.step("throws ENOENT when the binary is not found", async () => {
    const db = await dbWithBinary(MISSING_BIN);
    try {
      await assertRejects(() => compile(db, "/tmp/test.scad"), Error, "OpenSCAD binary not found");
    } finally {
      db.close();
    }
  });

  await t.step("throws on non-zero exit code with stderr detail", async () => {
    const db = await dbWithBinary(EXIT1_STUB);
    try {
      await assertRejects(() => compile(db, "/tmp/test.scad"), Error, "OpenSCAD exited with code 1: ERROR: syntax error");
    } finally {
      db.close();
    }
  });

  await t.step("throws when the output file is too large", async () => {
    const db = await dbWithBinary(LARGE_STUB);
    try {
      await assertRejects(() => compile(db, "/tmp/test.scad"), Error, "Output file too large");
    } finally {
      db.close();
    }
  });

  await t.step("uses the custom binary path from settings", async () => {
    // Proven by the fact the OK_STUB (a custom absolute path) produced a compile result above; here
    // we assert an unset/nonexistent custom path fails closed with the ENOENT message.
    const db = await dbWithBinary(MISSING_BIN);
    try {
      await assertRejects(() => compile(db, "/tmp/test.scad"), Error, "not found");
    } finally {
      db.close();
    }
  });
});

Deno.test("openscad validateConfig", async (t) => {
  await t.step("returns binaryFound + version when the binary is present", async () => {
    const db = await dbWithBinary(OK_STUB);
    try {
      const result = await validateConfig(db);
      assertEquals(result.binaryFound, true);
      assertEquals(result.binaryPath, OK_STUB);
      assertEquals(result.version, "OpenSCAD version 2024.12.06");
    } finally {
      db.close();
    }
  });

  await t.step("returns binaryFound false when the binary is missing", async () => {
    const db = await dbWithBinary(MISSING_BIN);
    try {
      const result = await validateConfig(db);
      assertEquals(result.binaryFound, false);
      assertEquals(result.version, "");
      assert(result.binaryPath === MISSING_BIN);
    } finally {
      db.close();
    }
  });
});
