// Ported from src/main/services/files.ts. Registers the file-management Cat C handlers that are
// NOT already served by core/handlers/files.ts (files:revealInFileManager, files:openWithDefault,
// files:trash) on the dispatch registry (origin 'local'). Electron APIs replaced:
//   shell.showItemInFolder → revealInFileManager (./opener; opens containing dir, no highlight)
//   shell.openPath          → openPath (./opener; fire-and-forget, no error string to re-throw)
//   shell.trashItem         → npm `trash` package
//   process.platform        → Deno.build.os
// All node:fs / node:path / node:os logic is kept as-is (node-compat works at runtime).
import type { HandleRegistrar } from "../../core/dispatch";
import type Database from "better-sqlite3";
import { promises as fsp } from "node:fs";
import { join, extname } from "node:path";
import os from "node:os";
import trash from "trash";
import { checkWriteAllowed, validatePathSafe, validatePathSafeAsync, validateString } from "../../core/utils/validate";
import { expandTilde } from "../../core/utils/paths";
import { getSetting } from "../../core/utils/db";
import { openPath, revealInFileManager } from "./opener";

// Extensions that can execute arbitrary code via the OS default handler.
// Refused in files:openWithDefault and files:revealInFileManager.
const EXECUTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  // Linux executables / launchers
  "sh", "bash", "zsh", "desktop", "appimage", "run",
  // Windows executables / launchers
  "exe", "bat", "cmd", "com", "ps1", "vbs", "scr", "pif", "msi", "lnk",
  // Cross-platform interpreted scripts
  "jar", "py", "rb", "pl",
]);

export function classifyFileExt(ext: string): string | null {
  switch (ext) {
    case "html": case "htm": return "html";
    case "svg": return "svg";
    case "css": return "css";
    case "js": case "jsx": return "javascript";
    case "ts": case "tsx": return "typescript";
    case "json": return "json";
    case "md": case "markdown": return "markdown";
    case "py": return "python";
    case "rs": return "rust";
    case "go": return "go";
    case "sh": case "bash": return "bash";
    case "yml": case "yaml": return "yaml";
    case "toml": return "toml";
    case "sql": return "sql";
    case "xml": return "xml";
    case "scad": return "scad";
    default: return ext || null;
  }
}

// Mirrors src/main/utils/mime.ts::mimeToExt — inlined so the desktop shell carries no
// dependency on src/main (retired in the cutover). Consumed by the ported service test.
export function mimeToExt(mime: string): string | null {
  switch (mime) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/gif": return "gif";
    case "image/webp": return "webp";
    case "image/bmp": return "bmp";
    case "image/svg+xml": return "svg";
    case "image/avif": return "avif";
    default: return null;
  }
}

export async function cleanupPastedFiles(): Promise<void> {
  const tmpDir = join(os.tmpdir(), "agent-paste");
  try {
    const files = await fsp.readdir(tmpDir);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24h
    for (const file of files) {
      const filePath = join(tmpDir, file);
      try {
        const stats = await fsp.stat(filePath);
        if (stats.mtimeMs < cutoff) await fsp.unlink(filePath);
      } catch { /* ignore per-file errors */ }
    }
  } catch { /* dir may not exist yet */ }
}

// The dispatch layer hands the live DB as `unknown` (concretely a sql.js adapter, structurally
// compatible with the better-sqlite3 surface getSetting() reads). Narrow via the one method used.
function isSqliteHandle(db: unknown): db is Database.Database {
  return typeof db === "object" && db !== null && "prepare" in db && typeof db.prepare === "function";
}

/** Read the global hooks_cwdWhitelist setting from the database. */
function getGlobalWhitelist(db: unknown): Array<{ path: string; access: "read" | "readwrite" }> {
  if (!isSqliteHandle(db)) return [];
  try {
    const value = getSetting(db, "hooks_cwdWhitelist");
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function registerHandlers(dispatch: HandleRegistrar, db: unknown): void {
  // files:listTree, files:listDir, files:readFile, files:rename, files:duplicate,
  // files:writeFile, files:move, files:createFile, files:createFolder,
  // files:savePastedFile, files:prepareSession, files:openTerminalHere
  // are all registered via core/handlers/files.ts (engine.dispatch) — not re-registered here.

  dispatch.handle("files:revealInFileManager", async (_event, filePath: unknown) => {
    const requested = validateString(filePath, "filePath");
    const resolved = expandTilde(requested);
    validatePathSafe(resolved);
    const realResolved = await validatePathSafeAsync(resolved);
    const ext = extname(realResolved).slice(1).toLowerCase();
    if (EXECUTABLE_EXTENSIONS.has(ext)) {
      throw new Error(`Refused to reveal: .${ext} files are blocked for security`);
    }
    revealInFileManager(realResolved);
  });

  dispatch.handle("files:openWithDefault", async (_event, filePath: unknown) => {
    const requested = validateString(filePath, "filePath");
    const resolved = expandTilde(requested);
    validatePathSafe(resolved);
    const realResolved = await validatePathSafeAsync(resolved);
    const ext = extname(realResolved).slice(1).toLowerCase();
    if (EXECUTABLE_EXTENSIONS.has(ext)) {
      throw new Error(`Refused to open: .${ext} files are blocked for security`);
    }
    if (Deno.build.os === "linux") {
      const stat = await fsp.stat(realResolved);
      if ((stat.mode & 0o111) !== 0) {
        throw new Error("Refused to open: file has executable permissions");
      }
    }
    // Fire-and-forget under deno: the opener spawns xdg-open/open/start and swallows failures,
    // so (unlike Electron's shell.openPath) there is no error string to re-throw.
    openPath(realResolved);
  });

  dispatch.handle("files:trash", async (_event, filePath: unknown) => {
    const requested = validateString(filePath, "filePath");
    const resolved = expandTilde(requested);
    validatePathSafe(resolved);
    const realResolved = await validatePathSafeAsync(resolved);
    const whitelist = getGlobalWhitelist(db);
    const outsideWrite = checkWriteAllowed(realResolved, whitelist);
    if (outsideWrite) {
      throw new Error(`Write access denied: ${outsideWrite} is outside the allowed readwrite directories`);
    }
    await trash(realResolved);
  });
}
