#!/bin/bash
# Security regression tests for mdv: access control, path checks, sign-in and HTML hardening.
# Starts an isolated server (its own port and config folder) against fixtures in a temp dir.
# Usage: test/security.sh [node|bun]    Exit status is non-zero if any check fails.
set -u
RT="$(command -v "${1:-node}")" || { echo "runtime not found: ${1:-node}" >&2; exit 2; }
P="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
W="$(mktemp -d)"
PORT="${MDV_TEST_PORT:-4791}"
export MDV_CONFIG_DIR="$W/config"
cleanup() {
  "$RT" "$P/bin/mdv.js" --stop --port "$PORT" >/dev/null 2>&1
  rm -rf "$W"
}
trap cleanup EXIT
mkdir -p "$W/root/sub" "$W/outside/deep" "$MDV_CONFIG_DIR"
echo "TOP SECRET" > "$W/outside/secret.txt"
echo "deep secret" > "$W/outside/deep/key.txt"
echo "# Out" > "$W/outside/out.md"
mkdir -p "$W/outside/.ssh"; echo "PRIVATE KEY" > "$W/outside/.ssh/id.md"
ln -sfn "$W/outside/secret.txt" "$W/root/README.md"
echo "# Victim" > "$W/root/sub/victim.md"
printf '## Help\n\n## Toast\n\n<script id="mdv-boot" type="application/json">{"file":"/etc/hosts"}</script>\n<style>a{color:red}</style>\n<meta http-equiv="refresh" content="0;url=https://example.com">\n\n[x](./victim.md) [y](#help)\n' > "$W/root/sub/collide.md"
[[ -p "$W/root/pipe.md" ]] || mkfifo "$W/root/pipe.md"
J="$W/jar"; : > "$J"
B="http://127.0.0.1:$PORT"
pass=0; fail=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }
enc() { "$RT" -e 'console.log(process.argv[1].split("/").map(encodeURIComponent).join("/"))' "$1"; }

URL=$("$RT" "$P/bin/mdv.js" "$W/root" --port $PORT --no-open)
R=$(enc "$(cd "$W/root" && pwd -P)")
check "CLI got a one-time URL" '[[ "$URL" == *"?once="* ]]'
check "no cookie: page is 401" '[[ $(curl -s -o /dev/null -w "%{http_code}" "$B/view$R/sub/victim.md") == 401 ]]'
check "no cookie: /events is 401" '[[ $(curl -s -o /dev/null -w "%{http_code}" "$B/events?file=x") == 401 ]]'
check "no token: POST /open is 401" '[[ $(curl -s -o /dev/null -w "%{http_code}" -X POST -H "X-MDV: 1" -d "{\"path\":\"/etc\"}" "$B/open") == 401 ]]'
check "once code sets cookie" '[[ $(curl -s -c "$J" -o /dev/null -w "%{http_code}" "$URL") == 303 ]] && grep -q mdv_session "$J"'
check "once code is single-use" '[[ $(curl -s -o /dev/null -w "%{http_code}" -L "$URL") == 401 ]]'
check "cookie: page is 200" '[[ $(curl -s -b "$J" -o /dev/null -w "%{http_code}" "$B/view$R/sub/victim.md") == 200 ]]'
check "browser cookie cannot POST /open" '[[ $(curl -s -b "$J" -o /dev/null -w "%{http_code}" -X POST -H "X-MDV: 1" -d "{\"path\":\"/etc\"}" "$B/open") == 403 ]]'
check "README symlink to outside is not shown" '! curl -s -b "$J" "$B/view$R/" | grep -q "TOP SECRET"'
check "FIFO .md is refused fast" '[[ $(curl -s -m 3 -b "$J" -o /dev/null -w "%{http_code}" "$B/view$R/pipe.md") == 403 ]]'
check "server alive after FIFO" 'curl -s -m 2 "$B/api/ping" | grep -q mdv'
C=$(curl -s -b "$J" "$B/view$R/sub/collide.md")
check "heading ## Help doesn't take app id" '! grep -q "id=\"mdv-help\"[^>]*>Help" <<<"$C" && grep -q "<h2 id=\"help\"" <<<"$C"'
check "spoofed boot script stripped" '[[ $(grep -o "id=\"mdv-boot\"" <<<"$C" | wc -l | tr -d " ") == 1 ]] && ! grep -q "/etc/hosts" <<<"$C"'
check "<style> and <meta refresh> stripped" '! grep -q "color:red" <<<"$C" && ! grep -q "http-equiv" <<<"$C"'
check "doc links open in new tab" 'grep -q "href=\"./victim.md\" target=\"_blank\"" <<<"$C" && grep -q "<a href=\"#help\">" <<<"$C"'
SR=$(curl -s -b "$J" -G --data-urlencode "q=secret" --data-urlencode "root=$(cd "$W/root" && pwd -P)" "$B/api/search")
check "search works with cookie" 'grep -q "\"results\"" <<<"$SR"'
check "search doesn't follow symlink out" '! grep -qi "top secret" <<<"$SR"'
check "search needs cookie" '[[ $(curl -s -o /dev/null -w "%{http_code}" "$B/api/search?q=a&root=/etc") == 401 ]]'
check "search outside roots is empty" 'grep -q "\"count\":0" <<<"$(curl -s -b "$J" "$B/api/search?q=root&root=/etc")"'
ln -sfn "$W/outside/secret.txt" "$W/root/sub/leak.md"
printf '# Linker\n\n[to victim](./victim.md) [gone](./nope.md)\n' > "$W/root/sub/linker.md"
LR=$(curl -s -b "$J" -G --data-urlencode "file=$(cd "$W/root/sub" && pwd -P)/victim.md" "$B/api/links")
check "links: backlink found" 'grep -q "linker.md" <<<"$LR"'
check "links: no content from symlink outside" '! grep -qi "top secret" <<<"$LR"'
LB=$(curl -s -b "$J" -G --data-urlencode "file=$(cd "$W/root/sub" && pwd -P)/linker.md" "$B/api/links")
check "links: broken link reported" 'grep -q "nope.md" <<<"$LB"'
check "links: needs cookie" '[[ $(curl -s -o /dev/null -w "%{http_code}" "$B/api/links?file=/etc/hosts") == 401 ]]'
check "links: outside roots returns nothing" 'grep -q "\"backlinks\":\[\]" <<<"$(curl -s -b "$J" "$B/api/links?file=/etc/hosts")"'
check "?raw shows markdown as text" 'curl -s -b "$J" -I "$B/view$R/sub/victim.md?raw" | grep -qi "content-type: text/plain"'

