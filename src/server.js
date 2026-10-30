// mdv server: binds to 127.0.0.1, serves only explicitly opened roots,
// pushes live-reload events over SSE and exits after 30 idle minutes.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderMarkdown, isMarkdown, escapeHtml } from './render.js';
import { listMarkdownTree, findIndexFile } from './tree.js';
import { pageHtml, sidebarHtml, crumbsHtml, viewUrl, tocHtml } from './page.js';
import { CONFIG_DIR, loadSecret, safeEqual } from './auth.js';
import { FONT_PACKAGES } from './themes.js';
import { search, flattenTree } from './search.js';
import { linkReport } from './links.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const PUBLIC = path.join(PROJECT, 'public');
const MERMAID = path.join(PROJECT, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
export const VERSION = JSON.parse(fs.readFileSync(path.join(PROJECT, 'package.json'), 'utf8')).version;

const IDLE_MS = Number(process.env.MDV_IDLE_MS) || 30 * 60 * 1000;
const DEBOUNCE_MS = 120;
const MAX_RENDER_BYTES = 8 * 1024 * 1024; // rendering is synchronous; don't let a huge file stall the server

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.pdf': 'application/pdf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.woff': 'font/woff', '.woff2': 'font/woff2', '.csv': 'text/plain; charset=utf-8',
  // Only reached for ?raw, so the source shows as text instead of downloading.
  '.md': 'text/plain; charset=utf-8', '.markdown': 'text/plain; charset=utf-8', '.mdown': 'text/plain; charset=utf-8',
  '.mkd': 'text/plain; charset=utf-8', '.mkdn': 'text/plain; charset=utf-8', '.mdx': 'text/plain; charset=utf-8',
};

// Opening a single file grants its folder, but only for things a Markdown page links to:
// other Markdown files and media. Hidden paths (.ssh, .git, .env…) are never served from it.
const FILE_ROOT_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.bmp',
  '.pdf', '.mp4', '.webm', '.mov', '.mp3', '.wav']);

// ---------- allowed roots ----------
// Each root is { dir, kind: 'dir' | 'file', file? }. A 'file' root grants its
// directory for assets and sibling .md links, but gets no sidebar.
// Roots persist in ~/.config/mdv/roots.json so tabs keep working across server restarts.
const roots = new Map();
const ROOTS_FILE = path.join(CONFIG_DIR, 'roots.json');
const MAX_ROOTS = 100;

function loadRoots() {
  try {
    for (const r of JSON.parse(fs.readFileSync(ROOTS_FILE, 'utf8'))) {
      if ((r.kind === 'dir' || r.kind === 'file') && typeof r.dir === 'string' && fs.existsSync(r.dir)) roots.set(r.dir, r);
    }
  } catch { /* none yet */ }
}

function saveRoots() {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(ROOTS_FILE, JSON.stringify([...roots.values()].slice(-MAX_ROOTS), null, 2), { mode: 0o600 });
  } catch (e) {
    log(`couldn't save opened folders: ${e.message}`);
  }
}

function addRoot(target) {
  const real = fs.realpathSync(target);
  const stat = fs.statSync(real);
  let entry;
  if (stat.isDirectory()) entry = { dir: real, kind: 'dir' };
  else if (stat.isFile()) entry = roots.get(path.dirname(real))?.kind === 'dir' ? roots.get(path.dirname(real)) : { dir: path.dirname(real), kind: 'file' };
  else throw new Error('not a regular file or folder');
  // Re-insert so the most recently opened roots survive the MAX_ROOTS trim.
  roots.delete(entry.dir);
  roots.set(entry.dir, entry);
  while (roots.size > MAX_ROOTS) roots.delete(roots.keys().next().value);
  saveRoots();
  return { real, isDir: stat.isDirectory() };
}

function inside(child, parent) {
  return child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
}

