#!/bin/bash
# Removes everything install.sh put outside this folder. The project folder itself is left alone.
set -uo pipefail

PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$HOME/Applications/MDView.app"
WORKFLOW="$HOME/Library/Services/View in MDView.workflow"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }

# Stop a running server (default port) so nothing is left behind.
RUNTIME="$(command -v node || command -v bun || true)"
if [[ -n "$RUNTIME" ]]; then
  "$RUNTIME" "$PROJECT/bin/mdv.js" --stop >/dev/null 2>&1 || true
fi
TARGET="$(realpath "$PROJECT/bin/mdv.js" 2>/dev/null || echo "$PROJECT/bin/mdv.js")"

for d in "$HOME/.local/bin" "/usr/local/bin"; do
  link="$d/mdv"
  # Only remove the link if it points at this project.
  if [[ -L "$link" && "$(realpath "$link" 2>/dev/null)" == "$TARGET" ]]; then
    rm -f "$link" && say "Removed $link"
  fi
done

if [[ -d "$APP" ]]; then
  "$LSREGISTER" -u "$APP" 2>/dev/null || true
  rm -rf "$APP" && say "Removed $APP"
fi

if [[ -d "$WORKFLOW" ]]; then
  rm -rf "$WORKFLOW" && say "Removed Quick Action"
  /System/Library/CoreServices/pbs -update 2>/dev/null || true
fi

if [[ -d "$HOME/.config/mdv" ]]; then
  rm -rf "$HOME/.config/mdv" && say "Removed ~/.config/mdv (settings, opened folders, access key)"
fi

echo
echo "Done. If MDView was your default app for .md files, pick a new one via Finder → Get Info → Open with."
echo "Logs (if any) are at ~/Library/Logs/mdv.log. Delete this folder to remove mdv completely."
