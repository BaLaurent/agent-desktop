// Ambient types for the `deno desktop` runtime additions (Deno 2.9.x). These
// APIs exist at runtime under `deno desktop` but are not yet in the shipped
// `lib.deno.d.ts`. Shapes taken from https://docs.deno.com/runtime/desktop/ and
// verified against the Phase-0 spike (notably: `executeJs` resolves an ENVELOPE
// `{ ok, value }`, NOT the bare completion value).
declare namespace Deno {
  /** Packaged app version (from deno.json `version`); `null` in dev / `--hmr`. */
  // deno-lint-ignore no-var
  const desktopVersion: string | null;

  interface BrowserWindowOptions {
    title?: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    resizable?: boolean;
    alwaysOnTop?: boolean;
    frameless?: boolean;
    noActivate?: boolean;
    transparentTitlebar?: boolean;
  }

  interface ExecuteJsResult {
    ok: boolean;
    value: unknown;
  }

  interface OpenDevtoolsOptions {
    deno?: boolean;
    renderer?: boolean;
  }

  class BrowserWindow extends EventTarget {
    constructor(options?: BrowserWindowOptions);
    readonly windowId: number;
    show(): void;
    hide(): void;
    focus(): void;
    close(): void;
    reload(): void;
    navigate(url: string): void;
    setSize(width: number, height: number): void;
    getSize(): [number, number];
    setPosition(x: number, y: number): void;
    getPosition(): [number, number];
    setTitle(title: string): void;
    setResizable(resizable: boolean): void;
    isResizable(): boolean;
    setAlwaysOnTop(value: boolean): void;
    isAlwaysOnTop(): boolean;
    isClosed(): boolean;
    isVisible(): boolean;
    openDevtools(options?: OpenDevtoolsOptions): void;
    /** Resolves `{ ok, value }` — read `.value` for the script's completion value. */
    executeJs(code: string): Promise<ExecuteJsResult>;
    bind(name: string, handler: (...args: never[]) => unknown): void;
    unbind(name: string): void;
    getNativeWindow(): unknown;
    onfocus: (() => void) | null;
    onblur: (() => void) | null;
  }

  type MenuItem =
    | "separator"
    | {
      item: {
        label: string;
        id: string;
        enabled?: boolean;
        accelerator?: string;
        submenu?: MenuItem[];
      };
    };

  interface TrayPanel {
    readonly window: BrowserWindow;
    show(): void;
    hide(): void;
    toggle(): void;
    readonly visible: boolean;
    destroy(): void;
  }

  class Tray extends EventTarget {
    constructor();
    readonly trayId: number;
    setIcon(pngBytes: Uint8Array): void;
    setIconDark(pngBytes: Uint8Array | null): void;
    setTooltip(text: string | null): void;
    setMenu(items: MenuItem[] | null): void;
    getBounds(): { x: number; y: number; width: number; height: number } | null;
    attachPanel(options: { url: string; width?: number; height?: number; hideOnBlur?: boolean }): TrayPanel;
    destroy(): void;
  }
}

// Web Notification API — provided by the deno desktop runtime (native OS notifications),
// not present in the default Deno type lib.
interface NotificationOptions {
  body?: string;
  icon?: string;
  tag?: string;
  silent?: boolean;
}
declare class Notification {
  constructor(title: string, options?: NotificationOptions);
  onclick: (() => void) | null;
  close(): void;
  static permission: "default" | "granted" | "denied";
  static requestPermission(): Promise<"default" | "granted" | "denied">;
}
