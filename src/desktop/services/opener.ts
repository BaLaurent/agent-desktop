// OS "open with default app" helpers — replaces Electron's shell.openExternal / shell.openPath /
// shell.showItemInFolder. Shared by system.ts, files.ts, and deeplink handling.
// Linux: xdg-open, macOS: open, Windows: cmd /c start. Fire-and-forget; errors are swallowed
// (a missing helper must not crash a handler).
function spawnDetached(cmd: string, args: string[]): void {
  try {
    new Deno.Command(cmd, { args, stdin: "null", stdout: "null", stderr: "null" }).spawn().unref();
  } catch {
    // helper not installed — nothing we can do
  }
}

function openWith(target: string): void {
  switch (Deno.build.os) {
    case "darwin":
      spawnDetached("open", [target]);
      break;
    case "windows":
      spawnDetached("cmd", ["/c", "start", "", target]);
      break;
    default:
      spawnDetached("xdg-open", [target]);
  }
}

/** Open an http(s) URL (or any URI) in the user's default handler. */
export function openExternal(url: string): void {
  openWith(url);
}

/** Open a file/dir with its default application. */
export function openPath(path: string): void {
  openWith(path);
}

/** Reveal a path in the file manager. No native "select the file" on Linux/Windows via the
 *  generic opener, so we open the containing directory (accepted degradation: no highlight). */
export function revealInFileManager(path: string): void {
  if (Deno.build.os === "darwin") {
    spawnDetached("open", ["-R", path]);
    return;
  }
  // Open the parent directory.
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = idx > 0 ? path.slice(0, idx) : path;
  openWith(dir);
}
