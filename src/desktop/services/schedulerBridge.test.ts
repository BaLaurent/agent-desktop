// Ported from src/main/services/schedulerBridge.test.ts. The Electron test mocked electron (only
// app.getPath), getMainWindow, and broadcast; everything load-bearing (net.Server/Socket, the socket
// file lifecycle, the JSON-line protocol, a real sql.js DB) was already real. The port keeps all of
// that real and swaps only the harness: XDG_RUNTIME_DIR/HOME are set at runtime (getSocketPath +
// getLogPath read process.env/homedir lazily inside startBridge, so no dynamic import is needed),
// socketPath/authToken are read through their live ESM bindings (no re-import), and readiness is
// awaited via the real "connect" event (retry-on-error) rather than a wall-clock sleep.
//
// Two faithful divergences, both documented inline:
//   - getSchedulerMcpConfig: the Electron test asserted null because getAppPath()→tmpdir hid the MCP
//     script. In this repo resources/mcp/scheduler-server.mjs exists, so we test the REAL positive
//     path (valid config when started) plus the not-started null case.
//   - broadcast() is a no-op here (no handler registered); the original never asserted on it either.
import { assert, assertEquals, assertMatch } from "jsr:@std/assert";
import * as net from "node:net";
import * as fs from "node:fs";
import { join } from "node:path";
import process from "node:process";
import type { SqlJsAdapter } from "../../core/db/sqljs-adapter.ts";
import { findBinaryInPath } from "../../core/utils/env.ts";
import { createTestDb } from "../../core/__tests__/db-helper.ts";
import {
  startBridge,
  stopBridge,
  getSchedulerMcpConfig,
  socketPath as liveSocketPath,
  authToken as liveAuthToken,
} from "./schedulerBridge.ts";

// Redirect the runtime socket dir + userData (log) dir into temp space. Read lazily by
// getSocketPath()/getLogPath() at startBridge() time, so setting them here (before any start) is
// sufficient — no need to control module load order.
const TMP_RUNTIME = await Deno.makeTempDir({ prefix: "schedbridge-runtime-" });
const TMP_HOME = await Deno.makeTempDir({ prefix: "schedbridge-home-" });
Deno.env.set("XDG_RUNTIME_DIR", TMP_RUNTIME);
Deno.env.set("HOME", TMP_HOME);
// XDG_CONFIG_HOME is exported on many Linux machines and userDataDir() prefers it over HOME, so the
// bridge's best-effort log would otherwise land in the REAL ~/.config/agent-desktop. Redirect it too.
Deno.env.set("XDG_CONFIG_HOME", join(TMP_HOME, ".config"));

const EXPECTED_SOCK = join(TMP_RUNTIME, `agent-desktop-sched-${process.pid}.sock`);

interface BridgeResponse {
  id: string | number | null;
  result?: unknown;
  error?: string;
}

function currentBridgeState(): { socketPath: string; token: string } {
  if (!liveSocketPath || !liveAuthToken) throw new Error("bridge not started");
  return { socketPath: liveSocketPath, token: liveAuthToken };
}

// Connect once the server is listening. Each createConnection attempt is real async I/O that yields
// to the event loop, letting startBridge's server.listen() callback run — so we await the genuine
// "connect" event rather than sleeping a tuned duration. (server object isn't exported to await its
// 'listening' event directly.)
async function connect(socketPath: string): Promise<net.Socket> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { promise, resolve, reject } = Promise.withResolvers<net.Socket>();
    const conn = net.createConnection(socketPath);
    conn.once("connect", () => resolve(conn));
    conn.once("error", (err: Error) => reject(err));
    try {
      return await promise;
    } catch {
      conn.destroy();
      // socket not created yet — retry (the attempt above already yielded to the loop)
    }
  }
  throw new Error(`bridge socket ${socketPath} never became ready`);
}

async function waitReady(socketPath: string): Promise<void> {
  (await connect(socketPath)).end();
}

// Send one JSON-line request, resolve the first reply line. The server writes a reply for every
// request (success OR error), so no read timeout is needed.
async function rpc(socketPath: string, payload: Record<string, unknown>): Promise<BridgeResponse> {
  const conn = await connect(socketPath);
  const { promise, resolve, reject } = Promise.withResolvers<BridgeResponse>();
  let buf = "";
  conn.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    const idx = buf.indexOf("\n");
    if (idx !== -1) {
      conn.end();
      try {
        resolve(JSON.parse(buf.slice(0, idx)));
      } catch (e) {
        reject(e);
      }
    }
  });
  conn.on("error", reject);
  conn.write(JSON.stringify(payload) + "\n");
  return promise;
}

