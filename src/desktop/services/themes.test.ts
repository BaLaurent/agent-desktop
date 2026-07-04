// Ported from src/main/services/themes.test.ts. The Electron test mocked electron's
// app.getPath('home') to a temp dir; the ported themes.ts uses node os.homedir() instead, so we
// redirect HOME at runtime. All theme logic lives in the Electron-free core ThemesService, which
// this test drives through the ported dispatch handlers exactly as the original drove them through
// the mock ipcMain — a real-filesystem, faithful port.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { join } from "node:path";
import { promises as fsp } from "node:fs";
import type { HandleRegistrar } from "../../core/dispatch.ts";
import type { ThemeFile } from "../../core/types.ts";

// HOME must point at the temp dir BEFORE themes.ts evaluates, because that module captures
// `const THEMES_DIR = join(homedir(), ".agent-desktop", "themes")` at load time. A static import is
// hoisted above the Deno.env.set() below, so it would bind THEMES_DIR to the real home dir and
// pollute the developer's ~/.agent-desktop. This is a genuine module-load-ordering boundary — the
// one documented exception to static-imports-only — so the specifier is dynamic on purpose.
const MOCK_HOME = await Deno.makeTempDir({ prefix: "agent-theme-test-" });
Deno.env.set("HOME", MOCK_HOME);
const { registerHandlers, ensureThemeDir } = await import("./themes.ts");

const THEMES_DIR = join(MOCK_HOME, ".agent-desktop", "themes");

