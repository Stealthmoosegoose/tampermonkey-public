// ==UserScript==
// @name         Canvas: Highlight Broken Links/Media Red/Orange/Green Highlights (v1.8.3)
// @namespace    https://github.com/Stealthmoosegoose/tampermonkey
// @version      1.8.3
// @description  Flags problematic Canvas content; adds orange flag for media embeds missing in old instance
// @match        https://courses.online.umich.edu/courses/*
// @match        https://umich.instructure.com/courses/*
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Stealthmoosegoose/tampermonkey-public/main/canvas-highlight-broken-links.user.js
// @downloadURL  https://raw.githubusercontent.com/Stealthmoosegoose/tampermonkey-public/main/canvas-highlight-broken-links.user.js
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      courses.online.umich.edu
// @connect      umich.instructure.com
// @connect      shared-files.online.umich.edu
// ==/UserScript==


(function () {
  "use strict";

  const CANVAS_HOSTS = new Set(["courses.online.umich.edu", "umich.instructure.com"]);
  const TRUSTED_EXTERNAL_ASSET_HOSTS = new Set(["shared-files.online.umich.edu"]);
  const OLD_INSTANCE = "umich.instructure.com";

  const MAX_CONCURRENCY = 6;
  const REQUEST_TIMEOUT_MS = 12000;

  const EXCLUDE_SELECTORS = [
    "#menu", ".ic-app-header", "#section-tabs", ".ic-NavMenu-list",
    ".ic-Layout-leftContent", ".ic-Layout-navigation",
    ".ui-dialog", ".tox-tinymce", ".mce-container"
  ];

  const CONTENT_ROOT_SELECTORS = [
    "#wiki_page_show .user_content",
    "#wiki_page_show",
    ".ic-Layout-contentMain .user_content",
    ".ic-Layout-contentMain",
    "#content"
  ];

  // Inject styles
  GM_addStyle(`
    .tm-red-outline { outline: 3px solid #e00000 !important; outline-offset: 2px !important; }
    .tm-orange-outline { outline: 3px solid #f59e0b !important; outline-offset: 2px !important; }
    .tm-green-outline { outline: 3px solid #1a7f37 !important; outline-offset: 2px !important; }
    .tm-red-badge::after,
    .tm-orange-badge::after,
    .tm-green-badge::after {
      content: attr(data-reason);
      position: absolute;
      top: -10px;
      left: -10px;
      z-index: 9999;
      font: 12px sans-serif;
      padding: 4px 6px;
      border-radius: 6px;
      max-width: 500px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
    }
    .tm-red-badge::after { background: #e00000; color: #fff; }
    .tm-orange-badge::after { background: #f59e0b; color: #111; }
    .tm-green-badge::after { background: #1a7f37; color: #fff; }
  `);

  // Reporting object
  const report = {
    red: [],
    orange: [],
    green: []
  };

  // Caches and concurrency queue
  const apiCache = new Map();
  const pendingPromises = new Map();
  const workQueue = [];
  let active = 0;

  function enqueue(task) {
    workQueue.push(task);
    processQueue();
  }

  function processQueue() {
    while (active < MAX_CONCURRENCY && workQueue.length) {
      const task = workQueue.shift();
      active++;
      Promise.resolve().then(task).catch(() => {}).finally(() => {
        active--;
        processQueue();
      });
    }
  }

  // Utility functions
  function isCanvasHost(url) {
    return CANVAS_HOSTS.has(url.hostname);
  }

  function isTrustedExternalHost(url) {
    return TRUSTED_EXTERNAL_ASSET_HOSTS.has(url.hostname);
  }

  function normalizeUrl(raw) {
    if (!raw) return null;
    const trimmed = String(raw).trim();
    if (!trimmed || /^(mailto:|tel:|javascript:)/i.test(trimmed)) return null;
    try {
      return new URL(trimmed, window.location.href);
    } catch {
      return null;
    }
  }

  function getCurrentCourseId() {
    const match = window.location.pathname.match(/\/courses\/(\d+)/);
    return match ? match[1] : null;
  }

  function extractCourseId(url) {
    const match = url.pathname.match(/\/courses\/(\d+)\b/);
    return match ? match[1] : null;
  }

  function extractMediaId(url) {
    const match = url.pathname.match(/\/media_attachments_iframe\/(\d+)/);
    return match ? match[1] : null;
  }

  function markElement(el, color, reason) {
    const classMap = {
      red: "tm-red-outline tm-red-badge",
      orange: "tm-orange-outline tm-orange-badge",
      green: "tm-green-outline tm-green-badge"
    };
    el.classList.add(...classMap[color].split(" "));
    el.setAttribute("data-reason", reason);
  }

  // Canvas API helper (with caching)
  function apiGet(url, cacheKey) {
    if (apiCache.has(cacheKey)) {
      return Promise.resolve(apiCache.get(cacheKey));
    }
    if (pendingPromises.has(cacheKey)) {
      return pendingPromises.get(cacheKey);
    }
    const promise = new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        timeout: REQUEST_TIMEOUT_MS,
        withCredentials: true,
        headers: { Accept: "application/json" },
        onload: (response) => {
          const status = response.status;
          const body = response.responseText || "";
          apiCache.set(cacheKey, { status, body });
          resolve({ status, body });
        },
        onerror: () => resolve({ status: 0, body: "" }),
        ontimeout: () => resolve({ status: 0, body: "" })
      });
    }).finally(() => pendingPromises.delete(cacheKey));
    pendingPromises.set(cacheKey, promise);
    return promise;
  }

  // Handles a single link or embed
  function handleElement(el, url, label) {
    if (!url) return;

    // Trusted external assets
    if (!isCanvasHost(url)) {
      if (isTrustedExternalHost(url)) {
        markElement(el, "green", `${label}: Trusted external asset`);
        report.green.push({ type: el.tagName, label, url: url.href });
      }
      return;
    }

    const currentCourse = getCurrentCourseId();
    const targetCourse = extractCourseId(url);

    // Wrong instance (old vs new)
    if (window.location.hostname !== url.hostname) {
      markElement(el, "red", `${label}: Wrong Canvas instance (${url.hostname})`);
      report.red.push({ type: el.tagName, label, url: url.href });
      return;
    }

    // Wrong course
    if (currentCourse && targetCourse && currentCourse !== targetCourse) {
      markElement(el, "red", `${label}: Wrong course (${targetCourse} ≠ ${currentCourse})`);
      report.red.push({ type: el.tagName, label, url: url.href });
      return;
    }

    // Check media attachments
    const mId = extractMediaId(url);
    if (mId) {
      // Use course-scoped API
      const apiUrl = `${url.origin}/api/v1/courses/${currentCourse}/media_attachments/${mId}`;
      const cacheKey = `media:${url.origin}:${currentCourse}:${mId}`;

      enqueue(async () => {
        const { status } = await apiGet(apiUrl, cacheKey);
        if (status === 200) {
          // media belongs to this course → OK
          return;
        }
        // On old instance: treat 404 as orange
        if (window.location.hostname === OLD_INSTANCE && status === 404) {
          markElement(el, "orange", `${label}: Media embed is from another course (re-embed recommended)`);
          report.orange.push({ type: el.tagName, label, url: url.href });
        } else {
          // New instance or other status → red
          markElement(el, "red", `${label}: Media not found in course`);
          report.red.push({ type: el.tagName, label, url: url.href });
        }
      });
      return;
    }
  }

  // Main scan function
  function scanPage() {
    const courseId = getCurrentCourseId();
    if (!report.courseId && courseId) {
      report.courseId = courseId;
    }

    const roots = [];
    for (const selector of CONTENT_ROOT_SELECTORS) {
      const nodes = document.querySelectorAll(selector);
      if (nodes.length) {
        nodes.forEach((n) => roots.push(n));
        break;
      }
    }
    if (roots.length === 0) {
      roots.push(document.body);
    }

    roots.forEach((root) => {
      // Links
      root.querySelectorAll("a[href]").forEach((a) => {
        const url = normalizeUrl(a.getAttribute("href"));
        handleElement(a, url, "Link");
      });
      // Images
      root.querySelectorAll("img[src]").forEach((img) => {
        const url = normalizeUrl(img.getAttribute("src"));
        handleElement(img, url, "Image");
      });
      // Embeds / iframes
      root.querySelectorAll("iframe[src], embed[src], object[data]").forEach((embed) => {
        const src = embed.getAttribute("src") || embed.getAttribute("data");
        const url = normalizeUrl(src);
        handleElement(embed, url, embed.tagName);
      });
    });
  }

  // Initial run
  scanPage();

  // Observe DOM changes for dynamic content
  const observer = new MutationObserver(() => {
    scanPage();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

})();
