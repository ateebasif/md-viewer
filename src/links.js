// Links between documents: which files in a folder link to this one (backlinks), and which
// of this file's relative links point at a missing file or heading (broken links).
import fs from 'node:fs';
import path from 'node:path';
import { docEntry, docHeadings } from './search.js';
import { isMarkdown } from './render.js';

const MAX_FILES = 3000;
const cache = new Map(); // file -> { raw, links }

// Remove code so links shown as examples (`[x](y)` in code) don't count.
function stripCode(raw) {
  return raw
    .replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\s*\1[^\n]*$/gm, '')
    .replace(/`[^`\n]+`/g, '');
}

// Relative link targets in a Markdown file, with the line each sits on.
function extract(raw) {
  const text = stripCode(raw);
  const out = [];
  const lines = text.split('\n');
  const push = (href, line) => {
    href = href.trim().replace(/^<|>$/g, '');
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return;
    out.push({ href, line });
  };
  lines.forEach((line) => {
    for (const m of line.matchAll(/(!?)\[(?:[^\[\]]|\[[^\]]*\])*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)) {
      if (!m[1]) push(m[2], line);
    }
    for (const m of line.matchAll(/<a\s[^>]*href\s*=\s*["']([^"']+)["']/gi)) push(m[1], line);
    const ref = /^\s{0,3}\[(?!\^)[^\]]+\]:\s*(\S+)/.exec(line); // not footnotes
    if (ref) push(ref[1], line);
  });
  return out;
}

function linksOf(file) {
  const entry = docEntry(file);
  if (!entry) return [];
  const hit = cache.get(file);
  if (hit && hit.raw === entry.raw) return hit.links;
  const links = extract(entry.raw).map(({ href, line }) => {
    const hashAt = href.indexOf('#');
    const pathPart = hashAt === -1 ? href : href.slice(0, hashAt);
    let hash = hashAt === -1 ? '' : href.slice(hashAt + 1);
    let decoded = pathPart;
    try { decoded = decodeURIComponent(pathPart); } catch { /* keep as written */ }
    try { hash = decodeURIComponent(hash); } catch { /* keep */ }
    const target = pathPart ? path.resolve(path.dirname(file), decoded) : null;
    return { href, target, hash, line };
  });
  cache.set(file, { raw: entry.raw, links });
  return links;
}

const plainLine = (line) => line
  .replace(/!?\[([^\[\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/[*_~`]+/g, '')
  .replace(/^\s*(#{1,6}|>+)\s*/, '').replace(/^\s*([-+]|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim().slice(0, 160);

/**
 * file: the open document (real path). files: Markdown files in its folder (already access-checked).
 * check(abs): resolveAllowed-style check, returning { error } or { real, stat }.
 */
export function linkReport(file, files, base, check) {
  const backlinks = [];
  for (const other of files.slice(0, MAX_FILES)) {
    if (other === file) continue;
    const link = linksOf(other).find((l) => {
      if (!l.target) return false;
      if (l.target === file) return true;
      // A link to a folder means its README/index.
      return path.dirname(file) === l.target && /^(readme|index)\./i.test(path.basename(file));
    });
    if (link) {
      const entry = docEntry(other);
      backlinks.push({ file: other, rel: path.relative(base, other), title: entry?.title || path.basename(other), snippet: plainLine(link.line) });
    }
  }
  backlinks.sort((a, b) => a.rel.localeCompare(b.rel));

  const broken = [];
  const seen = new Set();
  for (const l of linksOf(file)) {
    if (seen.has(l.href)) continue;
    seen.add(l.href);
    if (!l.target) continue; // same-page #anchors are checked in the browser
    let target = l.target;
    let stat;
    try { stat = fs.statSync(target); } catch { stat = null; }
    if (!stat) {
      // Only report files we'd be allowed to show; outside the opened folders we don't say.
      if (check(target).error === 404) broken.push({ href: l.href, reason: 'File not found' });
      continue;
    }
    if (!l.hash) continue;
    if (stat.isDirectory()) {
      const index = ['README.md', 'readme.md', 'index.md'].map((n) => path.join(target, n)).find((p) => fs.existsSync(p));
      if (!index) continue;
      target = index;
    }
    if (!isMarkdown(target) || check(target).error) continue;
    const headings = docHeadings(fs.realpathSync(target));
    if (headings && !headings.some((h) => h.id === l.hash)) broken.push({ href: l.href, reason: 'Heading not found' });
  }
  return { backlinks, broken };
}
