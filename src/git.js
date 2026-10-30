// "Changes since the last commit" for files in a git repo.
//
// Only git plumbing is used (rev-parse, ls-tree, cat-file): unlike `git status` or `git diff`,
// these never run fsmonitor hooks, clean/smudge filters or other repo-configured commands,
// so opening a hostile repository can't execute code. Working-tree files are hashed here, in
// JS, the same way git hashes blobs, and compared with the blob ids in HEAD.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const TIMEOUT = 4000;
const SAFE_CONFIG = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never'];
let gitBin;

// Find a real git without triggering macOS's "install developer tools" dialog: the
// /usr/bin/git shim pops it up when the Command Line Tools aren't installed.
function findGit() {
  if (gitBin !== undefined) return gitBin;
  gitBin = null;
  for (const p of ['/opt/homebrew/bin/git', '/usr/local/bin/git']) {
    if (fs.existsSync(p)) return (gitBin = p);
  }
  if (process.platform !== 'darwin') return (gitBin = 'git');
  const sel = spawnSync('/usr/bin/xcode-select', ['-p'], { timeout: TIMEOUT });
  if (sel.status === 0) gitBin = '/usr/bin/git';
  return gitBin;
}

function git(cwd, args, binary = false) {
  const bin = findGit();
  if (!bin) return null;
  const r = spawnSync(bin, ['-C', cwd, ...SAFE_CONFIG, ...args], {
    encoding: binary ? 'buffer' : 'utf8',
    timeout: TIMEOUT,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  });
  return r.error || r.status !== 0 ? null : r.stdout;
}

const repoCache = new Map(); // dir -> { at, repo }
function repoFor(dir) {
  const hit = repoCache.get(dir);
  if (hit && Date.now() - hit.at < 10000) return hit.repo;
  let repo = null;
  const out = git(dir, ['rev-parse', '--show-toplevel', '--show-object-format', 'HEAD']);
  if (out) {
    const [top, format, head] = out.trim().split('\n');
    if (top && head) repo = { top: fs.realpathSync(top), format: format === 'sha256' ? 'sha256' : 'sha1', head };
  }
  repoCache.set(dir, { at: Date.now(), repo });
  return repo;
}

function blobId(file, format) {
  const data = fs.readFileSync(file);
  return crypto.createHash(format).update(`blob ${data.length}\0`).update(data).digest('hex');
}

// path (relative to the repo, '/'-separated) -> blob id, for everything under `rel` in HEAD.
function headBlobs(repo, rel) {
  const out = git(repo.top, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD', '--', rel || '.']);
  const map = new Map();
  if (!out) return map;
  for (const entry of out.split('\0')) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(entry);
    if (m) map.set(m[2], m[1]);
  }
  return map;
}

const toRel = (repo, file) => path.relative(repo.top, file).split(path.sep).join('/');

/** { repo: false } | { repo: true, status: 'clean'|'modified'|'untracked', committed?: string } */
export function fileStatus(file) {
  const repo = repoFor(path.dirname(file));
  if (!repo) return { repo: false };
  const rel = toRel(repo, file);
  if (rel.startsWith('..')) return { repo: false };
  const id = headBlobs(repo, rel).get(rel);
  if (!id) return { repo: true, status: 'untracked' };
  let current;
  try { current = blobId(file, repo.format); } catch { return { repo: true, status: 'clean' }; }
  if (current === id) return { repo: true, status: 'clean' };
  const committed = git(repo.top, ['cat-file', 'blob', id]);
  return committed === null ? { repo: true, status: 'clean' } : { repo: true, status: 'modified', committed };
}

/** Markdown files under `root` that differ from HEAD: { repo, modified: [abs], untracked: [abs] } */
export function treeStatus(root, files) {
  const repo = repoFor(root);
  if (!repo) return { repo: false, modified: [], untracked: [] };
  const relRoot = toRel(repo, root);
  if (relRoot.startsWith('..')) return { repo: false, modified: [], untracked: [] };
  const blobs = headBlobs(repo, relRoot);
  const modified = [];
  const untracked = [];
  for (const file of files) {
    const rel = toRel(repo, file);
    const id = blobs.get(rel);
    if (!id) { untracked.push(file); continue; }
    try { if (blobId(file, repo.format) !== id) modified.push(file); } catch { /* unreadable */ }
  }
  return { repo: true, modified, untracked };
}
