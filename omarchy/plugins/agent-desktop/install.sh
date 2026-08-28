#!/usr/bin/env bash
# Idempotent installer for the Agent Desktop Omarchy plugin.
#
# 1. symlinks <repo>/omarchy/plugins/agent-desktop into ~/.config/omarchy/plugins
# 2. renders the systemd user unit, enables it, starts it
# 3. trusts the self-signed cert for Chromium-family browsers
# 4. validates the plugin, rescans the shell, enables the bar widget
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: install.sh [--no-restart]
EOF
}

restart_shell=true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-restart) restart_shell=false; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

# Resolve repo root from this script's location so the installer works no
# matter where it is invoked from.
repo="$(cd "$(dirname "$(readlink -f "$0")")/../../.." && pwd)"
plugin_dir="$repo/omarchy/plugins/agent-desktop"

config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
plugin_home="$config_home/omarchy/plugins"
install_path="$plugin_home/agent-desktop"

systemd_user_home="$config_home/systemd/user"
service_template="$plugin_dir/../../systemd/agent-desktop-headless.service.in"
service_rendered="$systemd_user_home/agent-desktop-headless.service"

# Pre-flight
command -v omarchy >/dev/null 2>&1 || { echo 'omarchy is required' >&2; exit 1; }
command -v systemctl >/dev/null 2>&1 || { echo 'systemctl is required' >&2; exit 1; }
command -v certutil >/dev/null 2>&1 || { echo 'certutil is required' >&2; exit 1; }

# 1. Symlink the plugin into the user plugins dir.
mkdir -p "$plugin_home"
ln -sfn "$plugin_dir" "$install_path"
echo "Linked $install_path -> $plugin_dir"

# 2. Render and enable the systemd user unit.
mkdir -p "$systemd_user_home"
sed "s|@REPO@|$repo|g" "$service_template" > "$service_rendered"
echo "Rendered $service_rendered"

systemctl --user daemon-reload
systemctl --user enable --now agent-desktop-headless.service
echo "Enabled and started agent-desktop-headless.service"

# 3. Trust the server's self-signed cert for Chromium-family browsers.
# The server writes $HOME/.config/agent-desktop/ssl/cert.pem on first
# start; that may not have happened yet, so wait briefly.
for _ in $(seq 1 20); do
  if [[ -f "$config_home/agent-desktop/ssl/cert.pem" ]]; then break; fi
  sleep 0.5
done

if [[ -f "$config_home/agent-desktop/ssl/cert.pem" ]]; then
  certutil -d "sql:$HOME/.pki/nssdb" -D -n agent-desktop-localhost 2>/dev/null || true
  certutil -d "sql:$HOME/.pki/nssdb" -A -t "P,," \
    -n agent-desktop-localhost \
    -i "$config_home/agent-desktop/ssl/cert.pem" \
    && echo "Imported agent-desktop-localhost cert into NSS DB"
else
  echo "Note: cert.pem not yet written by the server; trust it after first start:"
  echo "  certutil -d sql:\$HOME/.pki/nssdb -A -t 'P,,' -n agent-desktop-localhost -i $config_home/agent-desktop/ssl/cert.pem"
fi

# 4. Build the plugin's generated artifacts.
#
# bridge/bridge.built.mjs is what Service.qml actually spawns: the source
# imports `ws`, so it only runs with the repo's node_modules present, and the
# plugin is symlinked into ~/.config where that is not true. generated/
# settingDefs.js is emitted from src/core/types/constants.ts so the QML settings
# page is driven by the same data the React one is. Both are gitignored outputs.
echo "Building plugin artifacts…"
( cd "$repo" && npm run build:omarchy-bridge && npm run build:omarchy-consts )

# 5. Validate, rescan, enable.
echo "Validating plugin…"
omarchy plugin validate "$plugin_dir"

echo "Rescanning plugins…"
omarchy-shell shell rescanPlugins

echo "Enabling bar widget…"
omarchy plugin enable agent-desktop --section right || true

if $restart_shell; then
  echo "Restarting shell…"
  omarchy restart shell
fi

cat <<'EOF'

Done.

Now add the following to ~/.config/hypr/bindings.lua (or run omarchy-menu
and bind them there), then `hyprctl reload`:

  ------------------------------------------------------------------------
  -- Agent Desktop (Omarchy plugin, headless server -- no Electron)
  ------------------------------------------------------------------------
  --
  -- The Electron app registered these itself through `hyprctl keyword bind`,
  -- which Hyprland 0.56 accepts with `ok` and then ignores. Declaring them
  -- here and routing to the plugin's IpcHandler is the channel that works.
  o.bind("ALT + SPACE", "Agent Desktop: quick chat",
    "omarchy-shell shell toggle agent-desktop '{\"mode\":\"quick\"}'")
  o.bind("ALT + SHIFT + SPACE", "Agent Desktop: voice",
    "omarchy-shell agent-desktop voice")
  o.bind("SUPER + A", "Agent Desktop: app window",
    "omarchy-shell shell toggle agent-desktop '{\"mode\":\"window\"}'")
EOF