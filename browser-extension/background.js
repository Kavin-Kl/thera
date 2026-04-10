/**
 * Thera Bridge — background service worker (CDP edition)
 *
 * All automation goes through Chrome Debugger Protocol (CDP):
 *   Input.dispatchMouseEvent  — real mouse clicks at coordinates
 *   Input.insertText          — real text input (works with React/Lexical/any framework)
 *   Input.dispatchKeyEvent    — real key presses (Enter, Backspace, Ctrl+A …)
 *   Runtime.evaluate          — DOM queries, coordinate lookup
 *
 * This bypasses ALL synthetic-event detection by WhatsApp, Instagram, etc.
 */

'use strict';

const BRIDGE = 'http://127.0.0.1:7979';
const DOOM_HOSTS = ['twitter.com','x.com','reddit.com','youtube.com','instagram.com','tiktok.com','facebook.com'];

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function isDoom(url) {
  try {
    const h = new URL(url).hostname.replace('www.', '');
    return DOOM_HOSTS.some(d => h === d || h.endsWith('.' + d));
  } catch(_) { return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab activity reporting (doom-scroll detection)
// ─────────────────────────────────────────────────────────────────────────────

const doomTimers = {};

async function sendTabInfo(tab) {
  if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;
  const doom = isDoom(tab.url);
  if (doom && !doomTimers[tab.id]) doomTimers[tab.id] = Date.now();
  if (!doom) delete doomTimers[tab.id];
  const doomMinutes = doom && doomTimers[tab.id]
    ? Math.floor((Date.now() - doomTimers[tab.id]) / 60000) : 0;
  try {
    await fetch(`${BRIDGE}/tab`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: tab.url, title: tab.title || '', tabId: tab.id, isDoom: doom, doomMinutes, timestamp: Date.now() }),
    });
  } catch(_) {}
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try { sendTabInfo(await chrome.tabs.get(tabId)); } catch(_) {}
});
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (change.status === 'complete' && tab.active) sendTabInfo(tab);
});
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  if (tabs[0]) sendTabInfo(tabs[0]);
});

// ─────────────────────────────────────────────────────────────────────────────
// CDP Core
// ─────────────────────────────────────────────────────────────────────────────

const attachedTabs = new Set();

/** Attach Chrome Debugger to a tab. Safe to call if already attached. */
async function cdpAttach(tabId) {
  if (attachedTabs.has(tabId)) return;
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message || '';
        if (msg.includes('already attached') || msg.includes('Cannot attach')) {
          attachedTabs.add(tabId);
          resolve();
        } else {
          reject(new Error('CDP attach failed: ' + msg));
        }
      } else {
        attachedTabs.add(tabId);
        resolve();
      }
    });
  });
}

/** Detach Chrome Debugger. Safe to call if not attached. */
async function cdpDetach(tabId) {
  if (!attachedTabs.has(tabId)) return;
  return new Promise(resolve => {
    chrome.debugger.detach({ tabId }, () => {
      attachedTabs.delete(tabId);
      resolve();
    });
  });
}

/** Send a CDP command and return the result. */
function cdp(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, result => {
      if (chrome.runtime.lastError) {
        reject(new Error(`CDP ${method}: ${chrome.runtime.lastError.message}`));
      } else {
        resolve(result);
      }
    });
  });
}

// Clean up tracking when tabs close or debugger is force-detached
chrome.debugger.onDetach.addListener(({ tabId }) => attachedTabs.delete(tabId));
chrome.tabs.onRemoved.addListener(tabId => attachedTabs.delete(tabId));

// ─────────────────────────────────────────────────────────────────────────────
// CDP Action Primitives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate JS in the page and return the value.
 * The expression must return a JSON-serialisable value.
 */
async function evaluate(tabId, expression) {
  const res = await cdp(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  });
  if (res?.result?.subtype === 'error') {
    throw new Error('evaluate error: ' + res.result.description);
  }
  return res?.result?.value ?? null;
}

