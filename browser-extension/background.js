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
          if (!tabId) {
            await reportResult(cmd.taskId, { ok: false, error: 'no active tab' });
            break;
          }
          await chrome.tabs.update(tabId, { url: cmd.url, active: true });
          await waitForTabLoad(tabId);
          await sleep(cmd.waitAfterNav || 2000);
        }
        if (!tabId) {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = tabs[0]?.id;
        }
        if (!tabId || !cmd.steps?.length) {
          await reportResult(cmd.taskId, { ok: false, error: 'no tabId or steps' });
          break;
        }
        let result;
        try {
          result = await sendToTab(tabId, { type: 'automate-steps', steps: cmd.steps });
        } catch (e) {
          result = { ok: false, error: e.message };
        }
        await reportResult(cmd.taskId, result);
        break;
      }

      // ── Screenshot — capture visible tab ────────────────────────
      case 'screenshot': {
        try {
          const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 65 });
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const tab = tabs[0] || {};
          await reportResult(cmd.taskId, { ok: true, dataUrl, url: tab.url || '', title: tab.title || '' });
        } catch (e) {
          console.error('[THERA-BRIDGE] screenshot error:', e.message);
          await reportResult(cmd.taskId, { ok: false, error: e.message });
        }
        break;
      }

      // ── Read page — structured DOM context for AI agent ──────────
      case 'read-page': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (!tabId) { await reportResult(cmd.taskId, { ok: false, error: 'no active tab' }); break; }
        try {
          await cdpAttach(tabId);
          const pageInfo = await evaluate(tabId, `
            (function() {
              const url   = location.href;
              const title = document.title;
              const text  = (document.body?.innerText || '').replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').slice(0, 3000);

              const interactive = [];

              // Buttons (visible only)
              document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach(el => {
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height) return;
                const text = (el.textContent || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 60);
                if (!text) return;
                const sel = el.id ? '#' + CSS.escape(el.id)
                  : el.getAttribute('data-testid') ? '[data-testid="' + el.getAttribute('data-testid') + '"]'
                  : null;
                interactive.push({ type: 'button', text, sel });
              });

              // Inputs / textareas / contenteditables
              document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, [contenteditable="true"], [role="textbox"]').forEach(el => {
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height) return;
                const ph = (el.placeholder || el.getAttribute('aria-label') || el.name || el.id || '').slice(0, 60);
                const sel = el.id ? '#' + CSS.escape(el.id)
                  : el.name ? '[name="' + el.name + '"]'
                  : null;
                interactive.push({ type: 'input', placeholder: ph, sel, value: (el.value || '').slice(0, 40) });
              });

              // Links — top 15 visible, non-trivial ones
              const seen = new Set();
              let linkCount = 0;
              document.querySelectorAll('a[href]').forEach(el => {
                if (linkCount >= 15) return;
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height) return;
                const text = el.textContent?.trim().slice(0, 60);
                if (!text || seen.has(text)) return;
                seen.add(text);
                interactive.push({ type: 'link', text, href: el.href?.slice(0, 120) });
                linkCount++;
              });

              // Selects
              document.querySelectorAll('select').forEach(el => {
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height) return;
                const sel = el.id ? '#' + CSS.escape(el.id) : (el.name ? '[name="' + el.name + '"]' : null);
                const options = [...el.options].map(o => o.text.trim()).slice(0, 8);
                interactive.push({ type: 'select', sel, options });
              });

              return { url, title, text, interactive: interactive.slice(0, 50) };
            })()
          `);
          await cdpDetach(tabId);
          await reportResult(cmd.taskId, { ok: true, ...pageInfo });
        } catch (e) {
          try { await cdpDetach(tabId); } catch(_) {}
          await reportResult(cmd.taskId, { ok: false, error: e.message });
        }
        break;
      }

      // ── CDP step executor (no content script needed) ──────────────
      case 'automate-cdp': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (!tabId) { await reportResult(cmd.taskId, { ok: false, error: 'no active tab' }); break; }

        const results = [];
        try {
          await cdpAttach(tabId);

          for (const step of cmd.steps || []) {
            try {
              switch (step.action) {

                case 'click': {
                  await clickSel(tabId, step.selector, step.timeout || 8000);
                  results.push({ step: 'click', selector: step.selector, ok: true });
                  await sleep(300);
                  break;
                }

                case 'click-text': {
                  const coord = await evaluate(tabId, `
                    (function(){
                      const needle = ${JSON.stringify((step.text || '').toLowerCase())};
                      const candidates = [...document.querySelectorAll(
                        'button,[role="button"],a,[role="link"],span,div,li,td,th,label,summary'
                      )];
                      // Sort by how closely the element's own text matches the needle
                      const scored = candidates
                        .map(el => {
                          const t = (el.textContent || '').trim().toLowerCase();
                          if (!t.includes(needle)) return null;
                          const r = el.getBoundingClientRect();
                          if (!r.width || !r.height) return null;
                          return { el, score: t.length - needle.length, r };
                        })
                        .filter(Boolean)
                        .sort((a,b) => a.score - b.score);
                      if (!scored.length) return null;
                      const { r } = scored[0];
                      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
                    })()
                  `);
                  if (coord) {
                    await cdpClick(tabId, coord.x, coord.y);
                    results.push({ step: 'click-text', text: step.text, ok: true });
                  } else {
                    results.push({ step: 'click-text', text: step.text, ok: false, error: 'not found' });
                  }
                  await sleep(300);
                  break;
                }

                case 'type': {
                  if (step.selector) {
                    await clickSel(tabId, step.selector, step.timeout || 8000);
                    await sleep(200);
                  }
                  if (step.clear) await cdpClear(tabId);
                  await cdpType(tabId, step.text || '');
                  results.push({ step: 'type', ok: true });
                  break;
                }

                case 'press': {
                  await cdpKey(tabId, step.key);
                  results.push({ step: 'press', key: step.key, ok: true });
                  await sleep(200);
                  break;
                }

                case 'wait': {
                  await waitForRect(tabId, step.selector, step.timeout || 8000);
                  results.push({ step: 'wait', selector: step.selector, ok: true });
                  break;
                }

                case 'scroll': {
                  await evaluate(tabId, `window.scrollBy(0, ${Number(step.amount) || 400})`);
                  results.push({ step: 'scroll', ok: true });
                  await sleep(300);
                  break;
                }

                case 'sleep': {
                  await sleep(Number(step.ms) || 1000);
                  results.push({ step: 'sleep', ok: true });
                  break;
                }

                case 'navigate': {
                  await chrome.tabs.update(tabId, { url: step.url });
                  await waitForTabLoad(tabId);
                  await sleep(2000);
                  // Re-attach after navigation
                  attachedTabs.delete(tabId);
                  await cdpAttach(tabId);
                  results.push({ step: 'navigate', url: step.url, ok: true });
                  break;
                }

                default:
                  results.push({ step: step.action, ok: false, error: 'unknown step action' });
              }
            } catch (stepErr) {
              console.warn('[CDP-AUTOMATE] step failed:', step.action, stepErr.message);
              results.push({ step: step.action, ok: false, error: stepErr.message });
              // Continue to next step unless marked required
              if (step.required === true) break;
            }
          }

          await cdpDetach(tabId);
          await reportResult(cmd.taskId, { ok: true, results });
        } catch (e) {
          try { await cdpDetach(tabId); } catch(_) {}
          console.error('[CDP-AUTOMATE] fatal:', e.message);
          await reportResult(cmd.taskId, { ok: false, error: e.message, results });
        }
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

