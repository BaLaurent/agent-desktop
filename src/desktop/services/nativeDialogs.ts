// Native file dialogs — replaces Electron's dialog.showOpenDialog / showSaveDialog. Process-modal
// OS helpers: zenity (fallback kdialog) on Linux, osascript on macOS, PowerShell on Windows.
// Returns the chosen path, or null on cancel / missing helper.
type DialogOutcome =
  | { kind: "path"; path: string }
  | { kind: "cancel" } // user dismissed (non-zero exit) — terminal, do NOT fall back
  | { kind: "missing" }; // helper not installed (spawn threw) — try the fallback helper

async function run(cmd: string, args: string[]): Promise<DialogOutcome> {
  try {
    const output = await new Deno.Command(cmd, { args, stdout: "piped", stderr: "null" }).output();
    if (!output.success) return { kind: "cancel" };
    const out = new TextDecoder().decode(output.stdout).trim();
    return out.length > 0 ? { kind: "path", path: out } : { kind: "cancel" };
  } catch {
    return { kind: "missing" };
  }
}

// Cancel is terminal; only a missing primary helper falls through to the fallback.
async function resolve(primary: () => Promise<DialogOutcome>, fallback?: () => Promise<DialogOutcome>): Promise<string | null> {
  const first = await primary();
  if (first.kind === "path") return first.path;
  if (first.kind === "cancel" || !fallback) return null;
  const second = await fallback();
  return second.kind === "path" ? second.path : null;
}

export function selectFolder(): Promise<string | null> {
  const home = Deno.env.get("HOME") ?? ".";
  switch (Deno.build.os) {
    case "darwin":
      return resolve(() => run("osascript", ["-e", 'POSIX path of (choose folder with prompt "Select working directory")']));
    case "windows":
      return resolve(() => run("powershell", ["-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; if($d.ShowDialog() -eq 'OK'){[Console]::Out.Write($d.SelectedPath)}"]));
    default:
      return resolve(
        () => run("zenity", ["--file-selection", "--directory", "--title=Select working directory"]),
        () => run("kdialog", ["--getexistingdirectory", home]),
      );
  }
}

export function selectFile(): Promise<string | null> {
  const home = Deno.env.get("HOME") ?? ".";
  switch (Deno.build.os) {
    case "darwin":
      return resolve(() => run("osascript", ["-e", 'POSIX path of (choose file with prompt "Select file")']));
    case "windows":
      return resolve(() => run("powershell", ["-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; if($d.ShowDialog() -eq 'OK'){[Console]::Out.Write($d.FileName)}"]));
    default:
      return resolve(
        () => run("zenity", ["--file-selection", "--title=Select file"]),
        () => run("kdialog", ["--getopenfilename", home]),
      );
  }
}

export function saveFile(defaultName: string): Promise<string | null> {
  const home = Deno.env.get("HOME") ?? ".";
  const safe = defaultName.replace(/["'`$]/g, "");
  switch (Deno.build.os) {
    case "darwin":
      return resolve(() => run("osascript", ["-e", `POSIX path of (choose file name with prompt "Save as" default name "${safe}")`]));
    case "windows":
      return resolve(() => run("powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.SaveFileDialog; $d.FileName='${safe}'; if($d.ShowDialog() -eq 'OK'){[Console]::Out.Write($d.FileName)}`]));
    default:
      return resolve(
        () => run("zenity", ["--file-selection", "--save", "--confirm-overwrite", `--filename=${home}/${safe}`, "--title=Save as"]),
        () => run("kdialog", ["--getsavefilename", `${home}/${safe}`]),
      );
  }
}