function rootFor(p) {
  let best = null;
  for (const r of roots.values()) {
    if (inside(p, r.dir) && (!best || r.dir.length > best.dir.length)) best = r;
  }
  return best;
}

// Folder-mode root for the sidebar: the most recently opened folder that contains p.
// `roots` is in open order (addRoot re-inserts), so running `mdv sample/guides` after
// `mdv sample` shows just guides, and running `mdv sample` again widens it back.
function dirRootFor(p) {
  let best = null;
  for (const r of roots.values()) {
    if (r.kind === 'dir' && inside(p, r.dir)) best = r;
  }
  return best;
}

function permitted(real, stat) {
  if (dirRootFor(real)) return true;
  const r = rootFor(real);
  if (!r) return false;
  const rel = path.relative(r.dir, real);
  if (rel && rel.split(path.sep).some((seg) => seg.startsWith('.'))) return false;
  return stat.isDirectory() || isMarkdown(real) || FILE_ROOT_EXT.has(path.extname(real).toLowerCase());
}

// Resolve a requested absolute path → { real, stat } or { error: 403|404 }.
// Every read goes through here, including live-reload re-renders, so a file swapped for a
// symlink after the page loaded is re-checked too.
function resolveAllowed(requested) {
  const lexical = path.resolve('/', requested);
  if (!rootFor(lexical) && !rootForReal(lexical)) return { error: 403, path: lexical };
  let real, stat;
  try {
    // FIFOs, sockets and devices would block a synchronous read forever. Check the type
    // with stat before realpath: Bun's realpathSync opens the file, which blocks on a FIFO.
    const pre = fs.statSync(lexical);
    if (!pre.isFile() && !pre.isDirectory()) return { error: 403, path: lexical };
    real = fs.realpathSync(lexical);
    stat = fs.statSync(real);
  } catch {
    return { error: 404, path: lexical };
  }
  if (!stat.isFile() && !stat.isDirectory()) return { error: 403, path: lexical };
  if (!permitted(real, stat)) return { error: 403, path: lexical }; // symlink escape, hidden path…
  return { real, stat, path: lexical };
}

// Roots are stored as real paths; let /tmp/x match a root at /private/tmp/x.
function rootForReal(lexical) {
  let probe = lexical;
  while (probe !== '/') {
    try {
      const real = fs.realpathSync(probe);
      return rootFor(path.join(real, path.relative(probe, lexical)));
    } catch {
      probe = path.dirname(probe);
    }
  }
  return null;
}

// ---------- watching & SSE ----------
const clients = new Set(); // { res, file, root, timers }
const watchers = new Map(); // dir -> { watcher, recursive }

function ensureWatch(dir, recursive) {
  for (const [d, w] of watchers) {
    if (d === dir && (w.recursive || !recursive)) return;
    if (w.recursive && inside(dir, d)) return;
  }
  try {
    const watcher = fs.watch(dir, { recursive }, (event, filename) => {
      if (!filename) return onFsEvent(dir, event, null);
      onFsEvent(dir, event, path.join(dir, filename.toString()));
    });
    watcher.on('error', () => {
      watcher.close();
      if (watchers.get(dir)?.watcher === watcher) watchers.delete(dir);
    });
    watchers.get(dir)?.watcher.close(); // upgrading a plain watcher to a recursive one
    watchers.set(dir, { watcher, recursive });
  } catch {
    // Unwatchable dir (permissions, gone): live reload is best-effort.
  }
}

// Close watchers no remaining tab needs, so a long-running server doesn't pile them up.
function pruneWatchers() {
  for (const [dir, w] of watchers) {
    const needed = [...clients].some((c) =>
      (c.file && (w.recursive ? inside(c.file, dir) : path.dirname(c.file) === dir)) ||
      (c.root && w.recursive && inside(c.root, dir)));
    if (!needed) {
      w.watcher.close();
      watchers.delete(dir);
    }
  }
}

