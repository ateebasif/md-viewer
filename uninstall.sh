#!/bin/bash
# Removes everything install.sh put outside this folder. The project folder itself is left alone.
set -uo pipefail

PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPS=("$HOME/Applications/md-viewer.app" "$HOME/Applications/MDView.app")
WORKFLOWS=("$HOME/Library/Services/View in md-viewer.workflow" "$HOME/Library/Services/View in MDView.workflow")
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }

# Stop a running server (default port) so nothing is left behind.
RUNTIME="$(command -v node || command -v bun || true)"
if [[ -n "$RUNTIME" ]]; then
  "$RUNTIME" "$PROJECT/bin/mdv.js" --stop >/dev/null 2>&1 || true
fi
TARGET="$(realpath "$PROJECT/bin/mdv.js" 2>/dev/null || echo "$PROJECT/bin/mdv.js")"

for d in "$HOME/.local/bin" "/usr/local/bin"; do
  for name in mdv md-viewer; do
    link="$d/$name"
    # Only remove the link if it points at this project.
    if [[ -L "$link" && "$(realpath "$link" 2>/dev/null)" == "$TARGET" ]]; then
      rm -f "$link" && say "Removed $link"
    fi
  done
done

for APP in "${APPS[@]}"; do
  if [[ -d "$APP" ]]; then
    "$LSREGISTER" -u "$APP" 2>/dev/null || true
    rm -rf "$APP" && say "Removed $APP"
  fi
done

for WORKFLOW in "${WORKFLOWS[@]}"; do
  if [[ -d "$WORKFLOW" ]]; then
    rm -rf "$WORKFLOW" && say "Removed Quick Action"
    /System/Library/CoreServices/pbs -update 2>/dev/null || true
  fi
done

if [[ -d "$HOME/.config/mdv" ]]; then
  rm -rf "$HOME/.config/mdv" && say "Removed ~/.config/mdv (settings, opened folders, access key)"
fi

# A curl install keeps its files in ~/.local/share/md-viewer; remove that too.
if [[ "$PROJECT" == "${MD_VIEWER_HOME:-$HOME/.local/share/md-viewer}" ]]; then
  rm -rf "$PROJECT" && say "Removed $PROJECT"
  REMOVED_PROJECT=1
fi

echo
echo "Done. If md-viewer was your default app for .md files, pick a new one via Finder → Get Info → Open with."
echo "Logs (if any) are at ~/Library/Logs/mdv.log."
if [[ "$PROJECT" == */opt/md-viewer/libexec || "$PROJECT" == */Cellar/md-viewer/* ]]; then
  echo "Now run: brew uninstall md-viewer"
elif [[ -z "${REMOVED_PROJECT:-}" ]]; then
  echo "Delete this folder to remove md-viewer completely."
fi
