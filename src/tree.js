// Recursive listing of Markdown files for the folder-mode sidebar.
import fs from 'node:fs';
import path from 'node:path';
import { isMarkdown } from './render.js';

const IGNORED = new Set(['node_modules', '.git', 'bower_components', '__pycache__']);
const MAX_FILES = 5000;
// Pointing mdv at a huge folder (say, ~) shouldn't stall every page load walking it.
const MAX_DIRS = 4000;

// Returns { name, path, dirs: [...], files: [{ name, path }] } — empty dirs are pruned.
export function listMarkdownTree(root) {
  let count = 0;
  let dirs = 0;
  function walk(dir) {
    if (++dirs > MAX_DIRS) return null;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    const node = { name: path.basename(dir), path: dir, dirs: [], files: [] };
    for (const e of entries) {
      if (count >= MAX_FILES) break;
      if (e.name.startsWith('.') || IGNORED.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const child = walk(full);
        if (child && (child.files.length || child.dirs.length)) node.dirs.push(child);
      } else if ((e.isFile() || e.isSymbolicLink()) && isMarkdown(e.name)) {
        let mtime = 0;
        try { mtime = fs.statSync(full).mtimeMs; } catch { /* broken symlink */ }
        node.files.push({ name: e.name, path: full, mtime });
        count++;
      }
    }
    // README / index first, the way people expect to land in a folder.
    node.files.sort((a, b) => rank(a.name) - rank(b.name));
    return node;
  }
  return walk(root) || { name: path.basename(root), path: root, dirs: [], files: [] };
}

function rank(name) {
  return /^(readme|index)\./i.test(name) ? 0 : 1;
}

export function findIndexFile(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const pick = entries.find((n) => /^readme\.(md|markdown)$/i.test(n)) ||
    entries.find((n) => /^index\.(md|markdown)$/i.test(n));
  return pick ? path.join(dir, pick) : null;
}
