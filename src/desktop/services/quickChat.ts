// Ported from src/main/services/quickChat.ts (Electron main). Overlay windows now use
// Deno.BrowserWindow; the renderer reaches the backend over the WS shim on the local uiServer
// origin, so per-window IPC (webContents.send / registerStreamWindow) is gone — pushes fan out
// via broadcast(), and stream chunks already flow through the engine's broadcaster.
//
// Electron -> Deno swaps (per deno-port-guide.md):
//   BrowserWindow (frame:false, transparent, skipTaskbar, show:false) -> Deno.BrowserWindow
//     (frameless; NO transparency / skipTaskbar / show — accepted degradation). Voice adds noActivate.
//   screen.getPrimaryDisplay().workAreaSize -> executeJs('({aw:screen.availWidth,ah:screen.availHeight})')
//   did-finish-load gate -> poll executeJs until the overlay document is committed + complete
//   webContents.send / getMainWindow -> broadcast() (uiBridge fans it to every WS client)
//   globalShortcuts.reregister -> injected via configureOverlay (main.ts wires it; no cross-file dep)
//
// HYPRLAND CAVEAT (documented degradation): frameless overlay windows may be tiled by tiling WMs
// instead of floating at the requested geometry. The fix is a WM float rule (e.g. Hyprland
// `windowrulev2 = float, class:^(...)$`), configured by the user — not solved here.
import type Database from "better-sqlite3";
import type { HandleRegistrar } from "../../core/dispatch";
import { broadcast } from "../../core/utils/broadcast";
import { DEFAULT_MODEL } from "../../shared/constants";
import { applyVoiceAudioEffects, clearVoiceAudioEffects } from "../../core/services/voiceAudioEffects";
import { ConversationService } from "../../core/services/conversations";
import { getSetting } from "../../core/utils/db";

let overlayWindow: Deno.BrowserWindow | null = null;
let headlessActive = false;
let db: Database.Database;

// Injected by main.ts (the per-launch UI shim token + the global-shortcut reregister hook).
let uiToken = "";
let reregisterShortcuts: (() => void | Promise<void>) | undefined;

export interface OverlayConfig {
  /** UI shim auth token (same per-launch token main.ts hands the main window). Rides the overlay URL as ?token=. */
  token: string;
  /** globalShortcuts.reregister, injected so quickChat needs no direct dep on the (separately ported) module. */
  reregisterShortcuts?: () => void | Promise<void>;
}

/** Wire the overlay to main.ts's token + shortcut hooks. Call once during Phase 3 bootstrap. */
export function configureOverlay(config: OverlayConfig): void {
  uiToken = config.token;
  reregisterShortcuts = config.reregisterShortcuts;
}

// The uiServer's port: Deno.serve auto-binds and exports DENO_SERVE_ADDRESS (tcp:127.0.0.1:<port>).
function servePort(): string {
  const addr = Deno.env.get("DENO_SERVE_ADDRESS") ?? "";
  return addr.split(":").pop() ?? "";
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function resolveResumeTarget(mode: "text" | "voice"): number | null {
  const resumeKey = mode === "voice"
    ? "quickChat_resumeLastConversationVoice"
    : "quickChat_resumeLastConversationText";
  if (getSetting(db, resumeKey) !== "true") return null;

  const textId = Number(getSetting(db, "quickChat_conversationId")) || 0;
  const voiceId = Number(getSetting(db, "quickChat_voiceConversationId")) || 0;
  const excludeIds = [textId, voiceId].filter((n) => n > 0);

  const preferLastOpened = getSetting(db, "quickChat_resumePreferLastOpened") === "true";
  const service = new ConversationService(db);
  return preferLastOpened
    ? service.findLastOpenedConversationId(excludeIds)
    : service.findLastUserConversationId(excludeIds);
}

function ensureConversation(mode?: "text" | "voice"): number {
  const resolvedMode: "text" | "voice" = mode === "voice" ? "voice" : "text";
  const resumedId = resolveResumeTarget(resolvedMode);
  if (resumedId !== null) return resumedId;

  const separate = getSetting(db, "quickChat_separateVoiceConversation") === "true";
  const useVoiceKey = separate && mode === "voice";
  const settingKey = useVoiceKey ? "quickChat_voiceConversationId" : "quickChat_conversationId";
  const title = useVoiceKey ? "Quick Chat (Voice)" : "Quick Chat";

  const existingId = Number(getSetting(db, settingKey)) || 0;

  if (existingId > 0) {
    const exists = db.prepare("SELECT 1 FROM conversations WHERE id = ?").get(existingId);
    if (exists) return existingId;
  }

  // Create new Quick Chat conversation
  const model = getSetting(db, "ai_model") || DEFAULT_MODEL;

  const result = db.prepare(
    `INSERT INTO conversations (title, model, updated_at) VALUES (?, ?, datetime('now'))`,
  ).run(title, model);

  const newId = result.lastInsertRowid as number;
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(
    settingKey,
    String(newId),
  );

  // Notify all connected renderers (incl. the main window) so Quick Chat appears in the sidebar.
  broadcast("conversations:refresh");

  return newId;
}

function purgeConversation(): void {
  const textId = Number(getSetting(db, "quickChat_conversationId")) || 0;
  if (textId > 0) {
    db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(textId);
  }

  const voiceId = Number(getSetting(db, "quickChat_voiceConversationId")) || 0;
  if (voiceId > 0 && voiceId !== textId) {
    db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(voiceId);
  }
}

// --- Overlay Window ---

/** Reset shared overlay state, but only for the window that actually owned it (guards a late
 *  'close' event from clobbering a freshly-recreated overlay). */
function resetOverlayState(win: Deno.BrowserWindow): void {
  if (overlayWindow !== win) return;
  overlayWindow = null;
  headlessActive = false;
  void clearVoiceAudioEffects(db);
}

function destroyOverlay(win: Deno.BrowserWindow): void {
  win.close();
  // Reset immediately; the 'close' listener is a no-op afterwards (guarded by identity).
  resetOverlayState(win);
}

// available screen size (work area minus panels), read from the overlay's own DOM. executeJs
// resolves an envelope { ok, value } — read .value.
async function availableScreen(win: Deno.BrowserWindow): Promise<{ aw: number; ah: number }> {
  const res = await win.executeJs("({ aw: screen.availWidth, ah: screen.availHeight })");
  const v = res.value as { aw?: unknown; ah?: unknown };
  if (res.ok && v && typeof v.aw === "number" && typeof v.ah === "number") {
    return { aw: v.aw, ah: v.ah };
  }
  // Fallback if the window closed mid-query or the eval failed.
  return { aw: 1920, ah: 1080 };
}

// Replaces did-finish-load: poll until the OVERLAY document (not a stale about:blank) is fully
// loaded. Guarding on the ?mode=overlay query avoids positioning/showing against the prior page.
async function waitForOverlayReady(win: Deno.BrowserWindow): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    if (win.isClosed()) return false;
    const res = await win.executeJs(
      "location.search.includes('mode=overlay') && document.readyState === 'complete'",
    );
    if (res.ok && res.value === true) return true;
    await delay(50);
  }
  return false;
}

