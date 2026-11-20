// ==UserScript==
// @name         Canvas A11y Flagger
// @namespace    https://github.com/Stealthmoosegoose/tampermonkey-public
// @version      1.3.0
// @description  Flags heading hierarchy problems, missing or file-name alt text, vague links, header-less tables and untitled iframes on Canvas pages, the Modules page and the Pages list.
// @author       Michael Douglas
// @homepageURL  https://github.com/Stealthmoosegoose/tampermonkey-public/tree/main/canvas-a11y-flagger
// @supportURL   https://github.com/Stealthmoosegoose/tampermonkey-public/issues
// @downloadURL  https://raw.githubusercontent.com/Stealthmoosegoose/tampermonkey-public/main/canvas-a11y-flagger/canvas-a11y-flagger.user.js
// @updateURL    https://raw.githubusercontent.com/Stealthmoosegoose/tampermonkey-public/main/canvas-a11y-flagger/canvas-a11y-flagger.user.js
// @match        https://courses.online.umich.edu/courses/*
// @match        https://canvas.umich.edu/courses/*
// @match        https://*.instructure.com/courses/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// One file serves both installs: Tampermonkey runs it on page load, and the bookmarklet
// (see index.html) sets window.__a11yfOnDemand and loads this same file from GitHub Pages.
// Tampermonkey only offers an update when @version goes up, so bump it with every change.

