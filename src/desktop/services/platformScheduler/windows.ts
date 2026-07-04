/**
 * Windows Task Scheduler implementation of PlatformScheduler.
 * Uses schtasks.exe to create/remove a recurring task.
 *
 * Ported from src/main/services/platformScheduler/windows.ts — Electron-free; only the
 * node builtin specifiers gained the `node:` prefix.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { PlatformScheduler } from "../../../core/ports/platformScheduler";
import { createLogger } from "../../../core/utils/logger";

const log = createLogger("platformScheduler.windows");

const execAsync = promisify(exec);

const TASK_NAME = "AgentDesktopScheduler";

export class WindowsTaskScheduler implements PlatformScheduler {
  async install(nodePath: string, scriptPath: string): Promise<void> {
    await this.uninstall();

    const command = `"${nodePath}" "${scriptPath}" --tick`;
    await execAsync(
      `schtasks /create /tn "${TASK_NAME}" /tr ${JSON.stringify(command)} /sc minute /mo 1 /f`,
    );
    log.info("installed Windows scheduled task");
  }

  async uninstall(): Promise<void> {
    try {
      await execAsync(`schtasks /delete /tn "${TASK_NAME}" /f`);
    } catch { /* task doesn't exist */ }
    log.info("removed Windows scheduled task");
  }

  async isInstalled(): Promise<boolean> {
    try {
      await execAsync(`schtasks /query /tn "${TASK_NAME}"`);
      return true;
    } catch {
      return false;
    }
  }
}
