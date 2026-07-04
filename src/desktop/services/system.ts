// Ported from src/main/services/system.ts. Registers the `system:*` Cat C handlers on the
// dispatch registry (origin 'local'). Electron APIs replaced: app→paths, shell.openExternal→opener,
// Notification→Web Notification, dialog→nativeDialogs, BrowserWindow parent→dropped (dialogs are
// process-modal CLI helpers now). Adds system:importDroppedFile for CEF drag-drop (no webUtils).
import { join } from "node:path";
import type { HandleRegistrar } from "../../core/dispatch";
import { appVersion, userDataDir } from "../paths";
import { openExternal } from "./opener";
import { selectFile, selectFolder } from "./nativeDialogs";

function sessionType(): string {
  return Deno.env.get("XDG_SESSION_TYPE") ?? (Deno.env.get("WAYLAND_DISPLAY") ? "wayland" : "x11");
}

export function registerHandlers(dispatch: HandleRegistrar, _db: unknown): void {
  dispatch.handle("system:getInfo", async () => ({
    version: appVersion(),
    electron: "",
    node: Deno.version.deno,
    platform: Deno.build.os,
    dbPath: userDataDir(),
    configPath: userDataDir(),
    sessionType: sessionType(),
  }));

  dispatch.handle("system:openExternal", async (_event, url: unknown) => {
    if (typeof url !== "string") throw new Error("Invalid URL");
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Invalid URL format");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Blocked protocol: ${parsed.protocol}`);
    }
    openExternal(url);
  });

  dispatch.handle("system:showNotification", async (_event, title: unknown, body: unknown) => {
    if (typeof title !== "string" || typeof body !== "string") {
      throw new Error("Notification title and body must be strings");
    }
    if (title.length > 500 || body.length > 500) {
      throw new Error("Notification title or body exceeds maximum length (500 chars)");
    }
    new Notification(title, { body });
  });

  dispatch.handle("system:selectFolder", async () => selectFolder());
  dispatch.handle("system:selectFile", async () => selectFile());

  // Drag-dropped files arrive as raw bytes (CEF-under-deno has no webUtils.getPathForFile).
  // Persist under <userData>/dropped and return the absolute path for the attachment pipeline.
  dispatch.handle("system:importDroppedFile", async (_event, name: unknown, bytes: unknown) => {
    if (typeof name !== "string") throw new Error("importDroppedFile: name must be a string");
    if (!(bytes instanceof Uint8Array)) throw new Error("importDroppedFile: bytes must be a Uint8Array");
    const dir = join(userDataDir(), "dropped");
    await Deno.mkdir(dir, { recursive: true });
    const dest = join(dir, `${crypto.randomUUID()}-${name.replace(/[/\\]/g, "_")}`);
    await Deno.writeFile(dest, bytes);
    return dest;
  });
}