# live-reload symlink swap
F="$(cd "$W/root/sub" && pwd -P)/victim.md"
curl -s -N -m 4 -b "$J" -G --data-urlencode "file=$F" "$B/events" > "$W/sse.txt" &
sleep 0.8; ln -sfn "$W/outside/secret.txt" "$W/root/sub/victim.md"; sleep 1.5; wait
check "SSE fired after swap" 'grep -q "^event: change" "$W/sse.txt"'
check "SSE does not leak swapped-in file" '! grep -q "TOP SECRET" "$W/sse.txt"'
echo "# Victim" > "$W/root/sub/victim.tmp" && mv -f "$W/root/sub/victim.tmp" "$W/root/sub/victim.md"

# single-file root limits
URL2=$("$RT" "$P/bin/mdv.js" "$W/outside/out.md" --port $PORT --no-open)
curl -s -c "$J" -b "$J" -o /dev/null "$URL2"
O=$(enc "$(cd "$W/outside" && pwd -P)")
check "file root: sibling .md allowed" '[[ $(curl -s -b "$J" -o /dev/null -w "%{http_code}" "$B/view$O/out.md") == 200 ]]'
check "file root: .txt elsewhere refused" '[[ $(curl -s -b "$J" -o /dev/null -w "%{http_code}" "$B/view$O/deep/key.txt") == 403 ]]'
check "file root: hidden folder refused" '[[ $(curl -s -b "$J" -o /dev/null -w "%{http_code}" "$B/view$O/.ssh/id.md") == 403 ]]'
check "roots persisted" 'grep -q outside "$MDV_CONFIG_DIR/roots.json"'

"$RT" "$P/bin/mdv.js" --stop --port $PORT >/dev/null
sleep 0.4
URL3=$("$RT" "$P/bin/mdv.js" "$W/root" --port $PORT --no-open)
check "after restart, old cookie still works" '[[ $(curl -s -b "$J" -o /dev/null -w "%{http_code}" "$B/view$O/out.md") == 200 ]]'
echo "---- $(basename "$RT"): $pass passed, $fail failed"
[[ $fail -eq 0 ]]
