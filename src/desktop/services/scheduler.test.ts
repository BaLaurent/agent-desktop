// Ported from src/main/services/scheduler.test.ts. The Electron test mocked electron / streaming /
// tts / core messages so it could drive executeTask; here we port the parts that need NO module
// mocking and thus run faithfully under `deno test`:
//   - computeNextRun / getExpectedThemeFilename: pure, re-exported by scheduler.ts straight from
//     ../../core/services/scheduler — identical inputs/outputs asserted.
//   - reassignOrphanedTasks: real behavior against a real sql.js DB (createTestDb).
// The `executeTask` describe is intentionally NOT ported: it depends on vi.mock('./streaming')
// (streamMessage) + vi.mock('./tts') + vi.mock('../../core/handlers/messages), i.e. ES-module
// replacement that a plain `deno test` invocation cannot do (would spawn the real Claude SDK).
// See ompSidecar/whisper report notes.
import { assertEquals } from "jsr:@std/assert";
import { createTestDb } from "../../core/__tests__/db-helper.ts";
import { computeNextRun, getExpectedThemeFilename, reassignOrphanedTasks } from "./scheduler.ts";

const BASE = new Date("2025-01-15T10:00:00.000Z");

Deno.test("computeNextRun", async (t) => {
  await t.step("adds 30 minutes", () => {
    assertEquals(computeNextRun(30, "minutes", null, BASE), "2025-01-15T10:30:00.000Z");
  });
  await t.step("adds 1 minute", () => {
    assertEquals(computeNextRun(1, "minutes", null, BASE), "2025-01-15T10:01:00.000Z");
  });
  await t.step("adds 2 hours", () => {
    assertEquals(computeNextRun(2, "hours", null, BASE), "2025-01-15T12:00:00.000Z");
  });
  await t.step("adds 1 hour", () => {
    assertEquals(computeNextRun(1, "hours", null, BASE), "2025-01-15T11:00:00.000Z");
  });
  await t.step("adds 1 day", () => {
    assertEquals(computeNextRun(1, "days", null, BASE), "2025-01-16T10:00:00.000Z");
  });
  await t.step("adds 7 days", () => {
    assertEquals(computeNextRun(7, "days", null, BASE), "2025-01-22T10:00:00.000Z");
  });

  await t.step("days with scheduleTime — today at scheduleTime when future", () => {
    const localHour = BASE.getHours();
    const futureHour = String(localHour + 2).padStart(2, "0");
    const scheduleTime = `${futureHour}:30`;
    const result = computeNextRun(1, "days", scheduleTime, BASE);
    const expected = new Date(BASE);
    expected.setHours(localHour + 2, 30, 0, 0);
    assertEquals(result, expected.toISOString());
  });

  await t.step("days with scheduleTime — advance by interval when passed", () => {
    const localHour = BASE.getHours();
    const pastHour = localHour > 0 ? localHour - 1 : 0;
    const scheduleTime = `${String(pastHour).padStart(2, "0")}:00`;
    const result = computeNextRun(3, "days", scheduleTime, BASE);
    const expected = new Date(BASE);
    expected.setHours(pastHour, 0, 0, 0);
    expected.setDate(expected.getDate() + 3);
    assertEquals(result, expected.toISOString());
  });

  await t.step("falls through to simple day addition for invalid scheduleTime format", () => {
    assertEquals(computeNextRun(1, "days", "9:00", BASE), new Date(BASE.getTime() + 86_400_000).toISOString());
  });
  await t.step("falls through for completely invalid scheduleTime", () => {
    assertEquals(computeNextRun(2, "days", "noon", BASE), new Date(BASE.getTime() + 2 * 86_400_000).toISOString());
  });
  await t.step("falls through for empty string scheduleTime", () => {
    assertEquals(computeNextRun(1, "days", "", BASE), new Date(BASE.getTime() + 86_400_000).toISOString());
  });
});

Deno.test("getExpectedThemeFilename", async (t) => {
  await t.step("day theme during daytime (normal range)", () => {
    assertEquals(getExpectedThemeFilename("07:00", "21:00", "light.css", "dark.css", new Date("2025-01-15T12:00:00")), "light.css");
  });
  await t.step("night theme before day starts (normal range)", () => {
    assertEquals(getExpectedThemeFilename("07:00", "21:00", "light.css", "dark.css", new Date("2025-01-15T05:00:00")), "dark.css");
  });
  await t.step("night theme after night starts (normal range)", () => {
    assertEquals(getExpectedThemeFilename("07:00", "21:00", "light.css", "dark.css", new Date("2025-01-15T22:00:00")), "dark.css");
  });
  await t.step("day theme at exact day start time", () => {
    assertEquals(getExpectedThemeFilename("07:00", "21:00", "light.css", "dark.css", new Date("2025-01-15T07:00:00")), "light.css");
  });
  await t.step("night theme at exact night start time", () => {
    assertEquals(getExpectedThemeFilename("07:00", "21:00", "light.css", "dark.css", new Date("2025-01-15T21:00:00")), "dark.css");
  });
  await t.step("inverted range — night crosses midnight (during day)", () => {
    assertEquals(getExpectedThemeFilename("22:00", "06:00", "light.css", "dark.css", new Date("2025-01-15T23:00:00")), "light.css");
  });
  await t.step("inverted range — early morning still in day period", () => {
    assertEquals(getExpectedThemeFilename("22:00", "06:00", "light.css", "dark.css", new Date("2025-01-15T03:00:00")), "light.css");
  });
  await t.step("inverted range — afternoon = night", () => {
    assertEquals(getExpectedThemeFilename("22:00", "06:00", "light.css", "dark.css", new Date("2025-01-15T14:00:00")), "dark.css");
  });
  await t.step("day theme when both times are equal", () => {
    assertEquals(getExpectedThemeFilename("12:00", "12:00", "light.css", "dark.css", new Date("2025-01-15T12:00:00")), "light.css");
  });
});

