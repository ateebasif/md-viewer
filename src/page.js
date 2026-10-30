// HTML shell for every viewer page. Theme/reader prefs are applied by an inline
// script in <head> before first paint so there's no flash of the wrong theme.
import path from 'node:path';
import { escapeHtml } from './render.js';
import { THEMES, THEME_IDS, FONTS, MONO_FONTS } from './themes.js';

export function viewUrl(absPath, isDir = false) {
  const enc = absPath.split('/').map(encodeURIComponent).join('/');
  return '/view' + enc + (isDir && !enc.endsWith('/') ? '/' : '');
}

// Reading prefs are applied before first paint. Older saved values ('serif'/'sans') map onto
// the font list so nobody's choice is lost.
function bootScript() {
  const fonts = FONTS.map((f) => f.id);
  const monos = MONO_FONTS.map((f) => f.id);
  return `(function(){try{var d=document.documentElement,s=localStorage,q=new URLSearchParams(location.search).get('theme');
var T=${JSON.stringify(THEME_IDS)},F=${JSON.stringify(fonts)},M=${JSON.stringify(monos)};
if(q&&T.indexOf(q)>-1){s.setItem('mdv.theme',q);}
var t=s.getItem('mdv.theme');d.dataset.theme=T.indexOf(t)>-1?t:'auto';
var f=s.getItem('mdv.font');f=f==='serif'?'charter':f==='sans'?'system':f;d.dataset.font=F.indexOf(f)>-1?f:'charter';
var m=s.getItem('mdv.mono');d.dataset.mono=M.indexOf(m)>-1?m:'sfmono';
var l=s.getItem('mdv.leading');d.dataset.leading=/^(compact|normal|relaxed)$/.test(l)?l:'normal';
d.dataset.width=s.getItem('mdv.width')||'normal';var z=s.getItem('mdv.size');if(z)d.style.setProperty('--size',z+'px');
if(s.getItem('mdv.sidebar')==='closed')d.dataset.sidebar='closed';
var sw=s.getItem('mdv.sideW');if(sw)d.style.setProperty('--side-w',sw+'px');var tw=s.getItem('mdv.tocW');if(tw)d.style.setProperty('--toc-w',tw+'px');}catch(e){}})();`;
}

const FONT_CSS = [
  ...FONTS.map((f) => `:root[data-font="${f.id}"]{--read:${f.stack}}`),
  ...MONO_FONTS.map((f) => `:root[data-mono="${f.id}"]{--mono:${f.stack}}`),
].join('\n');

function themeOptions() {
  const groups = [...new Set(THEMES.map((t) => t.group))];
  return groups.map((g) => {
    const opts = THEMES.filter((t) => t.group === g)
      .map((t) => `<option value="${t.id}"${t.dark ? ' data-dark' : ''}>${escapeHtml(t.label)}</option>`).join('');
    return g === 'System' ? opts : `<optgroup label="${g}">${opts}</optgroup>`;
  }).join('');
}

function segmented(name, items) {
  return `<div class="seg-ctl" role="radiogroup" aria-label="${name}">` +
    items.map(([v, l]) => `<button type="button" role="radio" data-${name.toLowerCase().replace(/\s+/g, '-')}="${v}">${l}</button>`).join('') +
    `</div>`;
}

function settingsPanel() {
  const groups = [...new Set(FONTS.map((f) => f.group))];
  const fontGrid = groups.map((g) =>
    `<p class="set-group">${g}</p><div class="font-grid" role="radiogroup" aria-label="${g} typefaces">` +
    FONTS.filter((f) => f.group === g).map((f) =>
      `<button type="button" role="radio" data-font="${f.id}"${f.bundled ? ' data-bundled' : ''} style="font-family:${escapeHtml(f.stack)}">${escapeHtml(f.label)}</button>`).join('') +
    `</div>`).join('');
  return `<div class="settings" id="mdv-settings" role="dialog" aria-label="Reading settings" hidden>
  <div class="set-section"><h3>Typeface</h3>${fontGrid}</div>
  <div class="set-row"><h3>Size</h3><div class="stepper"><button type="button" data-step="-1" aria-label="Smaller text">A−</button><output id="mdv-size-val">18</output><button type="button" data-step="1" aria-label="Larger text">A+</button></div></div>
  <div class="set-row"><h3>Width</h3>${segmented('Width', [['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']])}</div>
  <div class="set-row"><h3>Spacing</h3>${segmented('Leading', [['compact', 'Compact'], ['normal', 'Normal'], ['relaxed', 'Relaxed']])}</div>
  <div class="set-row"><h3>Code</h3><div class="seg-ctl" role="radiogroup" aria-label="Code font">${MONO_FONTS.map((f) =>
    `<button type="button" role="radio" data-mono="${f.id}" style="font-family:${escapeHtml(f.stack)}">${escapeHtml(f.label)}</button>`).join('')}</div></div>
  <button type="button" class="set-reset" id="mdv-settings-reset">Reset to defaults</button>
</div>`;
}

