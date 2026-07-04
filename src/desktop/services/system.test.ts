// Ported from src/main/services/system.test.ts. Electron API swaps under test:
//   app.getVersion/getPath → appVersion()/userDataDir() (../paths); shell.openExternal → ./opener
//   (spawn, captured via a Deno.Command override); Notification → Web Notification (stubbed on
//   globalThis for the happy path — undefined in a bare deno runtime); dialog.showOpenDialog →
//   ./nativeDialogs selectFolder(), whose zenity/kdialog subprocess we drive by faking
//   Deno.Command().output(). Also covers the NEW system:importDroppedFile channel (CEF drag-drop).
// Faithful divergence: the Electron "passes parent BrowserWindow (sheet-modal)" selectFolder case
// has no counterpart — deno-desktop dialogs are process-modal CLI helpers with no parent window
// (intentional port decision), so it is dropped.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { join } from "node:path";
import type { HandleRegistrar } from "../../core/dispatch.ts";
import { registerHandlers } from "./system.ts";
import { userDataDir } from "../paths.ts";

// Sandbox userData (dbPath/configPath + the dropped-file dir). userDataDir() prefers XDG_CONFIG_HOME
// over HOME and reads both lazily, so setting them here (before any handler call) suffices.
const TMP = await Deno.makeTempDir({ prefix: "agent-system-test-" });
Deno.env.set("HOME", TMP);
Deno.env.set("XDG_CONFIG_HOME", join(TMP, ".config"));

interface SystemInfo {
  version: string;
  electron: string;
  node: string;
  platform: string;
  dbPath: string;
  configPath: string;
  sessionType: string;
}

