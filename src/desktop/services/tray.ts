// Ported from src/main/services/tray.ts. Uses Deno.Tray (see deno-desktop.d.ts) instead of
// Electron's Tray/Menu/nativeImage/nativeTheme. Menu is a Deno.MenuItem[] + a "menuclick"
// listener keyed on item ids; "click" shows the main window. tray:newConversation / bugReport:open
// go out via broadcast() (the uiBridge fans them to the WS renderer — there is no webContents.send).
//
// main.ts wires the tray via:
//   const tray = createTray({ showWindow, onNewConversation?, onQuickChat?, onQuit? })
// then, once the updater is initialized (packaged only):
//   setTrayUpdateCallbacks(checkForUpdates, installUpdate)  // adds the update menu item
//   rebuildTrayMenu(true)                                   // called when an update becomes ready
//
// Callback contract (see TrayOptions): only `showWindow` is required. Any omitted optional
// callback drops its menu item (Quick Chat) or falls back to a default (New Conversation →
// broadcast('tray:newConversation'); Quit → Deno.exit(0)).
import { broadcast } from "../../core/utils/broadcast";
import { createLogger } from "../../core/utils/logger";
import { resourcePath } from "../paths";

const log = createLogger("tray");

export interface TrayOptions {
  /** Show + focus the main window. Invoked by tray left-click and the Show/Hide, New
   *  Conversation, and Report-a-bug menu items. (Deno.BrowserWindow has no isFocused/isMinimized,
   *  so main.ts owns whatever show/restore/toggle logic is achievable — the tray just calls this.) */
  showWindow: () => void;
  /** Optional extra hook for "New Conversation" (runs in addition to showWindow() +
   *  broadcast('tray:newConversation')). */
  onNewConversation?: () => void;
  /** Optional "Quick Chat" action — main.ts wires it to quickChat.showOverlay('text').
   *  When omitted, the Quick Chat menu item is not shown. */
  onQuickChat?: () => void;
  /** Optional graceful-quit handler (main.ts wires it to its shutdown: DB flush + Deno.exit).
   *  Defaults to Deno.exit(0) when omitted. */
  onQuit?: () => void;
}

let trayInstance: Deno.Tray | null = null;
let trayOptions: TrayOptions | null = null;
let updateReadyFlag = false;
let onCheckUpdateFn: (() => void) | null = null;
let onInstallUpdateFn: (() => void) | null = null;

// Load the status-area icon. Deno.Tray takes PNG bytes, not a path, and exposes a separate
// dark-mode slot (setIconDark) instead of Electron's nativeTheme 'updated' swap.
// Electron's mapping was: dark mode → trayLight.png, light mode → trayDark.png. So the default
// (light-mode) icon is trayDark.png and the dark-mode variant is trayLight.png. macOS uses the
// template image, which auto-adapts to the menu-bar appearance.
function loadIcon(tray: Deno.Tray): void {
  try {
    if (Deno.build.os === "darwin") {
      tray.setIcon(Deno.readFileSync(resourcePath("build/trayTemplate.png")));
      return;
    }
    tray.setIcon(Deno.readFileSync(resourcePath("build/trayDark.png")));
    tray.setIconDark(Deno.readFileSync(resourcePath("build/trayLight.png")));
  } catch (err) {
    log.warn("failed to load tray icon", { err: err instanceof Error ? err.message : String(err) });
  }
}

function buildMenu(): Deno.MenuItem[] {
  const items: Deno.MenuItem[] = [
    { item: { label: "Show/Hide", id: "toggle", enabled: true } },
    { item: { label: "New Conversation", id: "newConversation", enabled: true } },
  ];

  if (trayOptions?.onQuickChat) {
    items.push({ item: { label: "Quick Chat", id: "quickChat", enabled: true } });
  }

  items.push("separator");
  items.push({ item: { label: "Report a bug…", id: "reportBug", enabled: true } });
  items.push("separator");

  // Update menu items (only when the updater has wired its callbacks — packaged builds).
  if (onCheckUpdateFn || onInstallUpdateFn) {
    if (updateReadyFlag && onInstallUpdateFn) {
      items.push({ item: { label: "Restart to Update", id: "installUpdate", enabled: true } });
    } else if (onCheckUpdateFn) {
      items.push({ item: { label: "Check for Updates", id: "checkUpdate", enabled: true } });
    }
    items.push("separator");
  }

  items.push({ item: { label: "Quit", id: "quit", enabled: true } });
  return items;
}

// The "menuclick" event carries { detail: { id } }. deno-desktop.d.ts does not type the event
// detail, so narrow it with in/typeof guards (never an inline cast).
function menuClickId(ev: unknown): string | null {
  if (!ev || typeof ev !== "object" || !("detail" in ev)) return null;
  const detail = ev.detail;
  if (detail && typeof detail === "object" && "id" in detail && typeof detail.id === "string") {
    return detail.id;
  }
  return null;
}

function handleMenuClick(id: string): void {
  const opts = trayOptions;
  if (!opts) return;
  switch (id) {
    case "toggle":
      opts.showWindow();
      break;
    case "newConversation":
      opts.showWindow();
      broadcast("tray:newConversation");
      opts.onNewConversation?.();
      break;
    case "quickChat":
      opts.onQuickChat?.();
      break;
    case "reportBug":
      opts.showWindow();
      broadcast("bugReport:open");
      break;
    case "checkUpdate":
      onCheckUpdateFn?.();
      break;
    case "installUpdate":
      onInstallUpdateFn?.();
      break;
    case "quit":
      if (opts.onQuit) opts.onQuit();
      else Deno.exit(0);
      break;
  }
}

export function createTray(opts: TrayOptions): Deno.Tray {
  trayOptions = opts;

  const tray = new Deno.Tray();
  trayInstance = tray;

  loadIcon(tray);
  tray.setTooltip("Agent Desktop");
  tray.setMenu(buildMenu());

  tray.addEventListener("menuclick", (ev) => {
    const id = menuClickId(ev);
    if (id) handleMenuClick(id);
  });
  tray.addEventListener("click", () => opts.showWindow());

  // On some Linux setups (e.g. bare Hyprland with no SNI/AppIndicator host) the tray can't
  // register: trayId stays 0 and all calls become silent no-ops. Warn but don't fail — the
  // app still works, just without a status-area icon. (Documented degradation.)
  if (tray.trayId === 0) {
    log.warn("tray registration failed (trayId=0) — no status-area icon (SNI/AppIndicator unavailable); menu + click disabled, app continues");
  }

  return tray;
}

/** Wire the updater actions and refresh the menu to expose the update item (packaged builds). */
export function setTrayUpdateCallbacks(onCheckUpdate: () => void, onInstallUpdate: () => void): void {
  onCheckUpdateFn = onCheckUpdate;
  onInstallUpdateFn = onInstallUpdate;
  trayInstance?.setMenu(buildMenu());
}

/** Flip the "an update is ready" state and rebuild the menu (Check for Updates → Restart to Update). */
export function rebuildTrayMenu(updateReady: boolean): void {
  updateReadyFlag = updateReady;
  trayInstance?.setMenu(buildMenu());
}
