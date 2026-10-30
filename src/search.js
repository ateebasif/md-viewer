// ⌘K search across the Markdown files in an opened folder: file names, headings and text.
// Files are read on demand and cached by mtime, so repeat searches are cheap and edits show
// up straight away. Headings come from the real renderer, so their ids match the page.
import fs from 'node:fs';
import path from 'node:path';
import { renderMarkdown } from './render.js';

const MAX_FILES = 3000;
const MAX_BYTES = 2 * 1024 * 1024;
const RENDER_BUDGET = 40; // first-time renders per query, so a cold search of a big folder stays fast
const MAX_RESULTS = 40;
const cache = new Map(); // path -> { mtimeMs, size, raw, plain, lower, title, headings }

// Markdown → readable text for matching and snippets (not for display as HTML).
function toPlain(raw) {
  return raw
    .replace(/^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[([^[\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^[\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>+|[-*+]\s+\[[ xX]\]|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*(`{3,}|~{3,}).*$/gm, '')
    .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, '')
    .replace(/[*_~`|]+/g, ' ')
    .replace(/[ \t]+/g, ' ');
}

function load(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    cache.delete(file);
    return null;
  }
  if (!stat.isFile() || stat.size > MAX_BYTES) return null;
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit;
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const plain = toPlain(raw);
  const h1 = /^\s{0,3}#\s+(.+?)\s*#*\s*$/m.exec(raw);
  const entry = { mtimeMs: stat.mtimeMs, size: stat.size, raw, plain, lower: plain.toLowerCase(), title: h1 ? toPlain(h1[1]).trim() : null, headings: null };
  cache.set(file, entry);
  return entry;
}

function headingsOf(entry, budget) {
  if (entry.headings) return entry.headings;
  if (budget.left <= 0) return null;
  budget.left--;
  try {
    const r = renderMarkdown(entry.raw);
    entry.headings = r.headings.filter((h) => h.text.trim());
    if (r.title) entry.title = r.title;
  } catch {
    entry.headings = [];
  }
  return entry.headings;
}

function snippet(plain, lower, index, length) {
  const start = Math.max(0, plain.lastIndexOf('\n', index) + 1, index - 70);
  let end = plain.indexOf('\n', index + length);
  if (end === -1 || end - index > 110) end = Math.min(plain.length, index + length + 110);
  let text = plain.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0 && plain[start - 1] !== '\n') text = '…' + text;
  if (end < plain.length && plain[end] !== '\n') text += '…';
  return text;
}

/**
 * files: absolute paths to search. base: folder that results' relative paths are shown from.
 * Returns ranked { type: 'file'|'heading'|'text', file, rel, title, heading?, id?, snippet?, match? }.
 */
export function search(files, base, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  if (!terms.length) return [];
  const budget = { left: RENDER_BUDGET };
  const results = [];
  const has = (s) => terms.every((t) => s.includes(t));

  for (const file of files.slice(0, MAX_FILES)) {
    const rel = path.relative(base, file) || path.basename(file);
    const relLower = rel.toLowerCase();
    const name = path.basename(file).replace(/\.[^.]+$/, '').toLowerCase();
    const entry = load(file);
    const title = entry?.title || path.basename(file);

    const fileHit = has(relLower) || (entry?.title && has(entry.title.toLowerCase()));
    if (fileHit) {
      const exact = name === terms.join(' ') || name === terms.join('-');
      results.push({ type: 'file', file, rel, title, score: 100 + (exact ? 40 : name.startsWith(terms[0]) ? 20 : 0) });
    }
    if (!entry || !has(entry.lower)) continue;

    const headings = headingsOf(entry, budget) || [];
    let headingHits = 0;
    for (const h of headings) {
      const t = h.text.toLowerCase();
      if (!has(t) || headingHits >= 5) continue;
      if (fileHit && h.level === 1 && h.text === title) continue; // same as the file result
      headingHits++;
      results.push({ type: 'heading', file, rel, title, heading: h.text, id: h.id, level: h.level,
        score: 80 - h.level * 4 + (t.startsWith(terms[0]) ? 10 : 0) });
    }

    // Text hit: the first occurrence in body text, skipping lines that are just a heading
    // (those already have their own result).
    const headingLines = new Set(headings.map((h) => h.text.trim().toLowerCase()));
    // Prefer the whole query as a phrase when it appears that way.
    const phrase = terms.join(' ');
    const needle = terms.length > 1 && entry.lower.includes(phrase) ? phrase : terms[0];
    let first = -1;
    for (let i = entry.lower.indexOf(needle), n = 0; i !== -1 && n < 50; i = entry.lower.indexOf(needle, i + 1), n++) {
      const ls = entry.lower.lastIndexOf('\n', i) + 1;
      const le = entry.lower.indexOf('\n', i);
      const line = entry.lower.slice(ls, le === -1 ? undefined : le).trim();
      if (!headingLines.has(line) && !(entry.title && line === entry.title.toLowerCase())) { first = i; break; }
    }
    if (first !== -1) {
      const match = entry.plain.substr(first, needle.length);
      const count = entry.lower.split(needle).length - 1;
      results.push({ type: 'text', file, rel, title, snippet: snippet(entry.plain, entry.lower, first, needle.length),
        match, score: 20 + Math.min(count, 10) });
    }
  }

  results.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
  return results.slice(0, MAX_RESULTS).map(({ score, ...r }) => r);
}

export function flattenTree(node, out = []) {
  for (const f of node.files) out.push(f.path);
  for (const d of node.dirs) flattenTree(d, out);
  return out;
}
