const assert = require('assert')
const fs = require('fs')
const path = require('path')

// No plugin QML file may import `Qt.labs.platform`.
//
// Its `FileDialog` / `FolderDialog` SEGFAULT the whole Quickshell process —
// the user's bar, their panels and every other plugin go down with this
// window. With `QT_QPA_PLATFORMTHEME=gtk3` the "native" dialog is
// `libqgtk3.so`, which pulls gvfs file monitoring into Quickshell's glib main
// loop and corrupts the heap. Measured (crash report i1gw228gkt, SIGSEGV):
//
//   #20 libgtk-3.so.0 (platformthemes)
//   #19 g_file_monitor          <- gvfs, over D-Bus
//   #15 g_dbus_proxy_call_sync
//   #10 g_variant_unref         <- refcount corruption
//    #2 calloc (jemalloc)
//
// SIX call sites shipped it — attach, conversation cwd, import, export,
// notebook open, scad open and export-STL — and each was a button that killed
// the desktop. Nothing offscreen can catch this: the module loads fine under
// qmltestrunner, and the crash needs a real compositor and a real dialog.
// So the gate is the import itself.
//
// `components/FilePicker.qml` is the replacement; it runs the picker out of
// process, which is how the Electron front stayed safe.

const ROOT = path.join(__dirname, '..')
const BANNED = /^\s*import\s+Qt\.labs\.platform\b/m

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'tests') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.qml')) out.push(p)
  }
  return out
}

const offenders = []
const files = walk(ROOT)
for (const f of files) {
  if (BANNED.test(fs.readFileSync(f, 'utf8'))) {
    offenders.push(path.relative(ROOT, f))
  }
}

assert.ok(files.length > 40, `expected the QML tree, found ${files.length} files`)
assert.deepStrictEqual(offenders, [],
  'these files import Qt.labs.platform, whose dialogs segfault the shell — ' +
  'use components/FilePicker.qml:\n  ' + offenders.join('\n  '))

console.log(`test_no_platform_dialogs: ok (${files.length} QML files, none import Qt.labs.platform)`)
