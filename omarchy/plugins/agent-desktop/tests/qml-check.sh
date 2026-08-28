#!/usr/bin/env bash
# qmllint over every plugin .qml, made actually load-bearing.
#
# Three things the naive `qmllint -I /usr/share/omarchy/shell *.qml` invocation
# gets wrong, each of which quietly turns the check into a no-op:
#
#  1. `import qs.Commons` resolves against an import root that CONTAINS a `qs`
#     directory. The shell ships `Commons/` and `Ui/` at its own root and
#     Quickshell maps that root as the `qs` namespace at runtime, so pointing -I
#     at the shell root makes every qs import fail — and a file whose singletons
#     all failed to import cannot have a bad binding detected in it. A symlink
#     `<tmp>/qs -> /usr/share/omarchy/shell` is what makes the check see the real
#     Style and Color.
#
#  2. qmllint emits a large, uniform class of warnings that are limitations
#     rather than findings. Left unfiltered they bury the real ones and the check
#     gets ignored.
#
#  3. A qmllint warning is a BLOCK: a `Warning: file:line:col: message [category]`
#     header followed by the offending source line and a caret line. Filtering
#     line-by-line with `grep -v` deletes the header of a suppressed warning but
#     leaves its two context lines behind — and then a final `grep '^Warning:'`
#     finds nothing and declares success. That bug hid a real
#     `Expected token ':'` syntax error in AuthBanner.qml that the QML engine
#     then refused to load at runtime. So suppression happens per BLOCK, keyed on
#     the header's `[category]` plus an optional message pattern, and anything
#     that survives fails the build.
#
# What survives is the class this check exists for: a binding to a Style/Color
# token that does not exist, an unqualified access in a delegate, and — the one
# that matters most — a syntax error, which qmllint reports as a mere Warning
# and which no other gate in this plugin can see (a component importing
# Quickshell cannot be instantiated by qmltestrunner).
set -uo pipefail

cd "$(dirname "$0")/.."

QMLLINT="${QMLLINT:-/usr/lib/qt6/bin/qmllint}"
SHELL_DIR="${OMARCHY_SHELL_DIR:-/usr/share/omarchy/shell}"

[[ -x "$QMLLINT" ]] || { echo "qmllint not found at $QMLLINT" >&2; exit 1; }
[[ -d "$SHELL_DIR/Commons" ]] || { echo "no Omarchy shell at $SHELL_DIR" >&2; exit 1; }

import_root="$(mktemp -d)"
trap 'rm -rf "$import_root"' EXIT
ln -s "$SHELL_DIR" "$import_root/qs"

mapfile -t files < <(find . -name '*.qml' -not -path './tests/*' | sed 's|^\./||' | sort)
[[ ${#files[@]} -gt 0 ]] || { echo "no .qml files found" >&2; exit 1; }

raw="$("$QMLLINT" -I "$import_root" "${files[@]}" 2>&1)"

# Suppressions, applied to the whole warning BLOCK. Each is a limitation of
# qmllint or of the plugin-host contract, never a finding about this code.
#
#   missing-property + 'on type "QObject"'
#       Style.spacing / Style.font / Style.bar are
#       `readonly property QtObject x: QtObject {…}`; qmllint cannot introspect
#       an inline QtObject, so it reports every nested token as missing —
#       including ones that demonstrably exist. Note this is scoped to
#       "QObject": a missing token on type "Style" (a real top-level typo such
#       as Style.gapsIn) is NOT suppressed.
#   signal-handler-parameters + QProcess::ExitStatus
#       Quickshell's Process.exited carries a Qt enum qmllint has no metatype for.
#   uncreatable-type
#       PanelWindow / FloatingWindow are created by Quickshell's own engine.
#   inheritance-cycle / unresolved-type on BarWidget
#       BarWidget.qml is the plugin's bar widget AND derives from qs.Ui's
#       BarWidget; the local file name shadows the imported type. The shell
#       resolves this correctly at runtime.
#   (There is deliberately NO suppression for `anchors`. An earlier version
#   suppressed `unknown grouped property scope anchors` on the theory that it
#   only followed from an unresolved Quickshell base type. It does not: it is
#   also exactly what qmllint says when `anchors` is assigned on a type that has
#   none — a `qs.Ui` `PopupCard` is a Quickshell `PopupWindow`, not an Item — and
#   the suppression hid four such assignments in StatusLine.qml until the shell
#   refused to load the file with `Cannot assign to non-existent property
#   "anchors"`. Any `anchors` warning is now a finding.)
#   import + '$InProcess$'
#       A Quickshell-internal type qmllint cannot see.
suppressed() {
  local header="$1"
  case "$header" in
    *'not found on type "QObject"'*) return 0 ;;
    *'QProcess::ExitStatus'*) return 0 ;;
    *'is not creatable'*) return 0 ;;
    *'inheritance cycle: BarWidget'*) return 0 ;;
    *'Type BarWidget is used but it is not resolved'*) return 0 ;;
    *'$InProcess$'*) return 0 ;;
  esac
  return 1
}

surviving=""
count=0
keep=0
while IFS= read -r line; do
  case "$line" in
    Warning:*|Error:*|Info:*)
      if [[ "$line" == Info:* ]]; then keep=0; continue; fi
      if suppressed "$line"; then keep=0; continue; fi
      keep=1
      count=$((count + 1))
      surviving+="$line"$'\n'
      ;;
    *)
      # A context line belongs to whichever header preceded it.
      [[ $keep -eq 1 ]] && surviving+="$line"$'\n'
      ;;
  esac
done <<< "$raw"

if [[ $count -gt 0 ]]; then
  echo "qml-check: $count actionable warning(s):" >&2
  printf '%s' "$surviving" >&2
  exit 1
fi

echo "qml-check: ${#files[@]} files clean"
