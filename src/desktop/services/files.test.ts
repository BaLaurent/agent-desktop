// Ported from src/main/services/files.test.ts. The Electron test's big "files IPC handlers" block
// exercised the CORE handlers (files:listTree/listDir/readFile/rename/…) registered by
// core/handlers/files.ts — those are out of scope here (core owns their tests). This port covers what
// the DESKTOP files.ts actually owns:
//   - classifyFileExt + mimeToExt: pure, exported — ported in full.
//   - files:revealInFileManager / files:openWithDefault / files:trash: the three Electron-only
//     handlers. Electron API swaps under test: shell.showItemInFolder/openPath → the ./opener spawn
//     (captured via a Deno.Command override, no GUI launched); shell.trashItem → npm `trash`.
// Faithful divergences (documented inline):
//   - reveal opens the CONTAINING dir (opener degradation: no highlight), so the spawn arg is the
//     parent dir, not the file itself.
//   - openWithDefault is fire-and-forget under deno (no shell.openPath error string), so the
//     Electron "throws when openPath returns an error string" case has no counterpart.
//   - files:trash actually moves to the OS trash; the success path is not unit-exercised (real
//     side effect + needs a desktop trash backend). Its security gate (dangerous path + write
//     whitelist) IS tested, which is the load-bearing behavior. The ported handler ALSO adds
//     executable-extension / executable-permission guards absent from the Electron original — tested.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { join } from "node:path";
import { writeFileSync, chmodSync } from "node:fs";
import type { HandleRegistrar } from "../../core/dispatch.ts";
import { createTestDb } from "../../core/__tests__/db-helper.ts";
import { classifyFileExt, mimeToExt, registerHandlers } from "./files.ts";

