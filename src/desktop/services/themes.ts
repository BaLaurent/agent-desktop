// Ported from src/main/services/themes.ts. Registers the `themes:*` handlers on the dispatch
// registry (origin 'local'). Electron swap: `app.getPath('home')` → node os.homedir(). The themes
// live under ~/.agent-desktop/themes (home-relative, NOT userData) — kept byte-identical so existing
// theme files are picked up. All logic delegates to the Electron-free core ThemesService.
import { homedir } from "node:os";
import { join } from "node:path";
import type { HandleRegistrar } from "../../core/dispatch";
import { ThemesService } from "../../core/services/themes";

const THEMES_DIR = join(homedir(), ".agent-desktop", "themes");
const service = new ThemesService(THEMES_DIR);

export async function ensureThemeDir(): Promise<void> {
  return service.ensureDir();
}

export function registerHandlers(dispatch: HandleRegistrar, _db: unknown): void {
  dispatch.handle("themes:list", () => service.list());
  dispatch.handle("themes:read", (_e, filename: unknown) => service.read(String(filename)));
  dispatch.handle("themes:create", (_e, filename: unknown, css: unknown) => service.create(String(filename), String(css)));
  dispatch.handle("themes:save", (_e, filename: unknown, css: unknown) => service.save(String(filename), String(css)));
  dispatch.handle("themes:delete", (_e, filename: unknown) => service.delete(String(filename)));
  dispatch.handle("themes:getDir", () => service.getDir());
  dispatch.handle("themes:refresh", () => service.list());
}
