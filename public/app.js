// mdv client: reader preferences, sidebar filter, TOC, copy buttons, mermaid and live reload.
(function () {
  'use strict';

  const root = document.documentElement;
  const boot = JSON.parse(document.getElementById('mdv-boot').textContent || '{}');
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  // Theme list comes from the page's picker, which the server renders from src/themes.js.
  const THEMES = $$('#mdv-theme option').map((o) => o.value);
  const DARK_THEMES = $$('#mdv-theme option[data-dark]').map((o) => o.value);
  const SIZE_MIN = 14, SIZE_MAX = 26, SIZE_DEFAULT = 18;

  const store = {
    get(k) { try { return localStorage.getItem('mdv.' + k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('mdv.' + k, v); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem('mdv.' + k); } catch { /* private mode */ } },
  };

  // Drop ?theme= from the address bar once it's been saved.
  if (new URLSearchParams(location.search).has('theme')) {
    const u = new URL(location.href);
    u.searchParams.delete('theme');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }

  // ---------- theme ----------
  const themeSelect = $('#mdv-theme');
  function setTheme(name) {
    if (!THEMES.includes(name)) name = 'auto';
    root.dataset.theme = name;
    store.set('theme', name);
    if (themeSelect) themeSelect.value = name;
    renderMermaid();
  }
  if (themeSelect) {
    themeSelect.value = root.dataset.theme || 'auto';
    themeSelect.addEventListener('change', () => setTheme(themeSelect.value));
  }
  function cycleTheme() {
    const i = THEMES.indexOf(root.dataset.theme || 'auto');
    setTheme(THEMES[(i + 1) % THEMES.length]);
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((root.dataset.theme || 'auto') === 'auto') renderMermaid();
  });

  // ---------- reading settings: typeface, size, width, spacing, code font ----------
  const settingsBtn = $('#mdv-settings-btn');
  const settings = $('#mdv-settings');
  const sizeVal = $('#mdv-size-val');
  const PREFS = { font: 'charter', width: 'normal', leading: 'normal', mono: 'sfmono' };

  function currentSize() {
    return parseInt(getComputedStyle(root).getPropertyValue('--size'), 10) || SIZE_DEFAULT;
  }
  function changeSize(delta) {
    const next = Math.min(SIZE_MAX, Math.max(SIZE_MIN, currentSize() + delta));
    root.style.setProperty('--size', next + 'px');
    store.set('size', String(next));
    syncSettings();
  }
  function setPref(name, value) {
    root.dataset[name] = value;
    store.set(name, value);
    syncSettings();
  }
  function syncSettings() {
    for (const name of Object.keys(PREFS)) {
      $$(`[data-${name}]`, settings).forEach((b) => b.setAttribute('aria-checked', String(b.dataset[name] === root.dataset[name])));
    }
    sizeVal.textContent = currentSize() + 'px';
  }
  function openSettings(open = settings.hidden) {
    settings.hidden = !open;
    settingsBtn.setAttribute('aria-expanded', String(open));
    if (open) ($('[aria-checked="true"]', settings) || $('button', settings)).focus();
  }
  // Hide system fonts this browser can't use (Chrome can't reach Apple's New York, for one),
  // by checking whether the face changes text width compared with two generic fallbacks.
  (function hideMissingFonts() {
    const ctx = document.createElement('canvas').getContext('2d');
    const sample = 'Handgloves 0123 The quick brown fox';
    const width = (font) => { ctx.font = `32px ${font}`; return ctx.measureText(sample).width; };
    $$('.font-grid button[data-font]:not([data-bundled])', settings).forEach((b) => {
      const first = b.style.fontFamily.split(',')[0].trim();
      if (/^(system-ui|-apple-system|ui-)/.test(first)) return;
      const present = width(`${first}, monospace`) !== width('monospace') || width(`${first}, serif`) !== width('serif');
      if (!present) b.hidden = true;
    });
  })();

  settingsBtn.addEventListener('click', () => openSettings());
  settings.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.step) return changeSize(Number(b.dataset.step));
    if (b.dataset.action === 'focus') { openSettings(false); return setFocus(true); }
    if (b.id === 'mdv-settings-reset') {
      for (const [name, value] of Object.entries(PREFS)) setPref(name, value);
      root.style.removeProperty('--size');
      store.set('size', '');
      return syncSettings();
    }
    for (const name of Object.keys(PREFS)) if (b.dataset[name]) setPref(name, b.dataset[name]);
  });
  document.addEventListener('click', (e) => {
    if (!settings.hidden && !e.target.closest('#mdv-settings, #mdv-settings-btn')) openSettings(false);
  });
  settings.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { openSettings(false); settingsBtn.focus(); }
  });
  syncSettings();

  // ---------- sidebar ----------
  const sidebar = $('#mdv-sidebar');
  const narrow = matchMedia('(max-width: 860px)');
  function toggleSidebar(force) {
    if (!sidebar) return;
    if (narrow.matches) {
      const open = force ?? !document.body.classList.contains('side-open');
      document.body.classList.toggle('side-open', open);
    } else {
      const closed = force === undefined ? root.dataset.sidebar !== 'closed' : !force;
      if (closed) root.dataset.sidebar = 'closed';
      else delete root.dataset.sidebar;
      store.set('sidebar', closed ? 'closed' : 'open');
    }
  }
  $('#mdv-toggle-sidebar')?.addEventListener('click', () => toggleSidebar());
  document.addEventListener('click', (e) => {
    if (narrow.matches && document.body.classList.contains('side-open') &&
        !e.target.closest('#mdv-sidebar, #mdv-toggle-sidebar')) toggleSidebar(false);
  });

  if (sidebar) {
    try {
      const saved = sessionStorage.getItem('mdv.sideScroll');
      if (saved) sidebar.scrollTop = Number(saved);
      addEventListener('pagehide', () => { try { sessionStorage.setItem('mdv.sideScroll', String(sidebar.scrollTop)); } catch { /* blocked */ } });
    } catch { /* storage blocked */ }
    $('[aria-current="page"]', sidebar)?.scrollIntoView({ block: 'nearest' });

    sidebar.addEventListener('input', (e) => { if (e.target.id === 'mdv-filter') applyFilter(); });
    sidebar.addEventListener('click', (e) => {
      if (!e.target.closest('#mdv-updated-chip')) return;
      updatedOnly = !updatedOnly;
      markUpdated();
      applyFilter();
    });
    sidebar.addEventListener('keydown', (e) => {
      if (e.target.id !== 'mdv-filter') return;
      if (e.key === 'Enter') {
        const first = $$('.tree-file:not([hidden]) a', sidebar)[0];
        if (first) location.href = first.href;
      } else if (e.key === 'Escape') {
        e.target.value = '';
        applyFilter();
        e.target.blur();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        $$('.tree-file:not([hidden]) a', sidebar)[0]?.focus();
      }
    });
  }

  // ---------- updated since you last read ----------
  // Each visit records when you read a file; sidebar files modified after that get a dot,
  // and the "N updated" chip filters the tree down to them.
  let updatedOnly = false;
  const MAX_READ = 500;
  function markRead() {
    if (!boot.file) return;
    const read = readJSON('read', {});
    read[location.pathname] = Date.now();
    const keys = Object.keys(read);
    if (keys.length > MAX_READ) keys.sort((a, b) => read[a] - read[b]).slice(0, keys.length - MAX_READ).forEach((k) => delete read[k]);
    store.set('read', JSON.stringify(read));
  }
  function markUpdated() {
    if (!sidebar) return;
    const read = readJSON('read', {});
    let count = 0;
    $$('.tree-file a[data-mtime]', sidebar).forEach((a) => {
      const seen = read[a.getAttribute('href')];
      const updated = !!seen && a.getAttribute('aria-current') !== 'page' && Number(a.dataset.mtime) > seen + 1000;
      a.classList.toggle('is-updated', updated);
      if (updated) { a.title = 'Updated since you last read it'; count++; } else a.removeAttribute('title');
    });
    if (!count) updatedOnly = false;
    const chip = $('#mdv-updated-chip');
    if (chip) {
      chip.hidden = !count;
      chip.textContent = `${count} updated`;
      chip.setAttribute('aria-pressed', String(updatedOnly));
      chip.title = updatedOnly ? 'Show all files' : 'Show only files updated since you last read them';
    }
  }

  function applyFilter() {
    const input = $('#mdv-filter');
    const tree = $('#mdv-tree');
    if (!input || !tree) return;
    const q = input.value.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    let shown = 0;
    $$('.tree-file', tree).forEach((li) => {
      const a = $('a', li);
      // Match against the path inside the opened folder, so "guides api" finds guides/api.md.
      const hay = decodeURIComponent(a.getAttribute('href')).slice(('/view' + (boot.root || '')).length).toLowerCase();
      const ok = terms.every((t) => hay.includes(t)) && (!updatedOnly || a.classList.contains('is-updated'));
      li.hidden = !ok;
      if (ok) shown++;
    });
    // Collapse dirs with no visible files; open everything while filtering.
    $$('.tree-dir', tree).reverse().forEach((li) => {
      const any = $$('.tree-file', li).some((f) => !f.hidden);
      li.hidden = !any;
      const d = $('details', li);
      if (q || updatedOnly) {
        if (!d.dataset.wasOpen) d.dataset.wasOpen = d.open ? '1' : '0';
        d.open = true;
      } else if (d.dataset.wasOpen) {
        d.open = d.dataset.wasOpen === '1';
        delete d.dataset.wasOpen;
      }
    });
    const none = $('#mdv-tree-none');
    if (none) none.hidden = shown > 0;
  }

  // ---------- resizable panes ----------
  // sign: +1 when dragging right grows the pane (sidebar), -1 when its handle is on the left (TOC).
  function makeResizer(handle, { prop, key, min, max, def, sign }) {
    if (!handle) return;
    const read = () => parseInt(getComputedStyle(root).getPropertyValue(prop), 10) || def;
    const clamp = (px) => Math.round(Math.min(max, Math.max(min, px)));
    const write = (px, save = true) => {
      px = clamp(px);
      root.style.setProperty(prop, px + 'px');
      handle.setAttribute('aria-valuenow', String(px));
      if (save) store.set(key, String(px));
    };
    handle.setAttribute('aria-valuemin', String(min));
    handle.setAttribute('aria-valuemax', String(max));
    handle.setAttribute('aria-valuenow', String(read()));

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const x0 = e.clientX, w0 = read();
      handle.classList.add('active');
      document.body.classList.add('resizing');
      const move = (ev) => write(w0 + sign * (ev.clientX - x0), false);
      const end = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        handle.classList.remove('active');
        document.body.classList.remove('resizing');
        write(read());
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
    handle.addEventListener('dblclick', () => {
      root.style.removeProperty(prop);
      store.del(key);
      handle.setAttribute('aria-valuenow', String(read()));
    });
    handle.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 48 : 16;
      if (e.key === 'ArrowLeft') write(read() - sign * step);
      else if (e.key === 'ArrowRight') write(read() + sign * step);
      else if (e.key === 'Home' || e.key === 'Enter') handle.dispatchEvent(new Event('dblclick'));
      else return;
      e.preventDefault();
    });
  }
  makeResizer($('#mdv-side-resizer'), { prop: '--side-w', key: 'sideW', min: 180, max: 560, def: 268, sign: 1 });
  makeResizer($('#mdv-toc-resizer'), { prop: '--toc-w', key: 'tocW', min: 160, max: 440, def: 240, sign: -1 });

  // ---------- table of contents ----------
  let tocObserver = null;
  // The side rail is the sticky layout from the CSS container query; ask the layout, not a width.
  const tocIsRail = () => getComputedStyle($('#mdv-toc-wrap')).position === 'sticky';
  function setupToc() {
    tocObserver?.disconnect();
    const toc = $('#mdv-toc');
    if (!toc) return;
    toc.open = tocIsRail();
    const links = new Map($$('a', toc).map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
    const heads = $$('#mdv-doc h2[id], #mdv-doc h3[id], #mdv-doc h4[id]').filter((h) => links.has(h.id));
    if (!heads.length || !('IntersectionObserver' in window)) return;
    const visible = new Set();
    tocObserver = new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target)));
      let current = heads.find((h) => visible.has(h));
      if (!current) {
        // Between headings: use the last one above the viewport.
        current = heads.filter((h) => h.getBoundingClientRect().top < 120).pop() || heads[0];
      }
      links.forEach((a) => a.classList.remove('active'));
      links.get(current.id)?.classList.add('active');
    }, { rootMargin: '-60px 0px -60% 0px' });
    heads.forEach((h) => tocObserver.observe(h));
  }
  let lastWide = null;
  new ResizeObserver(() => {
    const toc = $('#mdv-toc');
    if (!toc) return;
    const w = tocIsRail();
    if (w !== lastWide) { toc.open = w; lastWide = w; }
  }).observe($('#mdv-content'));

  // ---------- copy buttons ----------
  $('#mdv-doc').addEventListener('click', async (e) => {
    const btn = e.target.closest('.code-copy');
    if (!btn) return;
    const code = btn.closest('.code-block').querySelector('pre code');
    // Console blocks copy just the commands; prompts are CSS-only so they never get copied.
    const cmds = $$('.line.cmd, .line.cont', code);
    const text = $('.line.out', code) && cmds.length ? cmds.map((l) => l.textContent).join('\n') : code.textContent;
    try {
      await navigator.clipboard.writeText(text.replace(/\n$/, ''));
      btn.textContent = 'Copied';
    } catch {
      btn.textContent = 'Press ⌘C';
      const range = document.createRange();
      range.selectNodeContents(code);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    btn.classList.add('done');
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1600);
  });

  // ---------- fold long code blocks ----------
  const FOLD_AT = 30, FOLD_TO = 18;
  function setupFolds() {
    $$('#mdv-doc .code-block').forEach((block) => {
      const lines = Number(block.dataset.lines) || 0;
      if (lines <= FOLD_AT || block.querySelector('.code-more')) return;
      block.style.setProperty('--fold-lines', FOLD_TO);
      block.classList.add('is-folded');
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'code-more';
      more.textContent = `Show all ${lines} lines`;
      more.setAttribute('aria-expanded', 'false');
      more.addEventListener('click', () => {
        const folded = block.classList.toggle('is-folded');
        more.textContent = folded ? `Show all ${lines} lines` : 'Show less';
        more.setAttribute('aria-expanded', String(!folded));
        if (folded && block.getBoundingClientRect().top < 0) block.scrollIntoView({ block: 'start' });
      });
      block.append(more);
    });
  }

  // ---------- mermaid (loaded only when a page needs it) ----------
  let mermaidLoading = null;
  function loadMermaid() {
    if (window.mermaid) return Promise.resolve(window.mermaid);
    if (!mermaidLoading) {
      mermaidLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/_mdv/mermaid.min.js';
        s.onload = () => resolve(window.mermaid);
        s.onerror = () => reject(new Error('Could not load mermaid'));
        document.head.appendChild(s);
      });
    }
    return mermaidLoading;
  }

  function cssVar(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }
  function isDark() {
    const t = root.dataset.theme || 'auto';
    return DARK_THEMES.includes(t) || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  }

  // Renders are serialized: mermaid.run() isn't safe to overlap, and a quick
  // double theme switch would otherwise leave half-drawn diagrams.
  let mermaidBusy = null, mermaidAgain = false, mermaidSeq = 0;
  function renderMermaid() {
    if (mermaidBusy) { mermaidAgain = true; return mermaidBusy; }
    mermaidBusy = (async () => {
      do { mermaidAgain = false; await renderMermaidOnce(); } while (mermaidAgain);
      mermaidBusy = null;
    })();
    return mermaidBusy;
  }

  async function renderMermaidOnce() {
    const nodes = $$('#mdv-doc pre.mermaid');
    if (!nodes.length) return;
    nodes.forEach((n) => { if (n.dataset.src === undefined) n.dataset.src = n.textContent; });
    let mermaid;
    try {
      mermaid = await loadMermaid();
    } catch (err) {
      nodes.forEach((n) => { n.setAttribute('data-processed', 'true'); n.classList.add('mermaid-error'); });
      return;
    }
    const bg = cssVar('--bg'), fg = cssVar('--fg'), code = cssVar('--code-bg'), rule = cssVar('--rule-strong');
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: cssVar('--sans'),
      themeVariables: {
        darkMode: isDark(),
        background: bg,
        fontFamily: cssVar('--sans'),
        primaryColor: code,
        primaryTextColor: fg,
        primaryBorderColor: rule,
        secondaryColor: cssVar('--icode-bg'),
        tertiaryColor: bg,
        lineColor: cssVar('--muted'),
        textColor: fg,
        mainBkg: code,
        nodeBorder: rule,
        clusterBkg: bg,
        clusterBorder: rule,
        edgeLabelBackground: bg,
        noteBkgColor: cssVar('--icode-bg'),
        noteTextColor: fg,
        noteBorderColor: rule,
        actorBkg: code,
        actorBorder: rule,
        actorTextColor: fg,
        signalColor: fg,
        signalTextColor: fg,
        labelBoxBkgColor: code,
        labelTextColor: fg,
      },
    });
    // render() into a fresh id each time; re-running mermaid.run() on already
    // processed nodes leaves stale state behind and garbles the redraw.
    for (const n of nodes) {
      try {
        const { svg, bindFunctions } = await mermaid.render('mdv-mermaid-' + (++mermaidSeq), n.dataset.src);
        n.innerHTML = svg;
        bindFunctions?.(n);
        n.classList.remove('mermaid-error');
      } catch (err) {
        n.classList.add('mermaid-error');
        n.textContent = 'Mermaid: ' + (err && err.message ? err.message : err) + '\n\n' + n.dataset.src;
      }
      n.setAttribute('data-processed', 'true');
    }
  }

  // ---------- live reload ----------
  const live = $('#mdv-live');
  function connect() {
    if (!boot.file && !boot.root) return;
    const qs = new URLSearchParams();
    if (boot.file) qs.set('file', boot.file);
    if (boot.root) qs.set('root', boot.root);
    const es = new EventSource('/events?' + qs);
    es.addEventListener('open', () => { live.className = 'live on'; live.title = 'Live reload is on'; });
    es.addEventListener('error', () => {
      live.className = 'live off';
      // CLOSED means the server answered but refused (e.g. this browser isn't signed in to mdv).
      if (es.readyState === EventSource.CLOSED) {
        live.title = 'Live reload stopped. Run mdv again to reconnect.';
        toast('Live reload stopped. Run mdv again to reconnect.');
      } else {
        live.title = 'Reconnecting to mdv…';
      }
    });
    es.addEventListener('change', (e) => {
      const data = JSON.parse(e.data);
      const y = scrollY;
      const before = data.ok ? snapshot() : null;
      $('#mdv-doc').innerHTML = data.html;
      $('#mdv-toc-slot').innerHTML = data.toc;
      document.title = data.title;
      setupToc();
      setupFolds();
      setupSectionFolds();
      setupTables();
      updateReadTime();
      scrollTo(0, y);
      updateProgress();
      if (before) markChanges(before); else clearChanges();
      markRead();
      refreshLinks();
      if (data.hasMermaid) renderMermaid().then(() => scrollTo(0, y));
    });
    es.addEventListener('tree', (e) => {
      if (!sidebar) return;
      const data = JSON.parse(e.data);
      const q = $('#mdv-filter')?.value || '';
      const focused = document.activeElement?.id === 'mdv-filter';
      const top = sidebar.scrollTop;
      sidebar.innerHTML = data.html;
      const input = $('#mdv-filter');
      if (input) {
        input.value = q;
        if (focused) input.focus();
      }
      previewCache.clear();
      markUpdated();
      applyFilter();
      sidebar.scrollTop = top;
      buildDocNav();
      refreshLinks();
    });
  }

  // ---------- toast ----------
  const toastEl = $('#mdv-toast');
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  // ---------- reading time & progress ----------
  const readTime = $('#mdv-read-time');
  const progress = $('#mdv-progress');
  function updateReadTime() {
    if (!readTime) return;
    // Count prose only: code, diagrams and footnotes don't add reading time.
    let text = '';
    const walker = document.createTreeWalker($('#mdv-doc'), NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest('pre, .mermaid-block, .footnotes') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    while (walker.nextNode()) text += walker.currentNode.nodeValue + ' ';
    const words = (text.match(/\S+/g) || []).length;
    if (!boot.file || words < 60) { readTime.textContent = ''; return; }
    readTime.textContent = Math.max(1, Math.round(words / 230)) + ' min read';
    readTime.title = words.toLocaleString() + ' words';
  }
  let progressQueued = false;
  function updateProgress() {
    progressQueued = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    progress.style.setProperty('--progress', max > 40 ? Math.min(1, Math.max(0, scrollY / max)).toFixed(4) : '0');
  }
  addEventListener('scroll', () => {
    if (!progressQueued) { progressQueued = true; requestAnimationFrame(updateProgress); }
  }, { passive: true });
  addEventListener('resize', updateProgress);

  // ---------- previous / next file (folder mode) ----------
  function neighbors() {
    const links = sidebar ? $$('.tree-file a', sidebar) : [];
    const i = links.findIndex((a) => a.getAttribute('aria-current') === 'page');
    return i < 0 ? { prev: null, next: links[0] || null } : { prev: links[i - 1] || null, next: links[i + 1] || null };
  }
  function buildDocNav() {
    const nav = $('#mdv-doc-nav');
    nav.textContent = '';
    if (!boot.file || !sidebar) return;
    const { prev, next } = neighbors();
    const make = (a, cls, label) => {
      const el = document.createElement('a');
      el.href = a.href;
      el.className = cls;
      el.rel = cls;
      const small = document.createElement('small');
      small.textContent = label;
      const name = document.createElement('span');
      name.textContent = a.textContent;
      el.append(small, name);
      return el;
    };
    if (prev) nav.append(make(prev, 'prev', '← Previous'));
    if (next) nav.append(make(next, 'next', 'Next →'));
  }
  function go(which) {
    const target = neighbors()[which];
    if (target) location.href = target.href;
  }

  // ---------- open in editor / reveal in Finder ----------
  async function openIn(kind) {
    if (!boot.file) return;
    try {
      const r = await fetch('/api/' + kind, {
        method: 'POST',
        headers: { 'X-MDV': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: boot.file }),
      });
      toast(!r.ok ? 'Couldn’t open this file' : kind === 'edit' ? 'Opening in your editor…' : 'Showing in Finder…');
    } catch {
      toast('mdv isn’t running');
    }
  }
  $('#mdv-edit-btn')?.addEventListener('click', () => openIn('edit'));

  // ---------- help, image zoom, heading links ----------
  const help = $('#mdv-help');
  $('#mdv-help-btn').addEventListener('click', () => help.showModal());
  $('.help-head button', help).addEventListener('click', (e) => { e.preventDefault(); help.close(); });
  help.addEventListener('click', (e) => { if (e.target === help) help.close(); });

  const zoom = $('#mdv-zoom');
  const zoomImg = $('img', zoom);
  zoom.addEventListener('click', () => zoom.close());
  $('#mdv-doc').addEventListener('click', (e) => {
    const img = e.target.closest('img');
    if (img && !img.closest('a, .mermaid-block')) {
      zoomImg.src = img.currentSrc || img.src;
      zoomImg.alt = img.alt;
      zoom.showModal();
      return;
    }
    const anchor = e.target.closest('a.anchor');
    if (anchor && navigator.clipboard) {
      navigator.clipboard.writeText(location.origin + location.pathname + anchor.hash).then(() => toast('Link copied'), () => {});
    }
  });

  // ---------- ⌘K search ----------
  const searchDlg = $('#mdv-search');
  const sInput = $('#mdv-search-input');
  const sList = $('#mdv-search-results');
  let sResults = [];
  let sActive = 0;
  let sTimer = null;
  let sSeq = 0;
  const TYPE_LABEL = { file: 'File', heading: 'Section', text: 'Text', recent: 'Recent' };

  const esc = (str) => String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function highlight(text, terms) {
    let out = esc(text);
    for (const t of terms) {
      if (!t) continue;
      const re = new RegExp('(' + esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      out = out.replace(re, '<mark>$1</mark>');
    }
    return out;
  }

  function openSearch() {
    if (!searchDlg.open) searchDlg.showModal();
    sInput.focus();
    sInput.select();
    if (!sInput.value.trim()) renderSearch([], '');
  }

  function renderSearch(results, q) {
    sResults = results;
    sActive = 0;
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!q.trim()) {
      const hint = `<li class="search-empty">${boot.root ? 'Type to search every Markdown file in this folder.' : 'Type to search this document.'}</li>`;
      const recent = recentDocs().filter((r) => r.url !== location.pathname).slice(0, 8);
      sResults = recent;
      sList.innerHTML = recent.length
        ? '<li class="search-section" role="presentation">Recently opened</li>' + recent.map((r, i) =>
          `<li role="option" id="mdv-sr-${i}" class="sr sr-recent" aria-selected="${i === 0}">` +
          `<span class="sr-type">${TYPE_LABEL.recent}</span><span class="sr-main">${esc(r.title)}</span>` +
          `<span class="sr-sub">${esc(r.rel)}</span></li>`).join('')
        : hint;
      if (recent.length) sInput.setAttribute('aria-activedescendant', 'mdv-sr-0');
      return;
    }
    if (!results.length) {
      sList.innerHTML = `<li class="search-empty">No results for “${esc(q)}”</li>`;
      return;
    }
    sList.innerHTML = results.map((r, i) => {
      const main = r.type === 'heading' ? r.heading : r.type === 'text' ? r.snippet : r.title;
      const sub = r.type === 'heading' ? `${esc(r.title)} · ${esc(r.rel)}` : esc(r.rel);
      return `<li role="option" id="mdv-sr-${i}" class="sr sr-${r.type}" aria-selected="${i === 0}">` +
        `<span class="sr-type">${TYPE_LABEL[r.type]}</span>` +
        `<span class="sr-main">${highlight(main, terms)}</span>` +
        `<span class="sr-sub">${sub}</span></li>`;
    }).join('');
    sInput.setAttribute('aria-activedescendant', 'mdv-sr-0');
  }

  function setActive(i) {
    if (!sResults.length) return;
    sActive = (i + sResults.length) % sResults.length;
    $$('.sr', sList).forEach((li, n) => li.setAttribute('aria-selected', String(n === sActive)));
    const li = $(`#mdv-sr-${sActive}`);
    li?.scrollIntoView({ block: 'nearest' });
    sInput.setAttribute('aria-activedescendant', `mdv-sr-${sActive}`);
  }

  async function runSearch() {
    const q = sInput.value;
    const seq = ++sSeq;
    if (!q.trim()) return renderSearch([], '');
    const qs = new URLSearchParams({ q });
    if (boot.root) qs.set('root', boot.root);
    if (boot.file) qs.set('file', boot.file);
    try {
      const r = await fetch('/api/search?' + qs);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (seq === sSeq) renderSearch(data.results, q);
    } catch {
      if (seq === sSeq) sList.innerHTML = '<li class="search-empty">Search isn’t available. Run mdv again to reconnect.</li>';
    }
  }

  function openResult(r, newTab) {
    if (!r) return;
    const samePage = r.url === location.pathname;
    let hash = '';
    if (r.type === 'heading') hash = '#' + encodeURIComponent(r.id);
    else if (r.type === 'text') hash = '#mdv-find=' + encodeURIComponent(r.match + '\u0000' + r.snippet);
    if (newTab) return window.open(r.url + hash, '_blank', 'noopener');
    searchDlg.close();
    if (samePage && hash) {
      if (location.hash === hash) applyHash(); else location.hash = hash;
    } else {
      location.href = r.url + hash;
    }
  }

  sInput.addEventListener('input', () => { clearTimeout(sTimer); sTimer = setTimeout(runSearch, 110); });
  sInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(sActive + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(sActive - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); openResult(sResults[sActive], e.metaKey || e.ctrlKey); }
  });
  sList.addEventListener('mousemove', (e) => {
    const li = e.target.closest('.sr');
    if (li) { const i = Number(li.id.replace('mdv-sr-', '')); if (i !== sActive) setActive(i); }
  });
  sList.addEventListener('click', (e) => {
    const li = e.target.closest('.sr');
    if (li) openResult(sResults[Number(li.id.replace('mdv-sr-', ''))], e.metaKey || e.ctrlKey);
  });
  searchDlg.addEventListener('click', (e) => { if (e.target === searchDlg) searchDlg.close(); });
  $('#mdv-search-btn').addEventListener('click', openSearch);
  // ⌘K / Ctrl+K works everywhere, even while typing in the file filter.
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (searchDlg.open) searchDlg.close(); else openSearch();
    }
  }, true);

  // Text results jump to the exact spot: #mdv-find=<match>\0<snippet>. Whitespace is
  // normalised so the snippet still matches text split across lines and inline markup.
  // Returns { range, mark }: `range` covers the needle found, `mark` its first markLen chars.
  function findInDoc(needles, markLen) {
    const walker = document.createTreeWalker($('#mdv-doc'), NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest('.code-head, .anchor, .code-more') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let flat = '';
    const map = []; // flat index -> [text node, offset]
    let lastSpace = true;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const v = node.nodeValue;
      for (let i = 0; i < v.length; i++) {
        const space = /\s/.test(v[i]);
        if (space && lastSpace) continue;
        flat += space ? ' ' : v[i].toLowerCase();
        map.push([node, i]);
        lastSpace = space;
      }
    }
    const span = (from, len) => {
      const r = document.createRange();
      const [sn, so] = map[from];
      const [en, eo] = map[from + len - 1];
      r.setStart(sn, so);
      r.setEnd(en, eo + 1);
      return r;
    };
    for (const needle of needles) {
      const n = needle.replace(/\s+/g, ' ').trim().toLowerCase();
      const at = n ? flat.indexOf(n) : -1;
      if (at !== -1) return { range: span(at, n.length), mark: span(at, Math.min(markLen, n.length)) };
    }
    return null;
  }

  function applyHash() {
    if (!location.hash.startsWith('#mdv-find=')) return;
    let payload;
    try { payload = decodeURIComponent(location.hash.slice('#mdv-find='.length)); } catch { return; }
    history.replaceState(null, '', location.pathname + location.search);
    const [match, snip = ''] = payload.split('\u0000');
    // Use the match plus a few following words from the snippet to land on the right one.
    const core = snip.replace(/^…|…$/g, '');
    const i = core.toLowerCase().indexOf(match.toLowerCase());
    const context = i === -1 ? '' : core.slice(i, i + match.length + 40).replace(/\s+\S*$/, '');
    const found = findInDoc([context, match], match.replace(/\s+/g, ' ').trim().length);
    if (!found) return;
    revealInFolds(found.range.startContainer.parentElement);
    found.range.startContainer.parentElement.scrollIntoView({
      block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    if (window.CSS && CSS.highlights && window.Highlight) {
      CSS.highlights.set('mdv-find', new Highlight(found.mark));
      setTimeout(() => CSS.highlights.delete('mdv-find'), 2600);
    } else {
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(found.mark);
    }
  }
  addEventListener('hashchange', applyHash);

  // ---------- what changed on live reload ----------
  // Before a re-render, fingerprint each block (paragraph, heading, list item, table row…);
  // afterwards, blocks with no matching fingerprint are new or edited. They flash, keep a
  // margin mark, and the pill steps between them.
  const changesPill = $('#mdv-changes');
  const changesCount = $('#mdv-changes-count');
  let changed = [];
  let changeAt = -1;

  function units(doc) {
    const out = [];
    for (const el of doc.children) {
      if (el.matches('ul, ol')) out.push(...el.children);
      else if (el.matches('table')) out.push(...el.querySelectorAll('thead, tbody > tr'));
      else if (el.matches('section.footnotes')) out.push(...el.querySelectorAll('li'));
      else out.push(el);
    }
    return out;
  }
  function fingerprint(el) {
    if (el.matches('.mermaid-block')) { const pre = el.querySelector('pre.mermaid'); return 'mermaid:' + (pre?.dataset.src ?? pre?.textContent ?? '').trim(); }
    const text = el.matches('.code-block') ? el.querySelector('pre')?.textContent : el.textContent;
    return el.tagName + ':' + (text || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
  }
  function snapshot() {
    const counts = new Map();
    for (const u of units($('#mdv-doc'))) { const f = fingerprint(u); counts.set(f, (counts.get(f) || 0) + 1); }
    return counts;
  }
  function clearChanges() {
    changed.forEach((el) => el.classList.remove('mdv-changed', 'mdv-flash'));
    changed = [];
    changeAt = -1;
    changesPill.hidden = true;
  }
  function markChanges(before) {
    clearChanges();
    const after = units($('#mdv-doc'));
    for (const u of after) {
      const f = fingerprint(u);
      const n = before.get(f) || 0;
      if (n > 0) before.set(f, n - 1);
      else changed.push(u);
    }
    // Leftover old blocks are either edited (already counted as changes) or deleted;
    // only report what can't be an edit, so an edit doesn't also read as a removal.
    let leftover = 0;
    before.forEach((n) => { leftover += n; });
    const removed = Math.max(0, leftover - changed.length);
    if (!changed.length && !removed) return;
    changed.forEach((el) => el.classList.add('mdv-changed', 'mdv-flash'));
    setTimeout(() => changed.forEach((el) => el.classList.remove('mdv-flash')), 2400);
    const parts = [];
    if (changed.length) parts.push(`${changed.length} ${changed.length === 1 ? 'change' : 'changes'}`);
    if (removed) parts.push(`${removed} removed`);
    changesCount.textContent = parts.join(' · ');
    changesPill.querySelectorAll('[data-step]').forEach((b) => { b.hidden = !changed.length; });
    changesPill.hidden = false;
  }
  function stepChange(dir) {
    if (!changed.length) return;
    changeAt = (changeAt + dir + changed.length) % changed.length;
    const el = changed[changeAt];
    revealInFolds(el);
    el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.classList.remove('mdv-flash');
    void el.offsetWidth; // restart the flash
    el.classList.add('mdv-flash');
    changesCount.textContent = `${changeAt + 1} of ${changed.length}`;
  }
  changesPill.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.close !== undefined) clearChanges();
    else stepChange(Number(b.dataset.step));
  });

  // ---------- resume reading + recently opened ----------
  const MAX_POSITIONS = 150;
  function readJSON(key, fallback) { try { return JSON.parse(store.get(key) || '') || fallback; } catch { return fallback; } }
  function recentDocs() { return readJSON('recent', []); }

  function rememberRecent() {
    if (!boot.file) return;
    const decoded = decodeURIComponent(location.pathname).replace(/^\/view/, '');
    const rel = boot.root && decoded.startsWith(boot.root + '/') ? decoded.slice(boot.root.length + 1) : decoded.split('/').slice(-2).join('/');
    const list = recentDocs().filter((r) => r.url !== location.pathname);
    list.unshift({ url: location.pathname, title: document.title, rel });
    store.set('recent', JSON.stringify(list.slice(0, 15)));
  }

  let posTimer = null;
  function savePosition() {
    if (!boot.file) return;
    const all = readJSON('pos', {});
    all[location.pathname] = { y: Math.round(scrollY), t: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > MAX_POSITIONS) keys.sort((a, b) => all[a].t - all[b].t).slice(0, keys.length - MAX_POSITIONS).forEach((k) => delete all[k]);
    store.set('pos', JSON.stringify(all));
  }
  addEventListener('scroll', () => { clearTimeout(posTimer); posTimer = setTimeout(savePosition, 400); }, { passive: true });
  addEventListener('pagehide', savePosition);

  function resumePosition() {
    // Only on a fresh visit: reloads and back/forward already restore scroll themselves,
    // and links to a section or a search hit should land there instead.
    const nav = performance.getEntriesByType('navigation')[0];
    if (!boot.file || location.hash || (nav && nav.type !== 'navigate')) return;
    const saved = readJSON('pos', {})[location.pathname];
    if (!saved || saved.y < 300) return;
    const go = () => scrollTo(0, saved.y);
    go();
    requestAnimationFrame(go);
    setTimeout(go, 350); // after fonts and diagrams settle
    toast('Picked up where you left off');
  }

  // ---------- backlinks and broken links ----------
  const backlinksEl = $('#mdv-backlinks');
  let linkSeq = 0;
  async function refreshLinks() {
    if (!boot.file) return;
    const seq = ++linkSeq;
    let data;
    try {
      const r = await fetch('/api/links?' + new URLSearchParams({ file: boot.file }));
      if (!r.ok) return;
      data = await r.json();
    } catch { return; }
    if (seq !== linkSeq) return;

    if (data.backlinks.length) {
      backlinksEl.innerHTML = `<h2 class="bl-title">Linked from <span>${data.backlinks.length}</span></h2><ul>` +
        data.backlinks.map((b) => `<li><a href="${esc(b.url)}"><span class="bl-name">${esc(b.title)}</span>` +
          `<span class="bl-rel">${esc(b.rel)}</span></a>${b.snippet ? `<p>${esc(b.snippet)}</p>` : ''}</li>`).join('') + '</ul>';
      backlinksEl.hidden = false;
    } else {
      backlinksEl.hidden = true;
      backlinksEl.textContent = '';
    }

    const broken = new Map(data.broken.map((b) => [b.href, b.reason]));
    $$('#mdv-doc a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      let reason = broken.get(href);
      // Same-page jumps are checked here, against the ids actually on the page.
      if (!reason && href.startsWith('#') && href.length > 1 && !a.matches('.anchor, [data-footnote-ref], [data-footnote-backref]')) {
        let id = href.slice(1);
        try { id = decodeURIComponent(id); } catch { /* as written */ }
        if (!document.getElementById(id)) reason = 'Heading not found';
      }
      a.classList.toggle('link-broken', !!reason);
      if (reason) a.title = `${reason}: ${href}`;
    });
  }
  // Broken images get a visible outline instead of a silent gap.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.closest('#mdv-doc')) {
      img.classList.add('img-broken');
      img.title = 'Image not found: ' + img.getAttribute('src');
    }
  }, true);

  // ---------- section folding ----------
  // Fold a section by hiding the blocks between its heading and the next heading of the same
  // or higher level. The DOM isn't restructured, so live-reload diffs and the TOC still work.
  const foldedIds = new Set();
  let foldAnchor = null; // heading kept in place by fold-all, reused when unfolding
  const CHEVRON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 6.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const foldable = () => $$('#mdv-doc > :is(h2, h3, h4)');
  function sectionOf(h) {
    const level = Number(h.tagName[1]);
    const out = [];
    for (let el = h.nextElementSibling; el; el = el.nextElementSibling) {
      if (/^H[1-6]$/.test(el.tagName) && Number(el.tagName[1]) <= level) break;
      out.push(el);
    }
    return out;
  }
  function applyFolds() {
    $$('#mdv-doc > .fold-hidden').forEach((el) => el.classList.remove('fold-hidden'));
    foldable().filter((h) => h.classList.contains('is-folded')).forEach((h) => sectionOf(h).forEach((el) => el.classList.add('fold-hidden')));
    updateProgress();
  }
  function setFold(h, fold) {
    h.classList.toggle('is-folded', fold);
    $('.fold-btn', h)?.setAttribute('aria-expanded', String(!fold));
    if (h.id) { if (fold) foldedIds.add(h.id); else foldedIds.delete(h.id); }
  }
  function setupSectionFolds() {
    foldable().forEach((h) => {
      if (!$('.fold-btn', h)) {
        h.insertAdjacentHTML('afterbegin', `<button type="button" class="fold-btn" aria-expanded="true" aria-label="Fold section" title="Fold section  f">${CHEVRON}</button>`);
      }
      setFold(h, foldedIds.has(h.id)); // keep folds across live reloads
    });
    applyFolds();
  }
  // Unfold whatever hides `el` (a search hit, a TOC jump, a change).
  function revealInFolds(el) {
    const block = el && el.closest('#mdv-doc > *');
    if (!block) return;
    let changedFold = false;
    for (const h of foldable()) {
      if (h.classList.contains('is-folded') && (h === block || sectionOf(h).includes(block)) && h !== block) { setFold(h, false); changedFold = true; }
    }
    if (changedFold) applyFolds();
  }
  function currentHeading() {
    return foldable().filter((h) => !h.closest('.fold-hidden') && !h.classList.contains('fold-hidden') && h.getBoundingClientRect().top < 140).pop() || foldable()[0];
  }
  // Run a fold change while keeping `el` at the same spot on screen, so the heading you
  // clicked never jumps; only the content below it opens or closes.
  function keepInPlace(el, change) {
    const before = el.getBoundingClientRect().top;
    change();
    const after = el.getBoundingClientRect().top;
    if (after !== before) scrollBy(0, after - before);
  }
  function toggleFold(h) {
    keepInPlace(h, () => {
      setFold(h, !h.classList.contains('is-folded'));
      applyFolds();
    });
  }
  function toggleCurrentFold() {
    const h = currentHeading();
    if (!h) return;
    toggleFold(h);
    if (h.getBoundingClientRect().top < 0) h.scrollIntoView({ block: 'start' });
  }
  function toggleAllFolds() {
    const heads = foldable();
    const fold = !heads.some((h) => h.classList.contains('is-folded'));
    // Folding all keeps the top-level sections visible as an outline.
    const top = Math.min(...heads.map((h) => Number(h.tagName[1])));
    // Anchor on a top-level heading (they stay visible either way): when folding, the one on
    // screen nearest where you're reading; when unfolding, the same one, so it doesn't move.
    const level = (h) => Number(h.tagName[1]);
    const tops = heads.filter((h) => level(h) === top);
    const onScreen = tops.filter((h) => { const y = h.getBoundingClientRect().top; return y >= 0 && y < innerHeight; });
    const reading = innerHeight / 3;
    let anchor = !fold && foldAnchor && document.contains(foldAnchor) ? foldAnchor : null;
    if (!anchor) {
      anchor = onScreen.sort((a, b) => Math.abs(a.getBoundingClientRect().top - reading) - Math.abs(b.getBoundingClientRect().top - reading))[0]
        || tops.filter((h) => h.getBoundingClientRect().top < 0).pop() || tops[0];
    }
    foldAnchor = fold ? anchor : null;
    keepInPlace(anchor, () => {
      heads.forEach((h) => setFold(h, fold && level(h) === top));
      applyFolds();
    });
    toast(fold ? 'Folded all sections · F to unfold' : 'Unfolded all sections');
  }
  $('#mdv-doc').addEventListener('click', (e) => {
    const btn = e.target.closest('.fold-btn');
    if (!btn) return;
    e.preventDefault();
    toggleFold(btn.parentElement);
  });
  function revealHash() {
    if (!location.hash || location.hash.startsWith('#mdv-find=')) return;
    let id = location.hash.slice(1);
    try { id = decodeURIComponent(id); } catch { /* as written */ }
    const el = document.getElementById(id);
    if (el && el.closest('#mdv-doc') && (el.classList.contains('fold-hidden') || el.closest('.fold-hidden'))) {
      revealInFolds(el);
      el.scrollIntoView({ block: 'start' });
    }
  }
  addEventListener('hashchange', revealHash);

  // ---------- focus mode ----------
  function setFocus(on) {
    if (on) root.dataset.focus = 'on';
    else { delete root.dataset.focus; delete root.dataset.focusBar; }
    if (on) toast('Focus mode · z or Esc to leave');
  }
  document.addEventListener('mousemove', (e) => {
    if (!root.dataset.focus) return;
    if (e.clientY < 56) root.dataset.focusBar = 'show';
    else if (e.clientY > 140 && !e.target.closest('.bar, .settings')) delete root.dataset.focusBar;
  }, { passive: true });

  // ---------- sortable tables ----------
  // Click a header to sort ascending, again for descending, a third time for the original order.
  const tableSorts = new Map(); // table index -> { col, dir }
  function cellValue(row, col) {
    const text = (row.cells[col]?.textContent || '').trim();
    const num = text.replace(/[,\s%$€£¥]/g, '');
    return { text, num: /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(num) ? parseFloat(num) : null };
  }
  function sortTable(table, index, col, dir) {
    const body = table.tBodies[0];
    const rows = [...body._mdvOrder];
    if (dir) {
      rows.sort((a, b) => {
        const x = cellValue(a, col);
        const y = cellValue(b, col);
        const r = x.num !== null && y.num !== null ? x.num - y.num
          : x.text.localeCompare(y.text, undefined, { numeric: true, sensitivity: 'base' });
        return dir === 'asc' ? r : -r;
      });
      tableSorts.set(index, { col, dir });
    } else {
      tableSorts.delete(index);
    }
    body.append(...rows);
    $$('thead th', table).forEach((th, i) => th.setAttribute('aria-sort', i === col && dir ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'));
  }
  function setupTables() {
    $$('#mdv-doc table').forEach((table, index) => {
      const heads = $$('thead th', table);
      if (!heads.length || !table.tBodies[0] || table.tBodies[0].rows.length < 2) return;
      table.tBodies[0]._mdvOrder = [...table.tBodies[0].rows];
      heads.forEach((th) => {
        th.classList.add('sortable');
        th.tabIndex = 0;
        th.setAttribute('aria-sort', 'none');
        th.title = 'Sort by this column';
      });
      const saved = tableSorts.get(index);
      if (saved) sortTable(table, index, saved.col, saved.dir);
    });
  }
  function onSortHeader(th) {
    const table = th.closest('table');
    const index = $$('#mdv-doc table').indexOf(table);
    const col = [...th.parentElement.children].indexOf(th);
    const cur = th.getAttribute('aria-sort');
    sortTable(table, index, col, cur === 'ascending' ? 'desc' : cur === 'descending' ? null : 'asc');
  }
  $('#mdv-doc').addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable');
    if (th) onSortHeader(th);
  });
  $('#mdv-doc').addEventListener('keydown', (e) => {
    const th = e.target.closest('th.sortable');
    if (th && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSortHeader(th); }
  });

  // ---------- link hover previews ----------
  // Hover (or focus) a link to another Markdown file or to a heading, and a card shows that
  // section or the document's opening. Other files come from /api/preview, which applies the
  // same access checks as opening the page; the excerpt is cut out here with DOMParser.
  const previewEl = $('#mdv-preview');
  const previewCache = new Map(); // view URL -> Promise<{ title, doc }>
  const hoverCapable = matchMedia('(hover: hover)').matches;
  let previewTimer = null;
  let previewHide = null;
  let previewFor = null;

  function previewTarget(a) {
    if (!a || a.closest('.anchor, .fold-btn') || a.matches('[data-footnote-ref], [data-footnote-backref], .link-broken')) return null;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) return href.length > 1 ? { url: location.pathname, hash: href.slice(1), same: true } : null;
    let u;
    try { u = new URL(a.href); } catch { return null; }
    if (u.origin !== location.origin || !u.pathname.startsWith('/view/') || !/\.(md|markdown|mdown|mkdn?|mdx)$/i.test(u.pathname)) return null;
    return { url: u.pathname, hash: u.hash.slice(1), same: u.pathname === location.pathname };
  }

  function loadPreview(url) {
    if (!previewCache.has(url)) {
      const file = decodeURIComponent(url.slice('/view'.length));
      previewCache.set(url, fetch('/api/preview?' + new URLSearchParams({ file }))
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d) => ({ title: d.title, doc: new DOMParser().parseFromString(`<div>${d.html}</div>`, 'text/html').body.firstChild }))
        .catch((e) => { previewCache.delete(url); throw e; }));
    }
    return previewCache.get(url);
  }

  // Up to ~700 characters of blocks: a heading's section, or the opening of a document.
  function excerpt(root, hash) {
    let start = null;
    let level = 7;
    let heading = '';
    if (hash) {
      let id = hash;
      try { id = decodeURIComponent(hash); } catch { /* as written */ }
      start = root.querySelector(`[id="${CSS.escape(id)}"]`);
      if (!start) return null;
      if (/^H[1-6]$/.test(start.tagName)) {
        level = Number(start.tagName[1]);
        heading = start.textContent.replace(/#$/, '').trim();
        start = start.nextElementSibling;
      } else {
        return { heading: '', blocks: [start.cloneNode(true)] };
      }
    } else {
      // A whole document: its opening, continuing past sub-headings until the card is full.
      level = 1;
      start = root.firstElementChild;
      while (start && (start.matches('h1, header.doc-meta'))) start = start.nextElementSibling;
    }
    const blocks = [];
    let chars = 0;
    for (let el = start; el && chars < 700 && blocks.length < 5; el = el.nextElementSibling) {
      if (/^H[1-6]$/.test(el.tagName) && Number(el.tagName[1]) <= level) break;
      if (el.matches('section.footnotes')) break;
      blocks.push(el.cloneNode(true));
      chars += el.textContent.length;
    }
    return { heading, blocks };
  }

  function placePreview(a) {
    const r = a.getBoundingClientRect();
    previewEl.style.left = '0px';
    previewEl.style.top = '0px';
    const w = previewEl.offsetWidth;
    const h = previewEl.offsetHeight;
    const left = Math.max(12, Math.min(r.left, innerWidth - w - 12));
    const below = r.bottom + 8;
    const top = below + h < innerHeight - 8 || r.top - h - 8 < 8 ? below : r.top - h - 8;
    previewEl.style.left = left + 'px';
    previewEl.style.top = Math.max(8, top) + 'px';
  }

  async function showPreview(a) {
    const t = previewTarget(a);
    if (!t) return;
    previewFor = a;
    let title;
    let root;
    try {
      if (t.same) { root = $('#mdv-doc'); title = document.title; }
      else ({ title, doc: root } = await loadPreview(t.url));
    } catch { return; }
    if (previewFor !== a) return;
    const ex = excerpt(root, t.hash);
    if (!ex || (!ex.blocks.length && !ex.heading)) return;
    const base = new URL(t.url, location.origin);
    const body = document.createElement('div');
    body.className = 'preview-body prose';
    ex.blocks.forEach((b) => body.append(b));
    // Clean the copy: no ids to clash with this page, no controls, and links/images resolved
    // against the previewed file rather than this page.
    body.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    body.querySelectorAll('.anchor, .fold-btn, .code-copy, .code-more, script, style').forEach((el) => el.remove());
    body.querySelectorAll('.mermaid-block').forEach((el) => { el.replaceWith(Object.assign(document.createElement('p'), { className: 'preview-note', textContent: 'Diagram' })); });
    body.querySelectorAll('.fold-hidden, .mdv-changed, .mdv-flash').forEach((el) => el.classList.remove('fold-hidden', 'mdv-changed', 'mdv-flash'));
    body.querySelectorAll('img[src]').forEach((img) => { img.src = new URL(img.getAttribute('src'), base).href; });
    body.querySelectorAll('a[href]').forEach((link) => { if (!link.getAttribute('href').startsWith('#')) link.href = new URL(link.getAttribute('href'), base).href; });
    const where = t.same ? '' : decodeURIComponent(t.url).split('/').slice(-2).join('/');
    previewEl.innerHTML = `<div class="preview-head"><span class="preview-title">${esc(ex.heading || title)}</span>` +
      (ex.heading && !t.same ? `<span class="preview-where">${esc(title)}</span>` : where ? `<span class="preview-where">${esc(where)}</span>` : '') + '</div>';
    if (ex.blocks.length) previewEl.append(body);
    previewEl.hidden = false;
    placePreview(a);
  }

  function hidePreview(now) {
    clearTimeout(previewTimer);
    clearTimeout(previewHide);
    const go = () => { previewEl.hidden = true; previewFor = null; };
    if (now) go(); else previewHide = setTimeout(go, 180);
  }

  if (hoverCapable) {
    $('#mdv-doc').addEventListener('mouseover', (e) => {
      const a = e.target.closest('a[href]');
      if (!a || a === previewFor || !previewTarget(a)) return;
      clearTimeout(previewTimer);
      clearTimeout(previewHide);
      previewTimer = setTimeout(() => showPreview(a), 350);
    });
    $('#mdv-doc').addEventListener('mouseout', (e) => {
      const a = e.target.closest('a[href]');
      if (a && !a.contains(e.relatedTarget)) { clearTimeout(previewTimer); if (previewFor) hidePreview(); }
    });
    previewEl.addEventListener('mouseenter', () => clearTimeout(previewHide));
    previewEl.addEventListener('mouseleave', () => hidePreview());
  }
  $('#mdv-doc').addEventListener('focusin', (e) => {
    const a = e.target.closest('a[href]');
    if (a && previewTarget(a)) { clearTimeout(previewTimer); previewTimer = setTimeout(() => showPreview(a), 350); }
  });
  $('#mdv-doc').addEventListener('focusout', () => hidePreview(true));
  addEventListener('scroll', () => { if (!previewEl.hidden) hidePreview(true); }, { passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !previewEl.hidden) hidePreview(true); });

  // ---------- keyboard ----------
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t.closest && t.closest('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('dialog[open]')) return; // Esc closes dialogs natively
    if (!settings.hidden && e.target.closest('#mdv-settings')) return;
    // Some keyboard layouts report Shift+/ as '/' with shiftKey rather than '?'.
    const key = e.key === '/' && e.shiftKey ? '?' : e.key;
    switch (key) {
      case 't': cycleTheme(); break;
      case '[': toggleSidebar(); break;
      case '/': {
        const input = $('#mdv-filter');
        if (!input) return;
        e.preventDefault();
        toggleSidebar(true);
        input.focus();
        input.select();
        break;
      }
      case 'n': go('next'); break;
      case 'c': stepChange(1); break;
      case 'f': toggleCurrentFold(); break;
      case 'F': toggleAllFolds(); break;
      case 'z': setFocus(!root.dataset.focus); break;
      case 'C': stepChange(-1); break;
      case 'p': go('prev'); break;
      case 'e': openIn('edit'); break;
      case 'r': openIn('reveal'); break;
      case '?': help.showModal(); break;
      case 's': openSettings(); break;
      case '+': case '=': changeSize(1); break;
      case '-': case '_': changeSize(-1); break;
      case 'Escape': if (root.dataset.focus) setFocus(false); else if (narrow.matches) toggleSidebar(false); break;
      default: return;
    }
  });

  setupToc();
  setupFolds();
  setupSectionFolds();
  setupTables();
  updateReadTime();
  updateProgress();
  buildDocNav();
  revealHash();
  applyHash();
  rememberRecent();
  markRead();
  markUpdated();
  resumePosition();
  refreshLinks();
  if (boot.hasMermaid) renderMermaid();
  connect();
})();