function tocHtml(toc) {
  if (!toc.length) return '';
  const items = toc
    .map((h) => `<li class="toc-l${h.level}"><a href="#${escapeHtml(h.id)}">${escapeHtml(h.text)}</a></li>`)
    .join('');
  return `<details class="toc" id="mdv-toc"><summary>On this page</summary><ol>${items}</ol></details>`;
}

export function treeHtml(node, current, depth = 0) {
  let out = '';
  for (const f of node.files) {
    const active = f.path === current ? ' aria-current="page"' : '';
    out += `<li class="tree-file"><a href="${viewUrl(f.path)}"${active} data-name="${escapeHtml(f.name.toLowerCase())}">` +
      `${escapeHtml(f.name.replace(/\.(md|markdown|mdown|mkdn?|mdx)$/i, ''))}</a></li>`;
  }
  for (const d of node.dirs) {
    const open = current && current.startsWith(d.path + path.sep) ? ' open' : depth < 1 ? ' open' : '';
    out += `<li class="tree-dir"><details${open}><summary>${escapeHtml(d.name)}</summary>` +
      `<ul>${treeHtml(d, current, depth + 1)}</ul></details></li>`;
  }
  return out;
}

export function sidebarHtml(root, tree, current) {
  const list = treeHtml(tree, current);
  return `<div class="side-head">` +
    `<a class="side-root" href="${viewUrl(root, true)}" title="${escapeHtml(root)}">${escapeHtml(path.basename(root) || root)}</a>` +
    `<input type="search" id="mdv-filter" placeholder="Filter files" aria-label="Filter files" autocomplete="off" spellcheck="false"><kbd class="filter-hint">/</kbd></div>` +
    (list ? `<ul class="tree" id="mdv-tree">${list}</ul><p class="tree-empty" id="mdv-tree-none" hidden>No matching files</p>`
      : `<p class="tree-empty">No Markdown files in this folder.</p>`);
}

/**
 * opts: { title, content (html), toc, current (abs file path or null), root (dir root or null),
 *         tree (sidebar html or null), hasMermaid, state ('doc'|'error'|'empty'), nonce, crumbs }
 */
