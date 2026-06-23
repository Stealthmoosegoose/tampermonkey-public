// ==UserScript==
// @name         Canvas Split View Sync Navigation + Scroll v4.2
// @namespace    https://github.com/YOUR-ORG/YOUR-REPO
// @version      4.2.0
// @description  Sync Next/Previous navigation and scrolling across side-by-side Canvas course pages with collapsible floating controls.
// @author       Your Name
// @match        https://courses.online.umich.edu/courses/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Stealthmoosegoose/tampermonkey_public/main/canvas-split-sync-nav.user.js
// @updateURL    https://raw.githubusercontent.com/Stealthmoosegoose/tampermonkey_public/main/canvas-split-sync-nav.user.js
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        channelName: 'canvas-split-view-sync-v4-2',
        actionDebounceMs: 900,
        rebroadcastBlockMs: 500,
        scrollThrottleMs: 60,
        scrollSettleMs: 120,
        panelId: 'tm-canvas-sync-panel',
        statusId: 'tm-canvas-sync-status',
        styleId: 'tm-canvas-sync-style',
        buttonZIndex: 999999,
        defaultScrollSync: true,
        defaultNavSync: true,
        defaultPanelExpanded: false,
        defaultPanelVisible: true,
        panelStorageKey: 'tmCanvasSyncPanelExpanded',
        panelVisibleStorageKey: 'tmCanvasSyncPanelVisible',
        navStorageKey: 'tmCanvasNavSyncEnabled',
        scrollStorageKey: 'tmCanvasScrollSyncEnabled'
    };

    const channel = new BroadcastChannel(CONFIG.channelName);

    let lastActionAt = 0;
    let suppressBroadcast = false;
    let suppressScrollBroadcast = false;
    let lastScrollSentAt = 0;
    let remoteScrollUnlockTimer = null;

    const state = {
        navSyncEnabled: loadBool(CONFIG.navStorageKey, CONFIG.defaultNavSync),
        scrollSyncEnabled: loadBool(CONFIG.scrollStorageKey, CONFIG.defaultScrollSync),
        panelExpanded: loadBool(CONFIG.panelStorageKey, CONFIG.defaultPanelExpanded),
        panelVisible: loadBool(CONFIG.panelVisibleStorageKey, CONFIG.defaultPanelVisible)
    };

    function now() {
        return Date.now();
    }

    function tooSoon() {
        return now() - lastActionAt < CONFIG.actionDebounceMs;
    }

    function markAction() {
        lastActionAt = now();
    }

    function saveBool(key, value) {
        try {
            localStorage.setItem(key, value ? 'true' : 'false');
        } catch (err) {
            console.warn('[Canvas Sync] Could not save setting', key, err);
        }
    }

    function loadBool(key, fallback) {
        try {
            const value = localStorage.getItem(key);
            if (value === null) return fallback;
            return value === 'true';
        } catch (err) {
            return fallback;
        }
    }

    function setStatus(message) {
        const el = document.getElementById(CONFIG.statusId);
        if (el) el.textContent = message;
    }

    function normalizeText(value) {
        return (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function savePanelState() {
        saveBool(CONFIG.panelStorageKey, state.panelExpanded);
    }

    function savePanelVisibleState() {
        saveBool(CONFIG.panelVisibleStorageKey, state.panelVisible);
    }

    function updatePanelVisibility() {
        const panel = document.getElementById(CONFIG.panelId);
        if (!panel) return;

        panel.classList.toggle('tm-collapsed', !state.panelExpanded);

        const toggleLabel = document.getElementById('tm-sync-panel-toggle-label');
        if (toggleLabel) {
            toggleLabel.textContent = state.panelExpanded ? 'Hide' : 'Sync';
        }
    }

    function updatePanelDisplay() {
        const panel = document.getElementById(CONFIG.panelId);
        if (!panel) return;

        panel.style.display = state.panelVisible ? 'block' : 'none';
    }

    function togglePanel(forceValue) {
        state.panelExpanded = typeof forceValue === 'boolean'
            ? forceValue
            : !state.panelExpanded;

        savePanelState();
        updatePanelVisibility();
        setStatus(state.panelExpanded ? 'Panel expanded' : 'Panel collapsed');
    }

    function togglePanelVisible(forceValue) {
        state.panelVisible = typeof forceValue === 'boolean'
            ? forceValue
            : !state.panelVisible;

        savePanelVisibleState();
        updatePanelDisplay();

        if (state.panelVisible) {
            setStatus('Panel shown');
        }
    }

    function updateToggleUI() {
        const navToggle = document.getElementById('tm-sync-nav-toggle');
        const scrollToggle = document.getElementById('tm-sync-scroll-toggle');

        if (navToggle) navToggle.checked = state.navSyncEnabled;
        if (scrollToggle) scrollToggle.checked = state.scrollSyncEnabled;
    }

    function getCandidateLinks() {
        return [...document.querySelectorAll('a[href]')];
    }

    function findNextLink() {
        const links = getCandidateLinks();
        return (
            document.querySelector('a[aria-label*="Next Module Item"]') ||
            links.find(a => normalizeText(a.getAttribute('aria-label')).includes('next module item')) ||
            links.find(a => normalizeText(a.rel).includes('next')) ||
            links.find(a => normalizeText(a.textContent) === 'next')
        );
    }

    function findPrevLink() {
        const links = getCandidateLinks();
        return (
            document.querySelector('a[aria-label*="Previous Module Item"]') ||
            links.find(a => normalizeText(a.getAttribute('aria-label')).includes('previous module item')) ||
            links.find(a => normalizeText(a.rel).includes('prev')) ||
            links.find(a => normalizeText(a.textContent) === 'previous')
        );
    }

    function clickLink(link) {
        if (!link) return false;
        link.click();
        return true;
    }

    function clickNav(direction, shouldBroadcast = true, source = 'local') {
        if (!state.navSyncEnabled && source !== 'remote') {
            setStatus('Nav sync is off');
            return false;
        }

        if (tooSoon()) {
            setStatus(`Ignored ${direction}: debounce active`);
            return false;
        }

        const link = direction === 'next' ? findNextLink() : findPrevLink();
        if (!link) {
            setStatus(`No ${direction} button found on this page`);
            return false;
        }

        markAction();

        if (shouldBroadcast && !suppressBroadcast && state.navSyncEnabled) {
            channel.postMessage({
                type: 'sync-nav',
                direction,
                href: location.href,
                source,
                sentAt: now()
            });
        }

        setStatus(`${direction === 'next' ? 'Next' : 'Previous'} triggered (${source})`);
        return clickLink(link);
    }

    function getScrollMetrics() {
        const doc = document.documentElement;
        const body = document.body;

        const scrollTop = window.scrollY || doc.scrollTop || body.scrollTop || 0;
        const scrollHeight = Math.max(
            body.scrollHeight, doc.scrollHeight,
            body.offsetHeight, doc.offsetHeight,
            body.clientHeight, doc.clientHeight
        );
        const viewportHeight = window.innerHeight || doc.clientHeight || 0;
        const maxScrollTop = Math.max(0, scrollHeight - viewportHeight);
        const ratio = maxScrollTop > 0 ? scrollTop / maxScrollTop : 0;

        return { scrollTop, scrollHeight, viewportHeight, maxScrollTop, ratio };
    }

    function scrollToRatio(ratio) {
        const doc = document.documentElement;
        const body = document.body;
        const scrollHeight = Math.max(
            body.scrollHeight, doc.scrollHeight,
            body.offsetHeight, doc.offsetHeight,
            body.clientHeight, doc.clientHeight
        );
        const viewportHeight = window.innerHeight || doc.clientHeight || 0;
        const maxScrollTop = Math.max(0, scrollHeight - viewportHeight);
        const targetTop = Math.max(0, Math.min(maxScrollTop, ratio * maxScrollTop));

        window.scrollTo({
            top: targetTop,
            behavior: 'auto'
        });
    }

    function broadcastScroll(source = 'scroll') {
        if (!state.scrollSyncEnabled || suppressBroadcast || suppressScrollBroadcast) return;

        const currentTime = now();
        if (currentTime - lastScrollSentAt < CONFIG.scrollThrottleMs) return;
        lastScrollSentAt = currentTime;

        const { ratio, scrollTop, maxScrollTop } = getScrollMetrics();

        channel.postMessage({
            type: 'sync-scroll',
            ratio,
            scrollTop,
            maxScrollTop,
            href: location.href,
            source,
            sentAt: currentTime
        });
    }

    function handleIncomingMessage(event) {
        const msg = event.data;
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'sync-nav') {
            if (!state.navSyncEnabled) return;
            if (tooSoon()) {
                setStatus(`Ignored remote ${msg.direction}: debounce active`);
                return;
            }

            suppressBroadcast = true;
            try {
                clickNav(msg.direction, false, 'remote');
            } finally {
                window.setTimeout(() => {
                    suppressBroadcast = false;
                }, CONFIG.rebroadcastBlockMs);
            }
            return;
        }

        if (msg.type === 'sync-scroll') {
            if (!state.scrollSyncEnabled) return;

            suppressScrollBroadcast = true;
            scrollToRatio(msg.ratio);
            setStatus(`Scroll synced (${Math.round(msg.ratio * 100)}%)`);

            if (remoteScrollUnlockTimer) {
                clearTimeout(remoteScrollUnlockTimer);
            }

            remoteScrollUnlockTimer = window.setTimeout(() => {
                suppressScrollBroadcast = false;
            }, CONFIG.scrollSettleMs);
        }
    }

    function handleDocumentClick(event) {
        const link = event.target.closest('a[href]');
        if (!link || !event.isTrusted || suppressBroadcast || tooSoon() || !state.navSyncEnabled) return;

        const aria = normalizeText(link.getAttribute('aria-label'));
        const text = normalizeText(link.textContent);

        const isNext = aria.includes('next module item') || text === 'next';
        const isPrev = aria.includes('previous module item') || text === 'previous';

        if (!isNext && !isPrev) return;

        markAction();

        channel.postMessage({
            type: 'sync-nav',
            direction: isNext ? 'next' : 'prev',
            href: location.href,
            source: 'click',
            sentAt: now()
        });

        setStatus(`${isNext ? 'Next' : 'Previous'} broadcast from page click`);
    }

    function handleKeyboard(event) {
        // Option/Alt + Shift + S = hide/show the entire widget
        if (event.altKey && event.shiftKey && event.code === 'KeyS') {
            event.preventDefault();
            event.stopPropagation();
            togglePanelVisible();
            return;
        }

        // Option/Alt + Right = next
        if (event.altKey && event.code === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            clickNav('next', true, 'keyboard');
            return;
        }

        // Option/Alt + Left = previous
        if (event.altKey && event.code === 'ArrowLeft') {
            event.preventDefault();
            event.stopPropagation();
            clickNav('prev', true, 'keyboard');
            return;
        }
    }

    function handleScroll() {
        if (!state.scrollSyncEnabled) return;
        broadcastScroll('scroll');
    }

    function addStyles() {
        if (document.getElementById(CONFIG.styleId)) return;

        const style = document.createElement('style');
        style.id = CONFIG.styleId;
        style.textContent = `
            #${CONFIG.panelId} {
                position: fixed;
                right: 16px;
                bottom: 16px;
                z-index: ${CONFIG.buttonZIndex};
                background: rgba(17, 24, 39, 0.95);
                color: #fff;
                border-radius: 12px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.25);
                padding: 10px;
                font-family: Arial, Helvetica, sans-serif;
                width: 250px;
            }

            #${CONFIG.panelId} .tm-panel-toggle {
                width: 100%;
                border: 0;
                border-radius: 8px;
                padding: 8px 10px;
                font-size: 12px;
                font-weight: 700;
                cursor: pointer;
                background: #e5e7eb;
                color: #111827;
                margin-bottom: 8px;
            }

            #${CONFIG.panelId}.tm-collapsed {
                width: auto;
                padding: 8px;
            }

            #${CONFIG.panelId}.tm-collapsed .tm-panel-body {
                display: none;
            }

            #${CONFIG.panelId}.tm-collapsed .tm-panel-toggle {
                margin-bottom: 0;
                min-width: 72px;
            }

            #${CONFIG.panelId} .tm-title {
                font-size: 13px;
                font-weight: 700;
                margin: 0 0 8px 0;
            }

            #${CONFIG.panelId} .tm-row {
                display: flex;
                gap: 8px;
                margin-bottom: 8px;
            }

            #${CONFIG.panelId} button:not(.tm-panel-toggle) {
                flex: 1;
                border: 0;
                border-radius: 8px;
                padding: 8px 10px;
                font-size: 13px;
                font-weight: 700;
                cursor: pointer;
                background: #f3f4f6;
                color: #111827;
            }

            #${CONFIG.panelId} button:hover {
                opacity: 0.92;
            }

            #${CONFIG.panelId} .tm-status {
                font-size: 11px;
                line-height: 1.4;
                color: #d1d5db;
                min-height: 30px;
                margin-bottom: 8px;
            }

            #${CONFIG.panelId} .tm-help {
                font-size: 10px;
                color: #9ca3af;
                margin-top: 4px;
            }

            #${CONFIG.panelId} .tm-toggle {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                font-size: 12px;
                margin: 6px 0;
            }

            #${CONFIG.panelId} .tm-toggle input {
                transform: scale(1.1);
            }
        `;
        document.head.appendChild(style);
    }

    function buildPanel() {
        if (document.getElementById(CONFIG.panelId)) return;

        const panel = document.createElement('div');
        panel.id = CONFIG.panelId;

        panel.innerHTML = `
            <button type="button" id="tm-sync-panel-toggle" class="tm-panel-toggle">
                <span id="tm-sync-panel-toggle-label">Sync</span>
            </button>

            <div class="tm-panel-body">
                <div class="tm-title">Canvas Sync</div>

                <div class="tm-row">
                    <button type="button" id="tm-sync-prev">◀ Prev</button>
                    <button type="button" id="tm-sync-next">Next ▶</button>
                </div>

                <div class="tm-toggle">
                    <label for="tm-sync-nav-toggle">Sync navigation</label>
                    <input type="checkbox" id="tm-sync-nav-toggle" />
                </div>

                <div class="tm-toggle">
                    <label for="tm-sync-scroll-toggle">Sync scrolling</label>
                    <input type="checkbox" id="tm-sync-scroll-toggle" />
                </div>

                <div class="tm-status" id="${CONFIG.statusId}">Ready</div>
                <div class="tm-help">Option/Alt+Left / Right = Prev/Next<br>Option/Alt+Shift+S = Hide/Show widget</div>
            </div>
        `;

        document.body.appendChild(panel);

        document.getElementById('tm-sync-panel-toggle')?.addEventListener('click', () => {
            togglePanel();
        });

        document.getElementById('tm-sync-prev')?.addEventListener('click', () => {
            clickNav('prev', true, 'panel');
        });

        document.getElementById('tm-sync-next')?.addEventListener('click', () => {
            clickNav('next', true, 'panel');
        });

        document.getElementById('tm-sync-nav-toggle')?.addEventListener('change', (e) => {
            state.navSyncEnabled = !!e.target.checked;
            saveBool(CONFIG.navStorageKey, state.navSyncEnabled);
            setStatus(`Navigation sync ${state.navSyncEnabled ? 'on' : 'off'}`);
        });

        document.getElementById('tm-sync-scroll-toggle')?.addEventListener('change', (e) => {
            state.scrollSyncEnabled = !!e.target.checked;
            saveBool(CONFIG.scrollStorageKey, state.scrollSyncEnabled);
            setStatus(`Scroll sync ${state.scrollSyncEnabled ? 'on' : 'off'}`);
        });

        updateToggleUI();
        updatePanelVisibility();
        updatePanelDisplay();
    }

    function init() {
        addStyles();
        buildPanel();

        document.addEventListener('click', handleDocumentClick, true);
        window.addEventListener('keydown', handleKeyboard, true);
        window.addEventListener('scroll', handleScroll, { passive: true });
        channel.addEventListener('message', handleIncomingMessage);

        if (state.panelVisible) {
            setStatus('Ready');
        }

        console.log('[Canvas Sync v4.2] Loaded');
    }

    init();
})();