interface TestDispatch extends HandleRegistrar {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

function makeDispatch(): TestDispatch {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  return {
    handle(channel, listener) {
      handlers.set(channel, listener);
    },
    async invoke(channel, ...args) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler for ${channel}`);
      return await handler(null, ...args);
    },
  };
}

// Mirrors the Electron test's beforeEach: wipe the dir, seed builtins, register fresh handlers.
async function setup(): Promise<TestDispatch> {
  await fsp.rm(join(MOCK_HOME, ".agent-desktop"), { recursive: true, force: true });
  await ensureThemeDir();
  const dispatch = makeDispatch();
  registerHandlers(dispatch, undefined);
  return dispatch;
}

async function cleanup(): Promise<void> {
  await fsp.rm(join(MOCK_HOME, ".agent-desktop"), { recursive: true, force: true });
}

Deno.test("themes service (real filesystem)", async (t) => {
  await t.step("ensureThemeDir creates directory and builtin files", async () => {
    await setup();
    const files = await fsp.readdir(THEMES_DIR);
    assert(files.includes("default-dark.css"));
    assert(files.includes("default-light.css"));
    await cleanup();
  });

  await t.step("ensureThemeDir does not overwrite existing builtin files", async () => {
    await setup();
    const darkPath = join(THEMES_DIR, "default-dark.css");
    await fsp.writeFile(darkPath, "/* custom */");
    await ensureThemeDir();
    assertEquals(await fsp.readFile(darkPath, "utf-8"), "/* custom */");
    await cleanup();
  });

  await t.step("list returns builtin themes", async () => {
    const d = await setup();
    const themes = (await d.invoke("themes:list")) as ThemeFile[];
    assert(themes.length >= 2);
    const filenames = themes.map((th) => th.filename);
    assert(filenames.includes("default-dark.css"));
    assert(filenames.includes("default-light.css"));
    assertEquals(themes.find((th) => th.filename === "default-dark.css")?.isBuiltin, true);
    await cleanup();
  });

  await t.step("list returns ThemeFile structure", async () => {
    const d = await setup();
    const themes = (await d.invoke("themes:list")) as ThemeFile[];
    const theme = themes[0];
    assert("filename" in theme && "name" in theme && "isBuiltin" in theme && "css" in theme);
    await cleanup();
  });

  await t.step("read returns a single theme by filename", async () => {
    const d = await setup();
    const theme = (await d.invoke("themes:read", "default-dark.css")) as ThemeFile;
    assertEquals(theme.filename, "default-dark.css");
    assertEquals(theme.name, "Default Dark");
    assertEquals(theme.isBuiltin, true);
    assert(theme.css.includes("--color-bg"));
    await cleanup();
  });

  await t.step("create writes a new CSS file and returns ThemeFile", async () => {
    const d = await setup();
    const css = ":root { --color-bg: #000; }";
    const theme = (await d.invoke("themes:create", "ocean.css", css)) as ThemeFile;
    assertEquals(theme.filename, "ocean.css");
    assertEquals(theme.name, "Ocean");
    assertEquals(theme.isBuiltin, false);
    assertEquals(theme.css, css);
    assertEquals(await fsp.readFile(join(THEMES_DIR, "ocean.css"), "utf-8"), css);
    await cleanup();
  });

  await t.step("create rejects duplicate filename", async () => {
    const d = await setup();
    const css = ":root { --color-bg: #000; }";
    await d.invoke("themes:create", "dupe.css", css);
    await assertRejects(() => d.invoke("themes:create", "dupe.css", css), Error, "already exists");
    await cleanup();
  });

  await t.step("save overwrites custom theme CSS", async () => {
    const d = await setup();
    await d.invoke("themes:create", "custom.css", ":root {}");
    await d.invoke("themes:save", "custom.css", ":root { --color-bg: #111; }");
    const theme = (await d.invoke("themes:read", "custom.css")) as ThemeFile;
    assertEquals(theme.css, ":root { --color-bg: #111; }");
    await cleanup();
  });

  await t.step("save rejects builtin themes", async () => {
    const d = await setup();
    await assertRejects(() => d.invoke("themes:save", "default-dark.css", ":root {}"), Error, "Cannot modify built-in themes");
    await cleanup();
  });

  await t.step("delete removes custom theme file", async () => {
    const d = await setup();
    await d.invoke("themes:create", "temp.css", ":root {}");
    await d.invoke("themes:delete", "temp.css");
    const themes = (await d.invoke("themes:list")) as ThemeFile[];
    assertEquals(themes.find((th) => th.filename === "temp.css"), undefined);
    await cleanup();
  });

  await t.step("delete rejects builtin themes", async () => {
    const d = await setup();
    await assertRejects(() => d.invoke("themes:delete", "default-dark.css"), Error, "Cannot delete built-in themes");
    await cleanup();
  });

  await t.step("getDir returns themes directory path", async () => {
    const d = await setup();
    assertEquals(await d.invoke("themes:getDir"), THEMES_DIR);
    await cleanup();
  });

  await t.step("refresh re-scans directory", async () => {
    const d = await setup();
    await fsp.writeFile(join(THEMES_DIR, "external.css"), ":root {}");
    const themes = (await d.invoke("themes:refresh")) as ThemeFile[];
    assert(themes.find((th) => th.filename === "external.css") !== undefined);
    await cleanup();
  });

  await t.step("validates filename - rejects without .css extension", async () => {
    const d = await setup();
    await assertRejects(() => d.invoke("themes:create", "bad.txt", ":root {}"), Error, ".css");
    await cleanup();
  });

  await t.step("validates filename - rejects path separators (../)", async () => {
    const d = await setup();
    await assertRejects(() => d.invoke("themes:create", "../evil.css", ":root {}"), Error);
    await cleanup();
  });

  await t.step("validates filename - rejects path with slashes", async () => {
    const d = await setup();
    await assertRejects(() => d.invoke("themes:create", "a/b.css", ":root {}"), Error, "path separators");
    await cleanup();
  });

  await t.step("ensureThemeDir creates cheatsheet.md", async () => {
    await setup();
    const files = await fsp.readdir(THEMES_DIR);
    assert(files.includes("cheatsheet.md"));
    const content = await fsp.readFile(join(THEMES_DIR, "cheatsheet.md"), "utf-8");
    assert(content.includes("CSS Custom Properties"));
    assert(content.includes("--color-bg"));
    await cleanup();
  });

  await t.step("ensureThemeDir does not overwrite existing cheatsheet.md", async () => {
    await setup();
    const cheatsheetPath = join(THEMES_DIR, "cheatsheet.md");
    await fsp.writeFile(cheatsheetPath, "/* custom cheatsheet */");
    await ensureThemeDir();
    assertEquals(await fsp.readFile(cheatsheetPath, "utf-8"), "/* custom cheatsheet */");
    await cleanup();
  });

  await t.step("derives display name from filename", async () => {
    const d = await setup();
    await d.invoke("themes:create", "my-custom-theme.css", ":root {}");
    const theme = (await d.invoke("themes:read", "my-custom-theme.css")) as ThemeFile;
    assertEquals(theme.name, "My Custom Theme");
    await cleanup();
  });
});
