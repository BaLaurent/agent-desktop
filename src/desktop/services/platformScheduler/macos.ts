/**
 * macOS launchd implementation of PlatformScheduler.
 * Creates/removes a LaunchAgent plist that fires every 60 seconds.
 *
 * Ported from src/main/services/platformScheduler/macos.ts — Electron-free; only the
 * node builtin specifiers gained the `node:` prefix.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "node:os";
import { promises as fsp } from "node:fs";
import type { PlatformScheduler } from "../../../core/ports/platformScheduler";
import { createLogger } from "../../../core/utils/logger";

const log = createLogger("platformScheduler.macos");

const execAsync = promisify(exec);

const LABEL = "com.agent-desktop.scheduler";
const PLIST_DIR = join(homedir(), "Library", "LaunchAgents");
const PLIST_PATH = join(PLIST_DIR, `${LABEL}.plist`);
const LOG_PATH = join(homedir(), ".config", "agent-desktop", "scheduler-launchd.log");

export class MacOSLaunchdScheduler implements PlatformScheduler {
  async install(nodePath: string, scriptPath: string): Promise<void> {
    await this.uninstall();

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
    <string>--tick</string>
  </array>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_PATH}</string>
</dict>
</plist>`;

    await fsp.mkdir(PLIST_DIR, { recursive: true });
    await fsp.writeFile(PLIST_PATH, plist, "utf-8");
    await execAsync(`launchctl load ${PLIST_PATH}`);
    log.info("installed launchd agent");
  }

  async uninstall(): Promise<void> {
    try {
      await execAsync(`launchctl unload ${PLIST_PATH}`);
    } catch { /* not loaded */ }
    try {
      await fsp.unlink(PLIST_PATH);
    } catch { /* doesn't exist */ }
    log.info("removed launchd agent");
  }

  async isInstalled(): Promise<boolean> {
    try {
      await fsp.access(PLIST_PATH);
      return true;
    } catch {
      return false;
    }
  }
}