/**
 * Get the centre coordinates of a DOM element.
 * Returns { x, y, w, h } or null if not found.
 */
async function getRect(tabId, selector) {
  return evaluate(tabId, `
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height };
    })()
  `);
}

/**
 * Poll for a selector until it appears or times out.
 * Returns the rect { x, y, w, h }.
 */
async function waitForRect(tabId, selector, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rect = await getRect(tabId, selector);
    if (rect) return rect;
    await sleep(400);
  }
  throw new Error(`Timeout (${timeoutMs}ms) waiting for: ${selector}`);
}

/**
 * Dispatch a real mouse click at page coordinates via CDP.
 * Indistinguishable from a genuine user click.
 */
async function cdpClick(tabId, x, y) {
  const base = { x, y, button: 'left', clickCount: 1, modifiers: 0, buttons: 1 };
  await cdp(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mouseMoved' });
  await sleep(30);
  await cdp(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
  await sleep(50);
  await cdp(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
  await sleep(80);
}

/** Click a DOM element identified by CSS selector. */
async function clickSel(tabId, selector, timeoutMs = 8000) {
  const rect = await waitForRect(tabId, selector, timeoutMs);
  console.log(`[CDP] click "${selector}" @ (${rect.x},${rect.y})`);
  await cdpClick(tabId, rect.x, rect.y);
  return rect;
}

/**
 * Insert text into the currently focused element via CDP Input.insertText.
 * This goes through the browser's native text-input pipeline — React, Lexical,
 * and every other framework respond to it exactly as real keyboard typing.
 */
async function cdpType(tabId, text) {
  await cdp(tabId, 'Input.insertText', { text });
  await sleep(100);
}

/**
 * Press a single named key with correct virtual key codes.
 * modifiers: 0=none, 1=Alt, 2=Ctrl, 4=Meta, 8=Shift
 */
async function cdpKey(tabId, key, modifiers = 0) {
  const KEY_CODES = {
    Enter: 13, Backspace: 8, Tab: 9, Escape: 27, Delete: 46,
    ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39,
    Home: 36, End: 35, PageDown: 34, PageUp: 33,
    a: 65, A: 65,
  };
  const CODE_MAP = {
    Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape',
    Delete: 'Delete', ArrowDown: 'ArrowDown', ArrowUp: 'ArrowUp',
    ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
    a: 'KeyA', A: 'KeyA',
  };
  const wvk = KEY_CODES[key] ?? key.charCodeAt(0);
  const code = CODE_MAP[key] ?? ('Key' + key.toUpperCase());
  const base = { key, code, modifiers, nativeVirtualKeyCode: wvk, windowsVirtualKeyCode: wvk };
  await cdp(tabId, 'Input.dispatchKeyEvent', { ...base, type: 'rawKeyDown' });
  await sleep(40);
  await cdp(tabId, 'Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
  await sleep(60);
}

/** Select all content in the focused element and delete it. */
async function cdpClear(tabId) {
  await cdpKey(tabId, 'a', 2);   // Ctrl+A
  await sleep(80);
  await cdpKey(tabId, 'Backspace');
  await sleep(80);
}

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp DM — NEW APPROACH
//
// Strategy: search for the contact → extract their WhatsApp JID (phone ID)
// from the React fiber on the search result → navigate the tab directly to
// https://web.whatsapp.com/send?phone=PHONE&text=MESSAGE (WhatsApp's official
// "Click to Chat" URL that opens any chat and pre-fills the compose box) →
// re-attach CDP → click Send.
//
// This completely bypasses the broken "click on result" UI problem.
// ─────────────────────────────────────────────────────────────────────────────

async function cdpWhatsappDm(tabId, contact, message) {
  const L = (...a) => console.log('[THERA-WA]', ...a);
  const log = [];

  try {
    // ── 1. Attach + wait for WA ─────────────────────────────────
    L('attaching...');
    await cdpAttach(tabId);
    await waitForRect(tabId, '#side, #pane-side', 25000);
    L('WA ready');
    await sleep(800);

    // ── 2. Search for contact ───────────────────────────────────
    const SEARCH_SEL = [
      'input[aria-label="Search or start a new chat"]',
      'input[placeholder*="Search" i][type="text"]',
      '#side input[type="text"]',
    ].join(', ');

    const searchRect = await waitForRect(tabId, SEARCH_SEL, 10000);
    await cdpClick(tabId, searchRect.x, searchRect.y);
    await sleep(400);
    await cdpClear(tabId);
    await sleep(150);
    L('typing contact:', contact);
    await cdpType(tabId, contact);
    await sleep(2500);
    log.push('searched');

    // ── 3. Wait for results & click first match ──────────────────
    L('waiting for results...');
    const needle = contact.toLowerCase().trim();

    // Strategy A: find any visible element in #side containing the contact name
    // with list-item-like height (>= 40px). This is robust against WA DOM changes.
    let clickCoord = null;
    const RESULT_SELS = [
      '[data-testid="cell-frame-container"]',
      '[data-testid="list-item"]',
      '[data-testid="mi-list-item"]',
      '[data-testid="chatlist-item"]',
      '[role="listitem"]',
      '[role="option"]',
      '[role="row"]',
      'li',
    ];

    for (let i = 0; i < 15; i++) {
      await sleep(600);

      // First try: text-content search within #side / #pane-side (most robust)
      // Find the DIRECT chat row — not group mention rows — by looking for the
      // element whose own text most closely matches the needle, then walk up
      // to the row (height 40–150px). Cap height to avoid overshooting into
      // section containers whose center Y falls in the wrong area.
      const byText = await evaluate(tabId, `
        (function(){
          const needle = ${JSON.stringify(needle)};
          const panel = document.querySelector('#pane-side, #side');
          if (!panel) return null;

          // Collect all candidate leaf nodes whose text contains the needle
          const walker = document.createTreeWalker(panel, NodeFilter.SHOW_ELEMENT);
          const candidates = [];
          let node;
          while (node = walker.nextNode()) {
            const t = (node.textContent || '').trim().toLowerCase();
            if (!t.includes(needle)) continue;
            // Prefer nodes where the needle IS the primary text (not a mention)
            // Score: lower = better (closer length to needle = more direct match)
            const score = t.length - needle.length;
            candidates.push({ node, t, score });
          }

          // Sort by score: direct name matches first
          candidates.sort((a, b) => a.score - b.score);

          for (const { node, t } of candidates) {
            // Walk up to the nearest row-like element (height 40–150px, wide enough)
            let el = node;
            for (let up = 0; up < 10; up++) {
              const r = el.getBoundingClientRect();
              if (r.width > 80 && r.height >= 40 && r.height <= 150) {
                return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), tag: el.tagName, text: t.slice(0,40) };
              }
              if (!el.parentElement || el.parentElement === panel) break;
              el = el.parentElement;
            }
          }
          return null;
        })()
      `);
      if (byText) { clickCoord = byText; L(`poll ${i+1}: found by text — ${byText.tag} "${byText.text}" @ (${byText.x},${byText.y})`); break; }

      // Second try: generic selector scan (fallback for when text search misses)
      const bySel = await evaluate(tabId, `
        (function(){
          const SELS = ${JSON.stringify(RESULT_SELS)};
          for (const s of SELS) {
            const els = [...document.querySelectorAll(s)]
              .filter(el=>{const r=el.getBoundingClientRect();return r.width>10&&r.height>10;});
            if (els.length) {
              const el = els[0];
              const r = el.getBoundingClientRect();
              return { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2), sel: s, count: els.length };
            }
          }
          return null;
        })()
      `);
      L(`poll ${i+1}:`, bySel ? `${bySel.count} (${bySel.sel}) @ (${bySel.x},${bySel.y})` : 'none');
      if (bySel) { clickCoord = bySel; break; }
    }

    if (!clickCoord) {
      return { ok: false, error: `No search results for "${contact}"`, log };
    }

    // Click the first result
    L('clicking result @', clickCoord.x, clickCoord.y);
    await cdpClick(tabId, clickCoord.x, clickCoord.y);
    await sleep(2500);
    log.push('result_clicked');

    // Check if chat opened
    const chatOpened = await evaluate(tabId, `!!document.querySelector('#main [contenteditable="true"]')`);
    if (!chatOpened) {
      // Try one more click — sometimes first click selects but doesn't open
      await cdpClick(tabId, clickCoord.x, clickCoord.y);
      await sleep(2000);
    }

    const inChatNow = await evaluate(tabId, `!!document.querySelector('#main [contenteditable="true"]')`);
    if (!inChatNow) {
      return { ok: false, error: 'Clicked result but chat did not open', log };
    }

    log.push('chat_opened');

    // Focus compose box and type message
    await evaluate(tabId, `document.querySelector('#main [contenteditable="true"]')?.focus()`);
    await sleep(300);
    await cdpClear(tabId);
    await sleep(100);
    await cdpType(tabId, message);
    await sleep(500);
    log.push('message_ready');

    // ── 5. Send ─────────────────────────────────────────────────
    L('sending...');
    const sent = await evaluate(tabId, `
      (function(){
        const sels = [
          'button[data-testid="send"]',
          '[data-testid="send"]',
          'button[aria-label="Send"]',
          '[aria-label="Send"]',
          'span[data-icon="send"]',
        ];
        for (const s of sels) {
          const el = document.querySelector(s);
          if (el) { el.click(); return 'dom:' + s; }
        }
        // Last resort: last button in footer/main
        const btns = [...document.querySelectorAll('#main button, footer button')];
        if (btns.length) { btns[btns.length-1].click(); return 'last-btn'; }
        return null;
      })()
    `);
    L('send result:', sent);
    if (!sent) {
      await cdpKey(tabId, 'Enter');
      L('pressed Enter to send');
    }

    await sleep(800);
    const afterSend = await evaluate(tabId,
      `document.querySelector('#main [contenteditable="true"]')?.textContent?.trim() || '(empty)'`
    );
    L('compose after send (should be empty):', afterSend);

    log.push('sent');
    L('DONE:', log.join(' → '));
    return { ok: true, log };

  } catch (err) {
    console.error('[THERA-WA] ERROR:', err.message);
    return { ok: false, error: err.message, log };
  } finally {
    try { await cdpDetach(tabId); } catch(_) {}
    console.log('[THERA-WA] done');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Instagram DM via CDP
// ─────────────────────────────────────────────────────────────────────────────

async function cdpInstagramDm(tabId, username, message) {
  const L = (...a) => console.log('[THERA-IG]', ...a);
  const log = [];

  try {
    await cdpAttach(tabId);
    L('debugger attached to tab', tabId);

    // ── 1. Navigate to profile ───────────────────────────────────
    const profileUrl = `https://www.instagram.com/${encodeURIComponent(username.replace(/^@/, ''))}/`;
    L('navigating to:', profileUrl);
    await chrome.tabs.update(tabId, { url: profileUrl, active: true });
    await waitForTabLoad(tabId);
    await sleep(3500);
    log.push('navigated');

    // ── 2. Click "Message" button ───────────────────────────────
    L('looking for Message button...');
    const msgRect = await evaluate(tabId, `
      (function() {
        const btns = [...document.querySelectorAll('button, [role="button"]')];
        const btn = btns.find(b => b.textContent?.trim().toLowerCase() === 'message');
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        if (r.width === 0) return null;
        return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
      })()
    `);
    if (!msgRect) return { ok: false, error: 'Message button not found on profile page', log };
    L(`Message btn @ (${msgRect.x},${msgRect.y})`);
    await cdpClick(tabId, msgRect.x, msgRect.y);
    await sleep(2500);
    log.push('message_btn_clicked');

    // ── 3. Find the DM text input ───────────────────────────────
    L('waiting for DM input...');
    const DM_SEL = 'div[role="textbox"], div[contenteditable="true"], textarea[placeholder*="essage" i]';
    const inputRect = await waitForRect(tabId, DM_SEL, 8000);
    L(`DM input @ (${inputRect.x},${inputRect.y})`);
    await cdpClick(tabId, inputRect.x, inputRect.y);
    await sleep(400);
    log.push('input_found');

    // ── 4. Type message ─────────────────────────────────────────
    L('typing message...');
    await cdpType(tabId, message);
    await sleep(500);
    log.push('typed_message');

    // ── 5. Send ─────────────────────────────────────────────────
    // Try send button first, fall back to Enter
    const sendRect = await getRect(tabId, 'button[type="submit"], button[aria-label*="Send" i]');
    if (sendRect) {
      L(`send btn @ (${sendRect.x},${sendRect.y})`);
      await cdpClick(tabId, sendRect.x, sendRect.y);
    } else {
      L('no send btn — pressing Enter');
      await cdpKey(tabId, 'Enter');
    }
    log.push('sent');
    await sleep(500);

    L('DONE:', log.join(' → '));
    return { ok: true, log };

  } catch (err) {
    console.error('[THERA-IG] ERROR:', err.message);
    return { ok: false, error: err.message, log };
  } finally {
    await cdpDetach(tabId);
    console.log('[THERA-IG] debugger detached');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Long-poll bridge (Electron ↔ Extension)
// ─────────────────────────────────────────────────────────────────────────────

let polling = false;
let pollCount = 0;

async function startPolling() {
  if (polling) return;
  polling = true;
  console.log('[THERA-BRIDGE] starting long-poll to', BRIDGE);
  while (true) {
    try {
      pollCount++;
      const res = await fetch(`${BRIDGE}/commands?wait=1`, { signal: AbortSignal.timeout(28000) });
      if (res.ok) {
        const commands = await res.json();
        if (commands.length > 0) {
          console.log(`[THERA-BRIDGE] poll #${pollCount} got ${commands.length} cmd(s):`, commands.map(c => c.type));
          for (const cmd of commands) dispatch(cmd);
        }
      } else {
        console.warn(`[THERA-BRIDGE] poll #${pollCount} status:`, res.status);
        await sleep(2000);
      }
    } catch (e) {
      console.warn(`[THERA-BRIDGE] poll #${pollCount} error:`, e.message, '— retry in 2s');
      await sleep(2000);
    }
  }
}

startPolling();

// ─────────────────────────────────────────────────────────────────────────────
// Tab helpers
// ─────────────────────────────────────────────────────────────────────────────

async function waitForTabLoad(tabId, timeout = 20000) {
  // Check if already complete (avoids race where tab loads before listener registers)
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') {
      await sleep(300);
      return;
    }
  } catch(_) {}

  return new Promise(resolve => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); resolve(); }, timeout);
    const fn = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(t);
        chrome.tabs.onUpdated.removeListener(fn);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(fn);
  });
}

// Content-script messaging (for non-WA automation steps)
async function sendToTab(tabId, msg, retries = 4) {
  for (let i = 0; i < retries; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, msg);
    } catch (e) {
      if (i === 0) {
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
          await sleep(500);
        } catch(_) {}
      } else if (i < retries - 1) {
        await sleep(1200);
      } else {
        throw new Error(`content script unavailable: ${e.message}`);
      }
    }
  }
}

