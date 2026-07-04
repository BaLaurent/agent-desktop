// Ported from src/main/services/tray.test.ts. The Electron test targeted toggleAppWindow — window
// show/hide/minimize/restore logic driven by BrowserWindow.isVisible/isFocused/isMinimized. That
// logic was intentionally moved OUT of the ported tray.ts (Deno.BrowserWindow has no
// isFocused/isMinimized; main.ts owns it), so toggleAppWindow has no counterpart here.
//
// What the ported tray.ts DOES own — and what this test covers — is the Deno.Tray menu construction
// and the menuclick → broadcast/callback routing (the Electron→broadcast rewiring). Deno.Tray is a
// desktop-only global (undefined in a bare `deno test`), so we install a fake constructor: it needs
// no real status-area icon, and createTray() drives it exactly as the runtime would. This is the
// faithful analogue of the Electron test's TrayMock.
import { assert, assertEquals } from "jsr:@std/assert";
import { addBroadcastHandler } from "../../core/utils/broadcast.ts";
import { createTray, setTrayUpdateCallbacks, rebuildTrayMenu } from "./tray.ts";

interface FakeTray {
  trayId: number;
  menu: unknown[];
  listeners: Map<string, (ev: unknown) => void>;
  icons: { light?: Uint8Array; dark?: Uint8Array };
  setIcon(bytes: Uint8Array): void;
  setIconDark(bytes: Uint8Array): void;
  setTooltip(s: string): void;
  setMenu(items: unknown[]): void;
  addEventListener(event: string, cb: (ev: unknown) => void): void;
}

const trays: FakeTray[] = [];

class FakeTrayImpl implements FakeTray {
  trayId = 1;
  menu: unknown[] = [];
  listeners = new Map<string, (ev: unknown) => void>();
  icons: { light?: Uint8Array; dark?: Uint8Array } = {};
  constructor() {
    trays.push(this);
  }
  setIcon(bytes: Uint8Array): void {
    this.icons.light = bytes;
  }
  setIconDark(bytes: Uint8Array): void {
    this.icons.dark = bytes;
  }
  setTooltip(_s: string): void {}
  setMenu(items: unknown[]): void {
    this.menu = items;
  }
  addEventListener(event: string, cb: (ev: unknown) => void): void {
    this.listeners.set(event, cb);
  }
}

// Install the fake before createTray() reads `new Deno.Tray()`. Test-only process global.
Object.defineProperty(Deno, "Tray", { value: FakeTrayImpl as unknown as typeof Deno.Tray, configurable: true, writable: true });

// Extract the string labels from a Deno.MenuItem[] (items are `{ item: { label, id } }` or "separator").
function menuLabels(menu: unknown[]): string[] {
  const out: string[] = [];
  for (const m of menu) {
    if (m && typeof m === "object" && "item" in m) {
      const item = m.item;
      if (item && typeof item === "object" && "label" in item && typeof item.label === "string") {
        out.push(item.label);
      }
    }
  }
  return out;
}

function fire(tray: FakeTray, id: string): void {
  const cb = tray.listeners.get("menuclick");
  assert(cb !== undefined, "menuclick listener must be registered");
  cb!({ detail: { id } });
}

Deno.test("createTray builds the base menu and loads an icon", () => {
  const tray = createTray({ showWindow: () => {} }) as unknown as FakeTray;
  const labels = menuLabels(tray.menu);
  assert(labels.includes("Show/Hide"));
  assert(labels.includes("New Conversation"));
  assert(labels.includes("Report a bug…"));
  assert(labels.includes("Quit"));
  // onQuickChat omitted → no Quick Chat item; no updater callbacks yet → no update item.
  assertEquals(labels.includes("Quick Chat"), false);
  assertEquals(labels.includes("Check for Updates"), false);
  // Icon bytes were loaded from build/tray*.png (real files in the repo).
  assert(tray.icons.light !== undefined && tray.icons.light.length > 0);
});

Deno.test("Quick Chat item appears only when onQuickChat is provided", () => {
  const withQC = createTray({ showWindow: () => {}, onQuickChat: () => {} }) as unknown as FakeTray;
  assert(menuLabels(withQC.menu).includes("Quick Chat"));
});

Deno.test("menuclick routing: New Conversation shows window, broadcasts, and runs the hook", () => {
  let shown = 0;
  let newConv = 0;
  const events: string[] = [];
  const unsub = addBroadcastHandler((channel) => events.push(channel));
  try {
    const tray = createTray({ showWindow: () => shown++, onNewConversation: () => newConv++ }) as unknown as FakeTray;
    fire(tray, "newConversation");
    assertEquals(shown, 1);
    assertEquals(newConv, 1);
    assert(events.includes("tray:newConversation"));
  } finally {
    unsub();
  }
});

Deno.test("menuclick routing: Report a bug shows window and broadcasts bugReport:open", () => {
  let shown = 0;
  const events: string[] = [];
  const unsub = addBroadcastHandler((channel) => events.push(channel));
  try {
    const tray = createTray({ showWindow: () => shown++ }) as unknown as FakeTray;
    fire(tray, "reportBug");
    assertEquals(shown, 1);
    assert(events.includes("bugReport:open"));
  } finally {
    unsub();
  }
});

Deno.test("menuclick routing: Quit invokes the onQuit hook (not Deno.exit)", () => {
  let quit = 0;
  const tray = createTray({ showWindow: () => {}, onQuit: () => quit++ }) as unknown as FakeTray;
  fire(tray, "quit");
  assertEquals(quit, 1);
});

Deno.test("left-click shows the window", () => {
  let shown = 0;
  const tray = createTray({ showWindow: () => shown++ }) as unknown as FakeTray;
  const clickCb = tray.listeners.get("click");
  assert(clickCb !== undefined);
  clickCb!(undefined);
  assertEquals(shown, 1);
});

// Runs last: setTrayUpdateCallbacks/rebuildTrayMenu mutate module-level state that persists across
// tests, so the update-item assertions come after the "no update item by default" case above.
Deno.test("updater callbacks expose the update menu items", () => {
  const tray = createTray({ showWindow: () => {} }) as unknown as FakeTray;
  let checked = 0;
  let installed = 0;
  setTrayUpdateCallbacks(() => checked++, () => installed++);
  assert(menuLabels(tray.menu).includes("Check for Updates"));

  rebuildTrayMenu(true);
  assert(menuLabels(tray.menu).includes("Restart to Update"));
  assertEquals(menuLabels(tray.menu).includes("Check for Updates"), false);

  // "Restart to Update" routes to the install callback.
  fire(tray, "installUpdate");
  assertEquals(installed, 1);
});
