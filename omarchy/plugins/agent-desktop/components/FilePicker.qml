pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io

// File picker that runs OUT OF PROCESS.
//
// This exists because `Qt.labs.platform`'s FileDialog / FolderDialog SEGFAULT
// the whole Quickshell process — taking the user's bar, their panels and every
// other plugin down with it, not just this window. The crash is not in QML:
// with `QT_QPA_PLATFORMTHEME=gtk3` the "native" dialog is `libqgtk3.so`, which
// pulls gvfs file monitoring into Quickshell's glib main loop and corrupts the
// heap. Measured backtrace (quickshell crash report i1gw228gkt, SIGSEGV):
//
//   #20 libgtk-3.so.0 (platformthemes)
//   #19 g_file_monitor          <- gvfs, over D-Bus
//   #15 g_dbus_proxy_call_sync
//   #10 g_variant_unref         <- refcount corruption
//    #2 calloc (jemalloc)
//
// Four call sites shipped that dialog: attach, the conversation cwd picker,
// import and export. Every one of them was a button that killed the desktop
// shell.
//
// A separate process cannot corrupt this one's heap, which is exactly how the
// Electron front stayed safe — its dialogs are the OS portal, out of process.
// `zenity` is the picker here; it is GTK too, and that is fine, because its
// heap is its own.
Item {
  id: root

  // "open" one file | "files" several | "save" a target path | "folder"
  property string mode: "open"
  property string title: "Choose a file"
  // Seed directory or filename. A trailing slash means "start here".
  property string startPath: ""
  // zenity --file-filter values, e.g. "Conversations | *.json". Empty = all.
  property var filters: []

  // Emitted once per accepted pick. `paths` is always an array, even for the
  // single-selection modes, so callers have one shape to handle.
  signal picked(var paths)
  // Cancel is a normal outcome, not an error: zenity exits 1. Surfaced so a
  // caller can undo any optimistic UI it put up.
  signal cancelled()
  // zenity missing, or any non-cancel failure.
  signal failed(string reason)

  readonly property bool running: picker.running

  function open() {
    if (picker.running) return
    var args = ["zenity", "--file-selection", "--title=" + root.title]
    if (root.mode === "files") args.push("--multiple", "--separator=\n")
    else if (root.mode === "save") args.push("--save", "--confirm-overwrite")
    else if (root.mode === "folder") args.push("--directory")
    if (root.startPath.length > 0) args.push("--filename=" + root.startPath)
    for (var i = 0; i < root.filters.length; i++) {
      args.push("--file-filter=" + root.filters[i])
    }
    picker.command = args
    picker.running = true
  }

  Process {
    id: picker
    // Collected rather than parsed line by line: `--multiple` returns every
    // path on ONE line unless --separator is given, and a path may legally
    // contain almost anything except NUL and newline.
    stdout: StdioCollector { id: out }
    stderr: StdioCollector { id: err }

    onExited: function (code, status) {
      // 1 is the documented "user cancelled" exit. Anything else with no
      // output is a real failure — most likely zenity is not installed, which
      // `onExited` reports as 127 and Quickshell may also surface as a failed
      // start.
      var text = String(out.text || "").trim()
      if (code === 0 && text.length > 0) {
        root.picked(text.split("\n").filter(function (p) { return p.length > 0 }))
        return
      }
      if (code === 1) {
        root.cancelled()
        return
      }
      var why = String(err.text || "").trim()
      root.failed(why.length > 0
        ? why
        : "file picker exited with code " + code
          + " (is zenity installed?)")
    }
  }
}
