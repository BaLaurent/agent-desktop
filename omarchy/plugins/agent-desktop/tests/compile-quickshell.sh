#!/usr/bin/env bash
# Compile the plugin files that `tst_component_load.qml` cannot reach.
#
# Those files import Quickshell, which is statically linked into the
# `quickshell` binary, so qmltestrunner can never load them. App.qml is among
# them — the panel entry point, and so the whole front end — and it shipped a
# duplicated root `Component.onCompleted`: "Property value set multiple times",
# fatal, front end dead, every offscreen gate green. This closes that hole.
#
# Mechanism: Quickshell maps its CONFIG DIRECTORY onto the `qs` import
# namespace, which is how `qs.Commons` / `qs.Ui` resolve in the running shell.
# So the probe runs from a scratch root whose Commons/Ui are symlinks to the
# real shell modules — the same singletons production uses, not the test stubs.
set -uo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHELL_DIR="${OMARCHY_SHELL_DIR:-/usr/share/omarchy/shell}"

if ! command -v quickshell >/dev/null 2>&1; then
  echo "compile-quickshell: quickshell not installed — skipping" >&2
  exit 0
fi
if [ ! -d "$SHELL_DIR/Ui" ]; then
  echo "compile-quickshell: no shell modules at $SHELL_DIR — skipping" >&2
  exit 0
fi
# Needs a compositor: Quickshell is a Wayland client and cannot start without
# one. Skipping keeps `make test` usable over SSH instead of hanging.
if [ -z "${WAYLAND_DISPLAY:-}" ]; then
  echo "compile-quickshell: no WAYLAND_DISPLAY — skipping" >&2
  exit 0
fi

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
ln -s "$SHELL_DIR/Commons" "$ROOT/Commons"
ln -s "$SHELL_DIR/Ui" "$ROOT/Ui"
cp "$PLUGIN_DIR/tests/qml/compile_probe.qml" "$ROOT/shell.qml"

OUT="$(AGENT_DESKTOP_DIR="$PLUGIN_DIR" timeout 60 quickshell -p "$ROOT/shell.qml" 2>&1 \
  | sed 's/^ *[A-Z]* qml: //' | grep -E '^COMPILE_')"

echo "$OUT"
if echo "$OUT" | grep -q '^COMPILE_FAIL'; then
  echo "compile-quickshell: FAILED" >&2
  exit 1
fi
if ! echo "$OUT" | grep -q '^COMPILE_DONE'; then
  echo "compile-quickshell: probe produced no verdict — treating as failure" >&2
  exit 1
fi
echo "compile-quickshell: all Quickshell-importing files compile"
