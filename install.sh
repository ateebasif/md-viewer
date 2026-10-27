#!/bin/bash
# Installs mdv: dependencies, the `mdv` command, MDView.app and a Finder Quick Action.
set -euo pipefail

PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$PROJECT/bin/mdv.js"
APP_DIR="$HOME/Applications"
APP="$APP_DIR/MDView.app"
SERVICES="$HOME/Library/Services"
WORKFLOW="$SERVICES/View in MDView.workflow"
BUNDLE_ID="local.mdv.MDView"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*"; }

# ---------- 1. runtime + dependencies ----------
# Finder apps don't get your shell PATH, so record absolute paths now.
NODE="$(command -v node || true)"
BUN="$(command -v bun || true)"
if [[ -n "$NODE" ]]; then
  RUNTIME="$NODE"
elif [[ -n "$BUN" ]]; then
  RUNTIME="$BUN"
else
  echo "mdv needs Node.js 18+ or Bun. Install one (e.g. https://nodejs.org) and re-run." >&2
  exit 1
fi
RUNTIME="$(cd "$(dirname "$RUNTIME")" && pwd -P)/$(basename "$RUNTIME")"

cd "$PROJECT"
if [[ -n "$BUN" ]]; then
  say "Installing dependencies with bun"
  "$BUN" install
else
  say "Installing dependencies with npm"
  npm install --no-audit --no-fund
fi
chmod +x "$CLI"

# ---------- 2. link `mdv` onto PATH ----------
LINK_DIR=""
for d in "$HOME/.local/bin" "/usr/local/bin"; do
  if [[ -d "$d" && -w "$d" ]]; then LINK_DIR="$d"; break; fi
done
if [[ -z "$LINK_DIR" ]]; then
  LINK_DIR="$HOME/.local/bin"
  mkdir -p "$LINK_DIR"
fi
ln -sf "$CLI" "$LINK_DIR/mdv"
say "Linked mdv → $LINK_DIR/mdv"
case ":$PATH:" in
  *":$LINK_DIR:"*) ;;
  *) warn "$LINK_DIR is not on your PATH. Add this to ~/.zshrc:"
     echo "    export PATH=\"$LINK_DIR:\$PATH\"" ;;
esac
if [[ "$RUNTIME" == "$BUN" ]]; then
  warn "Only Bun was found. The mdv command's shebang uses node; run it as: bun $CLI <path>"
fi

# ---------- 3. MDView.app ----------
say "Building $APP"
mkdir -p "$APP_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Fill the template with the runtime itself (node or bun), so paths containing & " \ or $
# are escaped exactly once for an AppleScript string literal.
MDV_TPL_IN="$PROJECT/macos/MDView.applescript" MDV_TPL_OUT="$TMP/MDView.applescript" \
MDV_TPL_RUNTIME="$RUNTIME" MDV_TPL_CLI="$CLI" "$RUNTIME" -e '
  const fs = require("fs");
  const e = process.env;
  const lit = (s) => s.split("\\").join("\\\\").split("\"").join("\\\"");
  const src = fs.readFileSync(e.MDV_TPL_IN, "utf8")
    .split("__RUNTIME__").join(lit(e.MDV_TPL_RUNTIME))
    .split("__CLI__").join(lit(e.MDV_TPL_CLI));
  fs.writeFileSync(e.MDV_TPL_OUT, src);
'
# Compile next to the old app and swap it in, so a failed build leaves the old one working.
osacompile -o "$TMP/MDView.app" "$TMP/MDView.applescript"
rm -rf "$APP"
mv "$TMP/MDView.app" "$APP"

PLIST="$APP/Contents/Info.plist"
plutil -replace CFBundleIdentifier -string "$BUNDLE_ID" "$PLIST"
plutil -replace CFBundleShortVersionString -string "1.0.0" "$PLIST"
plutil -replace LSUIElement -bool true "$PLIST"
plutil -remove CFBundleIconName "$PLIST" 2>/dev/null || true
plutil -replace CFBundleDocumentTypes -json '[
  { "CFBundleTypeName": "Markdown document", "CFBundleTypeRole": "Viewer", "LSHandlerRank": "Alternate",
    "LSItemContentTypes": ["net.daringfireball.markdown"],
    "CFBundleTypeExtensions": ["md", "markdown", "mdown", "mkd"] },
  { "CFBundleTypeName": "Folder", "CFBundleTypeRole": "Viewer", "LSHandlerRank": "Alternate",
    "LSItemContentTypes": ["public.folder"] }
]' "$PLIST"
plutil -replace UTImportedTypeDeclarations -json '[
  { "UTTypeIdentifier": "net.daringfireball.markdown", "UTTypeDescription": "Markdown document",
    "UTTypeConformsTo": ["public.plain-text"],
    "UTTypeTagSpecification": { "public.filename-extension": ["md", "markdown", "mdown", "mkd"] } }
]' "$PLIST"

# Icon: drawn with AppKit via JXA, sized with sips, packed with iconutil.
if osascript -l JavaScript "$PROJECT/macos/make-icon.js" "$TMP/icon.png" >/dev/null 2>&1; then
  ICONSET="$TMP/MDView.iconset"
  mkdir -p "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$TMP/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    d=$((s * 2))
    sips -z $d $d "$TMP/icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  done
  if iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/applet.icns"; then
    cp "$APP/Contents/Resources/applet.icns" "$APP/Contents/Resources/droplet.icns"
    rm -f "$APP/Contents/Resources/Assets.car"
    plutil -replace CFBundleIconFile -string applet "$PLIST"
  else
    warn "iconutil failed; keeping the default icon"
  fi