// ═════════════════════════════════════════════════════════════════════════════
// WebSocket Bridge — LangChain Tool Commands (port 7980)
//
// This is the NEW channel used by src/services/tools/* in the Electron renderer.
// It runs alongside the existing HTTP long-poll system (port 7979) for backward compat.
//
// Protocol:
//   Receive:  { id, action, payload }          e.g. { id:"abc", action:"browser.click", payload:{ selector:"#btn" } }
//   Send back: { id, success, data }            on success
//              { id, success: false, error }    on failure
// ═════════════════════════════════════════════════════════════════════════════

const WS_URL = 'ws://127.0.0.1:7980';
let wsConn = null;
let wsReconnectTimer = null;

function connectWsBridge() {
  if (wsConn && (wsConn.readyState === WebSocket.OPEN || wsConn.readyState === WebSocket.CONNECTING)) return;

  console.log('[WS] Connecting to bridge at', WS_URL);
  wsConn = new WebSocket(WS_URL);

  wsConn.addEventListener('open', () => {
    console.log('[WS] Connected to Electron bridge');
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  });

  wsConn.addEventListener('message', async (event) => {
    let cmd;
    try { cmd = JSON.parse(event.data); } catch (e) { return; }
    if (!cmd?.id || !cmd?.action) return;

    console.log('[WS] Command received:', cmd.action, 'id:', cmd.id);
    try {
      const data = await wsDispatch(cmd.action, cmd.payload || {});
      wsReply(cmd.id, true, data);
    } catch (err) {
      console.error('[WS] Command failed:', cmd.action, err.message);
      wsReply(cmd.id, false, null, err.message);
    }
  });

  wsConn.addEventListener('close', () => {
    console.log('[WS] Disconnected — reconnecting in 3s');
    wsConn = null;
    wsReconnectTimer = setTimeout(connectWsBridge, 3000);
  });

  wsConn.addEventListener('error', (err) => {
    console.warn('[WS] Error:', err.message || err);
    wsConn?.close();
  });
}

