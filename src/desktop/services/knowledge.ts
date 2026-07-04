// Ported from src/main/services/knowledge.ts. Registers `kb:openKnowledgesFolder` on the dispatch
// registry (origin 'local'). Electron swaps: `app.getPath('home')` → node os.homedir();
// `shell.showItemInFolder` → revealInFileManager (./opener). TEXT_EXTENSIONS is inlined here — the
// core handlers (attachments.ts, knowledge.ts) already inline the same set, so this mirrors the
// established pattern rather than importing the Electron-era src/main/utils/mime.
import { homedir } from "node:os";
import { join } from "node:path";
import { promises as fsp } from "node:fs";
import type { HandleRegistrar } from "../../core/dispatch";
import { revealInFileManager } from "./opener";

// Mirrors src/core/handlers/{attachments,knowledge}.ts — text file detection for the knowledge base.
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".js", ".ts", ".py", ".json", ".csv", ".yaml", ".yml",
]);

const KNOWLEDGES_DIR = join(homedir(), ".agent-desktop", "knowledges");

export async function ensureKnowledgesDir(): Promise<void> {
  await fsp.mkdir(KNOWLEDGES_DIR, { recursive: true });
}

export function getKnowledgesDir(): string {
  return KNOWLEDGES_DIR;
}

export function getSupportedExtensions(): Set<string> {
  return TEXT_EXTENSIONS;
}

export function registerHandlers(dispatch: HandleRegistrar, _db: unknown): void {
  dispatch.handle("kb:openKnowledgesFolder", async () => {
    await ensureKnowledgesDir();
    revealInFileManager(KNOWLEDGES_DIR);
  });
}
