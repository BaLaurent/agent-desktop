// Ported from src/main/services/scheduler.clearConversation.test.ts. Verifies the ms-collision
// mitigation in createElectronContext(...).clearConversation: cleared_at is stamped at Date.now()-1
// so a user message saved at the SAME millisecond (created_at == Date.now()) still passes the strict
// `created_at > cleared_at` filter in buildMessageHistory. The Electron test used vi.useFakeTimers()
// + vi.setSystemTime(); the faithful Deno equivalent is @std/testing/time FakeTime, which controls
// Date.now() identically. streaming/tts are NOT exercised here — clearConversation is a pure DB op
// (+ a no-op invalidateSession for a session-less conversation), so no module mocking is needed.
import { assertEquals } from "jsr:@std/assert";
import { FakeTime } from "jsr:@std/testing/time";
import { createTestDb } from "../../core/__tests__/db-helper.ts";
import { createElectronContext } from "./scheduler.ts";
import { buildMessageHistory, saveMessage } from "../../core/handlers/messages.ts";

const FIXED_MS = new Date("2025-06-01T12:00:00.000Z").getTime();

Deno.test("user message saved at the same ms as clearConversation is visible in history", async () => {
  const db = await createTestDb();
  const time = new FakeTime(FIXED_MS);
  try {
    const result = db
      .prepare("INSERT INTO conversations (title, model, updated_at) VALUES ('Test Conv', 'claude-sonnet-4-6', datetime('now'))")
      .run();
    const convId = result.lastInsertRowid as number;

    const ctx = createElectronContext(db);
    ctx.clearConversation(convId);
    saveMessage(db, convId, "user", "hello from the scheduled task");

    const history = buildMessageHistory(db, convId);
    assertEquals(history.length, 1);
    assertEquals(history[0], { role: "user", content: "hello from the scheduled task" });
  } finally {
    time.restore();
    db.close();
  }
});

Deno.test("cleared_at is set 1ms before the frozen clock", async () => {
  const db = await createTestDb();
  const time = new FakeTime(FIXED_MS);
  try {
    const result = db
      .prepare("INSERT INTO conversations (title, model, updated_at) VALUES ('Test Conv', 'claude-sonnet-4-6', datetime('now'))")
      .run();
    const convId = result.lastInsertRowid as number;

    const ctx = createElectronContext(db);
    ctx.clearConversation(convId);

    const row = db.prepare("SELECT cleared_at FROM conversations WHERE id = ?").get(convId) as { cleared_at: string };
    assertEquals(new Date(row.cleared_at).getTime(), FIXED_MS - 1);
  } finally {
    time.restore();
    db.close();
  }
});
