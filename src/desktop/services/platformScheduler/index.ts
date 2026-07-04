// Ported from src/main/services/platformScheduler/index.ts. Electron-free — relocated
// unchanged (the OS-timer implementations use only node: builtins + process.platform).
import type { PlatformScheduler } from "../../../core/ports/platformScheduler";
import { noopPlatformScheduler } from "../../../core/ports/platformScheduler";
import { LinuxCrontabScheduler } from "./linux";
import { MacOSLaunchdScheduler } from "./macos";
import { WindowsTaskScheduler } from "./windows";

export function createPlatformScheduler(): PlatformScheduler {
  switch (process.platform) {
    case "linux":
      return new LinuxCrontabScheduler();
    case "darwin":
      return new MacOSLaunchdScheduler();
    case "win32":
      return new WindowsTaskScheduler();
    default:
      return noopPlatformScheduler;
  }
}

export type { PlatformScheduler } from "../../../core/ports/platformScheduler";
export { noopPlatformScheduler } from "../../../core/ports/platformScheduler";
