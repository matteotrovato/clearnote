#!/bin/sh
# Installs the ClearNote server as a macOS LaunchAgent for the current user.
# Safe to re-run: it replaces any previous install.
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.clearnote.server"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

sed -e "s|__INSTALL_DIR__|$DIR|g" -e "s|__HOME__|$HOME|g" \
  "$DIR/$LABEL.plist" > "$DEST"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"

echo "Installed $DEST"
echo "Logs: $HOME/Library/Logs/clearnote.log"
echo "Dashboard: http://localhost:8787"