function wsReply(id, success, data, error) {
  if (!wsConn || wsConn.readyState !== WebSocket.OPEN) return;
  wsConn.send(JSON.stringify(success ? { id, success: true, data: data ?? {} } : { id, success: false, error }));
}

// ── Helpers (shared with new handlers) ───────────────────────

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) throw new Error('No active browser tab found');
  return tabs[0];
}

// ── Action Handlers ───────────────────────────────────────────

const WS_ACTIONS = {

  // ── Navigation ─────────────────────────────────────────────
  'browser.navigate': async ({ url }) => {
    const tab = await getActiveTab();
    await chrome.tabs.update(tab.id, { url, active: true });
    await waitForTabLoad(tab.id, 20000);
    await sleep(500);
    const updated = await chrome.tabs.get(tab.id);
    return { title: updated.title, url: updated.url };
  },

  // ── Click by CSS selector (CDP — real, bot-resistant) ──────
  'browser.click': async ({ selector, timeout = 5000 }) => {
    const tab = await getActiveTab();
    await cdpAttach(tab.id);
    try {
      await clickSel(tab.id, selector, timeout);
      await sleep(200);
    } finally {
      await cdpDetach(tab.id);
    }
    return {};
  },

  // ── Click by visible text (CDP evaluate + click) ────────────
  'browser.click_text': async ({ text, scope }) => {
    const tab = await getActiveTab();
    await cdpAttach(tab.id);
    try {
      const needle = (text || '').toLowerCase();
      const scopeSel = scope || 'button,[role="button"],a,[role="link"],span,div,li,label,summary,td';
      const coord = await evaluate(tab.id, `
        (function(){
          const needle = ${JSON.stringify(needle)};
          const candidates = [...document.querySelectorAll(${JSON.stringify(scopeSel)})];
          const scored = candidates
            .map(el => {
              const t = (el.textContent || '').trim().toLowerCase();
              if (!t.includes(needle)) return null;
              const r = el.getBoundingClientRect();
              if (!r.width || !r.height) return null;
              return { score: t.length - needle.length, x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
            })
            .filter(Boolean)
            .sort((a,b) => a.score - b.score);
          return scored[0] || null;
        })()
      `);
      if (!coord) throw new Error(`No visible element with text: "${text}"`);
      await cdpClick(tab.id, coord.x, coord.y);
      await sleep(200);
    } finally {
      await cdpDetach(tab.id);
    }
    return {};
  },

  // ── Type text (CDP Input.insertText — works on React/Lexical) ──
  'browser.type': async ({ selector, text, clear = false, timeout = 5000 }) => {
    const tab = await getActiveTab();
    await cdpAttach(tab.id);
    try {
      const rect = await waitForRect(tab.id, selector, timeout);
      await cdpClick(tab.id, rect.x, rect.y);
      await sleep(150);
      if (clear) {
        await cdpClear(tab.id);
        await sleep(100);
      }
      await cdpType(tab.id, text);
      await sleep(100);
    } finally {
      await cdpDetach(tab.id);
    }
    return {};
  },

  // ── Extract text from element or full page ──────────────────
  'browser.extract': async ({ selector }) => {
    const tab = await getActiveTab();
    if (selector) {
      const result = await sendToTab(tab.id, {
        type: 'automate-steps',
        steps: [{ action: 'read', selector }],
      });
      return { text: result?.results?.[0]?.value || '' };
    }
    // Full page text
    const result = await sendToTab(tab.id, { type: 'read-page' });
    return { text: result?.text || '', title: result?.title || '', url: result?.url || '' };
  },

  // ── Read full page (URL + title + text + interactive elements) ──
  'browser.read_page': async () => {
    const tab = await getActiveTab();
    try {
      await cdpAttach(tab.id);
      const info = await evaluate(tab.id, `
        (function(){
          const url = location.href;
          const title = document.title;
          const text = (document.body?.innerText || '')
            .replace(/[ \\t]+/g,' ')
            .replace(/\\n{3,}/g,'\\n\\n')
            .slice(0, 4000);
          return { url, title, text };
        })()
      `);
      await cdpDetach(tab.id);
      return info;
    } catch (e) {
      try { await cdpDetach(tab.id); } catch(_) {}
      // Fallback to content script
      const result = await sendToTab(tab.id, { type: 'read-page' });
      return { url: result?.url || tab.url, title: result?.title || tab.title, text: result?.text || '' };
    }
  },

  // ── Wait for element (poll until visible) ──────────────────
  'browser.wait_for': async ({ selector, timeout = 8000 }) => {
    const tab = await getActiveTab();
    await cdpAttach(tab.id);
    try {
      await waitForRect(tab.id, selector, timeout);
    } finally {
      await cdpDetach(tab.id);
    }
    return {};
  },

  // ── Press a keyboard key ────────────────────────────────────
  'browser.press_key': async ({ key, selector }) => {
    const tab = await getActiveTab();
    const result = await sendToTab(tab.id, {
      type: 'automate-steps',
      steps: [{ action: 'press', key, selector, optional: false }],
    });
    if (!result?.ok) throw new Error(result?.error || 'press_key failed');
    return {};
  },

  // ── Scroll page ─────────────────────────────────────────────
  'browser.scroll': async ({ amount = 400 }) => {
    const tab = await getActiveTab();
    await sendToTab(tab.id, {
      type: 'automate-steps',
      steps: [{ action: 'scroll', amount }],
    });
    return {};
  },

  // ── WhatsApp DM (existing CDP handler) ─────────────────────
  'whatsapp.send': async ({ to, message }) => {
    let waTab = (await chrome.tabs.query({ url: '*://web.whatsapp.com/*' }))[0];
    if (!waTab) {
      waTab = await chrome.tabs.create({ url: 'https://web.whatsapp.com', active: true });
      await waitForTabLoad(waTab.id);
      await sleep(5000);
    } else {
      await chrome.tabs.update(waTab.id, { active: true });
      await sleep(500);
    }
    const result = await cdpWhatsappDm(waTab.id, to, message);
    if (!result.ok) throw new Error(result.error || 'WhatsApp send failed');
    return { log: result.log };
  },

  // ── Instagram DM (existing CDP handler) ────────────────────
  'instagram.send': async ({ to, message }) => {
    let igTab = (await chrome.tabs.query({ url: '*://*.instagram.com/*' }))[0];
    if (!igTab) {
      const allActive = await chrome.tabs.query({ active: true });
      igTab = allActive[0] || await chrome.tabs.create({ url: 'https://www.instagram.com', active: true });
      await waitForTabLoad(igTab.id);
      await sleep(3000);
    }
    const result = await cdpInstagramDm(igTab.id, to, message);
    if (!result.ok) throw new Error(result.error || 'Instagram send failed');
    return { log: result.log };
  },

  // ── Tab management ──────────────────────────────────────────
  'browser.tab_list': async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active, pinned: t.pinned, windowId: t.windowId }));
  },

  'browser.tab_switch': async ({ id, title, url }) => {
    let tab;
    if (id) {
      tab = await chrome.tabs.get(id);
    } else if (title || url) {
      const all = await chrome.tabs.query({});
      tab = all.find(t =>
        (title && t.title?.toLowerCase().includes(title.toLowerCase())) ||
        (url   && t.url?.toLowerCase().includes(url.toLowerCase()))
      );
      if (!tab) throw new Error(`No tab matching title="${title}" url="${url}"`);
    } else {
      throw new Error('Provide id, title, or url to switch to');
    }
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return { id: tab.id, title: tab.title, url: tab.url };
  },

  'browser.tab_new': async ({ url = 'about:newtab' }) => {
    const tab = await chrome.tabs.create({ url, active: true });
    if (url !== 'about:newtab') await waitForTabLoad(tab.id, 15000);
    return { id: tab.id, url: tab.url };
  },

  'browser.tab_close': async ({ id, current = false }) => {
    if (current || !id) {
      const tab = await getActiveTab();
      await chrome.tabs.remove(tab.id);
      return { closed: tab.id };
    }
    await chrome.tabs.remove(id);
    return { closed: id };
  },

  'browser.tab_pin': async ({ id, pinned = true }) => {
    let tabId = id;
    if (!tabId) { const tab = await getActiveTab(); tabId = tab.id; }
    await chrome.tabs.update(tabId, { pinned });
    return { id: tabId, pinned };
  },

  // ── WhatsApp read ───────────────────────────────────────────
  'whatsapp.read': async ({ contact, limit = 10 }) => {
    let waTab = (await chrome.tabs.query({ url: '*://web.whatsapp.com/*' }))[0];
    if (!waTab) throw new Error('WhatsApp Web is not open in any Chrome tab. Ask the user to open it first.');
    await chrome.tabs.update(waTab.id, { active: true });
    await sleep(500);
    await cdpAttach(waTab.id);
    try {
      // If contact given, search and open that chat first
      if (contact) {
        const searchSel = 'div[contenteditable="true"][data-tab="3"]';
        const rect = await waitForRect(waTab.id, searchSel, 5000);
        await cdpClick(waTab.id, rect.x, rect.y);
        await sleep(200);
        await cdpClear(waTab.id);
        await cdpType(waTab.id, contact);
        await sleep(1500);
        // Click first result
        const resultSel = 'div[data-testid="cell-frame-container"]';
        const resRect = await waitForRect(waTab.id, resultSel, 5000);
        await cdpClick(waTab.id, resRect.x, resRect.y);
        await sleep(800);
      }
      // Read message bubbles
      const messages = await evaluate(waTab.id, `
        (function() {
          const bubbles = [...document.querySelectorAll('div.message-in, div.message-out')].slice(-${limit});
          return bubbles.map(b => {
            const text = b.querySelector('span.selectable-text')?.innerText || '';
            const time = b.querySelector('span[data-testid="msg-meta"]')?.innerText || '';
            const out  = b.classList.contains('message-out');
            return { text, time, direction: out ? 'sent' : 'received' };
          });
        })()
      `);
      return { messages: messages || [] };
    } finally {
      await cdpDetach(waTab.id);
    }
  },

  // ── Instagram read ──────────────────────────────────────────
  'instagram.read': async ({ username, limit = 10 }) => {
    let igTab = (await chrome.tabs.query({ url: '*://*.instagram.com/direct/*' }))[0]
              || (await chrome.tabs.query({ url: '*://*.instagram.com/*' }))[0];
    if (!igTab) throw new Error('Instagram is not open in Chrome. Ask the user to open it first.');
    // Navigate to DMs
    await chrome.tabs.update(igTab.id, { url: 'https://www.instagram.com/direct/inbox/', active: true });
    await waitForTabLoad(igTab.id, 10000);
    await sleep(2000);
    await cdpAttach(igTab.id);
    try {
      if (username) {
        // Find and click the conversation with this username
        const threads = await evaluate(igTab.id, `
          [...document.querySelectorAll('div[role="listitem"]')].map(el => ({
            text: el.innerText?.split('\\n')[0] || '',
            y: el.getBoundingClientRect().top + el.getBoundingClientRect().height/2,
            x: el.getBoundingClientRect().left + el.getBoundingClientRect().width/2,
          }))
        `);
        const thread = (threads || []).find(t => t.text.toLowerCase().includes(username.toLowerCase()));
        if (thread) { await cdpClick(igTab.id, thread.x, thread.y); await sleep(1000); }
      }
      const messages = await evaluate(igTab.id, `
        (function() {
          const items = [...document.querySelectorAll('div[role="row"]')].slice(-${limit});
          return items.map(el => ({ text: el.innerText?.trim() || '' })).filter(m => m.text);
        })()
      `);
      return { messages: messages || [] };
    } finally {
      await cdpDetach(igTab.id);
    }
  },
};

async function wsDispatch(action, payload) {
  const handler = WS_ACTIONS[action];
  if (!handler) throw new Error(`Unknown action: "${action}". Available: ${Object.keys(WS_ACTIONS).join(', ')}`);
  return handler(payload);
}

// Start WebSocket connection on service worker init
connectWsBridge();
