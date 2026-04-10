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
// WhatsApp DM via CDP
// ─────────────────────────────────────────────────────────────────────────────

async function cdpWhatsappDm(tabId, contact, message) {
  const L = (...a) => console.log('[THERA-WA]', ...a);
  const log = [];

  try {
    // ── Attach debugger ─────────────────────────────────────────
    L('attaching debugger to tab', tabId);
    await cdpAttach(tabId);
    L('debugger attached OK');

    // ── 1. Wait for WA app shell ────────────────────────────────
    L('waiting for #side / #pane-side...');
    await waitForRect(tabId, '#side, #pane-side', 25000);
    L('WA app shell found');
    await sleep(1000);
    log.push('app_ready');

    // ── DOM RECON: dump every input + contenteditable ────────────
    const domDump = await evaluate(tabId, `
      (function(){
        const inputs = [...document.querySelectorAll('input')].map(e=>
          'INPUT[type='+e.type+'][aria='+e.getAttribute('aria-label')+'][ph='+e.placeholder+'][dt='+e.getAttribute('data-testid')+']');
        const ces = [...document.querySelectorAll('[contenteditable="true"]')].map(e=>
          'CE[tab='+e.getAttribute('data-tab')+'][aria='+e.getAttribute('aria-label')+'][inMain='+!!e.closest('#main')+']');
        return { inputs, ces };
      })()
    `);
    L('INPUTS on page:', JSON.stringify(domDump?.inputs));
    L('CONTENTEDITABLES:', JSON.stringify(domDump?.ces));

    // ── 2. Click the search input ───────────────────────────────
    const SEARCH_SEL = [
      'input[aria-label="Search or start a new chat"]',
      'input[placeholder="Search or start a new chat"]',
      'input[aria-label*="Search" i][type="text"]',
      '#side input[type="text"]',
      '#pane-side input[type="text"]',
    ].join(', ');

    L('looking for search input with selector:', SEARCH_SEL);
    const searchRect = await waitForRect(tabId, SEARCH_SEL, 10000);
    L(`search input found @ (${searchRect.x},${searchRect.y}) size=${searchRect.w}x${searchRect.h}`);

    // CDP click to focus
    await cdpClick(tabId, searchRect.x, searchRect.y);
    await sleep(500);

    // Verify focus
    const focusedTag = await evaluate(tabId, `document.activeElement?.tagName + '[' + document.activeElement?.getAttribute('aria-label') + ']'`);
    L('focused element after click:', focusedTag);
    log.push('search_clicked');

    // ── 3. Clear and type contact name ──────────────────────────
    L('clearing search box...');
    await cdpClear(tabId);
    await sleep(200);

    L('typing contact name:', contact);
    await cdpType(tabId, contact);
    await sleep(2000); // WA needs time to fetch

    const searchVal = await evaluate(tabId,
      `document.querySelector(${JSON.stringify(SEARCH_SEL)})?.value || 'NOT FOUND'`);
    L('search box value after type:', searchVal);

    const focused2 = await evaluate(tabId, `document.activeElement?.tagName + '[' + document.activeElement?.getAttribute('aria-label') + '][value=' + document.activeElement?.value + ']'`);
    L('active element after typing:', focused2);
    log.push('typed_contact');

    // ── 4. Poll for results + full DOM dump on poll 2 ────────────
    L('polling for search results...');
    let resultInfo = null;
    for (let i = 0; i < 18; i++) {
      await sleep(600);
      resultInfo = await evaluate(tabId, `
        (function() {
          const selectors = [
            '[data-testid="cell-frame-container"]',
            '[data-testid="list-item"]',
            '[data-testid="mi-list-item"]',
            '[data-testid="chat-list-item"]',
            '[data-testid="listitem"]',
            '[role="option"]',
            '[role="listitem"]',
            'li',
          ];
          let all = [];
          for (const s of selectors) all.push(...document.querySelectorAll(s));
          all = [...new Set(all)].filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 10 && r.height > 10;
          });
          return {
            count: all.length,
            texts: all.slice(0,6).map(e=>e.textContent?.trim().slice(0,40)),
            dtIds: [...new Set(all.map(e=>e.getAttribute('data-testid')))].filter(Boolean),
          };
        })()
      `);
      L(`poll ${i+1}: ${resultInfo?.count} results | texts: ${resultInfo?.texts?.join(' | ')}`);

      // On poll 2, dump FULL data-testid inventory so we know what's in DOM
      if (i === 1) {
        const inv = await evaluate(tabId, `
          (function(){
            const m={};
            [...document.querySelectorAll('[data-testid]')].forEach(e=>{
              const d=e.getAttribute('data-testid'); m[d]=(m[d]||0)+1;
            });
            return m;
          })()
        `);
        L('FULL data-testid inventory:', JSON.stringify(inv));

        // Also dump sidebar HTML to see actual structure
        const sideHtml = await evaluate(tabId, `
          document.querySelector('#side,#pane-side')?.innerHTML?.slice(0,1200) || 'no sidebar'
        `);
        L('SIDEBAR HTML:', sideHtml);
      }

      if (resultInfo?.count > 0) break;
    }

    if (!resultInfo?.count) {
      return { ok: false, error: `no search results for "${contact}" after 18 polls`, log };
    }

    L('results found:', resultInfo.count, '| data-testids:', resultInfo.dtIds.join(','));
    L('result texts:', resultInfo.texts.join(' | '));

    // ── 5. Open the chat ─────────────────────────────────────────
    L('=== OPEN CHAT ATTEMPTS ===');

    // Re-focus search input
    await evaluate(tabId, `
      const inp = document.querySelector('input[aria-label*="Search" i], input[placeholder*="Search" i]');
      if (inp) { inp.focus(); console.log('[THERA-WA-PAGE] focused:', inp.getAttribute('aria-label')); }
      else console.log('[THERA-WA-PAGE] search input not found for focus');
    `);
    await sleep(300);

    const focusedBeforeNav = await evaluate(tabId, `document.activeElement?.tagName + '[' + (document.activeElement?.getAttribute('aria-label')||document.activeElement?.getAttribute('data-testid')) + ']'`);
    L('focused before nav keys:', focusedBeforeNav);

    // Strategy A: ArrowDown × 3 + Enter with proper key codes
    L('Strategy A: ArrowDown x3 + Enter...');
    for (let n = 0; n < 3; n++) {
      await cdpKey(tabId, 'ArrowDown');
      await sleep(250);
      const focused = await evaluate(tabId, `document.activeElement?.tagName + '[dt=' + document.activeElement?.getAttribute('data-testid') + ']'`);
      L(`  after ArrowDown #${n+1}, focused:`, focused);
    }
    await cdpKey(tabId, 'Enter');
    L('Enter pressed, waiting 2.5s...');
    await sleep(2500);

    let inChat = await evaluate(tabId, `
      (function(){
        const ce = !!document.querySelector('#main [contenteditable="true"]');
        const url = location.href;
        const main = document.querySelector('#main')?.innerHTML?.slice(0,200) || 'no #main';
        return { ce, url, main };
      })()
    `);
    L('Strategy A result:', JSON.stringify(inChat));

    // Strategy B: PointerEvent on result
    if (!inChat?.ce) {
      L('Strategy B: PointerEvent click...');
      const b = await evaluate(tabId, `
        (function(){
          const needle = ${JSON.stringify(contact.trim().toLowerCase())};
          const all = [...new Set([
            ...document.querySelectorAll('[data-testid="cell-frame-container"]'),
            ...document.querySelectorAll('[data-testid="list-item"]'),
            ...document.querySelectorAll('[data-testid="mi-list-item"]'),
            ...document.querySelectorAll('[role="option"]'),
            ...document.querySelectorAll('li'),
          ])].filter(el=>{const r=el.getBoundingClientRect();return r.width>10&&r.height>10;});
          const match = all.find(el=>el.textContent?.toLowerCase().includes(needle))||all[0];
          if (!match) return {ok:false,error:'no match element'};
          const inner = match.querySelector('[tabindex="0"],a,[role="button"]') || match;
          const opts = {bubbles:true,cancelable:true,isPrimary:true,view:window};
          ['pointerover','pointerenter','pointerdown','pointerup'].forEach(t=>inner.dispatchEvent(new PointerEvent(t,opts)));
          ['mousedown','mouseup','click'].forEach(t=>inner.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window})));
          inner.dispatchEvent(new PointerEvent('click',opts));
          const r = inner.getBoundingClientRect();
          return {ok:true, text:match.textContent?.trim().slice(0,40), rect:{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}};
        })()
      `);
      L('Strategy B click result:', JSON.stringify(b));
      await sleep(2500);
      inChat = await evaluate(tabId, `({ce:!!document.querySelector('#main [contenteditable="true"]'), url:location.href})`);
      L('Strategy B inChat:', JSON.stringify(inChat));

      // Strategy C: CDP raw coordinate click on the rect we got from B
      if (!inChat?.ce && b?.rect) {
        L('Strategy C: CDP coordinate click at', b.rect.x, b.rect.y);
        await cdpClick(tabId, b.rect.x, b.rect.y);
        await sleep(2500);
        inChat = await evaluate(tabId, `({ce:!!document.querySelector('#main [contenteditable="true"]'), url:location.href})`);
        L('Strategy C inChat:', JSON.stringify(inChat));
      }
    }

    if (!inChat?.ce) {
      const mainHtml = await evaluate(tabId, `document.querySelector('#main,#app')?.innerHTML?.slice(0,500)||'no #main'`);
      L('FINAL: compose not found. #main HTML:', mainHtml);
      return { ok: false, error: 'All strategies failed — chat did not open. Check [THERA-WA] logs for SIDEBAR HTML and data-testid inventory.', log };
    }
    log.push('chat_opened');
    L('=== CHAT IS OPEN ===');

    // ── 6. Focus compose box ─────────────────────────────────────
    L('focusing compose box...');
    const COMPOSE_SEL = '#main [contenteditable="true"], footer [contenteditable="true"]';
    await waitForRect(tabId, COMPOSE_SEL, 12000);
    await evaluate(tabId, `
      const el = document.querySelector('#main [contenteditable="true"]')
               || document.querySelector('footer [contenteditable="true"]');
      if (el) { el.click(); el.focus(); console.log('[THERA-WA-PAGE] compose focused, aria:', el.getAttribute('aria-label')); }
      else console.log('[THERA-WA-PAGE] compose not found!');
    `);
    await sleep(500);

    const focusedCompose = await evaluate(tabId, `document.activeElement?.getAttribute('aria-label') + ' tag=' + document.activeElement?.tagName + ' inMain=' + !!document.activeElement?.closest('#main')`);
    L('focused for compose:', focusedCompose);
    log.push('compose_focused');

    // ── 7. Type message ──────────────────────────────────────────
    L('typing message:', message.slice(0,50));
    await cdpKey(tabId, 'a', 2); // Ctrl+A select all
    await sleep(100);
    await cdpKey(tabId, 'Backspace');
    await sleep(100);
    await cdpType(tabId, message);
    await sleep(800);

    const composeText = await evaluate(tabId, `
      (document.querySelector('#main [contenteditable="true"]') || document.querySelector('footer [contenteditable="true"]'))?.textContent?.trim() || ''
    `);
    L('compose text after type:', composeText.slice(0, 100));
    if (!composeText.trim()) {
      return { ok: false, error: 'message did not appear in compose box after typing', log };
    }
    log.push('typed_message');

    // ── 8. Type message ──────────────────────────────────────────
    L('typing message via CDP...');
    await cdpKey(tabId, 'a', 2); // Ctrl+A
    await sleep(80);
    await cdpKey(tabId, 'Backspace');
    await sleep(80);
    await cdpType(tabId, message);
    await sleep(600);

    const composeText = await evaluate(tabId, `
      (document.querySelector('#main [contenteditable="true"]')
       || document.querySelector('footer [contenteditable="true"]'))
        ?.textContent?.trim() || ''
    `);
    L('compose text after type:', composeText.slice(0, 80));
    if (!composeText.trim()) {
      return { ok: false, error: 'message did not appear in compose box', log };
    }
    log.push('typed_message');

    // ── 8. Click send via DOM click ──────────────────────────────
    L('clicking send button...');
    const sent = await evaluate(tabId, `
      (function() {
        const sels = ['button[data-testid="send"]','[data-testid="send"]','button[aria-label="Send"]','[aria-label="Send"]','span[data-icon="send"]'];
        for (const s of sels) {
          const el = document.querySelector(s);
          if (el) { el.click(); return s; }
        }
        // fallback: last button in footer
        const btns = document.querySelectorAll('footer button');
        if (btns.length) { btns[btns.length-1].click(); return 'footer-last'; }
        return null;
      })()
    `);
    L('send result:', sent);
    if (!sent) {
      // last resort: Enter key via CDP
      L('send btn not found — pressing Enter');
      await cdpKey(tabId, 'Enter');
    }

    log.push('sent');
    await sleep(500);
    L('DONE:', log.join(' → '));
    return { ok: true, log };

  } catch (err) {
    console.error('[THERA-WA] ERROR:', err.message);
    return { ok: false, error: err.message, log };
  } finally {
    await cdpDetach(tabId);
    console.log('[THERA-WA] debugger detached');
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

function waitForTabLoad(tabId, timeout = 20000) {
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
