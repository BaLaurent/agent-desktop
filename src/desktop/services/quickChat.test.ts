// Ported from src/main/services/quickChat.test.ts. The Electron test mocked BrowserWindow/
// webContents/streaming/globalShortcuts to drive overlay-window creation AND used a hand-rolled mock
// DB. In the deno-desktop port the overlay is a Deno.BrowserWindow orchestrated with async
// navigate + executeJs-envelope readiness polling + geometry read from executeJs('screen.availWidth')
// — that window path is genuinely Deno-native-UI and can't be exercised without a real window, so
// showOverlay/createOverlay/setBubbleMode geometry are NOT unit-tested here.
//
// What IS testable — and is the load-bearing DB logic the original also covered — are the window-free
// dispatch channels backed by a REAL sql.js DB (createTestDb): quickChat:getConversationId
// (ensureConversation: create/reuse/separate-voice + conversations:refresh broadcast) and
// quickChat:purge (message deletion). quickChat:hide/setBubbleMode/reregisterShortcuts are asserted as
// safe no-ops when no overlay window exists. resume-last-conversation delegates to ConversationService
// (core-owned, core-tested) and is not re-covered here.
import { assert, assertEquals } from "jsr:@std/assert";
import type { HandleRegistrar } from "../../core/dispatch.ts";
import type { SqlJsAdapter } from "../../core/db/sqljs-adapter.ts";
import { createTestDb } from "../../core/__tests__/db-helper.ts";
import { addBroadcastHandler } from "../../core/utils/broadcast.ts";
import { registerHandlers } from "./quickChat.ts";

interface TestDispatch extends HandleRegistrar {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

function makeDispatch(db: SqlJsAdapter): TestDispatch {
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

function asNumber(value: unknown): number {
  assert(typeof value === "number", `expected a number, got ${typeof value}`);
  return value;
}

function setSetting(db: SqlJsAdapter, key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(key, value);
}

Deno.test("quickChat:getConversationId creates a Quick Chat conversation and broadcasts refresh", async () => {
  const db = await createTestDb();
  const events: string[] = [];
  const unsub = addBroadcastHandler((channel) => events.push(channel));
  try {
    const id = asNumber(await makeDispatch(db).invoke("quickChat:getConversationId", "text"));
    assert(id > 0);
    const conv = db.prepare("SELECT title FROM conversations WHERE id = ?").get(id) as { title: string } | undefined;
    assert(conv !== undefined);
    assertEquals(conv!.title, "Quick Chat");
    assertEquals(db.prepare("SELECT value FROM settings WHERE key = 'quickChat_conversationId'").get(), { value: String(id) });
    assert(events.includes("conversations:refresh"));
  } finally {
    unsub();
    db.close();
  }
});

Deno.test("quickChat:getConversationId reuses the existing Quick Chat conversation", async () => {
  const db = await createTestDb();
  try {
    const dispatch = makeDispatch(db);
    const first = asNumber(await dispatch.invoke("quickChat:getConversationId", "text"));
    const second = asNumber(await dispatch.invoke("quickChat:getConversationId", "text"));
    assertEquals(second, first);
    assertEquals(db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE title = 'Quick Chat'").get(), { n: 1 });
  } finally {
    db.close();
  }
});

Deno.test("quickChat:getConversationId uses a separate voice conversation when configured", async () => {
  const db = await createTestDb();
  try {
    setSetting(db, "quickChat_separateVoiceConversation", "true");
    const dispatch = makeDispatch(db);
    const textId = asNumber(await dispatch.invoke("quickChat:getConversationId", "text"));
    const voiceId = asNumber(await dispatch.invoke("quickChat:getConversationId", "voice"));
    assert(textId !== voiceId);
    const voiceConv = db.prepare("SELECT title FROM conversations WHERE id = ?").get(voiceId) as { title: string };
    assertEquals(voiceConv.title, "Quick Chat (Voice)");
    assertEquals(db.prepare("SELECT value FROM settings WHERE key = 'quickChat_voiceConversationId'").get(), { value: String(voiceId) });
  } finally {
    db.close();
  }
});

Deno.test("quickChat:purge deletes the Quick Chat conversation's messages", async () => {
  const db = await createTestDb();
  try {
    const dispatch = makeDispatch(db);
    const id = asNumber(await dispatch.invoke("quickChat:getConversationId", "text"));
    db.prepare("INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, 'user', 'hi', datetime('now'))").run(id);
    db.prepare("INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, 'assistant', 'yo', datetime('now'))").run(id);
    assertEquals(db.prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?").get(id), { n: 2 });

    await dispatch.invoke("quickChat:purge");
    assertEquals(db.prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?").get(id), { n: 0 });
  } finally {
    db.close();
  }
});

Deno.test("window-free channels are safe no-ops when no overlay exists", async () => {
  const db = await createTestDb();
  try {
    const dispatch = makeDispatch(db);
    // No overlay window has been created (showOverlay is never called), so these must not throw.
    await dispatch.invoke("quickChat:hide");
    await dispatch.invoke("quickChat:setBubbleMode");
    await dispatch.invoke("quickChat:reregisterShortcuts");
  } finally {
    db.close();
  }
});
