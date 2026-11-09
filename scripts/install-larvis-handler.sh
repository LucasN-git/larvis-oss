#!/usr/bin/env bash
# One-time setup so the Larvis web app's "In Claude Code öffnen" links work.
# Registers the larvis:// URL scheme on this Linux machine, pointing at
# scripts/larvis-open (terminal + `claude` at the project folder).
#
# Run once:  bash scripts/install-larvis-handler.sh
# Safe to re-run. Undo with: scripts/install-larvis-handler.sh --uninstall
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HANDLER="$SCRIPT_DIR/larvis-open"
APPS_DIR="$HOME/.local/share/applications"
DESKTOP="$APPS_DIR/larvis-open.desktop"

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$DESKTOP"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" 2>/dev/null || true
  echo "Removed $DESKTOP"
  exit 0
fi

if [ ! -f "$HANDLER" ]; then
  echo "Handler not found at $HANDLER" >&2
  exit 1
fi
chmod +x "$HANDLER"

mkdir -p "$APPS_DIR"
cat >"$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=Larvis Open
Comment=Open a Larvis project folder in Claude Code
Exec=$HANDLER %u
Terminal=false
NoDisplay=true
MimeType=x-scheme-handler/larvis;
EOF

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" 2>/dev/null || true
xdg-mime default larvis-open.desktop x-scheme-handler/larvis

echo "Registered larvis:// -> $HANDLER"
echo "Test it:  xdg-open 'larvis://open?path=$(printf '%s' "$HOME" | sed 's/ /%20/g')'"
