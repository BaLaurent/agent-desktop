// Ported from src/main/services/knowledge.test.ts. The Electron test mocked electron
// (app.getPath/shell.showItemInFolder) + fs and asserted mkdir({recursive}) + showItemInFolder were
// called with a path containing "knowledges". The ported knowledge.ts uses node os.homedir() and
// ./opener revealInFileManager instead. Faithful equivalents, all on real seams (no ES-module
// mocking): ensureKnowledgesDir does a real recursive mkdir; kb:openKnowledgesFolder both ensures
// the dir and spawns the opener (captured via a Deno.Command override). NOTE the accepted
// degradation carried by revealInFileManager: it opens the CONTAINING directory (no highlight), so
// the spawned arg is <home>/.agent-desktop, not the knowledges dir itself.
import { assert, assertEquals } from "jsr:@std/assert";
import { join } from "node:path";

// HOME must be set before knowledge.ts evaluates its module-level
// `const KNOWLEDGES_DIR = join(homedir(), ".agent-desktop", "knowledges")`. A static import is
// hoisted above the Deno.env.set below and would bind the real home dir, polluting it. Genuine
// module-load-ordering boundary → dynamic import is required (the documented exception).
const MOCK_HOME = await Deno.makeTempDir({ prefix: "agent-kb-test-" });
Deno.env.set("HOME", MOCK_HOME);
const { registerHandlers, ensureKnowledgesDir, getKnowledgesDir, getSupportedExtensions } = await import("./knowledge.ts");

const KNOWLEDGES_DIR = join(MOCK_HOME, ".agent-desktop", "knowledges");

async function dirExists(path: string): Promise<boolean> {
  try {
    const st = await Deno.stat(path);
    return st.isDirectory;
  } catch {
    return false;
  }
}

Deno.test("getKnowledgesDir returns the ~/.agent-desktop/knowledges path", () => {
  const dir = getKnowledgesDir();
  assertEquals(dir, KNOWLEDGES_DIR);
  assert(dir.includes("knowledges"));
  assert(dir.includes(".agent-desktop"));
});

Deno.test("getSupportedExtensions exposes the text-file allowlist", () => {
  const exts = getSupportedExtensions();
  assert(exts.has(".md"));
  assert(exts.has(".txt"));
  assert(exts.has(".json"));
});

Deno.test("ensureKnowledgesDir creates the directory recursively", async () => {
  await Deno.remove(join(MOCK_HOME, ".agent-desktop"), { recursive: true }).catch(() => {});
  assertEquals(await dirExists(KNOWLEDGES_DIR), false);
  await ensureKnowledgesDir();
  assertEquals(await dirExists(KNOWLEDGES_DIR), true);
});

Deno.test("kb:openKnowledgesFolder ensures the dir and opens it via the file manager", async () => {
  await Deno.remove(join(MOCK_HOME, ".agent-desktop"), { recursive: true }).catch(() => {});

  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  registerHandlers({ handle: (ch, fn) => handlers.set(ch, fn) }, undefined);
  const handler = handlers.get("kb:openKnowledgesFolder");
  assert(handler !== undefined);

  // Capture the opener subprocess without launching a real file manager (plain fn, not a class, so
  // it can be `new`ed by the opener; restored in finally).
  let capturedArgs: string[] | null = null;
  const origCommand = Deno.Command;
  function FakeCommand(_cmd: string, opts: { args: string[] }) {
    capturedArgs = opts.args;
    return { spawn() { return { unref() {} }; } };
  }
  Object.defineProperty(Deno, "Command", { value: FakeCommand, configurable: true, writable: true });
  try {
    await handler!(null);
    // The knowledges dir was created…
    assertEquals(await dirExists(KNOWLEDGES_DIR), true);
    // …and the opener was invoked at the containing directory (reveal→parent degradation).
    assert(capturedArgs !== null);
    assertEquals(capturedArgs!.includes(join(MOCK_HOME, ".agent-desktop")), true);
  } finally {
    Object.defineProperty(Deno, "Command", { value: origCommand, configurable: true, writable: true });
  }
});
