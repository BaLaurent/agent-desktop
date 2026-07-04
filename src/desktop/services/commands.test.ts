// Ported from src/main/services/commands.test.ts. The Electron test mocked fs/promises to feed
// synthetic readdir/open results and mocked ../utils/paths + ./piExtensions. A plain `deno test`
// can't replace the fs module — but it doesn't need to: commands.ts resolves every scan directory at
// CALL time from HOME (expandTilde('~/.claude'), getMacrosDir()='~/.agent-desktop/macros'), so we
// point HOME at a per-test temp dir and lay down REAL command/skill/macro files. The scanners
// (scanCommandsDir/scanSkillsDir/scanMacrosDir/loadMacro) are core-owned and unchanged, so this
// exercises the desktop commands.ts's own job faithfully: assembling builtins + user + project +
// skills + macros with name-keyed dedup (project overrides user).
//
// The omp/pi branch is held off by forcing ai_sdkBackend != 'pi' (a fresh test DB), and
// discoverPIExtensionCommands returns [] on the claude path — so the result is fully deterministic
// (no subprocess). Assertions use containment, matching the original intent.
import { assert, assertEquals } from "jsr:@std/assert";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import type { HandleRegistrar } from "../../core/dispatch.ts";
import type Database from "better-sqlite3";
import { createTestDb } from "../../core/__tests__/db-helper.ts";
import { registerHandlers } from "./commands.ts";

interface Cmd {
  name: string;
  description?: string;
  source: string;
}

interface TestDispatch extends HandleRegistrar {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

function makeDispatch(db: Database.Database): TestDispatch {
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

// Fresh temp HOME per test → isolates ~/.claude and ~/.agent-desktop. HOME is read inside the
// handler at invoke time, so setting it per test (before invoke) is sufficient with a static import.
async function freshHome(): Promise<string> {
  const home = await Deno.makeTempDir({ prefix: "agent-cmds-" });
  Deno.env.set("HOME", home);
  return home;
}

async function dbNonPi(): Promise<Database.Database> {
  const db = await createTestDb();
  // Force the claude path (skip the omp/pi branch → no subprocess) for determinism.
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_sdkBackend', 'claude')").run();
  return db as unknown as Database.Database;
}

function writeCommand(home: string, rel: string, name: string, description: string): void {
  const dir = join(home, ".claude", rel);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `---\ndescription: ${description}\n---\n# ${name}\n`);
}

Deno.test("registers commands:list and macros:load", async () => {
  const db = await dbNonPi();
  try {
    const handlers = new Map<string, unknown>();
    registerHandlers({ handle: (ch, fn) => handlers.set(ch, fn) }, db);
    assert(handlers.has("commands:list"));
    assert(handlers.has("macros:load"));
  } finally {
    db.close();
  }
});

Deno.test("commands:list returns the builtin commands when no user dirs exist", async () => {
  await freshHome();
  const db = await dbNonPi();
  try {
    const result = (await makeDispatch(db).invoke("commands:list")) as Cmd[];
    const names = result.map((c) => c.name);
    for (const b of ["compact", "clear", "context", "help"]) assert(names.includes(b), `missing builtin ${b}`);
    assertEquals(result.find((c) => c.name === "compact")?.source, "builtin");
  } finally {
    db.close();
  }
});

Deno.test("commands:list scans the user commands directory", async () => {
  const home = await freshHome();
  const db = await dbNonPi();
  try {
    writeCommand(home, "commands", "mycmd", "My custom command");
    const result = (await makeDispatch(db).invoke("commands:list")) as Cmd[];
    const cmd = result.find((c) => c.name === "mycmd");
    assert(cmd !== undefined);
    assertEquals(cmd!.source, "user");
    assertEquals(cmd!.description, "My custom command");
  } finally {
    db.close();
  }
});

Deno.test("commands:list — project commands override user commands with the same name", async () => {
  const home = await freshHome();
  const project = await Deno.makeTempDir({ prefix: "agent-cmds-proj-" });
  const db = await dbNonPi();
  try {
    writeCommand(home, "commands", "review", "User review");
    const projDir = join(project, ".claude", "commands");
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, "review.md"), `---\ndescription: Project review\n---\n`);

    const result = (await makeDispatch(db).invoke("commands:list", project)) as Cmd[];
    const reviews = result.filter((c) => c.name === "review");
    assertEquals(reviews.length, 1);
    assertEquals(reviews[0].source, "project");
    assertEquals(reviews[0].description, "Project review");
  } finally {
    db.close();
    await Deno.remove(project, { recursive: true }).catch(() => {});
  }
});

Deno.test("commands:list skips non-.md files", async () => {
  const home = await freshHome();
  const db = await dbNonPi();
  try {
    const dir = join(home, ".claude", "commands");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "readme.txt"), "not a command");
    writeFileSync(join(dir, "script.sh"), "#!/bin/sh");
    writeFileSync(join(dir, "valid.md"), `---\ndescription: Valid\n---\n`);

    const result = (await makeDispatch(db).invoke("commands:list")) as Cmd[];
    const nonBuiltin = result.filter((c) => !["compact", "clear", "context", "help"].includes(c.name));
    assertEquals(nonBuiltin.length, 1);
    assertEquals(nonBuiltin[0].name, "valid");
  } finally {
    db.close();
  }
});

Deno.test("commands:list scans user skills when skillsMode is 'user'", async () => {
  const home = await freshHome();
  const db = await dbNonPi();
  try {
    const skillDir = join(home, ".claude", "skills", "weather-wttr");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), `---\nname: weather-wttr\ndescription: Weather info\n---\n`);

    const off = (await makeDispatch(db).invoke("commands:list")) as Cmd[];
    assertEquals(off.some((c) => c.source === "skill"), false);

    const withSkills = (await makeDispatch(db).invoke("commands:list", undefined, "user")) as Cmd[];
    const skill = withSkills.find((c) => c.name === "weather-wttr");
    assert(skill !== undefined);
    assertEquals(skill!.source, "skill");
    assertEquals(skill!.description, "Weather info");
  } finally {
    db.close();
  }
});

Deno.test("macros:load", async (t) => {
  await t.step("returns the messages of a real macro file", async () => {
    const home = await freshHome();
    const db = await dbNonPi();
    try {
      const macroDir = join(home, ".agent-desktop", "macros");
      mkdirSync(macroDir, { recursive: true });
      writeFileSync(join(macroDir, "greet.json"), JSON.stringify({ description: "hi", messages: ["hello", "world"] }));
      const result = await makeDispatch(db).invoke("macros:load", "greet");
      assertEquals(result, ["hello", "world"]);
    } finally {
      db.close();
    }
  });

  await t.step("returns null for a non-string name", async () => {
    const db = await dbNonPi();
    try {
      assertEquals(await makeDispatch(db).invoke("macros:load", 42), null);
    } finally {
      db.close();
    }
  });

  await t.step("returns null for a nonexistent macro", async () => {
    await freshHome();
    const db = await dbNonPi();
    try {
      assertEquals(await makeDispatch(db).invoke("macros:load", "ghost"), null);
    } finally {
      db.close();
    }
  });
});