function onFsEvent(dir, event, full) {
  for (const c of clients) {
    if (c.file && (full === null ? inside(c.file, dir) : full === c.file)) schedule(c, 'change');
    // The sidebar shows each file's modified time (for "updated since you read it"),
    // so Markdown edits refresh it too, not just renames.
    if (c.root && (full === null || (inside(full, c.root) && (event === 'rename' || isMarkdown(full))))) schedule(c, 'tree');
  }
}

function schedule(client, kind) {
  clearTimeout(client.timers[kind]);
  client.timers[kind] = setTimeout(() => {
    if (kind === 'change') sendRender(client);
    else sendTree(client);
  }, DEBOUNCE_MS);
}

function sse(client, event, data) {
  client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sendRender(client) {
  const r = resolveAllowed(client.file);
  if (r.error === 403) {
    return sse(client, 'change', { ok: false, title: 'Not available', toc: '', hasMermaid: false,
      html: stateHtml('Not available', client.file, 'This file now points outside the folders opened in mdv.') });
  }
  sse(client, 'change', renderPayload(r.real || client.file));
}

function sendTree(client) {
  const tree = listMarkdownTree(client.root);
  sse(client, 'tree', { html: sidebarHtml(client.root, tree, client.file) });
}

function renderPayload(file) {
  try {
    if (fs.statSync(file).size > MAX_RENDER_BYTES) throw Object.assign(new Error('This file is over 8 MB, too large to render.'), { code: 'EFBIG' });
    const src = fs.readFileSync(file, 'utf8');
    const r = renderMarkdown(src, path.basename(file));
    return { ok: true, html: r.html, toc: tocHtml(r.toc), tocList: r.toc, title: r.title, hasMermaid: r.hasMermaid };
  } catch (e) {
    const missing = e.code === 'ENOENT';
    return {
      ok: false,
      title: missing ? 'File not found' : 'Could not read file',
      html: stateHtml(missing ? 'File not found' : 'Could not read file', file,
        missing ? 'It was moved, renamed or deleted. This page will update if it comes back.' : escapeHtml(e.message)),
      toc: '',
      tocList: [],
      hasMermaid: false,
    };
  }
}

// ---------- idle shutdown ----------
let idleTimer = null;
function armIdle() {
  clearTimeout(idleTimer);
  if (clients.size === 0) {
    idleTimer = setTimeout(() => {
      log('No open tabs for a while, shutting down.');
      shutdown();
    }, IDLE_MS);
    idleTimer.unref?.();
  }
}

// ---------- HTML helpers ----------
function stateHtml(heading, detail, hint) {
  return `<div class="state"><h1 class="state-title">${escapeHtml(heading)}</h1>` +
    (detail ? `<p class="state-path"><code>${escapeHtml(detail)}</code></p>` : '') +
    (hint ? `<p class="state-hint">${hint}</p>` : '') + `</div>`;
}

function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
}

