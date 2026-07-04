// Entry point for the `deno desktop` shell — replaces src/main/index.ts (Electron main).
// Boots the AgentEngine, serves the renderer over a local HTTP+WS bridge (uiServer/uiBridge),
// opens a native window pointed at it, registers all dispatch services (registerServices), and
// wires the native OS integrations (tray, global shortcuts, quick-chat overlay, omp sidecar).
import { join } from "node:path";
import { AgentEngine, noopHookRunner, noopPlatformIO, noopSystemUI } from "../core";
import type { Broadcaster } from "../core";
import { broadcast as coreBroadcast } from "../core/utils/broadcast";
import { setPIBackend, setSessionManager } from "../core/services/streaming";
import { streamMessageOmp } from "../core/services/streamingOmp";
import { stop as stopTts } from "../core/handlers/tts";
import { createLogger } from "../core/utils/logger";
import { appVersion, resourcePath, userDataDir } from "./paths";
import { createUiBridge } from "./uiBridge";
import { startUiServer } from "./uiServer";
import { acquireSingleInstance, releaseSingletonLock } from "./singleInstance";
import { registerLocalServices } from "./registerServices";
import { parseDeepLink } from "./services/deeplink";
import { configureOverlay, showOverlay } from "./services/quickChat";
import { createTray } from "./services/tray";
import { registerGlobalShortcuts, reregister as reregisterShortcuts, unregisterAll as unregisterShortcuts } from "./services/globalShortcuts";
import { shutdownAllKernels } from "./services/jupyter";
import { shutdownSttSidecar } from "./services/sttSidecar";
import { ensureOmpBinary } from "./services/ompSidecar";
import { loadAndRegisterClaudeSDK } from "./services/loadSdk";
import { sendTurn, respondToSessionApproval, abortSession, hasActiveSession, shutdownAllSessions } from "./services/sessionManager";
import { startBridge, stopBridge } from "./services/schedulerBridge";
import { startScheduler, stopScheduler } from "./services/scheduler";

const log = createLogger("desktop/main");

// Minimal environment enrichment. Ensures HOME + CLAUDE_CONFIG_DIR so the omp/claude subprocesses
// find their config. (Full sanitizeWayland/loadShellEnv/sanitizeAppImage port is a follow-up.)
function enrichEnvironment(): void {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (home && !Deno.env.get("CLAUDE_CONFIG_DIR")) {
    Deno.env.set("CLAUDE_CONFIG_DIR", join(home, ".claude"));
  }
}

// Module-level handle so the single-instance callback + tray can focus the window.
let mainWin: Deno.BrowserWindow | undefined;
let shuttingDown = false;

function showMainWindow(): void {
  mainWin?.show();
  mainWin?.focus();
}

