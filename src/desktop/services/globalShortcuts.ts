// Ported from src/main/services/globalShortcuts.ts. Startup service (NOT a dispatch handler):
// main.ts calls registerGlobalShortcuts(db, cbs) once at boot. Electron's `globalShortcut` is
// gone, so BOTH Wayland and X11 sessions now route through the XDG desktop portal / hyprctl
// path (registerWaylandShortcuts) — portals work on X11 GNOME/KDE. On a bare X11 WM with no
// portal, registration returns false and shortcuts are logged + disabled (accepted degradation).
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../../core/utils/logger";
import { userDataDir } from "../paths";
import {
  rebindWaylandShortcuts,
  registerWaylandShortcuts,
  unregisterWaylandShortcuts,
} from "./waylandShortcuts";

const log = createLogger("globalShortcuts");

export interface ShortcutCallbacks {
  onQuickChat: () => void;
  onQuickVoice: () => void;
  onShowApp: () => void;
  onStopTts: () => void;
}

// The keyboard_shortcuts table is queried through SqlJsAdapter's prepare().get() (which returns
// Record<string, unknown> | undefined). db arrives as unknown from main.ts — narrow it once.
interface ShortcutDb {
  prepare(sql: string): { get(...params: unknown[]): Record<string, unknown> | undefined };
}

function isShortcutDb(v: unknown): v is ShortcutDb {
  return typeof v === "object" && v !== null && "prepare" in v && typeof v.prepare === "function";
}

let db: unknown = null;
let callbacks: ShortcutCallbacks | null = null;
let sessionType: "wayland" | "x11" | "unknown" = "unknown";
// True while a portal/FIFO session is live (Wayland or X11-through-portal).
let portalActive = false;

/** Detect whether the current session is Wayland, X11, or unknown (diagnostics only — both
 *  routes go through the portal now). Mirrors src/main/utils/env.ts::getSessionType. */
function getSessionType(): "wayland" | "x11" | "unknown" {
  if (Deno.env.get("XDG_SESSION_TYPE") === "wayland") return "wayland";
  if (Deno.env.get("WAYLAND_DISPLAY")) return "wayland";
  if (Deno.env.get("HYPRLAND_INSTANCE_SIGNATURE")) return "wayland";
  if (Deno.env.get("XDG_SESSION_TYPE") === "x11") return "x11";
  if (Deno.env.get("DISPLAY")) return "x11";
  return "unknown";
}

/** Append a timestamped line to <userData>/shortcuts.log for debugging */
function logToFile(msg: string): void {
  try {
    const logPath = join(userDataDir(), "shortcuts.log");
    appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // best effort
  }
}

function readShortcutKeybinding(action: string): string | undefined {
  if (!isShortcutDb(db)) return undefined;
  const row = db
    .prepare("SELECT keybinding FROM keyboard_shortcuts WHERE action = ? AND enabled = 1")
    .get(action);
  const keybinding = row?.keybinding;
  return typeof keybinding === "string" && keybinding.length > 0 ? keybinding : undefined;
}

export function registerGlobalShortcuts(database: unknown, cbs: ShortcutCallbacks): void {
  db = database;
  callbacks = cbs;
  sessionType = getSessionType();
  log.info("session type", { sessionType });
  logToFile(`Session type: ${sessionType}`);
  logToFile(
    `Env: DBUS=${Deno.env.get("DBUS_SESSION_BUS_ADDRESS") || "(unset)"} WAYLAND=${
      Deno.env.get("WAYLAND_DISPLAY") || "(unset)"
    } XDG_SESSION=${Deno.env.get("XDG_SESSION_TYPE") || "(unset)"} HYPRLAND_SIG=${
      Deno.env.get("HYPRLAND_INSTANCE_SIGNATURE") || "(unset)"
    }`,
  );
  reregister().catch((err) => {
    log.error("failed to register shortcuts", err);
    logToFile(`FAILED: ${err}`);
  });
}

let reregisterLock: Promise<void> | null = null;

export async function reregister(): Promise<void> {
  if (reregisterLock) await reregisterLock;
  reregisterLock = doReregister().finally(() => {
    reregisterLock = null;
  });
  return reregisterLock;
}

async function doReregister(): Promise<void> {
  if (!callbacks) return;
  const cbs = callbacks;

  const chatKey = readShortcutKeybinding("quick_chat") || "Alt+Space";
  const voiceKey = readShortcutKeybinding("quick_voice") || "Alt+Shift+Space";
  const showKey = readShortcutKeybinding("show_app") || "Super+A";
  const stopTtsKey = readShortcutKeybinding("stop_tts") || "Ctrl+Shift+T";

  // Fast path: if a portal/FIFO session is already active, just rebind the key combos
  // (no D-Bus teardown). The portal session + Activated listener stay intact.
  if (portalActive) {
    logToFile(
      `Rebinding shortcuts (session alive): chat=${chatKey} voice=${voiceKey} show=${showKey} stopTts=${stopTtsKey}`,
    );
    const ok = await rebindWaylandShortcuts([
      { id: "quick-chat", accelerator: chatKey },
      { id: "quick-voice", accelerator: voiceKey },
      { id: "show-app", accelerator: showKey },
      { id: "stop-tts", accelerator: stopTtsKey },
    ]);
    if (ok) {
      logToFile("rebind OK");
      return;
    }
    // Session gone — fall through to full registration
    logToFile("rebind failed (session lost), doing full re-registration");
    portalActive = false;
  }

  logToFile(
    `Registering shortcuts: chat=${chatKey} voice=${voiceKey} show=${showKey} stopTts=${stopTtsKey}`,
  );
  const ok = await registerWaylandShortcuts(
    [
      { id: "quick-chat", accelerator: chatKey, description: "Quick Chat" },
      { id: "quick-voice", accelerator: voiceKey, description: "Quick Voice" },
      { id: "show-app", accelerator: showKey, description: "Show App" },
      { id: "stop-tts", accelerator: stopTtsKey, description: "Stop TTS" },
    ],
    (shortcutId) => {
      logToFile(`Activated: ${shortcutId}`);
      if (shortcutId === "quick-chat") cbs.onQuickChat();
      if (shortcutId === "quick-voice") cbs.onQuickVoice();
      if (shortcutId === "show-app") cbs.onShowApp();
      if (shortcutId === "stop-tts") cbs.onStopTts();
    },
  );
  portalActive = ok;
  logToFile(`registration result: ${ok}`);
  if (!ok) {
    log.warn("XDG portal unavailable — global shortcuts disabled");
    logToFile("XDG portal unavailable — global shortcuts disabled");
  }
}

export async function unregisterAll(): Promise<void> {
  if (portalActive) {
    await unregisterWaylandShortcuts();
    portalActive = false;
  }
}
