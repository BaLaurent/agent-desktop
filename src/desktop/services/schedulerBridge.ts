// Ported from src/main/services/schedulerBridge.ts. The node:net unix-socket bridge that lets the
// scheduler MCP subprocess (resources/mcp/scheduler-server.mjs) create/list/cancel tasks in the
// live DB. Electron swaps: app.getPath('userData') → userDataDir(); getMainWindow()+webContents.send
// → broadcast() (the uiBridge fans it to the WS renderer); app.isPackaged/process.resourcesPath/
// getAppPath() → resourcePath(). Socket-server + JSON-line protocol behavior is unchanged.
import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { SqlJsAdapter } from "../../core/db/sqljs-adapter";
import type { IntervalUnit, PreRunAction } from "../../shared/types";
import { SchedulerService } from "../../core/services/scheduler";
import { validatePositiveInt } from "../../core/utils/validate";
import { broadcast } from "../../core/utils/broadcast";
import { sanitizeError } from "../utils/errors";
import { findBinaryInPath } from "../../core/utils/env";
import { createLogger } from "../../core/utils/logger";
import { userDataDir, resourcePath } from "../paths";

const log = createLogger("schedulerBridge");

let server: net.Server | null = null;
let socketPath: string | null = null;
let authToken: string | null = null;
let bridgeDb: SqlJsAdapter | null = null;

// ─── File logging ─────────────────────────────────────────────

function getLogPath(): string {
  return path.join(userDataDir(), "agent_scheduler.log");
}

function bridgeLog(level: string, msg: string): void {
  const line = `${new Date().toISOString()} [schedulerBridge] [${level}] ${msg}`;
  // Mirror to structured logger at info level (file logging is the primary sink)
  log.info(msg, { bridgeLevel: level });
  try {
    fs.appendFileSync(getLogPath(), line + "\n");
  } catch { /* best effort */ }
}

// ─── Socket path ─────────────────────────────────────────────

function getSocketPath(): string {
  const dir = process.env.XDG_RUNTIME_DIR || "/tmp";
  return path.join(dir, `agent-desktop-sched-${process.pid}.sock`);
}

// ─── Bridge request dispatch ─────────────────────────────────

interface BridgeRequest {
  method: string;
  token: string;
  params: Record<string, unknown>;
}

function dispatch(req: BridgeRequest): unknown {
  if (!bridgeDb) throw new Error("Bridge DB not initialized");
  if (req.token !== authToken) throw new Error("Unauthorized");

  const db = bridgeDb;

  switch (req.method) {
    case "scheduler.create": {
      const p = req.params;
      const conversationId = p.conversation_id as number;
      validatePositiveInt(conversationId, "conversation_id");

      // Bridge callers (agent MCP) MUST target an existing conversation.
      // SchedulerService.create would auto-create one otherwise.
      const conv = db.prepare("SELECT id FROM conversations WHERE id = ?").get(conversationId);
      if (!conv) throw new Error("Conversation not found");

      // SqlJsAdapter structurally satisfies better-sqlite3's Database (the SchedulerService ctor
      // type); bridge at this boundary (same as registerServices.ts / scheduler.ts).
      const service = new SchedulerService(db as unknown as Database.Database);
      const task = service.create({
        name: p.name as string,
        prompt: p.prompt as string,
        conversation_id: conversationId,
        interval_value: p.interval_value as number,
        interval_unit: p.interval_unit as IntervalUnit,
        schedule_time: (p.schedule_time as string) || undefined,
        max_runs: p.max_runs != null ? (p.max_runs as number) : null,
        // Bridge historical defaults preserved:
        catch_up: false,
        notify_desktop: true,
        notify_voice: false,
        // pre_run_action: optional — pass through if present
        pre_run_action: (p.pre_run_action as PreRunAction | undefined) ?? undefined,
      });

      broadcast("scheduler:taskUpdate", task);
      return { id: task.id, name: task.name, next_run_at: task.next_run_at, max_runs: task.max_runs };
    }

    case "scheduler.list": {
      const conversationId = req.params.conversation_id as number;
      validatePositiveInt(conversationId, "conversation_id");

      // Type the query result at the boundary so field reads stay checked (no per-field `as`).
      const rows = db.prepare(
        "SELECT id, name, prompt, enabled, interval_value, interval_unit, max_runs, next_run_at, last_status, run_count FROM scheduled_tasks WHERE conversation_id = ? ORDER BY created_at DESC",
      ).all(conversationId) as Array<{
        id: number;
        name: string;
        prompt: string;
        enabled: number;
        interval_value: number;
        interval_unit: string;
        max_runs: number | null;
        next_run_at: string | null;
        last_status: string | null;
        run_count: number;
      }>;

      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        prompt: r.prompt.slice(0, 200),
        enabled: Boolean(r.enabled),
        interval_value: r.interval_value,
        interval_unit: r.interval_unit,
        max_runs: r.max_runs != null ? r.max_runs : null,
        next_run_at: r.next_run_at,
        last_status: r.last_status,
        run_count: r.run_count,
      }));
    }

    case "scheduler.cancel": {
      const taskId = req.params.task_id as number;
      validatePositiveInt(taskId, "task_id");

      // Only allow cancelling tasks in the caller's conversation
      const conversationId = req.params.conversation_id as number;
      if (conversationId) {
        const task = db.prepare("SELECT conversation_id FROM scheduled_tasks WHERE id = ?")
          .get(taskId) as { conversation_id: number } | undefined;
        if (!task) throw new Error("Task not found");
        if (task.conversation_id !== conversationId) throw new Error("Task belongs to another conversation");
      }

      db.prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(taskId);
      broadcast("scheduler:taskUpdate", { id: taskId, deleted: true });
      return { deleted: true };
    }

    default:
      throw new Error(`Unknown method: ${req.method}`);
  }
}