else
  warn "couldn't draw the icon; keeping the default applet icon"
fi

# Editing Info.plist invalidates osacompile's ad-hoc signature, so sign again.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || warn "codesign failed; macOS may refuse to launch the app"
touch "$APP"
"$LSREGISTER" -f "$APP"
say "Registered MDView with Launch Services"

# ---------- 4. Finder Quick Action ----------
say "Installing Quick Action \"View in MDView\""
mkdir -p "$SERVICES"
rm -rf "$WORKFLOW"
mkdir -p "$WORKFLOW/Contents"
xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
sh_quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
COMMAND="for f in \"\$@\"; do $(sh_quote "$RUNTIME") $(sh_quote "$CLI") \"\$f\" >/dev/null 2>&1; done"
COMMAND_XML="$(xml_escape "$COMMAND")"

cat > "$WORKFLOW/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>View in MDView</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSRequiredContext</key>
			<dict>
				<key>NSApplicationIdentifier</key>
				<string>com.apple.finder</string>
			</dict>
			<key>NSSendFileTypes</key>
			<array>
				<string>net.daringfireball.markdown</string>
				<string>public.folder</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
PLIST

cat > "$WORKFLOW/Contents/document.wflow" <<WFLOW
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>528</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key>
					<dict/>
					<key>CheckedForUserDefaultShell</key>
					<dict/>
					<key>inputMethod</key>
					<dict/>
					<key>shell</key>
					<dict/>
					<key>source</key>
					<dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>$COMMAND_XML</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>1</integer>
					<key>shell</key>
					<string>/bin/bash</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>6F0B2D8E-3C1A-4B55-9E7D-2A1C4E8F0B11</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
				</array>
				<key>OutputUUID</key>
				<string>A3E5C7D9-1B2F-4A6C-8E0D-3F5B7C9A1E22</string>
				<key>UUID</key>
				<string>C1D3E5F7-2A4B-4C6D-9E8F-0A1B2C3D4E33</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
				<key>arguments</key>
				<dict>
					<key>0</key>
					<dict>
						<key>default value</key>
						<integer>0</integer>
						<key>name</key>
						<string>inputMethod</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>0</string>
					</dict>
					<key>1</key>
					<dict>
						<key>default value</key>
						<false/>
						<key>name</key>
						<string>CheckedForUserDefaultShell</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>1</string>
					</dict>
					<key>2</key>
					<dict>
						<key>default value</key>
						<string></string>
						<key>name</key>
						<string>source</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>2</string>
					</dict>
					<key>3</key>
					<dict>
						<key>default value</key>
						<string></string>
						<key>name</key>
						<string>COMMAND_STRING</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>3</string>
					</dict>
					<key>4</key>
					<dict>
						<key>default value</key>
						<string>/bin/sh</string>
						<key>name</key>
						<string>shell</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>4</string>
					</dict>
				</dict>
				<key>isViewVisible</key>
				<integer>1</integer>
				<key>location</key>
				<string>309.000000:253.000000</string>
				<key>nibPath</key>
				<string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string>
			</dict>
			<key>isViewVisible</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>applicationBundleID</key>
		<string>com.apple.finder</string>
		<key>applicationBundleIDsByPath</key>
		<dict>
			<key>/System/Library/CoreServices/Finder.app</key>
			<string>com.apple.finder</string>
		</dict>
		<key>applicationPath</key>
		<string>/System/Library/CoreServices/Finder.app</string>
		<key>applicationPaths</key>
		<array>
			<string>/System/Library/CoreServices/Finder.app</string>
		</array>
		<key>inputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject</string>
		<key>outputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>presentationMode</key>
		<integer>15</integer>
		<key>processesInput</key>
		<false/>
		<key>serviceApplicationBundleID</key>
		<string>com.apple.finder</string>
		<key>serviceApplicationPath</key>
		<string>/System/Library/CoreServices/Finder.app</string>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<false/>
		<key>systemImageName</key>
		<string>NSActionTemplate</string>
		<key>useAutomaticInputType</key>
		<false/>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
WFLOW
plutil -lint "$WORKFLOW/Contents/document.wflow" >/dev/null
plutil -lint "$WORKFLOW/Contents/Info.plist" >/dev/null
/System/Library/CoreServices/pbs -update 2>/dev/null || true

# ---------- 5. done ----------
cat <<EOF

$(printf '\033[1m')mdv is installed.$(printf '\033[0m')
  Runtime:      $RUNTIME
  Command:      $LINK_DIR/mdv  (try: mdv $PROJECT/sample)
  App:          $APP
  Quick Action: right-click a .md file or folder in Finder → Quick Actions → View in MDView
                (if it's missing, enable it in System Settings → Keyboard → Keyboard Shortcuts → Services → Files and Folders)

Make MDView the default app for Markdown files:
  1. In Finder, select any .md file and press ⌘I (Get Info).
  2. Under "Open with", choose MDView (pick "Other…" and browse to $APP if it isn't listed).
  3. Click "Change All…" and confirm.

If you later move or upgrade Node (e.g. with nvm), re-run ./install.sh so the app points at the right runtime.
EOF