async function main(): Promise<void> {
  enrichEnvironment();
  // userDataDir must exist before acquireSingleInstance (its socket lives there; a missing dir
  // would make listen() fail and mint a false primary → dual DB writers on a fresh install).
  Deno.mkdirSync(userDataDir(), { recursive: true });

  // Single-DB-writer guard. A second launch forwards its argv here (deep-link delivery on Linux)
  // and exits. agent://conversation/<id> in argv → focus + navigate.
  const isPrimary = await acquireSingleInstance((argv) => {
    showMainWindow();
    for (const arg of argv) {
      const convId = parseDeepLink(arg);
      if (convId != null) {
        coreBroadcast("deeplink:navigate", convId);
        break;
      }
    }
  });
  if (!isPrimary) {
    log.info("another instance is already running — exiting");
    Deno.exit(0);
  }

  // Route pi/omp chat through the out-of-process omp RPC backend (same as headless).
  setPIBackend(streamMessageOmp);

  // Claude (non-omp) backend: register the Agent SDK (non-fatal — a load failure leaves the omp
  // backend untouched) + inject the persistent-session manager so core streaming's Claude path
  // (streaming.ts:301) has a sendTurn. Mirrors Electron's whenReady registerAgentSDK + setSessionManager.
  await loadAndRegisterClaudeSDK();
  setSessionManager({
    sendTurn,
    respondToApproval: respondToSessionApproval,
    abortSession,
    hasActiveSession,
  });

  // Engine Broadcaster port → global broadcast(); uiBridge fans broadcast() out to WS clients.
  const broadcaster: Broadcaster = {
    broadcast(channel: string, ...args: unknown[]): void {
      coreBroadcast(channel, ...args);
    },
  };

  const engine = new AgentEngine({
    dbPath: join(userDataDir(), "agent.db"),
    wasmPath: resourcePath("node_modules/sql.js/dist/sql-wasm.wasm"),
    themesDir: join(Deno.env.get("HOME") ?? "", ".agent-desktop", "themes"),
    broadcaster,
    hookRunner: noopHookRunner,
    platformIO: noopPlatformIO,
    systemUI: noopSystemUI,
  });
  await engine.init();
  log.info(`engine ready — ${engine.conversations.list().length} conversations, v${appVersion()}`);

  // Register Category B (web-server/discord) + Category C (ported native services) on the
  // dispatch registry. Category A is already registered inside engine.init().
  registerLocalServices(engine);

  // Scheduler: the unix-socket MCP bridge (lets the agent_scheduler MCP subprocess mutate tasks in
  // the live DB) + the in-process task scheduler (60s tick + OS-timer background fallback). Both
  // take the SqlJsAdapter directly (engine.db), matching Electron's startBridge(db)/startScheduler(db).
  startBridge(engine.db);
  await startScheduler(engine.db);

  // Local trusted UI transport. AGENT_UI_TOKEN is a dev/test seam (scripted WS clients);
  // absent → a fresh per-launch random token (the normal case).
  const token = Deno.env.get("AGENT_UI_TOKEN") || crypto.randomUUID();
  const bridge = createUiBridge(engine.dispatch, token);
  startUiServer({ token, bridge });

  const port = (Deno.env.get("DENO_SERVE_ADDRESS") ?? "").split(":").pop() ?? "";
  log.info(`ui server on 127.0.0.1:${port}`);

  // Native frame (Deno.BrowserWindow has no minimize/maximize — the OS titlebar provides them;
  // the renderer drops its custom window controls).
  const win = new Deno.BrowserWindow({ title: "Agent Desktop", width: 1280, height: 800 });
  mainWin = win;
  // The token rides the URL so the shim authenticates without an inline <script> (keeps CSP tight).
  win.navigate(`http://127.0.0.1:${port}/?token=${token}`);

  win.bind("desktopCapabilities", () => ({ windowControls: false, transparency: false }));
  if (Deno.env.get("AGENT_DEV") === "1") {
    win.bind("openDevtools", () => {
      win.openDevtools();
      return true;
    });
  }
  win.addEventListener("keydown", (ev) => {
    const key = "detail" in ev && ev.detail && typeof ev.detail === "object" && "key" in ev.detail ? ev.detail.key : undefined;
    if (key === "F5") win.reload();
  });

  // ─── Native OS integrations ────────────────────────────────────────────────
  // SqlJsAdapter debounces disk flushes (~500ms); only engine.shutdown()→close() forces a final
  // flush. deno desktop's DEFAULT close action exits the runtime immediately, which would race the
  // async flush and drop the last writes — so we preventDefault, await shutdown, THEN exit.
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutting down");
    // ORDER MATTERS on the signal path: laufey may tear the process down while an await is
    // parked, losing everything after it (observed: SIGTERM died inside the XDG-portal
    // roundtrip). So: fast/sync teardown + the DB flush FIRST, slow best-effort calls LAST —
    // if the runtime dies late, only the portal unregister is lost (its session dies with the
    // pid anyway), never the flush or the singleton lock release.
    try { bridge.close(); } catch { /* ignore */ }
    try { await stopScheduler(); } catch { /* ignore */ }
    try { stopBridge(); } catch { /* ignore */ }
    try { shutdownAllSessions(); } catch { /* ignore */ }
    shutdownAllKernels();
    shutdownSttSidecar();
    await engine.shutdown();
    releaseSingletonLock();
    try { await unregisterShortcuts(); } catch { /* ignore */ }
    Deno.exit(0);
  };

  // Quick-chat overlay: give it the UI token so its shim authenticates over /ui-ws.
  configureOverlay({ token, reregisterShortcuts });

  // Tray icon + menu.
  createTray({
    showWindow: showMainWindow,
    onQuickChat: () => showOverlay("text"),
    onQuit: shutdown,
  });

  // Global shortcuts (Wayland/X11 via XDG portal).
  registerGlobalShortcuts(engine.db, {
    onQuickChat: () => showOverlay("text"),
    onQuickVoice: () => showOverlay("voice"),
    onShowApp: showMainWindow,
    onStopTts: () => stopTts(),
  });

  // omp sidecar: download/update the managed omp binary (non-fatal, fire-and-forget).
  ensureOmpBinary().catch((err) => log.warn("ensureOmpBinary failed", { err: String(err) }));

  // window-all-closed → quit. Cancel the runtime's default exit so the DB flush completes first.
  win.addEventListener("close", (ev) => {
    ev.preventDefault();
    void shutdown();
  });
  // Signal path: laufey tears the runtime down DURING the handler — even synchronous work races
  // process death (observed: a kill landed mid-flush). Durability therefore does NOT rely on this
  // handler: SqlJsAdapter flushes leading-edge on isolated writes (atomic tmp+rename), so recent
  // user actions are already on disk before any signal fires. The handler is best-effort: flush
  // any burst tail, release the singleton lock (stale locks are inert — pid-checked by readers),
  // and kick the async shutdown for whatever teardown the runtime allows. The window-close path
  // (above) keeps the full async shutdown — preventDefault() makes the runtime wait for it.
  const onSignal = () => {
    try {
      engine.db.flush();
    } catch {
      // nothing dirty, or the engine is already closed
    }
    releaseSingletonLock();
    void shutdown();
  };
  Deno.addSignalListener("SIGINT", onSignal);
  Deno.addSignalListener("SIGTERM", onSignal);
}

main().catch((err) => {
  log.error("startup fatal", { err: err instanceof Error ? err.message : String(err) });
  Deno.exit(1);
});