async function reportResult(taskId, result) {
  if (!taskId) return;
  console.log('[THERA-BRIDGE] report taskId:', taskId, JSON.stringify(result).slice(0, 200));
  try {
    await fetch(`${BRIDGE}/tab`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'automate-result', taskId, result }),
    });
  } catch (e) {
    console.error('[THERA-BRIDGE] reportResult failed:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Command dispatcher
// ─────────────────────────────────────────────────────────────────────────────

async function dispatch(cmd) {
  if (!cmd?.type) return;
  console.log('[THERA-BRIDGE] dispatch:', cmd.type, 'taskId:', cmd.taskId);

  try {
    switch (cmd.type) {

      // ── WhatsApp DM (CDP) ───────────────────────────────────────
      case 'whatsapp-dm': {
        console.log('[THERA-BRIDGE] whatsapp-dm to:', cmd.to, 'msg:', cmd.message?.slice(0, 40));

        // Find or open WhatsApp tab
        let waTab = (await chrome.tabs.query({ url: '*://web.whatsapp.com/*' }))[0];
        if (!waTab) {
          console.log('[THERA-BRIDGE] opening WhatsApp...');
          waTab = await chrome.tabs.create({ url: 'https://web.whatsapp.com', active: true });
          await waitForTabLoad(waTab.id);
          await sleep(5000); // Let WA app initialise
        } else {
          await chrome.tabs.update(waTab.id, { active: true });
          await sleep(500);
        }

        const result = await cdpWhatsappDm(waTab.id, cmd.to, cmd.message);
        console.log('[THERA-BRIDGE] WA result:', JSON.stringify(result).slice(0, 200));
        await reportResult(cmd.taskId, result);
        break;
      }

      // ── Instagram DM (CDP) ──────────────────────────────────────
      case 'instagram-dm': {
        console.log('[THERA-BRIDGE] instagram-dm to:', cmd.to);

        let igTab = (await chrome.tabs.query({ url: '*://*.instagram.com/*' }))[0];
        if (!igTab) {
          const allActive = await chrome.tabs.query({ active: true });
          igTab = allActive[0];
        }
        if (!igTab) {
          igTab = await chrome.tabs.create({ url: 'https://www.instagram.com', active: true });
          await waitForTabLoad(igTab.id);
          await sleep(3000);
        }

        const result = await cdpInstagramDm(igTab.id, cmd.to, cmd.message);
        console.log('[THERA-BRIDGE] IG result:', JSON.stringify(result).slice(0, 200));
        await reportResult(cmd.taskId, result);
        break;
      }

      // ── Generic browser automation (content script) ─────────────
      case 'automate': {
        let tabId = cmd.tabId;
        if (cmd.url) {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = tabs[0]?.id;
          if (!tabId) { console.warn('[THERA-BRIDGE] automate: no active tab'); break; }
          await chrome.tabs.update(tabId, { url: cmd.url, active: true });
          await waitForTabLoad(tabId);
          await sleep(cmd.waitAfterNav || 2000);
        }
        if (!tabId) {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = tabs[0]?.id;
        }
        if (!tabId || !cmd.steps?.length) { console.warn('[THERA-BRIDGE] automate: no tabId or steps'); break; }
        const result = await sendToTab(tabId, { type: 'automate-steps', steps: cmd.steps });
        await reportResult(cmd.taskId, result);
        break;
      }

      // ── Tab management ──────────────────────────────────────────
      case 'open-url': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (cmd.newTab || !tabs[0]) await chrome.tabs.create({ url: cmd.url, active: true });
        else await chrome.tabs.update(tabs[0].id, { url: cmd.url });
        break;
      }

      case 'close-tab':  if (cmd.tabId) await chrome.tabs.remove(cmd.tabId); break;
      case 'focus-tab':  if (cmd.tabId) await chrome.tabs.update(cmd.tabId, { active: true }); break;

      case 'get-tabs': {
        const all = await chrome.tabs.query({});
        await fetch(`${BRIDGE}/tab`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'tabs-list', tabs: all.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active })) }),
        });
        break;
      }

      default:
        console.warn('[THERA-BRIDGE] unknown command:', cmd.type);
    }

    console.log('[THERA-BRIDGE] dispatch done:', cmd.type);

  } catch (e) {
    console.error('[THERA-BRIDGE] dispatch error for', cmd.type, ':', e.message);
    await reportResult(cmd.taskId, { ok: false, error: 'dispatch error: ' + e.message });
  }
}