// ─── Socket server ───────────────────────────────────────────

function handleConnection(conn: net.Socket): void {
  bridgeLog("INFO", "New bridge client connected");
  let buffer = "";

  conn.on("data", (chunk) => {
    buffer += chunk.toString();
    // Process complete JSON lines
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;

      try {
        const req = JSON.parse(line) as BridgeRequest & { id?: string | number };
        bridgeLog("DEBUG", `Dispatch: method=${req.method} id=${req.id}`);
        const result = dispatch(req);
        conn.write(JSON.stringify({ id: req.id, result }) + "\n");
      } catch (err) {
        const errMsg = sanitizeError(err);
        bridgeLog("ERROR", `Dispatch error: ${errMsg}`);
        conn.write(JSON.stringify({ id: null, error: errMsg }) + "\n");
      }
    }
  });

  conn.on("error", (err) => {
    bridgeLog("ERROR", `Connection error: ${err.message}`);
  });

  conn.on("close", () => {
    bridgeLog("INFO", "Bridge client disconnected");
  });
}

// ─── Public API ──────────────────────────────────────────────

export function startBridge(db: SqlJsAdapter): void {
  bridgeDb = db;
  authToken = randomUUID();
  socketPath = getSocketPath();

  // Truncate log file on startup
  try { fs.writeFileSync(getLogPath(), ""); } catch { /* ok */ }

  bridgeLog("INFO", `Starting bridge: socket=${socketPath}`);

  // Clean up stale socket
  try { fs.unlinkSync(socketPath); } catch { /* ok */ }

  const sockPath = socketPath;
  server = net.createServer(handleConnection);
  server.listen(sockPath, () => {
    // Set socket permissions to owner-only
    try { fs.chmodSync(sockPath, 0o600); } catch { /* ok */ }
    bridgeLog("INFO", `Listening on ${sockPath}`);
  });

  server.on("error", (err) => {
    bridgeLog("ERROR", `Server error: ${(err as Error).message}`);
  });
}

export function stopBridge(): void {
  bridgeLog("INFO", "Stopping bridge");
  if (server) {
    server.close();
    server = null;
  }
  if (socketPath) {
    try { fs.unlinkSync(socketPath); } catch { /* ok */ }
    socketPath = null;
  }
  authToken = null;
  bridgeDb = null;
  bridgeLog("INFO", "Bridge stopped");
}

// The scheduler MCP script ships under resources/mcp/. resourcePath() resolves it in dev
// (Deno.cwd()) and in the packaged binary (embedded VFS via `--include resources`), replacing the
// Electron app.isPackaged / process.resourcesPath / getAppPath() branch.
function getServerScriptPath(): string {
  return resourcePath("resources/mcp/scheduler-server.mjs");
}

export function getSchedulerMcpConfig(conversationId: number): { command: string; args: string[]; env: Record<string, string> } | null {
  if (!socketPath || !authToken) {
    bridgeLog("WARN", "Bridge not started — scheduler MCP unavailable");
    return null;
  }

  const nodeBin = findBinaryInPath("node");
  if (!nodeBin) {
    bridgeLog("WARN", "Node.js binary not found in PATH — scheduler MCP unavailable");
    return null;
  }

  const scriptPath = getServerScriptPath();
  try {
    fs.accessSync(scriptPath, fs.constants.R_OK);
  } catch {
    bridgeLog("WARN", `MCP script not found at ${scriptPath} — scheduler MCP unavailable`);
    return null;
  }

  const logPath = getLogPath();
  bridgeLog("INFO", `MCP config: node=${nodeBin} script=${scriptPath} socket=${socketPath} conv=${conversationId} log=${logPath}`);

  return {
    command: nodeBin,
    args: [scriptPath],
    env: {
      SCHEDULER_SOCKET: socketPath,
      SCHEDULER_TOKEN: authToken,
      SCHEDULER_CONVERSATION_ID: String(conversationId),
      SCHEDULER_LOG_FILE: logPath,
    },
  };
}

// Export for PI SDK (not used for MCP)
export { socketPath, authToken };