async function setupOverlay(win: Deno.BrowserWindow, winW: number, headless: boolean): Promise<void> {
  const ready = await waitForOverlayReady(win);
  if (!ready || win.isClosed()) return;

  const { aw, ah } = await availableScreen(win);
  if (win.isClosed()) return;
  win.setPosition(Math.round((aw - winW) / 2), Math.round(ah * 0.2));

  if (!headless) {
    win.show();
    win.focus();
  }
}

function createOverlay(voice: boolean, headless: boolean): Deno.BrowserWindow {
  const winW = voice ? 400 : 650;
  const winH = voice ? 200 : 420;

  const win = new Deno.BrowserWindow({
    width: winW,
    height: winH,
    frameless: true,
    alwaysOnTop: true,
    resizable: false,
    // Voice overlay must not steal activation from the user's current window.
    ...(voice ? { noActivate: true } : {}),
  });
  // No show:false option on Deno.BrowserWindow (starts visible) — hide immediately so headless
  // voice mode stays invisible and non-headless overlays don't flash before positioning.
  win.hide();

  win.addEventListener("close", () => resetOverlayState(win));

  const url =
    `http://127.0.0.1:${servePort()}/?mode=overlay&voice=${voice}&headless=${headless}&token=${uiToken}`;
  win.navigate(url);

  void setupOverlay(win, winW, headless);
  return win;
}

export function showOverlay(mode: "text" | "voice"): void {
  if (overlayWindow && !overlayWindow.isClosed()) {
    if (overlayWindow.isVisible() || headlessActive) {
      if (mode === "voice") {
        // Toggle recording off in the (possibly headless) overlay renderer.
        broadcast("overlay:stopRecording");
        void clearVoiceAudioEffects(db);
      } else {
        destroyOverlay(overlayWindow);
      }
      return;
    }
    destroyOverlay(overlayWindow);
  }

  const isHeadless = mode === "voice" && getSetting(db, "quickChat_voiceHeadless") === "true";

  headlessActive = isHeadless;
  overlayWindow = createOverlay(mode === "voice", isHeadless);

  if (mode === "voice") {
    applyVoiceAudioEffects(db).catch(() => {});
  }
}

export function hideOverlay(): void {
  if (overlayWindow && !overlayWindow.isClosed()) {
    destroyOverlay(overlayWindow);
  }
}

function setBubbleMode(): void {
  const win = overlayWindow;
  if (!win || win.isClosed()) return;
  void (async () => {
    const { aw, ah } = await availableScreen(win);
    if (win.isClosed()) return;
    win.setSize(400, 280);
    win.setPosition(aw - 416, ah - 296);
    win.setAlwaysOnTop(true);
  })();
}

// --- Dispatch Handlers ---

export function registerHandlers(dispatch: HandleRegistrar, database: unknown): void {
  db = database as Database.Database;

  dispatch.handle("quickChat:getConversationId", (_e, mode?: unknown) =>
    ensureConversation(mode === "voice" ? "voice" : "text"));
  dispatch.handle("quickChat:purge", () => purgeConversation());
  dispatch.handle("quickChat:hide", () => hideOverlay());
  dispatch.handle("quickChat:setBubbleMode", () => setBubbleMode());
  dispatch.handle("quickChat:reregisterShortcuts", () => reregisterShortcuts?.());
}