interface TestDispatch extends HandleRegistrar {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

function makeDispatch(db: unknown): TestDispatch {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const dispatch: TestDispatch = {
    handle(channel, listener) {
      handlers.set(channel, listener);
    },
    async invoke(channel, ...args) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler for ${channel}`);
      return await handler(null, ...args);
    },
  };
  registerHandlers(dispatch, db);
  return dispatch;
}

// Intercept the opener subprocess (opener.ts does `new Deno.Command(cmd,{args}).spawn().unref()`).
// A plain constructor-function is used so `new` works (a class would throw when a spy calls it
// without `new`); restore is the caller's responsibility.
function interceptCommand(): { captured: () => { cmd: string; args: string[] } | null; restore: () => void } {
  let captured: { cmd: string; args: string[] } | null = null;
  const orig = Deno.Command;
  function FakeCommand(cmd: string, opts: { args: string[] }) {
    captured = { cmd, args: opts.args };
    return { spawn() { return { unref() {} }; } };
  }
  Object.defineProperty(Deno, "Command", { value: FakeCommand, configurable: true, writable: true });
  return {
    captured: () => captured,
    restore: () => Object.defineProperty(Deno, "Command", { value: orig, configurable: true, writable: true }),
  };
}

Deno.test("classifyFileExt", async (t) => {
  await t.step("returns html for html/htm", () => {
    assertEquals(classifyFileExt("html"), "html");
    assertEquals(classifyFileExt("htm"), "html");
  });
  await t.step("returns svg for svg", () => assertEquals(classifyFileExt("svg"), "svg"));
  await t.step("returns markdown for md", () => assertEquals(classifyFileExt("md"), "markdown"));
  await t.step("returns typescript for ts/tsx", () => {
    assertEquals(classifyFileExt("ts"), "typescript");
    assertEquals(classifyFileExt("tsx"), "typescript");
  });
  await t.step("returns python for py", () => assertEquals(classifyFileExt("py"), "python"));
  await t.step("returns the extension itself for unknown types", () => assertEquals(classifyFileExt("xyz"), "xyz"));
  await t.step("returns null for empty string", () => assertEquals(classifyFileExt(""), null));
});

Deno.test("mimeToExt", async (t) => {
  await t.step("maps known image mime types", () => {
    assertEquals(mimeToExt("image/png"), "png");
    assertEquals(mimeToExt("image/jpeg"), "jpg");
    assertEquals(mimeToExt("image/gif"), "gif");
    assertEquals(mimeToExt("image/webp"), "webp");
    assertEquals(mimeToExt("image/bmp"), "bmp");
    assertEquals(mimeToExt("image/svg+xml"), "svg");
    assertEquals(mimeToExt("image/avif"), "avif");
  });
  await t.step("returns null for unknown mime types", () => {
    assertEquals(mimeToExt("application/pdf"), null);
    assertEquals(mimeToExt("text/plain"), null);
    assertEquals(mimeToExt(""), null);
  });
});

Deno.test("files:revealInFileManager", async (t) => {
  const db = await createTestDb();
  const testDir = await Deno.makeTempDir({ prefix: "agent-files-reveal-" });
  const dispatch = makeDispatch(db);
  try {
    await t.step("opens the containing directory of a resolved file", async () => {
      const filePath = join(testDir, "reveal.txt");
      writeFileSync(filePath, "hi");
      const cmd = interceptCommand();
      try {
        await dispatch.invoke("files:revealInFileManager", filePath);
        const c = cmd.captured();
        assert(c !== null);
        // reveal → containing dir (accepted opener degradation: no file highlight)
        assertEquals(c!.args.includes(testDir), true);
      } finally {
        cmd.restore();
      }
    });

    await t.step("rejects dangerous paths", async () => {
      await assertRejects(() => dispatch.invoke("files:revealInFileManager", "/proc/self"), Error, "protected directory");
    });

    await t.step("refuses to reveal executable-extension files", async () => {
      const scriptPath = join(testDir, "danger.sh");
      writeFileSync(scriptPath, "#!/bin/sh\n");
      await assertRejects(() => dispatch.invoke("files:revealInFileManager", scriptPath), Error, "blocked for security");
    });

    await t.step("rejects a non-string path", async () => {
      await assertRejects(() => dispatch.invoke("files:revealInFileManager", 42), Error);
    });
  } finally {
    db.close();
    await Deno.remove(testDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("files:openWithDefault", async (t) => {
  const db = await createTestDb();
  const testDir = await Deno.makeTempDir({ prefix: "agent-files-open-" });
  const dispatch = makeDispatch(db);
  try {
    await t.step("opens a resolved file with the default handler", async () => {
      const filePath = join(testDir, "open.txt");
      writeFileSync(filePath, "hi");
      const cmd = interceptCommand();
      try {
        await dispatch.invoke("files:openWithDefault", filePath);
        const c = cmd.captured();
        assert(c !== null);
        assertEquals(c!.args.includes(filePath), true);
      } finally {
        cmd.restore();
      }
    });

    await t.step("refuses to open executable-extension files", async () => {
      const scriptPath = join(testDir, "danger.desktop");
      writeFileSync(scriptPath, "[Desktop Entry]\n");
      await assertRejects(() => dispatch.invoke("files:openWithDefault", scriptPath), Error, "blocked for security");
    });

    await t.step("refuses to open files with executable permissions (linux)", async () => {
      if (Deno.build.os !== "linux") return;
      const execPath = join(testDir, "runnable.bin");
      writeFileSync(execPath, "data");
      chmodSync(execPath, 0o755);
      await assertRejects(() => dispatch.invoke("files:openWithDefault", execPath), Error, "executable permissions");
    });

    await t.step("rejects dangerous paths", async () => {
      await assertRejects(() => dispatch.invoke("files:openWithDefault", "/proc/cpuinfo"), Error, "protected directory");
    });
  } finally {
    db.close();
    await Deno.remove(testDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("files:trash (security gate)", async (t) => {
  const testDir = await Deno.makeTempDir({ prefix: "agent-files-trash-" });
  try {
    await t.step("rejects dangerous paths before trashing", async () => {
      const db = await createTestDb();
      try {
        const dispatch = makeDispatch(db);
        await assertRejects(() => dispatch.invoke("files:trash", "/proc/self"), Error, "protected directory");
      } finally {
        db.close();
      }
    });

    await t.step("denies trashing a path outside the readwrite whitelist", async () => {
      const db = await createTestDb();
      try {
        // Seed a whitelist that does NOT cover testDir → checkWriteAllowed returns the offending
        // path → the handler throws BEFORE reaching the real `trash` (no OS-trash side effect).
        const whitelist = JSON.stringify([{ path: "/some/other/allowed", access: "readwrite" }]);
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('hooks_cwdWhitelist', ?)").run(whitelist);
        const dispatch = makeDispatch(db);

        const filePath = join(testDir, "trash-me.txt");
        writeFileSync(filePath, "bye");
        await assertRejects(() => dispatch.invoke("files:trash", filePath), Error, "Write access denied");
      } finally {
        db.close();
      }
    });
  } finally {
    await Deno.remove(testDir, { recursive: true }).catch(() => {});
  }
});