(() => {
  'use strict';
  const ON_DEMAND = window.__a11yfOnDemand === true; // true when run from the bookmarklet
  window.__a11yfOnDemand = false;

  /* ------------------------------------------------------------------ */
  /* Config                                                              */
  /* ------------------------------------------------------------------ */
  const ALT_MAX = 150;
  const VAGUE_LINKS = ['click here', 'here', 'click', 'read more', 'more', 'learn more',
    'link', 'this link', 'this', 'go', 'details', 'view', 'download'];
  const GENERIC_ALT = ['image', 'picture', 'photo', 'graphic', 'img', 'icon', 'logo',
    'screenshot', 'figure', 'chart', 'diagram', 'banner'];

  /* ------------------------------------------------------------------ */
  /* Checks                                                              */
  /* ------------------------------------------------------------------ */
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function looksLikeFilename(alt) {
    const a = alt.trim();
    if (/\.(png|jpe?g|gif|svg|webp|bmp|tiff?|heic|avif|pdf)\b/i.test(a)) return true;
    if (/^(img|dsc|dcim|pxl|screenshot|screen ?shot|image|photo|pic|untitled|capture|scan)[\s_-]*\d/i.test(a)) return true;
    if (!/\s/.test(a) && /[_-]/.test(a) && a.length > 4) return true; // hero_banner_v2, week-3-diagram
    return false;
  }

  function visibleText(node) {
    const c = node.cloneNode(true);
    c.querySelectorAll('.screenreader-only, .external_link_icon, .ui-icon').forEach(n => n.remove());
    return (c.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function checkContent(root, { title = '' } = {}) {
    const issues = [];
    const add = (sev, msg, el) => issues.push({ sev, msg, el });
    const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();

    // Headings — the page title is the one expected H1; everything else should nest under it
    let prev = 1;
    let titleSeen = false;
    [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].forEach((h, idx) => {
      const lvl = +h.tagName[1];
      const text = visibleText(h);
      const label = text ? `“${trunc(text, 40)}”` : '(empty)';
      if (lvl === 1) {
        const isTitle = h.classList.contains('page-title') || (title && norm(text) === norm(title)) || idx === 0;
        if (isTitle && !titleSeen) { titleSeen = true; prev = 1; return; }
        add('error', `Extra H1 at ${label}. A page should have one H1, the title`, h);
        prev = 1;
        return;
      }
      if (!text && !h.querySelector('img[alt]:not([alt=""])')) add('error', `Empty H${lvl} heading`, h);
      if (lvl > prev + 1) add('error', `Skipped heading level: H${prev} to H${lvl} at ${label}`, h);
      prev = lvl;
    });

    // Images
    root.querySelectorAll('img').forEach(img => {
      if (img.closest('.MathJax, .math_equation_latex') || img.classList.contains('equation_image')) return;
      const decorative = img.getAttribute('role') === 'presentation' || img.getAttribute('aria-hidden') === 'true';
      if (!img.hasAttribute('alt')) {
        if (!decorative) add('error', 'Image has no alt text', img);
        return;
      }
      const alt = img.getAttribute('alt').trim();
      if (!alt) {
        if (img.closest('a')) add('error', 'Linked image has empty alt text, so the link has no name', img);
        else if (!decorative) add('warning', 'Empty alt text: confirm the image is decorative', img);
        return;
      }
      if (looksLikeFilename(alt)) add('error', `Alt text looks like a file name: “${trunc(alt, 40)}”`, img);
      else if (GENERIC_ALT.includes(alt.toLowerCase())) add('warning', `Generic alt text: “${alt}”`, img);
      else if (/^(an? )?(image|picture|photo|graphic) of\b/i.test(alt))
        add('warning', `Alt starts with “${alt.match(/^.*? of/i)[0]}”. Screen readers already say “image”`, img);
      if (alt.length > ALT_MAX) add('warning', `Alt text is ${alt.length} characters. Consider a caption or long description`, img);
    });

    // Links
    root.querySelectorAll('a[href]').forEach(a => {
      if (a.closest('h1,h2,h3,h4,h5,h6') && !visibleText(a)) return; // anchor targets
      const imgAlt = [...a.querySelectorAll('img')].map(i => i.getAttribute('alt') || '').join(' ').trim();
      const name = (a.getAttribute('aria-label') || visibleText(a) || imgAlt).trim();
      const norm = name.toLowerCase().replace(/[.:!…]+$/, '');
      if (!name) { if (!a.querySelector('img')) add('error', 'Link has no text', a); }
      else if (VAGUE_LINKS.includes(norm)) add('warning', `Vague link text: “${name}”`, a);
      else if (/^https?:\/\//i.test(name) && name.length > 40) add('warning', `Raw URL used as link text: “${trunc(name, 40)}”`, a);
    });

    // Tables
    root.querySelectorAll('table').forEach((t, i) => {
      if (t.getAttribute('role') === 'presentation') return;
      if (!t.querySelector('th')) add('warning', `Table ${i + 1} has no header cells`, t);
    });

    // Iframes (video embeds, LTI tools)
    root.querySelectorAll('iframe').forEach(f => {
      if (!(f.getAttribute('title') || '').trim()) add('warning', 'Embedded frame has no title', f);
    });

    return issues;
  }

  function checkHTML(html, title = '') {
    const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
    return checkContent(doc.body, { title });
  }

  const counts = issues => ({
    e: issues.filter(i => i.sev === 'error').length,
    w: issues.filter(i => i.sev === 'warning').length,
  });

  /* ------------------------------------------------------------------ */
  /* Canvas API                                                          */
  /* ------------------------------------------------------------------ */
  async function getAll(url) {
    let out = [];
    while (url) {
      const r = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`${r.status} on ${url}`);
      const txt = (await r.text()).replace(/^while\(1\);/, '');
      out = out.concat(JSON.parse(txt));
      const next = (r.headers.get('Link') || '').split(',').find(p => /rel="next"/.test(p));
      url = next ? next.match(/<([^>]+)>/)[1] : null;
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* UI                                                                  */
  /* ------------------------------------------------------------------ */
  function injectCSS() {
    if (document.getElementById('a11yf-css')) return;
    const s = document.createElement('style');
    s.id = 'a11yf-css';
    s.textContent = `
      .a11yf-badge{display:inline-block;margin-left:8px;padding:1px 7px;border-radius:9px;font:600 11px/16px system-ui,sans-serif;vertical-align:middle;white-space:nowrap}
      button.a11yf-badge{cursor:pointer}
      button.a11yf-badge:hover{filter:brightness(.95)}
      button.a11yf-badge:focus-visible,.a11yf-pop a:focus-visible{outline:3px solid #2b6cb0;outline-offset:2px}
      .a11yf-pop{position:fixed;z-index:100000;width:min(380px,calc(100vw - 16px));max-height:50vh;overflow:auto;padding:12px 14px;background:#fff;color:#222;border:1px solid #ccc;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.2);font:13px/1.45 system-ui,sans-serif}
      .a11yf-pop:focus{outline:none}
      .a11yf-pop h3{margin:0 0 8px;font-size:14px}
      .a11yf-pop p{margin:0}
      .a11yf-pop ul{list-style:none;margin:0 0 10px;padding:0}
      .a11yf-pop li{display:flex;gap:8px;align-items:flex-start;padding:4px 0}
      .a11yf-pop .a11yf-sev{margin-left:0}
      .a11yf-pop a{font-weight:600}
      .a11yf-err{background:#fde8e8;color:#9b1c1c;border:1px solid #f5b5b5}
      .a11yf-warn{background:#fff4d6;color:#7a4b00;border:1px solid #f0d28a}
      .a11yf-ok{background:#e6f4ea;color:#1e6b34;border:1px solid #b5dcc0}
      #a11yf-root{position:fixed;right:16px;bottom:16px;z-index:99999;font:14px/1.4 system-ui,sans-serif}
      #a11yf-toggle{border:0;border-radius:20px;padding:8px 14px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)}
      #a11yf-toggle:focus-visible,.a11yf-row:focus-visible,#a11yf-close:focus-visible{outline:3px solid #2b6cb0;outline-offset:2px}
      .a11yf-panel{position:absolute;right:0;bottom:48px;width:min(420px,calc(100vw - 32px));max-height:60vh;overflow:auto;background:#fff;color:#222;border:1px solid #ccc;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.2)}
      .a11yf-head{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #e5e5e5;position:sticky;top:0;background:#fff}
      .a11yf-head h2{margin:0;font-size:15px}
      #a11yf-close{border:0;background:none;font-size:18px;cursor:pointer;color:#555}
      .a11yf-list{list-style:none;margin:0;padding:4px 0}
      .a11yf-row{display:flex;gap:8px;align-items:flex-start;width:100%;text-align:left;padding:8px 12px;border:0;background:none;color:inherit;font:inherit;cursor:pointer;text-decoration:none}
      .a11yf-row:hover{background:#f4f6f8}
      .a11yf-sev{flex:none;margin-top:2px}
      .a11yf-empty{padding:12px}
      .a11yf-hl-error{outline:3px dashed #c81e1e!important;outline-offset:2px}
      .a11yf-hl-warning{outline:3px dashed #d69e00!important;outline-offset:2px}
      .a11yf-flash{animation:a11yf-flash 1.2s ease 2}
      @keyframes a11yf-flash{50%{outline-color:#2b6cb0}}
      @media (prefers-reduced-motion:reduce){.a11yf-flash{animation:none}}
    `;
    document.head.appendChild(s);
  }

  function badge(issues, { title = '', href = '' } = {}) {
    const { e, w } = counts(issues);
    const n = e + w;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'a11yf-badge ' + (e ? 'a11yf-err' : w ? 'a11yf-warn' : 'a11yf-ok');
    b.textContent = n ? `${n} issue${n === 1 ? '' : 's'}` : 'No issues';
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-label', n ? `Accessibility: ${e} error${e === 1 ? '' : 's'}, ${w} to check. Show details` : 'Accessibility: no issues found');
    b.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      showPopover(b, issues, title, href);
    });
    return b;
  }

  let pop = null;
  function closePopover(refocus = false) {
    if (!pop) return;
    pop.anchor.setAttribute('aria-expanded', 'false');
    pop.el.remove();
    if (refocus) pop.anchor.focus();
    pop = null;
  }

  function showPopover(anchor, issues, title, href) {
    if (pop && pop.anchor === anchor) return closePopover();
    closePopover();
    const el = document.createElement('div');
    el.className = 'a11yf-pop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', `Accessibility issues: ${title}`);
    el.tabIndex = -1;

    const h = document.createElement('h3');
    h.textContent = title || 'Accessibility issues';
    el.appendChild(h);

    if (!issues.length) {
      const p = document.createElement('p');
      p.textContent = 'No issues found by these checks.';
      el.appendChild(p);
    } else {
      const ul = document.createElement('ul');
      issues.forEach(i => {
        const li = document.createElement('li');
        li.append(sevPill(i.sev), document.createTextNode(i.msg));
        ul.appendChild(li);
      });
      el.appendChild(ul);
      if (href) {
        const a = document.createElement('a');
        a.href = withFlag(href);
        a.textContent = ON_DEMAND ? 'Open page (click the bookmarklet there to highlight issues)' : 'Open page with issues highlighted';
        el.appendChild(a);
      }
    }

    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const pw = el.offsetWidth, ph = el.offsetHeight;
    const below = r.bottom + 6 + ph < innerHeight;
    el.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - 6 - ph)}px`;
    el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pw - 8))}px`;
    anchor.setAttribute('aria-expanded', 'true');
    pop = { el, anchor };
    el.focus();
  }

  document.addEventListener('click', ev => { if (pop && !pop.el.contains(ev.target)) closePopover(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && pop) closePopover(true); });
  window.addEventListener('scroll', ev => { if (pop && !pop.el.contains(ev.target)) closePopover(); }, true);

  function sevPill(sev) {
    const p = document.createElement('span');
    p.className = 'a11yf-badge a11yf-sev ' + (sev === 'error' ? 'a11yf-err' : 'a11yf-warn');
    p.textContent = sev === 'error' ? 'Error' : 'Check';
    return p;
  }

  // rows: [{sev, msg, el?, href?}]
  function panel(title, rows, { autoOpen = false, highlight = false } = {}) {
    document.getElementById('a11yf-root')?.remove();
    const { e, w } = counts(rows);
    const root = document.createElement('div');
    root.id = 'a11yf-root';

    const toggle = document.createElement('button');
    toggle.id = 'a11yf-toggle';
    toggle.className = e ? 'a11yf-err' : w ? 'a11yf-warn' : 'a11yf-ok';
    toggle.textContent = rows.length ? `Accessibility: ${e} error${e === 1 ? '' : 's'}, ${w} to check` : 'Accessibility: no issues';
    toggle.setAttribute('aria-expanded', 'false');

    const box = document.createElement('div');
    box.className = 'a11yf-panel';
    box.hidden = true;
    box.innerHTML = `<div class="a11yf-head"><h2></h2><button id="a11yf-close" aria-label="Close">×</button></div>`;
    box.querySelector('h2').textContent = title;

    const list = document.createElement('ul');
    list.className = 'a11yf-list';
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'a11yf-empty';
      li.textContent = 'No issues found by these checks. Still review color contrast, video captions and reading order by hand.';
      list.appendChild(li);
    }
    rows.forEach(r => {
      const li = document.createElement('li');
      const row = document.createElement(r.href ? 'a' : 'button');
      row.className = 'a11yf-row';
      if (r.href) row.href = r.href;
      row.append(sevPill(r.sev), document.createTextNode(r.msg));
      if (r.el) row.addEventListener('click', () => {
        r.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        r.el.classList.remove('a11yf-flash'); void r.el.offsetWidth; r.el.classList.add('a11yf-flash');
      });
      li.appendChild(row);
      list.appendChild(li);
    });
    box.appendChild(list);

    const setOpen = open => {
      box.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (highlight) rows.forEach(r => r.el?.classList.toggle(`a11yf-hl-${r.sev}`, open));
    };
    toggle.addEventListener('click', () => setOpen(box.hidden));
    box.querySelector('#a11yf-close').addEventListener('click', () => { setOpen(false); toggle.focus(); });

    root.append(box, toggle);
    document.body.appendChild(root);
    if (autoOpen) setOpen(true);
  }

  const worst = issues => (counts(issues).e ? 'error' : 'warning');
  const summary = issues => { const { e, w } = counts(issues); return [e && `${e} error${e === 1 ? '' : 's'}`, w && `${w} to check`].filter(Boolean).join(', '); };
  const withFlag = url => url + (url.includes('?') ? '&' : '?') + 'a11y=1';

  /* ------------------------------------------------------------------ */
  /* Modes                                                               */
  /* ------------------------------------------------------------------ */
  function findContentRoot() {
    const sels = [
      '.show-content.user_content',
      '#wiki_page_show .user_content',
      '#assignment_show .description.user_content',
      '.discussion-section .user_content',
      '#course_syllabus.user_content',
      '#content .user_content',
    ];
    for (const s of sels) { const el = document.querySelector(s); if (el) return el; }
    return null;
  }

  function runPage() {
    const root = findContentRoot();
    if (!root) return;
    const title = (document.querySelector('h1.page-title, #content h1') || {}).textContent || '';
    const issues = checkContent(root, { title: title.trim() });
    panel('This page', issues, { autoOpen: ON_DEMAND || /[?&]a11y=1/.test(location.search), highlight: true });
  }

  async function runModules(cid) {
    panel('Modules: scanning…', []);
    const mods = await getAll(`/api/v1/courses/${cid}/modules?include[]=items&per_page=100`);
    for (const m of mods) if (!m.items) m.items = await getAll(`/api/v1/courses/${cid}/modules/${m.id}/items?per_page=100`);
    const items = mods.flatMap(m => m.items || []);
    const has = t => items.some(i => i.type === t);

    const [pages, asgs, discs] = await Promise.all([
      has('Page') ? getAll(`/api/v1/courses/${cid}/pages?include[]=body&per_page=100`) : [],
      has('Assignment') ? getAll(`/api/v1/courses/${cid}/assignments?per_page=100`) : [],
      has('Discussion') ? getAll(`/api/v1/courses/${cid}/discussion_topics?per_page=100`) : [],
    ]);
    const pageBy = new Map(pages.map(p => [p.url, p.body]));
    const asgBy = new Map(asgs.map(a => [a.id, a.description]));
    const discBy = new Map(discs.map(d => [d.id, d.message]));

    const rows = [];
    let checked = 0;
    for (const it of items) {
      const html = it.type === 'Page' ? pageBy.get(it.page_url)
        : it.type === 'Assignment' ? asgBy.get(it.content_id)
        : it.type === 'Discussion' ? discBy.get(it.content_id)
        : undefined;
      if (html === undefined) continue;
      checked++;
      const issues = checkHTML(html, it.title);
      const li = document.getElementById(`context_module_item_${it.id}`);
      const slot = li?.querySelector('.item_name') || li?.querySelector('.ig-title')?.parentElement;
      if (slot && !slot.querySelector('.a11yf-badge')) slot.appendChild(badge(issues, { title: it.title, href: it.html_url }));
      if (issues.length) rows.push({ sev: worst(issues), msg: `${it.title}: ${summary(issues)}`, href: withFlag(it.html_url) });
    }
    panel(`Modules: ${rows.length} of ${checked} items flagged`, rows);
  }

  async function runPagesIndex(cid) {
    panel('Pages: scanning…', []);
    const pages = await getAll(`/api/v1/courses/${cid}/pages?include[]=body&per_page=100`);
    const results = new Map(pages.map(p => [p.url, { title: p.title, href: p.html_url, issues: checkHTML(p.body, p.title) }]));

    const decorate = () => document.querySelectorAll('#content a[href*="/pages/"]').forEach(a => {
      if (a.dataset.a11yf) return;
      const m = (a.getAttribute('href') || '').match(/\/pages\/([^/?#]+)\/?$/);
      const r = m && results.get(decodeURIComponent(m[1]));
      if (!r) return;
      a.dataset.a11yf = '1';
      a.after(badge(r.issues, { title: r.title, href: r.href }));
    });
    decorate();
    let t;
    window.__a11yfObs?.disconnect();
    window.__a11yfObs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(decorate, 250); });
    window.__a11yfObs.observe(document.querySelector('#content') || document.body, { childList: true, subtree: true });

    const rows = [...results.values()].filter(r => r.issues.length)
      .map(r => ({ sev: worst(r.issues), msg: `${r.title}: ${summary(r.issues)}`, href: withFlag(r.href) }));
    panel(`Pages: ${rows.length} of ${results.size} flagged`, rows);
  }

  /* ------------------------------------------------------------------ */
  /* Router                                                              */
  /* ------------------------------------------------------------------ */
  function waitFor(fn, ms = 10000) {
    return new Promise(res => {
      const start = Date.now();
      (function tick() {
        const v = fn();
        if (v || Date.now() - start > ms) return res(v);
        setTimeout(tick, 300);
      })();
    });
  }

  const fail = err => {
    console.error('[A11y Flagger]', err);
    panel('Scan failed', [{ sev: 'error', msg: `Couldn't read course content (${err.message}). Check that you're logged in with edit access.` }]);
  };

  // Clear any previous run so a second click (or bookmarklet + userscript) doesn't stack
  document.querySelectorAll('#a11yf-root, .a11yf-badge, .a11yf-pop').forEach(n => n.remove());
  document.querySelectorAll('.a11yf-hl-error, .a11yf-hl-warning').forEach(n => n.classList.remove('a11yf-hl-error', 'a11yf-hl-warning'));
  document.querySelectorAll('[data-a11yf]').forEach(n => delete n.dataset.a11yf);
  const tell = msg => { if (ON_DEMAND) alert(`A11y Flagger: ${msg}`); };

  const m = location.pathname.match(/^\/courses\/(\d+)(\/.*)?$/);
  if (!m) { tell('open a Canvas course page, Modules or the Pages list first.'); return; }
  const cid = m[1];
  const rest = (m[2] || '').replace(/\/$/, '');
  if (/\/edit$|\/new$/.test(rest)) { tell('save or cancel first. In the editor, use Canvas\'s built-in Accessibility Checker.'); return; }

  injectCSS();
  if (rest === '/pages') { runPagesIndex(cid).catch(fail); return; }

  waitFor(() => document.querySelector('#context_modules') || findContentRoot(), ON_DEMAND ? 1500 : 10000).then(found => {
    if (!found) { tell('no page content found here. Try a Page, Assignment, Discussion, Modules or the Pages list.'); return; }
    if (document.querySelector('#context_modules')) runModules(cid).catch(fail);
    else runPage();
  });
})();