function seedConv(db: SqlJsAdapter, title = "Bridge Test"): number {
  const r = db
    .prepare(`INSERT INTO conversations (title, model, updated_at) VALUES ('${title}', 'claude-sonnet-4-6', datetime('now'))`)
    .run();
  return r.lastInsertRowid as number;
}

const TASK_COLS =
  "name, prompt, conversation_id, interval_value, interval_unit, schedule_time, catch_up, max_runs, notify_desktop, notify_voice, pre_run_action, next_run_at, created_at, updated_at";

function seedTask(db: SqlJsAdapter, name: string, prompt: string, convId: number): number {
  const r = db
    .prepare(
      `INSERT INTO scheduled_tasks (${TASK_COLS}) VALUES (?, ?, ?, 5, 'minutes', NULL, 0, NULL, 1, 0, 'none', datetime('now'), datetime('now'), datetime('now'))`,
    )
    .run(name, prompt, convId);
  return r.lastInsertRowid as number;
}

Deno.test("schedulerBridge", async (t) => {
  await t.step("lifecycle: startBridge creates the socket file with owner-only perms", async () => {
    const db = await createTestDb();
    try {
      startBridge(db);
      const { socketPath } = currentBridgeState();
      await waitReady(socketPath);
      assertEquals(fs.existsSync(socketPath), true);
      assertEquals(fs.statSync(socketPath).mode & 0o777, 0o600);
    } finally {
      stopBridge();
      db.close();
    }
  });

  await t.step("lifecycle: stopBridge removes the socket file and clears credentials", async () => {
    const db = await createTestDb();
    try {
      startBridge(db);
      const { socketPath } = currentBridgeState();
      await waitReady(socketPath);
      assertEquals(fs.existsSync(socketPath), true);

      stopBridge();
      assertEquals(fs.existsSync(socketPath), false);
      assertEquals(liveSocketPath, null);
      assertEquals(liveAuthToken, null);
    } finally {
      stopBridge();
      db.close();
    }
  });

  await t.step("lifecycle: startBridge replaces a stale socket file from a prior process", async () => {
    const db = await createTestDb();
    try {
      try {
        fs.writeFileSync(EXPECTED_SOCK, "leftover");
      } catch { /* ignore */ }
      startBridge(db);
      await waitReady(currentBridgeState().socketPath);
      assertEquals(fs.existsSync(EXPECTED_SOCK), true);
      assertEquals(fs.statSync(EXPECTED_SOCK).isSocket(), true);
    } finally {
      stopBridge();
      db.close();
    }
  });

  await t.step("lifecycle: issues a fresh authToken on every startBridge call", async () => {
    const db = await createTestDb();
    try {
      startBridge(db);
      const a = currentBridgeState().token;
      stopBridge();
      startBridge(db);
      const b = currentBridgeState().token;
      assert(a.length > 0);
      assert(b.length > 0);
      assert(a !== b);
    } finally {
      stopBridge();
      db.close();
    }
  });

  await t.step("auth: rejects requests with no token", async () => {
    const db = await createTestDb();
    try {
      const convId = seedConv(db);
      startBridge(db);
      const { socketPath } = currentBridgeState();
      const reply = await rpc(socketPath, { id: 1, method: "scheduler.list", params: { conversation_id: convId } });
      assert(reply.error !== undefined);
      assertMatch(reply.error!, /Unauthorized/);
      assertEquals(reply.result, undefined);
    } finally {
      stopBridge();
      db.close();
    }
  });

  await t.step("auth: rejects requests with a wrong token", async () => {
    const db = await createTestDb();
    try {
      const convId = seedConv(db);
      startBridge(db);
      const { socketPath } = currentBridgeState();
      const reply = await rpc(socketPath, { id: 2, method: "scheduler.list", token: "definitely-not-the-real-token", params: { conversation_id: convId } });
      assertMatch(reply.error!, /Unauthorized/);
    } finally {
      stopBridge();
      db.close();
    }
  });

  await t.step("auth: accepts requests with the correct token", async () => {
    const db = await createTestDb();
    try {
      const convId = seedConv(db);
      startBridge(db);
      const { socketPath, token } = currentBridgeState();
      const reply = await rpc(socketPath, { id: 3, method: "scheduler.list", token, params: { conversation_id: convId } });
      assertEquals(reply.error, undefined);
      assertEquals(Array.isArray(reply.result), true);
      assertEquals(reply.id, 3);
    } finally {
      stopBridge();
      db.close();
    }
  });

  await t.step("create: creates a task targeting an existing conversation", async () => {
    const db = await createTestDb();
    try {
      const convId = seedConv(db);
      startBridge(db);
      const { socketPath, token } = currentBridgeState();
      const reply = await rpc(socketPath, {
        id: "a",
        method: "scheduler.create",
        token,
        params: { name: "Test Task", prompt: "do the thing", conversation_id: convId, interval_value: 30, interval_unit: "minutes" },
      });
      assertEquals(reply.error, undefined);
      const result = reply.result as { id: number; name: string; next_run_at: string };
      assertEquals(result.name, "Test Task");
      assertEquals(typeof result.id, "number");
      assertEquals(typeof result.next_run_at, "string");
      const row = db.prepare("SELECT name, conversation_id FROM scheduled_tasks WHERE id = ?").get(result.id) as { name: string; conversation_id: number };
      assertEquals(row.name, "Test Task");
      assertEquals(row.conversation_id, convId);
    } finally {
      stopBridge();
      db.close();
    }
  });

  await t.step("create: rejects when the conversation does not exist", async () => {
    const db = await createTestDb();
    try {
      startBridge(db);
      const { socketPath, token } = currentBridgeState();
      const reply = await rpc(socketPath, {
        id: "b",
        method: "scheduler.create",
        token,
        params: { name: "Orphan", prompt: "no conv", conversation_id: 99999, interval_value: 1, interval_unit: "hours" },
      });
      assertMatch(reply.error!, /Conversation not found/);
    } finally {
      stopBridge();
      db.close();
    }
  });

  await t.step("create: rejects non-positive conversation_id", async () => {
    const db = await createTestDb();
    try {
      startBridge(db);
      const { socketPath, token } = currentBridgeState();
      const reply = await rpc(socketPath, {
        id: "c",
        method: "scheduler.create",
        token,
        params: { name: "Bad", prompt: "x", conversation_id: 0, interval_value: 5, interval_unit: "minutes" },
      });
      assertMatch(reply.error!, /conversation_id/);
    } finally {
      stopBridge();
      db.close();
    }
  });

  await t.step("list: scopes to the conversation and truncates prompt to 200 chars", async () => {
    const db = await createTestDb();
    try {
      const convId = seedConv(db);
      seedTask(db, "Long", "x".repeat(500), convId);
      startBridge(db);
      const { socketPath, token } = currentBridgeState();
      const reply = await rpc(socketPath, { id: "d", method: "scheduler.list", token, params: { conversation_id: convId } });
      const rows = reply.result as Array<{ name: string; prompt: string; enabled: boolean }>;
      assertEquals(Array.isArray(rows), true);
      const row = rows.find((r) => r.name === "Long");
      assert(row !== undefined);
      assertEquals(row!.prompt.length, 200);
      assertEquals(row!.prompt, "x".repeat(200));
      assertEquals(typeof row!.enabled, "boolean");
    } finally {
      stopBridge();
      db.close();
    }
  });

  await t.step("list: excludes tasks from other conversations", async () => {
    const db = await createTestDb();
    try {
      const convId = seedConv(db);
      const otherConv = seedConv(db, "Other");
      seedTask(db, "Other Task", "p", otherConv);
      startBridge(db);
      const { socketPath, token } = currentBridgeState();
      const reply = await rpc(socketPath, { id: "e", method: "scheduler.list", token, params: { conversation_id: convId } });
      const rows = reply.result as Array<{ name: string }>;
      assertEquals(rows.find((r) => r.name === "Other Task"), undefined);
    } finally {
      stopBridge();
      db.close();
    }
  });

  await t.step("cancel: deletes a task belonging to the caller conversation", async () => {
    const db = await createTestDb();
    try {
      const convId = seedConv(db);
      const taskId = seedTask(db, "To Cancel", "p", convId);
      startBridge(db);
      const { socketPath, token } = currentBridgeState();
      const reply = await rpc(socketPath, { id: "f", method: "scheduler.cancel", token, params: { task_id: taskId, conversation_id: convId } });
      assertEquals(reply.error, undefined);
      assertEquals(reply.result, { deleted: true });
      assertEquals(db.prepare("SELECT id FROM scheduled_tasks WHERE id = ?").get(taskId), undefined);
    } finally {
      stopBridge();
      db.close();
    }
  });

  await t.step("cancel: refuses a task belonging to another conversation", async () => {
    const db = await createTestDb();
    try {
      const convId = seedConv(db);
      const otherConv = seedConv(db, "Other");
      const foreignTaskId = seedTask(db, "Theirs", "p", otherConv);
      startBridge(db);
      const { socketPath, token } = currentBridgeState();
      const reply = await rpc(socketPath, { id: "g", method: "scheduler.cancel", token, params: { task_id: foreignTaskId, conversation_id: convId } });
      assertMatch(reply.error!, /another conversation/);
      assert(db.prepare("SELECT id FROM scheduled_tasks WHERE id = ?").get(foreignTaskId) !== undefined);
    } finally {
      stopBridge();
      db.close();
    }
  });

  await t.step("protocol: rejects an unknown method", async () => {
    const db = await createTestDb();
    try {
      startBridge(db);
      const { socketPath, token } = currentBridgeState();
      const reply = await rpc(socketPath, { id: "h", method: "scheduler.bogus", token, params: {} });
      assertMatch(reply.error!, /Unknown method/);
    } finally {
      stopBridge();
      db.close();
    }
  });

  await t.step("protocol: returns an error envelope for malformed JSON (id:null)", async () => {
    const db = await createTestDb();
    try {
      startBridge(db);
      const { socketPath } = currentBridgeState();
      const conn = await connect(socketPath);
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      let buf = "";
      conn.on("data", (c: Buffer) => {
        buf += c.toString();
        const i = buf.indexOf("\n");
        if (i !== -1) {
          conn.end();
          resolve(buf.slice(0, i));
        }
      });
      conn.on("error", reject);
      conn.write("this is not json\n");
      const parsed = JSON.parse(await promise) as BridgeResponse;
      assert(parsed.error !== undefined);
      assertEquals(parsed.id, null);
    } finally {
      stopBridge();
      db.close();
    }
  });

  await t.step("protocol: handles two requests on one connection (newline framing)", async () => {
    const db = await createTestDb();
    try {
      const convId = seedConv(db);
      startBridge(db);
      const { socketPath, token } = currentBridgeState();
      const conn = await connect(socketPath);
      const replies: BridgeResponse[] = [];
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      let buf = "";
      conn.on("data", (c: Buffer) => {
        buf += c.toString();
        let idx: number;
        while ((idx = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          replies.push(JSON.parse(line));
          if (replies.length === 2) {
            conn.end();
            resolve();
          }
        }
      });
      conn.on("error", reject);
      conn.write(JSON.stringify({ id: "r1", method: "scheduler.list", token, params: { conversation_id: convId } }) + "\n");
      conn.write(JSON.stringify({ id: "r2", method: "scheduler.bogus", token, params: {} }) + "\n");
      await promise;

      assertEquals(replies.length, 2);
      // Success replies preserve req.id; error replies come back with id:null (dispatch's catch loses id).
      const success = replies.find((r) => r.id === "r1");
      const failure = replies.find((r) => r.id === null);
      assertEquals(success?.error, undefined);
      assertEquals(Array.isArray(success?.result), true);
      assertMatch(failure!.error!, /Unknown method/);
    } finally {
      stopBridge();
      db.close();
    }
  });

  await t.step("getSchedulerMcpConfig returns null when the bridge is not started", async () => {
    const db = await createTestDb();
    try {
      stopBridge(); // ensure not started (module state persists across steps)
      assertEquals(getSchedulerMcpConfig(seedConv(db)), null);
    } finally {
      stopBridge();
      db.close();
    }
  });

  await t.step("getSchedulerMcpConfig returns a valid config when started (script present in repo)", async () => {
    const db = await createTestDb();
    try {
      const convId = seedConv(db);
      startBridge(db);
      await waitReady(currentBridgeState().socketPath);
      const cfg = getSchedulerMcpConfig(convId);
      const nodeBin = findBinaryInPath("node");
      if (nodeBin) {
        assert(cfg !== null);
        assertEquals(cfg!.command, nodeBin);
        assert(cfg!.args[0].endsWith("scheduler-server.mjs"));
        assertEquals(cfg!.env.SCHEDULER_CONVERSATION_ID, String(convId));
        assertEquals(typeof cfg!.env.SCHEDULER_SOCKET, "string");
        assertEquals(typeof cfg!.env.SCHEDULER_TOKEN, "string");
      } else {
        // node not in PATH → the factory fails closed
        assertEquals(cfg, null);
      }
    } finally {
      stopBridge();
      db.close();
    }
  });

  await t.step("exported credentials update after startBridge and clear after stopBridge", async () => {
    const db = await createTestDb();
    try {
      stopBridge();
      assertEquals(liveSocketPath, null);
      assertEquals(liveAuthToken, null);
      startBridge(db);
      assertEquals(typeof liveSocketPath, "string");
      assertEquals(typeof liveAuthToken, "string");
      assert(liveAuthToken!.length > 0);
      stopBridge();
      assertEquals(liveSocketPath, null);
      assertEquals(liveAuthToken, null);
    } finally {
      stopBridge();
      db.close();
    }
  });
});