export function pageHtml(opts) {
  const { title, content, toc = [], current = null, root = null, sidebar = null, hasMermaid = false, nonce, crumbs = '' } = opts;
  const boot = JSON.stringify({ file: current, root, hasMermaid });
  return `<!doctype html>
<html lang="en" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/_mdv/favicon.svg" type="image/svg+xml">
<script nonce="${nonce}">
${bootScript()}
</script>
<link rel="stylesheet" href="/_mdv/app.css">
<style>${FONT_CSS}</style>
</head>
<body class="${sidebar ? 'has-sidebar' : 'no-sidebar'}">
<a class="skip" href="#mdv-content">Skip to content</a>
<header class="bar">
  <div class="bar-left">
    ${sidebar ? `<button type="button" class="icon-btn" id="mdv-toggle-sidebar" aria-label="Toggle sidebar ( [ )" title="Toggle sidebar  [" aria-controls="mdv-sidebar"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7.5 3.5v13" stroke="currentColor" stroke-width="1.4"/></svg></button>` : ''}
    <nav class="crumbs" aria-label="Location">${crumbs}</nav>
    <span class="read-time" id="mdv-read-time"></span>
  </div>
  <div class="bar-right" role="toolbar" aria-label="Reader settings">
    <button type="button" class="search-btn" id="mdv-search-btn" title="Search  ⌘K" aria-label="Search (⌘K)" aria-haspopup="dialog"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12.6 12.6 17 17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span class="search-btn-label">Search</span><kbd>⌘K</kbd></button>
    <span class="live" id="mdv-live" title="Live reload" aria-live="polite"></span>
    ${current ? `<button type="button" class="icon-btn" id="mdv-edit-btn" title="Open in editor  e" aria-label="Open in editor"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.6 3.6l2.8 2.8-8.9 8.9-3.6.8.8-3.6z M11.8 5.4l2.8 2.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></button>` : ''}
    <button type="button" class="text-btn" id="mdv-settings-btn" title="Reading settings  s" aria-label="Reading settings" aria-haspopup="dialog" aria-expanded="false" aria-controls="mdv-settings">Aa</button>
    <label class="theme-pick" title="Theme  t"><span class="sr-only">Theme</span>
      <select id="mdv-theme">${themeOptions()}</select>
    </label>
    <button type="button" class="icon-btn" id="mdv-help-btn" title="Keyboard shortcuts  ?" aria-label="Keyboard shortcuts" aria-haspopup="dialog">?</button>
  </div>
  <div class="progress" id="mdv-progress" aria-hidden="true"></div>
  ${settingsPanel()}
</header>
<div class="layout">
  ${sidebar ? `<aside class="sidebar" id="mdv-sidebar" aria-label="Files">${sidebar}</aside>
  <div class="pane-resizer side-resizer" id="mdv-side-resizer" role="separator" aria-orientation="vertical" aria-controls="mdv-sidebar" aria-label="Resize sidebar" title="Drag to resize · double-click to reset" tabindex="0"></div>` : ''}
  <main class="main" id="mdv-content" tabindex="-1">
    <div class="page">
      <div class="toc-wrap" id="mdv-toc-wrap">
        <div class="pane-resizer toc-resizer" id="mdv-toc-resizer" role="separator" aria-orientation="vertical" aria-controls="mdv-toc-slot" aria-label="Resize table of contents" title="Drag to resize · double-click to reset" tabindex="0"></div>
        <div id="mdv-toc-slot">${tocHtml(toc)}</div>
      </div>
      <article class="prose" id="mdv-doc">${content}</article>
      <section class="backlinks" id="mdv-backlinks" aria-label="Linked from" hidden></section>
      <nav class="doc-nav" id="mdv-doc-nav" aria-label="Previous and next file"></nav>
    </div>
  </main>
</div>
<dialog class="help" id="mdv-help" aria-labelledby="mdv-help-title">
  <form method="dialog" class="help-head"><h2 id="mdv-help-title">Keyboard shortcuts</h2><button class="icon-btn" aria-label="Close">×</button></form>
  <dl class="keys">
    <div><dt><kbd>⌘</kbd> <kbd>K</kbd></dt><dd>Search names, headings and text</dd></div>
    <div><dt><kbd>t</kbd></dt><dd>Cycle themes</dd></div>
    <div><dt><kbd>/</kbd></dt><dd>Filter files</dd></div>
    <div><dt><kbd>[</kbd></dt><dd>Show or hide the sidebar</dd></div>
    <div><dt><kbd>n</kbd> <kbd>p</kbd></dt><dd>Next or previous file</dd></div>
    <div><dt><kbd>c</kbd> <kbd>⇧C</kbd></dt><dd>Next or previous change after a live reload</dd></div>
    <div><dt><kbd>e</kbd></dt><dd>Open in your editor</dd></div>
    <div><dt><kbd>r</kbd></dt><dd>Reveal in Finder</dd></div>
    <div><dt><kbd>s</kbd></dt><dd>Reading settings: typeface, size, width, spacing</dd></div>
    <div><dt><kbd>+</kbd> <kbd>−</kbd></dt><dd>Text size</dd></div>
    <div><dt><kbd>?</kbd></dt><dd>This panel</dd></div>
  </dl>
  <p class="help-note">Drag the edge of the sidebar or contents to resize; double-click to reset. Click an image to zoom.</p>
</dialog>
<dialog class="search" id="mdv-search" aria-label="Search">
  <div class="search-box">
    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12.6 12.6 17 17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
    <input id="mdv-search-input" type="text" role="combobox" aria-expanded="true" aria-controls="mdv-search-results" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="${root ? 'Search file names, headings and text' : 'Search this document'}">
    <kbd>esc</kbd>
  </div>
  <ul class="search-results" id="mdv-search-results" role="listbox" aria-label="Results"></ul>
  <div class="search-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>⌘</kbd><kbd>↵</kbd> new tab</span></div>
</dialog>
<dialog class="zoom" id="mdv-zoom" aria-label="Image"><img alt=""></dialog>
<div class="toast" id="mdv-toast" role="status" aria-live="polite"></div>
<div class="changes" id="mdv-changes" role="status" aria-live="polite" hidden>
  <span class="changes-dot" aria-hidden="true"></span><span id="mdv-changes-count"></span>
  <button type="button" data-step="-1" aria-label="Previous change" title="Previous change  ⇧C">↑</button>
  <button type="button" data-step="1" aria-label="Next change" title="Next change  c">↓</button>
  <button type="button" data-close aria-label="Clear change highlights" title="Clear">×</button>
</div>
<script nonce="${nonce}" id="mdv-boot" type="application/json">${boot.replace(/</g, '\\u003c')}</script>
<script src="/_mdv/app.js" defer></script>
</body>
</html>`;
}

export function crumbsHtml(root, file) {
  // Show the path relative to the opened root, with the root name first.
  if (!root) return file ? `<span aria-current="page" title="${escapeHtml(file)}">${escapeHtml(path.basename(file))}</span>` : '';
  const base = root;
  const parts = [];
  parts.push(`<a href="${viewUrl(base, true)}" title="${escapeHtml(base)}">${escapeHtml(path.basename(base) || base)}</a>`);
  if (file) {
    const rel = path.relative(base, file).split(path.sep);
    rel.forEach((seg, i) => {
      const isLast = i === rel.length - 1;
      parts.push(isLast ? `<span aria-current="page">${escapeHtml(seg)}</span>` : `<span>${escapeHtml(seg)}</span>`);
    });
  }
  return parts.join('<span class="sep" aria-hidden="true">/</span>');
}

export { tocHtml };