interface TestDispatch extends HandleRegistrar {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

function makeDispatch(): TestDispatch {
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
  registerHandlers(dispatch, undefined);
  return dispatch;
}

// Fake Deno.Command covering both opener (`.spawn().unref()`) and nativeDialogs (`.output()`).
function patchCommand(output?: { success: boolean; stdout: string }): {
  captured: () => { cmd: string; args: string[] } | null;
  restore: () => void;
} {
  let captured: { cmd: string; args: string[] } | null = null;
  const orig = Deno.Command;
  function FakeCommand(cmd: string, opts?: { args?: string[] }) {
    captured = { cmd, args: opts?.args ?? [] };
    return {
      spawn() {
        return { unref() {} };
      },
      output() {
        return Promise.resolve({
          success: output?.success ?? true,
          stdout: new TextEncoder().encode(output?.stdout ?? ""),
          stderr: new Uint8Array(),
          code: 0,
          signal: null,
        });
      },
    };
  }
  Object.defineProperty(Deno, "Command", { value: FakeCommand, configurable: true, writable: true });
  return {
    captured: () => captured,
    restore: () => Object.defineProperty(Deno, "Command", { value: orig, configurable: true, writable: true }),
  };
}

const dispatch = makeDispatch();

Deno.test("system:getInfo returns runtime information", async () => {
  // dispatch returns unknown; getInfo's shape is fixed by the handler under test.
  const info = (await dispatch.invoke("system:getInfo")) as SystemInfo;
  assertEquals(info.version, "0.18.0-dev");
  assertEquals(info.electron, "");
  assertEquals(info.node, Deno.version.deno);
  assertEquals(info.platform, Deno.build.os);
  assertEquals(info.dbPath, userDataDir());
  assertEquals(info.configPath, userDataDir());
  assertEquals(info.dbPath, join(TMP, ".config", "agent-desktop"));
  assertEquals(typeof info.sessionType, "string");
  assert(info.sessionType.length > 0);
});

Deno.test("system:openExternal", async (t) => {
  await t.step("opens a valid http URL via the opener", async () => {
    const cmd = patchCommand();
    try {
      await dispatch.invoke("system:openExternal", "http://example.com/");
      const c = cmd.captured();
      assert(c !== null);
      assertEquals(c!.args.includes("http://example.com/"), true);
    } finally {
      cmd.restore();
    }
  });

  await t.step("opens a valid https URL via the opener", async () => {
    const cmd = patchCommand();
    try {
      await dispatch.invoke("system:openExternal", "https://example.com/");
      assertEquals(cmd.captured()!.args.includes("https://example.com/"), true);
    } finally {
      cmd.restore();
    }
  });

  await t.step("blocks file: protocol", async () => {
    await assertRejects(() => dispatch.invoke("system:openExternal", "file:///etc/passwd"), Error, "Blocked protocol: file:");
  });
  await t.step("blocks javascript: protocol", async () => {
    await assertRejects(() => dispatch.invoke("system:openExternal", "javascript:alert(1)"), Error, "Blocked protocol: javascript:");
  });
  await t.step("blocks data: protocol", async () => {
    await assertRejects(() => dispatch.invoke("system:openExternal", "data:text/html,<script>alert(1)</script>"), Error, "Blocked protocol: data:");
  });
  await t.step("throws on invalid URL format", async () => {
    await assertRejects(() => dispatch.invoke("system:openExternal", "not-a-url"), Error, "Invalid URL format");
  });
  await t.step("throws on non-string URL", async () => {
    await assertRejects(() => dispatch.invoke("system:openExternal", 123), Error, "Invalid URL");
  });
  await t.step("throws on null URL", async () => {
    await assertRejects(() => dispatch.invoke("system:openExternal", null), Error, "Invalid URL");
  });
});

Deno.test("system:showNotification", async (t) => {
  await t.step("resolves for a valid title and body", async () => {
    // Notification is undefined in a bare deno runtime; the desktop runtime provides the Web API.
    // Supply a stub so the handler's `new Notification(...)` succeeds (the happy path under test).
    const orig = (globalThis as { Notification?: unknown }).Notification;
    class StubNotification {
      constructor(public title: string, public opts?: { body?: string }) {}
    }
    Object.defineProperty(globalThis, "Notification", { value: StubNotification, configurable: true, writable: true });
    try {
      await dispatch.invoke("system:showNotification", "Test Title", "Test Body");
    } finally {
      Object.defineProperty(globalThis, "Notification", { value: orig, configurable: true, writable: true });
    }
  });

  await t.step("throws on non-string title", async () => {
    await assertRejects(() => dispatch.invoke("system:showNotification", 123, "Body"), Error, "must be strings");
  });
  await t.step("throws on non-string body", async () => {
    await assertRejects(() => dispatch.invoke("system:showNotification", "Title", 123), Error, "must be strings");
  });
  await t.step("throws on oversized title", async () => {
    await assertRejects(() => dispatch.invoke("system:showNotification", "a".repeat(501), "Body"), Error, "exceeds maximum length");
  });
  await t.step("throws on oversized body", async () => {
    await assertRejects(() => dispatch.invoke("system:showNotification", "Title", "a".repeat(501)), Error, "exceeds maximum length");
  });
});

Deno.test("system:selectFolder", async (t) => {
  await t.step("returns the folder path when the user selects one", async () => {
    const cmd = patchCommand({ success: true, stdout: "/home/user/selected" });
    try {
      assertEquals(await dispatch.invoke("system:selectFolder"), "/home/user/selected");
    } finally {
      cmd.restore();
    }
  });

  await t.step("returns null when the user cancels (non-zero exit)", async () => {
    const cmd = patchCommand({ success: false, stdout: "" });
    try {
      assertEquals(await dispatch.invoke("system:selectFolder"), null);
    } finally {
      cmd.restore();
    }
  });

  await t.step("returns null when no path is selected (empty stdout)", async () => {
    const cmd = patchCommand({ success: true, stdout: "" });
    try {
      assertEquals(await dispatch.invoke("system:selectFolder"), null);
    } finally {
      cmd.restore();
    }
  });
});

Deno.test("system:importDroppedFile", async (t) => {
  await t.step("writes bytes under <userData>/dropped and returns the path", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const dest = await dispatch.invoke("system:importDroppedFile", "photo.png", bytes);
    assertEquals(typeof dest, "string");
    if (typeof dest !== "string") return;
    assert(dest.startsWith(join(userDataDir(), "dropped")));
    assert(dest.endsWith("photo.png"));
    const written = await Deno.readFile(dest);
    assertEquals(Array.from(written), Array.from(bytes));
  });

  await t.step("sanitizes path separators in the file name", async () => {
    const dest = await dispatch.invoke("system:importDroppedFile", "e/vil.png", new Uint8Array([1]));
    assertEquals(typeof dest, "string");
    if (typeof dest !== "string") return;
    assert(dest.endsWith("e_vil.png"));
  });

  await t.step("throws on a non-string name", async () => {
    await assertRejects(() => dispatch.invoke("system:importDroppedFile", 42, new Uint8Array([1])), Error, "name must be a string");
  });

  await t.step("throws when bytes are not a Uint8Array", async () => {
    await assertRejects(() => dispatch.invoke("system:importDroppedFile", "x.bin", "notbytes"), Error, "bytes must be a Uint8Array");
  });
});
