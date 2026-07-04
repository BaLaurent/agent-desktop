/**
 * Linux implementation of PlatformScheduler.
 * Uses systemd user timers (available on all systemd distros).
 * Falls back to crontab if systemd is not available.
 *
 * Ported from src/main/services/platformScheduler/linux.ts — Electron-free; only the
 * node builtin specifiers gained the `node:` prefix.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "node:os";
import { promises as fsp } from "node:fs";
import type { PlatformScheduler } from "../../../core/ports/platformScheduler";
import { createLogger } from "../../../core/utils/logger";

const log = createLogger("platformScheduler.linux");

const execAsync = promisify(exec);

// ─── systemd user timer ────────────────────────────────────

const UNIT_NAME = "agent-desktop-scheduler";
const SYSTEMD_USER_DIR = join(homedir(), ".config", "systemd", "user");
const SERVICE_PATH = join(SYSTEMD_USER_DIR, `${UNIT_NAME}.service`);
const TIMER_PATH = join(SYSTEMD_USER_DIR, `${UNIT_NAME}.timer`);
const LOG_PATH = join(homedir(), ".config", "agent-desktop", "scheduler-cron.log");

class SystemdTimerScheduler implements PlatformScheduler {
  async install(nodePath: string, scriptPath: string): Promise<void> {
    await this.uninstall();

    await fsp.mkdir(SYSTEMD_USER_DIR, { recursive: true });

    const serviceUnit = `[Unit]
Description=Agent Desktop Scheduler Tick

[Service]
Type=oneshot
ExecStart=${nodePath} ${scriptPath} --tick
StandardOutput=append:${LOG_PATH}
StandardError=append:${LOG_PATH}
`;

    const timerUnit = `[Unit]
Description=Agent Desktop Scheduler Timer

[Timer]
OnBootSec=60
OnUnitActiveSec=60
AccuracySec=10

[Install]
WantedBy=timers.target
`;

    await fsp.writeFile(SERVICE_PATH, serviceUnit, "utf-8");
    await fsp.writeFile(TIMER_PATH, timerUnit, "utf-8");

    await execAsync("systemctl --user daemon-reload");
    await execAsync(`systemctl --user enable --now ${UNIT_NAME}.timer`);
    log.info("installed systemd user timer");
  }

  async uninstall(): Promise<void> {
    try {
      await execAsync(`systemctl --user disable --now ${UNIT_NAME}.timer`);
    } catch { /* not installed */ }
    try {
      await fsp.unlink(SERVICE_PATH);
    } catch { /* doesn't exist */ }
    try {
      await fsp.unlink(TIMER_PATH);
    } catch { /* doesn't exist */ }
    try {
      await execAsync("systemctl --user daemon-reload");
    } catch { /* ignore */ }
    log.info("removed systemd user timer");
  }

  async isInstalled(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`systemctl --user is-enabled ${UNIT_NAME}.timer`);
      return stdout.trim() === "enabled";
    } catch {
      return false;
    }
  }
}

// ─── crontab fallback ──────────────────────────────────────

const CRON_MARKER = "# agent-desktop-scheduler";

class CrontabScheduler implements PlatformScheduler {
  async install(nodePath: string, scriptPath: string): Promise<void> {
    await this.uninstall();

    const existing = await this.readCrontab();
    const lockPath = join(homedir(), ".config", "agent-desktop", "scheduler.lock");
    const entry = `* * * * * flock -n ${lockPath} ${nodePath} ${scriptPath} --tick >> ${LOG_PATH} 2>&1 ${CRON_MARKER}`;
    const newCrontab = existing ? `${existing}\n${entry}\n` : `${entry}\n`;

    await execAsync(`echo ${JSON.stringify(newCrontab)} | crontab -`);
    log.info("installed crontab entry");
  }

  async uninstall(): Promise<void> {
    const existing = await this.readCrontab();
    if (!existing) return;

    const filtered = existing
      .split("\n")
      .filter((line) => !line.includes(CRON_MARKER))
      .join("\n")
      .trim();

    if (filtered) {
      await execAsync(`echo ${JSON.stringify(filtered + "\n")} | crontab -`);
    } else {
      await execAsync("crontab -r").catch(() => {});
    }
    log.info("removed crontab entry");
  }

  async isInstalled(): Promise<boolean> {
    const crontab = await this.readCrontab();
    return crontab.includes(CRON_MARKER);
  }

  private async readCrontab(): Promise<string> {
    try {
      const { stdout } = await execAsync("crontab -l");
      return stdout.trim();
    } catch {
      return "";
    }
  }
}

// ─── Factory: systemd first, crontab fallback ──────────────

let cachedScheduler: PlatformScheduler | null = null;

async function hasSystemd(): Promise<boolean> {
  try {
    await execAsync("systemctl --user --version");
    return true;
  } catch {
    return false;
  }
}

async function hasCrontab(): Promise<boolean> {
  try {
    await execAsync("which crontab");
    return true;
  } catch {
    return false;
  }
}

export class LinuxCrontabScheduler implements PlatformScheduler {
  private async resolve(): Promise<PlatformScheduler> {
    if (cachedScheduler) return cachedScheduler;
    if (await hasSystemd()) {
      cachedScheduler = new SystemdTimerScheduler();
    } else if (await hasCrontab()) {
      cachedScheduler = new CrontabScheduler();
    } else {
      log.warn("neither systemd nor crontab available");
      cachedScheduler = { install: async () => {}, uninstall: async () => {}, isInstalled: async () => false };
    }
    return cachedScheduler;
  }

  async install(nodePath: string, scriptPath: string): Promise<void> {
    const impl = await this.resolve();
    await impl.install(nodePath, scriptPath);
  }

  async uninstall(): Promise<void> {
    const impl = await this.resolve();
    await impl.uninstall();
  }

  async isInstalled(): Promise<boolean> {
    const impl = await this.resolve();
    return impl.isInstalled();
  }
}