Deno.test("reassignOrphanedTasks", async (t) => {
  await t.step("reassigns task to new conversation before deletion", async () => {
    const db = await createTestDb();
    try {
      const conv = db.prepare("INSERT INTO conversations (title, model, updated_at) VALUES ('Original', 'test', datetime('now'))").run();
      const convId = conv.lastInsertRowid as number;
      db.prepare(
        "INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit, enabled, next_run_at, created_at, updated_at) VALUES ('My Task', 'Do something', ?, 1, 'days', 1, datetime('now'), datetime('now'), datetime('now'))",
      ).run(convId);

      reassignOrphanedTasks(db, convId);
      db.prepare("DELETE FROM conversations WHERE id = ?").run(convId);

      const tasks = db.prepare("SELECT * FROM scheduled_tasks").all() as { id: number; conversation_id: number; name: string }[];
      assertEquals(tasks.length, 1);
      assertEquals(tasks[0].conversation_id !== convId, true);
      const newConv = db.prepare("SELECT title FROM conversations WHERE id = ?").get(tasks[0].conversation_id) as { title: string };
      assertEquals(newConv.title, "My Task");
    } finally {
      db.close();
    }
  });

  await t.step("places new conversation in default folder", async () => {
    const db = await createTestDb();
    try {
      const defaultFolder = db.prepare("SELECT id FROM folders WHERE is_default = 1").get() as { id: number };
      const conv = db.prepare("INSERT INTO conversations (title, model, updated_at) VALUES ('Temp', 'test', datetime('now'))").run();
      const convId = conv.lastInsertRowid as number;
      db.prepare(
        "INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit, enabled, next_run_at, created_at, updated_at) VALUES ('Folder Task', 'Check folder', ?, 1, 'hours', 1, datetime('now'), datetime('now'), datetime('now'))",
      ).run(convId);

      reassignOrphanedTasks(db, convId);
      db.prepare("DELETE FROM conversations WHERE id = ?").run(convId);

      const task = db.prepare("SELECT conversation_id FROM scheduled_tasks").get() as { conversation_id: number };
      const newConv = db.prepare("SELECT folder_id FROM conversations WHERE id = ?").get(task.conversation_id) as { folder_id: number };
      assertEquals(newConv.folder_id, defaultFolder.id);
    } finally {
      db.close();
    }
  });

  await t.step("does nothing when conversation has no tasks", async () => {
    const db = await createTestDb();
    try {
      const conv = db.prepare("INSERT INTO conversations (title, model, updated_at) VALUES ('No Tasks', 'test', datetime('now'))").run();
      const convId = conv.lastInsertRowid as number;
      reassignOrphanedTasks(db, convId);
      db.prepare("DELETE FROM conversations WHERE id = ?").run(convId);
      assertEquals((db.prepare("SELECT * FROM scheduled_tasks").all()).length, 0);
    } finally {
      db.close();
    }
  });

  await t.step("reassigns multiple tasks from same conversation", async () => {
    const db = await createTestDb();
    try {
      const conv = db.prepare("INSERT INTO conversations (title, model, updated_at) VALUES ('Shared', 'test', datetime('now'))").run();
      const convId = conv.lastInsertRowid as number;
      db.prepare(
        "INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit, enabled, next_run_at, created_at, updated_at) VALUES ('Task A', 'Prompt A', ?, 1, 'hours', 1, datetime('now'), datetime('now'), datetime('now'))",
      ).run(convId);
      db.prepare(
        "INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit, enabled, next_run_at, created_at, updated_at) VALUES ('Task B', 'Prompt B', ?, 2, 'days', 1, datetime('now'), datetime('now'), datetime('now'))",
      ).run(convId);

      reassignOrphanedTasks(db, convId);
      db.prepare("DELETE FROM conversations WHERE id = ?").run(convId);

      const tasks = db.prepare("SELECT name, conversation_id FROM scheduled_tasks ORDER BY name").all() as { name: string; conversation_id: number }[];
      assertEquals(tasks.length, 2);
      assertEquals(tasks[0].conversation_id !== convId, true);
      assertEquals(tasks[1].conversation_id !== convId, true);
      assertEquals(tasks[0].conversation_id !== tasks[1].conversation_id, true);
    } finally {
      db.close();
    }
  });
});
