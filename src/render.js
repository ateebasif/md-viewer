// Markdown → HTML. Everything runs server-side so the page arrives fully rendered.
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import { gfmHeadingId, getHeadingList } from 'marked-gfm-heading-id';
import markedFootnote from 'marked-footnote';
import markedAlert from 'marked-alert';

export const MD_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdx'];

export function isMarkdown(file) {
  const lower = file.toLowerCase();
  return MD_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const LANG_LABELS = {
  js: 'JavaScript', javascript: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', typescript: 'TypeScript',
  tsx: 'TSX', py: 'Python', python: 'Python', rb: 'Ruby', ruby: 'Ruby', go: 'Go', rs: 'Rust',
  rust: 'Rust', sh: 'Shell', bash: 'Bash', zsh: 'Zsh', shell: 'Shell', console: 'Console',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', html: 'HTML', xml: 'XML', css: 'CSS',
  scss: 'SCSS', sql: 'SQL', swift: 'Swift', kotlin: 'Kotlin', java: 'Java', c: 'C', cpp: 'C++',
  'c++': 'C++', cs: 'C#', csharp: 'C#', php: 'PHP', diff: 'Diff', md: 'Markdown',
  markdown: 'Markdown', dockerfile: 'Dockerfile', graphql: 'GraphQL', lua: 'Lua', ini: 'INI',
};

function langLabel(lang) {
  if (!lang) return '';
  return LANG_LABELS[lang.toLowerCase()] || lang;
}

const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'fish']);
const CONSOLE_LANGS = new Set(['console', 'terminal', 'shell-session', 'shellsession']);
// Things that mean "this is a script", where a $ prompt on every line would be wrong.
const SCRIPT_HINT = /^#!|\b(then|fi|do|done|esac|function|elif)\b|[{}]\s*$|<<-?\s*['"]?\w+/m;

