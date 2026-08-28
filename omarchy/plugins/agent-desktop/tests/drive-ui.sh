#!/usr/bin/env bash
# Drive the live Agent Desktop window with real pointer/keyboard input.
#
# The offscreen suites cannot reach this plugin's UI at all: the real
# qs.Commons/qs.Ui singletons import Quickshell, which is statically linked
# into the `quickshell` binary, so every QML test runs against generated stubs.
# Anything that only breaks in the real shell — a fatal duplicate property, a
# swallowed click, a pane clipped by a double margin — is invisible to them.
# This is the tool that closes that gap, and it encodes three traps that each
# produced a confident wrong conclusion:
#
#   1. ydotool's absolute mousemove is NOT in screen pixels. Its virtual
#      absolute device is declared 960x540, so Hyprland scales every value by
#      2 on a 1920x1080 scale=1 output. Passing screen pixels clamps at the
#      right/bottom edge and clicks the wrong place — indistinguishable from
#      "the button does nothing". `click` halves and then VERIFIES with
#      hyprctl cursorpos before pressing.
#
#   2. grim captures the VISIBLE output. The window is a FloatingWindow on
#      whatever workspace was active when it opened; screenshotting its
#      rectangle while another workspace is shown silently captures whatever
#      app sits at those coordinates. `focus` makes the workspace visible
#      first and refuses if focus did not land.
#
#   3. Hardcoded window-relative offsets rot. This window went from 936x1020
#      to 1890x1020 mid-session when Hyprland tiled it, and the stale mic
#      offset landed on a conversation row and started an inline RENAME.
#      `target` resolves every control from the CURRENT window size.
#
# Hyprland 0.56 dispatchers take a Lua TABLE, not positional arguments:
#   hl.dsp.focus({ workspace = "4" })   not   dispatch workspace 4
#
# Usage:
#   drive-ui.sh geom                    print "X,Y WxH" (grim -g format)
#   drive-ui.sh focus                   raise the window, print its geom
#   drive-ui.sh click <sx> <sy>         click at absolute screen coordinates
#   drive-ui.sh target <name>           click a named control
#   drive-ui.sh at <wx> <wy>            click at window-relative coordinates
#   drive-ui.sh shot <file>             screenshot the window
#   drive-ui.sh type <text>             type into the focused control
#   drive-ui.sh key <keyname>           press a key (Return, Escape, ...)
#
# Named targets, measured on the real window:
#   mic send attach compose sidebar
set -euo pipefail

need() { command -v "$1" >/dev/null 2>&1 || { echo "drive-ui: missing $1" >&2; exit 127; }; }

# Every caller reads this through `read -r ... <<<"$(win_info)"`, and a command
# substitution's exit status is DISCARDED there — so a missing window used to
# leave the fields empty and the script carried on to compute a click at
# (-87,-16). Signal the whole script instead; `set -e` cannot see it.
win_info() {
  local out
  out="$(hyprctl clients -j | node -e '
let d="";process.stdin.on("data",c=>c&&(d+=c)).on("end",()=>{
  const c=JSON.parse(d).find(x=>(x.title||"").startsWith("Agent Desktop"));
  if(!c){process.exit(3)}
  console.log([c.address,c.workspace.id,c.at[0],c.at[1],c.size[0],c.size[1]].join(" "))})')" || {
    echo "drive-ui: no Agent Desktop window — open one with" >&2
    echo "          omarchy-shell agent-desktop window" >&2
    kill -TERM $$
  }
  echo "$out"
}

cmd_geom() {
  read -r _ _ X Y W H <<<"$(win_info)"
  echo "$X,$Y ${W}x${H}"
}

cmd_focus() {
  read -r ADDR WS X Y W H <<<"$(win_info)"
  hyprctl dispatch "hl.dsp.focus({ workspace = \"$WS\" })" >/dev/null
  sleep 0.4
  hyprctl dispatch "hl.dsp.focus({ window = \"address:$ADDR\" })" >/dev/null
  sleep 0.6
  local active
  active="$(hyprctl activewindow -j | node -e '
let d="";process.stdin.on("data",c=>c&&(d+=c)).on("end",()=>{
  try{console.log(JSON.parse(d).title||"")}catch(e){console.log("")}})')"
  case "$active" in
    "Agent Desktop"*) ;;
    *) echo "drive-ui: focus is on '$active', not Agent Desktop" >&2; exit 1 ;;
  esac
  echo "$X,$Y ${W}x${H}"
}