function sendPage(res, status, opts) {
  const nonce = crypto.randomBytes(16).toString('base64');
  const csp = [
    "default-src 'self'",
    // Scripts only from mdv's own assets: a Markdown file can't pull in a .js file from its folder.
    `script-src 'nonce-${nonce}' http://127.0.0.1:${port}/_mdv/ http://localhost:${port}/_mdv/`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: http:",
    "media-src 'self' https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  send(res, status, pageHtml({ ...opts, nonce }), 'text/html; charset=utf-8', { 'Content-Security-Policy': csp });
}

function errorPage(res, status, p, root) {
  const forbidden = status === 403;
  const title = forbidden ? 'Not available' : 'File not found';
  const hint = forbidden
    ? `This path is outside the folders opened in mdv. Open it from the terminal with <code>mdv ${escapeHtml(shellQuote(p))}</code>.`
    : `Check the path or the link that brought you here.${root ? ' The sidebar lists every Markdown file in this folder.' : ''}`;
  const sidebar = root ? sidebarHtml(root.dir, listMarkdownTree(root.dir), null) : null;
  sendPage(res, status, {
    title,
    content: stateHtml(forbidden ? 'Not available' : `File not found: ${path.basename(p)}`, p, hint),
    sidebar,
    crumbs: root ? crumbsHtml(root.dir, null) : '',
  });
}

function shellQuote(s) {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

// Files from opened folders get a sandbox CSP: an .html or .svg opened directly runs with an
// opaque origin and no scripts, so it can't read other files or talk to the mdv API.
const UNTRUSTED_CSP = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; font-src 'self' data:";

function serveStatic(res, file, req, untrusted = false) {
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const stat = fs.statSync(file);
  // Chrome's PDF viewer refuses to run under a sandbox CSP; PDFs don't execute page script anyway.
  const extra = untrusted && ext !== '.pdf' ? { 'Content-Security-Policy': UNTRUSTED_CSP } : {};
  const head = req.method === 'HEAD';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && stat.size > 0) {
    const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) return send(res, 416, '', type, { 'Content-Range': `bytes */${stat.size}`, ...extra });
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', ...extra });
    return head ? res.end() : pipeFile(res, fs.createReadStream(file, { start, end }));
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', ...extra });
  if (head) return res.end();
  pipeFile(res, fs.createReadStream(file));
}

function pipeFile(res, stream) {
  // A file deleted or unreadable mid-stream must not take the server down.
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------- routes ----------
function decodeViewPath(pathname) {
  const rest = pathname.slice('/view'.length) || '/';
  return rest.split('/').map((s) => decodeURIComponent(s)).join('/');
}

function viewDocument(res, file) {
  const dirRoot = dirRootFor(file);
  const payload = renderPayload(file);
  const tree = dirRoot ? sidebarHtml(dirRoot.dir, listMarkdownTree(dirRoot.dir), file) : null;
  sendPage(res, 200, {
    title: payload.title,
    content: payload.html,
    toc: payload.tocList,
    current: file,
    root: dirRoot ? dirRoot.dir : null,
    sidebar: tree,
    hasMermaid: payload.hasMermaid,
    crumbs: crumbsHtml(dirRoot ? dirRoot.dir : null, file),
  });
}

function viewFolder(res, dir) {
  const dirRoot = dirRootFor(dir);
  if (!dirRoot) {
    // A file root's directory: there is no folder view, so send them back to the file.
    return send(res, 404, '', 'text/plain', {});
  }
  const index = findIndexFile(dir);
  if (index) {
    const r = resolveAllowed(index);
    if (!r.error && r.stat.isFile()) return viewDocument(res, r.real);
  }
  const tree = listMarkdownTree(dir);
  const has = tree.files.length || tree.dirs.length;
  const content = has
    ? stateHtml(path.basename(dir), dir, 'Pick a file from the sidebar, or press <kbd>/</kbd> to filter.')
    : stateHtml('No Markdown files here', dir, 'mdv looks for <code>.md</code>, <code>.markdown</code>, <code>.mdown</code> and <code>.mkd</code> files, skipping <code>node_modules</code>, <code>.git</code> and hidden folders.');
  sendPage(res, 200, {
    title: path.basename(dir),
    content,
    root: dirRoot.dir,
    sidebar: sidebarHtml(dirRoot.dir, listMarkdownTree(dirRoot.dir), null),
    crumbs: crumbsHtml(dirRoot.dir, dir === dirRoot.dir ? null : dir),
  });
}

function landing(res) {
  const list = [...roots.values()]
    .map((r) => {
      const href = r.kind === 'dir' ? viewUrl(r.dir, true) : null;
      return href ? `<li><a href="${href}">${escapeHtml(r.dir)}</a></li>` : `<li>${escapeHtml(r.dir)} <span class="muted">(single files)</span></li>`;
    })
    .join('');
  sendPage(res, 200, {
    title: 'mdv',
    content: stateHtml('mdv is running', null,
      (list ? `Opened this session:</p><ul class="state-list">${list}</ul><p class="state-hint">` : '') +
      'Open something with <code>mdv &lt;file-or-folder&gt;</code>.'),
  });
}

const ASSETS = {
  '/_mdv/app.css': path.join(PUBLIC, 'app.css'),
  '/_mdv/app.js': path.join(PUBLIC, 'app.js'),
  '/_mdv/favicon.svg': path.join(PUBLIC, 'favicon.svg'),
  '/_mdv/mermaid.min.js': MERMAID,
};

let port = 4747;
let server = null;

// ---------- auth ----------
// The CLI proves itself with the shared secret. Browsers get a cookie through a one-time
// code in the URL the CLI opens, so neither the secret nor a reusable token appears in a URL.
let SECRET = null;
let COOKIE = null;
const onceCodes = new Map(); // code -> expiry
const COOKIE_NAME = 'mdv_session';

function initAuth() {
  SECRET = loadSecret();
  COOKIE = crypto.createHash('sha256').update(SECRET + ':browser').digest('hex');
}

function issueOnce() {
  const now = Date.now();
  for (const [c, exp] of onceCodes) if (exp < now) onceCodes.delete(c);
  const code = crypto.randomBytes(18).toString('base64url');
  onceCodes.set(code, now + 2 * 60 * 1000);
  return code;
}

function cliAuthed(req) {
  return safeEqual(req.headers['x-mdv-token'], SECRET);
}

function browserAuthed(req) {
  const m = /(?:^|;\s*)mdv_session=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return !!m && safeEqual(m[1], COOKIE);
}

function hostAllowed(req) {
  const host = (req.headers.host || '').toLowerCase();
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

async function handle(req, res) {
  // Reject DNS-rebinding style requests: only our own origin may talk to us.
  if (!hostAllowed(req)) return send(res, 421, 'Misdirected request', 'text/plain');
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const { pathname } = url;

  if (req.method === 'POST') {
    // Custom header forces a CORS preflight that we never approve, so web pages can't drive these.
    if (req.headers['x-mdv'] !== '1') return send(res, 403, 'Forbidden', 'text/plain');
    const origin = req.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
      return send(res, 403, 'Forbidden', 'text/plain');
    }
    const fromCli = cliAuthed(req);
    if (!fromCli && !browserAuthed(req)) return send(res, 401, '{"error":"not authorized"}', 'application/json');
    if ((pathname === '/open' || pathname === '/shutdown') && !fromCli) {
      return send(res, 403, '{"error":"only the mdv command can do that"}', 'application/json');
    }
    if (pathname === '/api/reveal' || pathname === '/api/edit') {
      let target;
      try {
        target = JSON.parse(await readBody(req)).path;
      } catch {
        return send(res, 400, '{"error":"bad request"}', 'application/json');
      }
      if (typeof target !== 'string') return send(res, 400, '{"error":"bad request"}', 'application/json');
      const r = resolveAllowed(target);
      if (r.error) return send(res, r.error, JSON.stringify({ error: r.error === 403 ? 'not allowed' : 'not found' }), 'application/json');
      const editor = readConfig().editor;
      const args = pathname === '/api/reveal' ? ['-R', r.real] : editor ? ['-a', editor, r.real] : ['-t', r.real];
      const child = spawn('/usr/bin/open', args, { stdio: 'ignore' });
      child.on('error', () => {});
      child.on('exit', (code) => {
        if (code !== 0 && editor && pathname === '/api/edit') log(`couldn't open "${editor}"; check the app name with mdv --editor`);
      });
      return send(res, 200, '{"ok":true}', 'application/json');
    }
    if (pathname === '/open') {
      try {
        const { path: target } = JSON.parse(await readBody(req));
        if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('path must be absolute');
        const { real, isDir } = addRoot(target);
        log(`open ${real}`);
        return send(res, 200, JSON.stringify({ url: `http://127.0.0.1:${port}${viewUrl(real, isDir)}?once=${issueOnce()}` }), 'application/json');
      } catch (e) {
        return send(res, 400, JSON.stringify({ error: e.code === 'ENOENT' ? `Not found: ${e.path || ''}` : e.message }), 'application/json');
      }
    }
    if (pathname === '/shutdown') {
      send(res, 200, '{"ok":true}', 'application/json');
      return setTimeout(shutdown, 50);
    }
    return send(res, 404, 'Not found', 'text/plain');
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');

  if (pathname === '/api/ping') {
    return send(res, 200, JSON.stringify({ app: 'mdv', version: VERSION, pid: process.pid, clients: clients.size }), 'application/json');
  }

  if (ASSETS[pathname]) {
    if (!fs.existsSync(ASSETS[pathname])) return send(res, 404, 'Missing asset', 'text/plain');
    return serveStatic(res, ASSETS[pathname], req);
  }

  // Bundled fonts: /_mdv/fonts/<font id>/<file>.woff2, only from the known @fontsource packages.
  const fontMatch = /^\/_mdv\/fonts\/([a-z]+)\/([a-z0-9-]+\.woff2)$/.exec(pathname);
  if (fontMatch && FONT_PACKAGES[fontMatch[1]]) {
    const file = path.join(PROJECT, 'node_modules', FONT_PACKAGES[fontMatch[1]], 'files', fontMatch[2]);
    if (!fs.existsSync(file)) return send(res, 404, 'Missing font', 'text/plain');
    return serveStatic(res, file, req);
  }

  // Trade a one-time code from the CLI for a session cookie, then drop it from the URL.
  const once = url.searchParams.get('once');
  if (once !== null) {
    const exp = onceCodes.get(once);
    onceCodes.delete(once);
    url.searchParams.delete('once');
    if (exp && exp > Date.now()) {
      res.writeHead(303, {
        Location: url.pathname + url.search,
        'Set-Cookie': `${COOKIE_NAME}=${COOKIE}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`,
        'Cache-Control': 'no-store',
      });
      return res.end();
    }
    if (browserAuthed(req)) return send(res, 303, '', 'text/plain', { Location: url.pathname + url.search });
  }
  // SameSite=Strict also means other websites' requests (images, EventSource) arrive without it.
  if (!browserAuthed(req)) {
    if (pathname === '/events') return send(res, 401, 'Not authorized', 'text/plain');
    return sendPage(res, 401, {
      title: 'Open with mdv',
      content: stateHtml('Open this page with mdv', null,
        'For your safety, mdv only shows files in a browser that was opened by the <code>mdv</code> command, MDView.app or the Finder Quick Action. Run <code>mdv &lt;file-or-folder&gt;</code> again.'),
    });
  }

  if (pathname === '/events') {
    const want = url.searchParams.get('file');
    const wantRoot = url.searchParams.get('root');
    const client = { res, file: null, root: null, timers: {} };
    if (want) {
      const r = resolveAllowed(want);
      if (r.error === 403) return send(res, 403, 'Forbidden', 'text/plain');
      client.file = r.real || r.path;
      ensureWatch(path.dirname(client.file), false);
    }
    if (wantRoot) {
      const r = resolveAllowed(wantRoot);
      if (r.real && r.stat.isDirectory() && dirRootFor(r.real)) {
        client.root = dirRootFor(r.real).dir;
        ensureWatch(client.root, true);
      }
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 1500\n: connected\n\n');
    clients.add(client);
    clearTimeout(idleTimer);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      Object.values(client.timers).forEach(clearTimeout);
      clients.delete(client);
      pruneWatchers();
      armIdle();
    });
    return;
  }

  if (pathname === '/api/search') {
    const q = (url.searchParams.get('q') || '').slice(0, 200);
    let files = [];
    let base = null;
    const wantRoot = url.searchParams.get('root');
    const wantFile = url.searchParams.get('file');
    const r = wantRoot ? resolveAllowed(wantRoot) : null;
    const dirRoot = r && r.real && r.stat.isDirectory() ? dirRootFor(r.real) : null;
    if (dirRoot) {
      base = dirRoot.dir;
      files = flattenTree(listMarkdownTree(base));
    } else if (wantFile) {
      const f = resolveAllowed(wantFile);
      if (f.real && f.stat.isFile()) { files = [f.real]; base = path.dirname(f.real); }
    }
    // Each file is checked like a page load, so a symlink in the folder can't leak outside files.
    files = files.filter((f) => { const a = resolveAllowed(f); return !a.error && a.stat.isFile(); });
    const results = q.trim() && base ? search(files, base, q) : [];
    return send(res, 200, JSON.stringify({
      count: files.length,
      results: results.map((x) => ({ ...x, url: viewUrl(x.file), file: undefined })),
    }), 'application/json');
  }

  if (pathname === '/api/links') {
    const f = resolveAllowed(url.searchParams.get('file') || '');
    if (!f.real || !f.stat.isFile()) return send(res, 200, '{"backlinks":[],"broken":[]}', 'application/json');
    const dirRoot = dirRootFor(f.real);
    const base = dirRoot ? dirRoot.dir : path.dirname(f.real);
    const files = dirRoot
      ? flattenTree(listMarkdownTree(base)).filter((x) => { const a = resolveAllowed(x); return !a.error && a.stat.isFile(); })
      : [];
    const { backlinks, broken } = linkReport(f.real, files, base, resolveAllowed);
    return send(res, 200, JSON.stringify({
      backlinks: backlinks.map(({ file, ...b }) => ({ ...b, url: viewUrl(file) })),
      broken,
    }), 'application/json');
  }

  if (pathname === '/') return landing(res);

  if (pathname === '/view' || pathname.startsWith('/view/')) {
    let requested;
    try {
      requested = decodeViewPath(pathname);
    } catch {
      return send(res, 400, 'Bad path', 'text/plain');
    }
    const r = resolveAllowed(requested);
    if (r.error) return errorPage(res, r.error, r.path, r.error === 404 ? dirRootFor(r.path) || null : null);
    if (r.stat.isDirectory()) {
      if (!pathname.endsWith('/')) return send(res, 301, '', 'text/plain', { Location: viewUrl(r.path, true) });
      if (!dirRootFor(r.real)) {
        // Folder of a single opened file: no listing, hand back to the file if we know it.
        return errorPage(res, 403, r.path, null);
      }
      return viewFolder(res, r.real);
    }
    if (isMarkdown(r.real) && url.searchParams.get('raw') === null) return viewDocument(res, r.real);
    return serveStatic(res, r.real, req, true);
  }

  return send(res, 404, 'Not found', 'text/plain');
}

// ~/.config/mdv/config.json, written by `mdv --editor`. Read per request so changes apply live.
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function log(msg) {
  console.log(`[mdv ${new Date().toISOString()}] ${msg}`);
}

function shutdown() {
  for (const c of clients) c.res.end();
  for (const { watcher } of watchers.values()) watcher.close();
  server?.close();
  setTimeout(() => process.exit(0), 100).unref?.();
}

export function start(p = 4747) {
  port = p;
  initAuth();
  loadRoots();
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      handle(req, res).catch((e) => {
        log(`error ${req.url}: ${e.stack || e}`);
        if (!res.headersSent) send(res, 500, 'Internal error', 'text/plain');
        else res.end();
      });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      log(`listening on http://127.0.0.1:${port} (pid ${process.pid})`);
      armIdle();
      resolve(server);
    });
  });
}

// Run directly: node src/server.js --port 4747
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--port');
  const p = i > -1 ? Number(process.argv[i + 1]) : 4747;
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  start(p).catch((e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${p} is already in use.` : e.message);
    process.exit(e.code === 'EADDRINUSE' ? 3 : 1);
  });
}
