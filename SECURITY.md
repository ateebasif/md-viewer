# Security

mdv runs a web server on your Mac that can read your files, so it's designed to give that
access only to you, only for the folders you open, and only through a browser it opened.

## Reporting a vulnerability

Please don't open a public issue for security problems. Use GitHub's
[private vulnerability reporting](https://github.com/ateebasif/md-viewer/security/advisories/new)
instead. Include steps to reproduce and the version (`mdv --version`).

## How mdv protects your files

**Network**

- The server binds to `127.0.0.1` only, never to your network.
- Requests whose `Host` header isn't `127.0.0.1:<port>` or `localhost:<port>` are rejected,
  which blocks DNS-rebinding attacks.

**Who can use the server**

- On first run, mdv creates a random 256-bit key in `~/.config/mdv/secret` (file mode `0600`,
  folder mode `0700`). The `mdv` command sends it on every control request (`/open`,
  `/shutdown`), so other local programs and other user accounts can't drive the server.
- Browsers never see the key. When `mdv` opens a page, the URL carries a one-time code that
  expires after two minutes. The server swaps it for an `HttpOnly`, `SameSite=Strict` cookie
  and removes the code from the address bar.
- Every page, file and live-reload request needs that cookie. Because it's `SameSite=Strict`,
  requests started by other websites (images, scripts, `EventSource`) arrive without it and
  are refused.
- Browser requests that change state need a custom header (which forces a CORS preflight
  that's never approved), a same-origin `Origin`, and the cookie.

**Which files can be read**

- Only folders you opened with `mdv`, MDView.app or the Quick Action. Opened folders are
  remembered in `~/.config/mdv/roots.json`.
- Every read, including live-reload re-renders, resolves the real path and checks it against
  those folders, so `..`, symlinks and files later swapped for symlinks can't escape.
- FIFOs, sockets and device files are refused. They would otherwise hang the server.
- Opening a single file grants its folder only for Markdown and media files, and never for
  hidden paths such as `.ssh`, `.git` or `.env`.
- Files over 8 MB aren't rendered.

**What a Markdown file can do**

- Pages carry a Content Security Policy that allows only mdv's own scripts from `/_mdv/`
  plus a per-page nonce. Inline scripts and `<script src>` pointing at files in your folder
  don't run.
- `<script>`, `<style>`, `<meta>`, `<link>` and `<base>` are stripped from rendered HTML.
  This prevents CSS-based data leaks and redirects.
- The viewer's own elements use `mdv-` ids, and ids in that namespace are renamed in
  documents, so content can't take over the viewer's controls or its boot data.
- Non-Markdown files served from your folders (HTML, SVG and others) get a `sandbox` CSP, so
  opening one directly runs with no scripts and an opaque origin. PDFs are the exception,
  because Chrome's viewer can't run sandboxed and PDFs don't run page script.

## Tests

`npm test` (and `npm run test:bun`) runs `test/security.sh`, which checks each protection
above against a live server, including symlink and FIFO tricks. CI runs it on every push.

## Known limits

- Remote images in Markdown (`https://…`) are allowed so README badges work. Loading one
  tells that server you opened the document, as any browser would.
- The key protects against other users and processes, but not against software already
  running as your own user, which can read `~/.config/mdv/secret` just as it can read your
  files directly.