cmd_click() {
  need ydotool
  local x="$1" y="$2" btn="${3:-0xC0}"
  ydotool mousemove -a -x "$((x / 2))" -y "$((y / 2))"
  sleep 0.35
  local pos gx gy dx dy
  pos="$(hyprctl cursorpos)"
  gx="${pos%,*}"; gy="${pos#*, }"
  dx=$(( gx > x ? gx - x : x - gx ))
  dy=$(( gy > y ? gy - y : y - gy ))
  if [ "$dx" -gt 2 ] || [ "$dy" -gt 2 ]; then
    echo "drive-ui: cursor landed at $pos, wanted $x,$y — refusing to click" >&2
    exit 1
  fi
  ydotool click "$btn" >/dev/null
  sleep 0.5
}

cmd_at() {
  read -r _ _ X Y _ _ <<<"$(win_info)"
  cmd_click "$((X + $1))" "$((Y + $2))" "${3:-0xC0}"
}

cmd_target() {
  read -r _ _ X Y W H <<<"$(win_info)"
  local rx ry
  case "$1" in
    mic)     rx=$((W-87));  ry=$((H-16)) ;;
    send)    rx=$((W-40));  ry=$((H-16)) ;;
    attach)  rx=$((W-129)); ry=$((H-16)) ;;
    compose) rx=200;        ry=$((H-54)) ;;
    sidebar) rx=57;         ry=24        ;;
    *) echo "drive-ui: unknown target '$1'" >&2; exit 2 ;;
  esac
  echo "drive-ui: $1 -> window($rx,$ry) of ${W}x${H}" >&2
  cmd_click "$((X + rx))" "$((Y + ry))"
}

# Press-and-hold. The mic button is NOT a toggle: MicButton.qml starts the
# capture in `onPressed` and stops it in `onReleased`. A `click` is a press and
# a release milliseconds apart, so it started and ended a capture with no audio
# in between, and the empty composer looked exactly like a broken transcription
# chain. ydotool encodes the two halves separately: 0x40 down, 0x80 up.
cmd_hold() {
  read -r _ _ X Y W H <<<"$(win_info)"
  local name="$1" secs="${2:-3}" rx ry
  case "$name" in
    mic)     rx=$((W-87));  ry=$((H-16)) ;;
    send)    rx=$((W-40));  ry=$((H-16)) ;;
    attach)  rx=$((W-129)); ry=$((H-16)) ;;
    *) echo "drive-ui: cannot hold '$name'" >&2; exit 2 ;;
  esac
  local sx=$((X + rx)) sy=$((Y + ry))
  need ydotool
  ydotool mousemove -a -x "$((sx / 2))" -y "$((sy / 2))"
  sleep 0.35
  # Same +/-2 tolerance as cmd_click: the halving is integer division, so an
  # odd target coordinate always lands one pixel off and a strict comparison
  # rejects every legitimate press.
  local pos gx gy dx dy
  pos="$(hyprctl cursorpos)"
  gx="${pos%,*}"; gy="${pos#*, }"
  dx=$(( gx > sx ? gx - sx : sx - gx ))
  dy=$(( gy > sy ? gy - sy : sy - gy ))
  if [ "$dx" -gt 2 ] || [ "$dy" -gt 2 ]; then
    echo "drive-ui: cursor landed at $pos, wanted $sx,$sy — refusing to hold" >&2
    exit 1
  fi
  echo "drive-ui: holding $name at ($rx,$ry) for ${secs}s" >&2
  ydotool click 0x40 >/dev/null
  sleep "$secs"
  ydotool click 0x80 >/dev/null
  sleep 0.4
}

cmd_shot() {
  need grim
  grim -g "$(cmd_geom)" "$1"
  echo "$1"
}

case "${1:?usage: drive-ui.sh <geom|focus|click|at|target|hold|shot|type|key> ...}" in
  geom)   cmd_geom ;;
  focus)  cmd_focus ;;
  click)  shift; cmd_click "$@" ;;
  at)     shift; cmd_at "$@" ;;
  target) shift; cmd_target "$@" ;;
  hold)   shift; cmd_hold "$@" ;;
  shot)   shift; cmd_shot "$@" ;;
  type)   need wtype; shift; wtype "$*" ;;
  key)    need wtype; shift; wtype -k "$1" ;;
  *) echo "drive-ui: unknown command '$1'" >&2; exit 2 ;;
esac