// Info strings like `js app.js`, `js title="app.js"` or `js:app.js` → { lang, title }.
export function parseInfo(info = '') {
  const trimmed = info.trim();
  let [lang = '', ...rest] = trimmed.split(/\s+/);
  let title = '';
  const colon = lang.indexOf(':');
  if (colon > 0) {
    title = lang.slice(colon + 1);
    lang = lang.slice(0, colon);
  }
  const restStr = rest.join(' ');
  const quoted = /(?:title|file|filename)\s*=\s*(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(restStr);
  if (quoted) title = quoted[1] || quoted[2] || quoted[3];
  else if (!title && /^[\w@~.\-/]+\.[\w-]+$/.test(rest[0] || '')) title = rest[0];
  return { lang: lang.toLowerCase(), title };
}

// Split highlighted HTML into lines, closing and reopening <span>s that cross line breaks.
function splitHighlighted(html) {
  const out = [];
  let open = [];
  for (const line of html.split('\n')) {
    let s = open.join('') + line;
    for (const m of line.matchAll(/<span[^>]*>|<\/span>/g)) {
      if (m[0] === '</span>') open.pop();
      else open.push(m[0]);
    }
    s += '</span>'.repeat(open.length);
    out.push(s);
  }
  return out;
}

function highlightRaw(code, lang) {
  if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  return escapeHtml(code);
}

// Shell, console and diff blocks are wrapped line by line so CSS can draw prompts and
// full-width diff rows. Each line is <span class="line …">…</span>, joined by real newlines,
// so the code's textContent (what Copy uses) is exactly the source.
function highlightCode(code, info) {
  const { lang } = parseInfo(info);
  if (lang === 'mermaid') return escapeHtml(code);
  const isShell = SHELL_LANGS.has(lang);
  const isConsole = CONSOLE_LANGS.has(lang);
  const isDiff = lang === 'diff' || lang === 'patch';
  if (!isShell && !isConsole && !isDiff) return highlightRaw(code, lang);

  let lines = code.replace(/\n$/, '').split('\n');
  let classes;
  if (isConsole) {
    // `$ cmd` lines are commands (prompt drawn by CSS, so it isn't copied); the rest is output.
    let continuing = false;
    classes = lines.map((line, i) => {
      const m = /^\s*[$%❯]\s?(.*)$/.exec(line);
      let cls;
      if (m) { lines[i] = m[1]; cls = 'cmd'; }
      else cls = continuing ? 'cont' : 'out';
      continuing = cls !== 'out' && /\\$/.test(lines[i]);
      return cls;
    });
  } else if (isShell) {
    const prompts = lines.length <= 25 && !SCRIPT_HINT.test(code);
    let continuing = false;
    classes = lines.map((line) => {
      const t = line.trim();
      let cls = !t ? 'blank' : continuing ? 'cont' : t.startsWith('#') ? 'comment' : prompts ? 'cmd' : '';
      continuing = /\\$/.test(line);
      return cls;
    });
  } else {
    classes = lines.map((line) => (/^@@/.test(line) ? 'hunk' : /^\+(?!\+\+)/.test(line) ? 'add' : /^-(?!--)/.test(line) ? 'del' : ''));
  }
  const html = splitHighlighted(highlightRaw(lines.join('\n'), isConsole ? 'bash' : isDiff ? 'diff' : lang));
  return html.map((h, i) => `<span class="line${classes[i] ? ' ' + classes[i] : ''}">${h}</span>`).join('\n');
}

function createMarked() {
  return new Marked(
    { gfm: true },
    markedHighlight({
      emptyLangClass: 'hljs',
      langPrefix: 'hljs language-',
      highlight(code, _lang, info) {
        return highlightCode(code, info || _lang || '');
      },
    }),
    gfmHeadingId(),
    markedFootnote(),
    markedAlert(),
    {
      renderer: {
        // Runs after marked-highlight has replaced `text` with highlighted (escaped) HTML.
        code({ text, lang, escaped }) {
          const { lang: language, title } = parseInfo(lang || '');
          const body = (escaped ? text : escapeHtml(text)).replace(/\n$/, '');
          if (language === 'mermaid') {
            return `<div class="mermaid-block"><pre class="mermaid">${body}</pre></div>\n`;
          }
          const label = langLabel(language);
          const kind = SHELL_LANGS.has(language) || CONSOLE_LANGS.has(language) ? ' is-shell' : '';
          const cls = language ? ` language-${escapeHtml(language)}` : '';
          const lineCount = (body.match(/\n/g) || []).length + 1;
          const head = title
            ? `<span class="code-title">${escapeHtml(title)}</span>${label ? `<span class="code-lang">${escapeHtml(label)}</span>` : ''}`
            : `<span class="code-lang">${escapeHtml(label)}</span>`;
          return (
            `<figure class="code-block${kind}" data-lines="${lineCount}">` +
            `<div class="code-head">${head}` +
            `<button type="button" class="code-copy" aria-label="Copy code">Copy</button></div>` +
            `<pre><code class="hljs${cls}">${body}</code></pre></figure>\n`
          );
        },
      },
    },
  );
}

// Very small YAML front-matter reader: we only need to strip it and pick up `title`.
function splitFrontMatter(src) {
  const m = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { body: src, meta: {} };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return { body: src.slice(m[0].length), meta };
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export function renderMarkdown(src, fileName = '') {
  const { body, meta } = splitFrontMatter(src);
  const marked = createMarked();
  let html = marked.parse(body);
  const headings = getHeadingList().filter((h) => h.id !== 'footnote-label');

  // Hover anchors on headings.
  html = html.replace(/<h([1-6]) id="([^"]+)">([\s\S]*?)<\/h\1>/g, (_, level, id, inner) =>
    `<h${level} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${level}>`);

  const h1 = headings.find((h) => h.level === 1);
  const docTitle = meta.title || (h1 ? stripTags(h1.text) : '') || fileName;
  if (meta.title && (!h1 || stripTags(h1.text).trim() !== meta.title)) {
    html = `<header class="doc-meta"><p class="doc-title">${escapeHtml(meta.title)}</p>` +
      (meta.description ? `<p class="doc-desc">${escapeHtml(meta.description)}</p>` : '') +
      `</header>\n` + html;
  }

  // Every link in the document opens in a new tab, except jumps within the page
  // (#section, footnotes) and links whose author already set a target.
  html = html.replace(/<a\s([^>]*)>/gi, (tag, attrs) => {
    const href = /\bhref\s*=\s*"([^"]*)"/i.exec(attrs);
    if (!href || href[1].startsWith('#') || /\btarget\s*=/i.test(attrs)) return tag;
    const rel = /\brel\s*=/i.test(attrs) ? '' : ' rel="noopener noreferrer"';
    return `<a ${attrs} target="_blank"${rel}>`;
  });

  // Raw HTML in Markdown is allowed, but not the parts that can restyle or redirect the page
  // (<style> can leak attributes through CSS selectors, <meta refresh> navigates away), and
  // ids in the viewer's own `mdv-` namespace are renamed so content can't shadow its controls.
  html = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|meta|link|base)\b[^>]*>/gi, '')
    .replace(/\bid\s*=\s*(["'])mdv-/gi, 'id=$1user-mdv-')
    .replace(/(href="#)mdv-/g, '$1user-mdv-');

  const toc = headings
    .filter((h) => h.level >= 2 && h.level <= 4)
    .map((h) => ({ level: h.level, id: h.id.startsWith('mdv-') ? 'user-' + h.id : h.id, text: stripTags(h.text) }));

  return { html, toc, title: docTitle, hasMermaid: html.includes('class="mermaid"') };
}
