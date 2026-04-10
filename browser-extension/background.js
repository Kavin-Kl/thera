/**
 * Thera Bridge — background service worker
 */

const BRIDGE = 'http://127.0.0.1:7979';

const DOOM_HOSTS = ['twitter.com','x.com','reddit.com','youtube.com','instagram.com','tiktok.com','facebook.com'];
const doomTimers = {};

function isDoom(url) {
  try { const h = new URL(url).hostname.replace('www.',''); return DOOM_HOSTS.some(d=>h===d||h.endsWith('.'+d)); }
  catch(_){ return false; }
}

async function sendTab(tab) {
  if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;
  const doom = isDoom(tab.url);
  if (doom && !doomTimers[tab.id]) doomTimers[tab.id] = Date.now();
  if (!doom) delete doomTimers[tab.id];
  const doomMinutes = doom && doomTimers[tab.id] ? Math.floor((Date.now()-doomTimers[tab.id])/60000) : 0;
  try {
    await fetch(`${BRIDGE}/tab`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({url:tab.url, title:tab.title||'', tabId:tab.id, isDoom:doom, doomMinutes, timestamp:Date.now()}),
    });
  } catch(_){}
}

chrome.tabs.onActivated.addListener(async ({tabId}) => { try { sendTab(await chrome.tabs.get(tabId)); } catch(_){} });
chrome.tabs.onUpdated.addListener((_id, change, tab) => { if (change.status==='complete' && tab.active) sendTab(tab); });

// ── Long-poll ──────────────────────────────────────────────────
let polling = false;
let pollCount = 0;
async function startPolling() {
  if (polling) return;
  polling = true;
  console.log('[THERA-BRIDGE] starting long-poll loop to', BRIDGE);
  while (true) {
    try {
      pollCount++;
      const res = await fetch(`${BRIDGE}/commands?wait=1`, { signal: AbortSignal.timeout(28000) });
      if (res.ok) {
        const commands = await res.json();
        if (commands.length > 0) {
          console.log(`[THERA-BRIDGE] poll #${pollCount} got ${commands.length} command(s):`, commands.map(c=>c.type));
          for (const cmd of commands) dispatch(cmd);
        }
        // silent if empty — keeps console clean
      } else {
        console.warn(`[THERA-BRIDGE] poll #${pollCount} non-ok status:`, res.status);
        await sleep(2000);
      }
    } catch(e) {
      console.warn(`[THERA-BRIDGE] poll #${pollCount} error:`, e.message, '— retrying in 2s');
      await sleep(2000);
    }
  }
}
startPolling();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function waitForTabLoad(tabId, timeout = 15000) {
  return new Promise(resolve => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); resolve(); }, timeout);
    const fn = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(t); chrome.tabs.onUpdated.removeListener(fn); resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(fn);
  });
}

async function sendToTab(tabId, msg, retries = 5) {
  console.log(`[THERA-BRIDGE] sendToTab tabId=${tabId} type=${msg.type} steps=${msg.steps?.length}`);
  for (let i = 0; i < retries; i++) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, msg);
      console.log(`[THERA-BRIDGE] sendToTab success on attempt ${i+1}:`, JSON.stringify(result).slice(0, 200));
      return result;
    } catch(e) {
      console.warn(`[THERA-BRIDGE] sendToTab attempt ${i+1} failed:`, e.message);
      if (i === 0) {
        console.log('[THERA-BRIDGE] injecting content.js and retrying...');
        try { await chrome.scripting.executeScript({ target:{tabId}, files:['content.js'] }); await sleep(500); } catch(injectErr){
          console.error('[THERA-BRIDGE] content.js inject failed:', injectErr.message);
        }
      } else if (i < retries - 1) {
        await sleep(1500);
      } else {
        throw new Error(`No content script after ${retries} tries: ${e.message}`);
      }
    }
  }
}

// ── WhatsApp MAIN-world automation ────────────────────────────
// Injected into WA Web's MAIN world. Logs appear in WA Web's DevTools console.
function _waAutomate(contact, message) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const L = (...a) => console.log('[THERA-WA]', ...a);

  // Wait for a selector to appear in the DOM
  function waitFor(sel, ms) {
    ms = ms || 15000;
    return new Promise((res, rej) => {
      try { const el = document.querySelector(sel); if (el) return res(el); } catch(e) { return rej(e); }
      const ob = new MutationObserver(() => {
        try { const f = document.querySelector(sel); if (f) { ob.disconnect(); clearTimeout(t); res(f); } } catch(_){}
      });
      ob.observe(document.body, { childList:true, subtree:true });
      const t = setTimeout(() => { ob.disconnect(); rej(new Error('Timeout: '+sel)); }, ms);
    });
  }

  // Type text into a focused Lexical editor using execCommand — fires beforeinput
  function typeInto(el, text) {
    el.focus();
    // select-all + delete to clear first
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    // insert all at once — Lexical handles this fine
    document.execCommand('insertText', false, text);
    L('typeInto result, element text now:', (el.textContent||'').slice(0,80));
  }

  // Click the WA send button — always more reliable than Enter keydown
  async function clickSend() {
    const sendSels = [
      'button[data-testid="send"]',
      '[data-testid="send"]',
      'button[aria-label="Send"]',
      '[aria-label="Send"]',
      'span[data-icon="send"]',
    ];
    for (const s of sendSels) {
      const btn = document.querySelector(s);
      if (btn) { L('send btn found:', s); btn.click(); return true; }
    }
    // fallback: look for any button near the footer
    const footerBtns = document.querySelectorAll('footer button');
    L('footer buttons found:', footerBtns.length);
    if (footerBtns.length > 0) {
      const last = footerBtns[footerBtns.length - 1];
      L('clicking last footer button:', last.getAttribute('aria-label'), last.getAttribute('data-testid'));
      last.click();
      return true;
    }
    return false;
  }

  return (async function run() {
    const log = [];
    L('START contact=', contact, 'message=', message.slice(0,50));

    // ── STEP 1: Wait for WA sidebar ──────────────────────────────
    try { await waitFor('#pane-side', 25000); }
    catch(e) { return { ok:false, error:'whatsapp not ready — is it logged in? ' + e.message, log }; }
    await sleep(800);
    log.push('app_ready');

    // ── STEP 2: Find and focus search box ────────────────────────
    // Log all contenteditable in sidebar so we can see what WA renders
    const ceAll = [...document.querySelectorAll('#pane-side [contenteditable]')];
    L(`contenteditable in #pane-side: ${ceAll.length}`);
    ceAll.forEach((el,i) => L(`  [${i}] data-tab=${el.getAttribute('data-tab')} aria-label="${el.getAttribute('aria-label')}" data-lexical=${!!el.getAttribute('data-lexical-editor')}`));

    const searchSels = [
      '#pane-side div[contenteditable="true"]',
      'div[contenteditable][data-tab="3"]',
      '[data-testid="search-input"]',
      '[aria-label="Search input textbox"]',
      '[aria-label="Search or start new chat"]',
      '[title*="Search"]',
    ];
    let search = null;
    for (const s of searchSels) {
      search = document.querySelector(s);
      if (search) { log.push('search:'+s); L('search found:', s); break; }
    }
    if (!search) {
      L('ERROR: search box not found');
      return { ok:false, error:'search box not found — WA may have changed its DOM', log };
    }

    // ── STEP 3: Type contact name ────────────────────────────────
    search.dispatchEvent(new MouseEvent('mousedown', { bubbles:true }));
    search.click();
    await sleep(300);
    typeInto(search, contact);
    log.push('typed_contact');
    L('typed, search text now:', search.textContent?.slice(0,60));

    // ── STEP 4: Wait for search results ─────────────────────────
    // Poll for up to 6 seconds
    let results = [];
    for (let i = 0; i < 12; i++) {
      await sleep(500);
      results = [
        ...document.querySelectorAll('[data-testid="cell-frame-container"]'),
        ...document.querySelectorAll('[data-testid="chat-list-item"]'),
        ...document.querySelectorAll('#pane-side li'),
      ];
      // deduplicate
      results = [...new Set(results)];
      L(`poll ${i+1}: ${results.length} results`);
      if (results.length > 0) break;
    }

    if (results.length === 0) {
      L('no results after 6s — contact not found. search box text:', search.textContent);
      return { ok:false, error:`no search results for "${contact}" — check the name matches your WA contacts`, log };
    }

    // Log all results so we can verify the right one is first
    results.slice(0,5).forEach((el,i) => L(`  result[${i}]:`, el.textContent?.trim().slice(0,60)));

    // ── STEP 5: Click the first result ──────────────────────────
    const firstResult = results[0];
    L('clicking result:', firstResult.textContent?.trim().slice(0,60));
    firstResult.dispatchEvent(new MouseEvent('mousedown', { bubbles:true }));
    firstResult.dispatchEvent(new MouseEvent('mouseup',   { bubbles:true }));
    firstResult.click();
    log.push('clicked_result');
    await sleep(2000);
    L('after click URL:', location.href);

    // ── STEP 6: Find compose box ─────────────────────────────────
    const composeSels = [
      'footer div[contenteditable="true"]',
      'div[contenteditable][data-tab="10"]',
      'div[contenteditable][data-tab="6"]',
      '[data-testid="conversation-compose-box-input"]',
      '[aria-label="Type a message"]',
      'div[contenteditable][spellcheck="true"]',
    ];
    let compose = null;
    for (const s of composeSels) {
      compose = document.querySelector(s);
      if (compose) { log.push('compose:'+s); L('compose found:', s); break; }
    }
    if (!compose) {
      // Any contenteditable NOT in the sidebar
      const allCE = [...document.querySelectorAll('[contenteditable="true"]')];
      L('all CE after chat open:', allCE.length);
      allCE.forEach((el,i) => L(`  [${i}] data-tab=${el.getAttribute('data-tab')} aria-label="${el.getAttribute('aria-label')}" inFooter=${!!el.closest('footer')} inPane=${!!el.closest('#pane-side')}`));
      compose = allCE.find(el => !el.closest('#pane-side'));
      if (compose) log.push('compose:outside-pane');
    }
    if (!compose) {
      try { compose = await waitFor('footer div[contenteditable="true"]', 8000); log.push('compose:waited'); }
      catch(e) { return { ok:false, error:'compose box not found: '+e.message, log }; }
    }

    // ── STEP 7: Type message ─────────────────────────────────────
    compose.dispatchEvent(new MouseEvent('mousedown', { bubbles:true }));
    compose.click();
    await sleep(300);
    typeInto(compose, message);
    log.push('typed_message');
    const composeText = compose.textContent || compose.innerText || '';
    L('compose text after type:', composeText.slice(0,80));
    if (!composeText.trim()) {
      L('WARNING: compose still empty after typeInto');
      return { ok:false, error:'message did not enter compose box — WA may have blocked it', log };
    }
    await sleep(500);

    // ── STEP 8: Click send button ────────────────────────────────
    const sent = await clickSend();
    if (!sent) {
      L('send button not found');
      return { ok:false, error:'send button not found', log };
    }
    log.push('sent');
    await sleep(400);
    L('DONE:', log.join(' → '));
    return { ok:true, log };
  })();
}

// ── Command dispatcher ─────────────────────────────────────────
async function dispatch(cmd) {
  if (!cmd?.type) return;
  console.log('[THERA-BRIDGE] dispatch START:', cmd.type, 'taskId:', cmd.taskId, JSON.stringify(cmd).slice(0,200));
  try {
    switch(cmd.type) {

      case 'open-url': {
        const tabs = await chrome.tabs.query({ active:true, currentWindow:true });
        console.log('[THERA-BRIDGE] open-url, current tab:', tabs[0]?.url?.slice(0,60));
        if (cmd.newTab || !tabs[0]) await chrome.tabs.create({ url:cmd.url, active:true });
        else await chrome.tabs.update(tabs[0].id, { url:cmd.url });
        break;
      }

      case 'automate': {
        let tabId = cmd.tabId;
        if (cmd.url) {
          const tabs = await chrome.tabs.query({ active:true, currentWindow:true });
          tabId = tabs[0]?.id; if (!tabId) { console.warn('[THERA-BRIDGE] automate: no active tab'); break; }
          await chrome.tabs.update(tabId, { url:cmd.url, active:true });
          await waitForTabLoad(tabId);
          await sleep(cmd.waitAfterNav || 2000);
        }
        if (!tabId) { const tabs = await chrome.tabs.query({active:true,currentWindow:true}); tabId=tabs[0]?.id; }
        if (!tabId || !cmd.steps?.length) { console.warn('[THERA-BRIDGE] automate: no tabId or steps'); break; }
        const result = await sendToTab(tabId, { type:'automate-steps', steps:cmd.steps });
        await reportResult(cmd.taskId, result);
        break;
      }

      case 'whatsapp-dm': {
        console.log('[THERA-BRIDGE] whatsapp-dm to:', cmd.to, 'message:', cmd.message?.slice(0,50));

        // First look for an existing WhatsApp tab across ALL windows
        let waTab = (await chrome.tabs.query({ url: '*://web.whatsapp.com/*' }))[0];
        console.log('[THERA-BRIDGE] existing WA tab:', waTab ? waTab.url : 'none');

        // Fall back to the active tab in any window
        if (!waTab) {
          const allActive = await chrome.tabs.query({ active:true });
          console.log('[THERA-BRIDGE] all active tabs across windows:', allActive.map(t=>t.url?.slice(0,60)));
          waTab = allActive[0];
        }

        let tabId = waTab?.id;
        if (!tabId) {
          console.error('[THERA-BRIDGE] whatsapp-dm: no tab found at all');
          await reportResult(cmd.taskId, { ok: false, error: 'no browser tab found' });
          break;
        }

        // Navigate to WhatsApp if not already there
        if (!waTab.url?.includes('web.whatsapp.com')) {
          console.log('[THERA-BRIDGE] navigating tab', tabId, 'to web.whatsapp.com...');
          await chrome.tabs.update(tabId, { url:'https://web.whatsapp.com', active:true });
          await waitForTabLoad(tabId);
          console.log('[THERA-BRIDGE] WhatsApp loaded, sleeping 5s for app init...');
          await sleep(5000);
        } else {
          console.log('[THERA-BRIDGE] already on WhatsApp tab', tabId, 'proceeding...');
          await chrome.tabs.update(tabId, { active:true }); // bring it to front
          await sleep(500);
        }

        // Inject and run in MAIN world
        console.log('[THERA-BRIDGE] injecting _waAutomate into MAIN world...');
        let injection;
        try {
          injection = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: _waAutomate,
            args: [cmd.to, cmd.message],
          });
          console.log('[THERA-BRIDGE] executeScript completed, result:', JSON.stringify(injection?.[0]?.result).slice(0,300));
        } catch(e) {
          console.error('[THERA-BRIDGE] executeScript FAILED:', e.message);
          await reportResult(cmd.taskId, { ok: false, error: 'executeScript failed: ' + e.message });
          break;
        }

        const result = injection?.[0]?.result;
        console.log('[THERA-BRIDGE] WhatsApp final result:', JSON.stringify(result));
        await reportResult(cmd.taskId, result || { ok: false, error: 'no injection result' });
        break;
      }

      case 'instagram-dm': {
        console.log('[THERA-BRIDGE] instagram-dm to:', cmd.to, 'message:', cmd.message?.slice(0,50));

        // Look for an existing Instagram tab first, fall back to any active tab
        let igTab = (await chrome.tabs.query({ url: '*://*.instagram.com/*' }))[0];
        if (!igTab) {
          const allActive = await chrome.tabs.query({ active:true });
          igTab = allActive[0];
        }
        console.log('[THERA-BRIDGE] using tab:', igTab?.url?.slice(0,80));
        let tabId = igTab?.id;
        if (!tabId) {
          console.error('[THERA-BRIDGE] instagram-dm: no tab found');
          await reportResult(cmd.taskId, { ok: false, error: 'no browser tab found' });
          break;
        }

        const igUsername = cmd.to.replace(/^@/, '');
        const profileUrl = `https://www.instagram.com/${encodeURIComponent(igUsername)}/`;
        console.log('[THERA-BRIDGE] navigating to Instagram profile:', profileUrl);
        await chrome.tabs.update(tabId, { url: profileUrl, active:true });
        await waitForTabLoad(tabId);
        console.log('[THERA-BRIDGE] profile loaded, sleeping 3.5s...');
        await sleep(3500);

        const steps = [
          { action:'wait', selector:'header, main section', timeout:12000 },
          { action:'sleep', ms:500 },
          { action:'click',
            selector:'[role="button"][aria-label*="essage"], a[role="link"][aria-label*="essage"]',
            optional:true },
          { action:'click-text', selector:'button, [role="button"], a[role="link"]', text:'Message', optional:true },
          { action:'sleep', ms:2500 },
          { action:'wait',
            selector:'div[role="textbox"], textarea[placeholder*="essage"], div[contenteditable="true"]',
            timeout:8000 },
          { action:'click',
            selector:'div[role="textbox"], textarea[placeholder*="essage"], div[contenteditable="true"]' },
          { action:'paste',
            selector:'div[role="textbox"], textarea[placeholder*="essage"], div[contenteditable="true"]',
            text: cmd.message },
          { action:'sleep', ms:400 },
          { action:'press', key:'Enter' },
        ];

        console.log('[THERA-BRIDGE] sending', steps.length, 'steps to content script...');
        let result;
        try {
          result = await sendToTab(tabId, { type:'automate-steps', steps });
        } catch(e) {
          console.error('[THERA-BRIDGE] sendToTab failed:', e.message);
          await reportResult(cmd.taskId, { ok: false, error: 'content script error: ' + e.message });
          break;
        }
        console.log('[THERA-BRIDGE] Instagram step results:', JSON.stringify(result));
        await reportResult(cmd.taskId, result?.ok !== false
          ? { ok: true, log: result?.results?.map(r => `${r.step}:${r.ok?'ok':r.error}`) }
          : { ok: false, error: result?.error || 'automation failed' });
        break;
      }

      case 'close-tab':  if (cmd.tabId) await chrome.tabs.remove(cmd.tabId); break;
      case 'focus-tab':  if (cmd.tabId) await chrome.tabs.update(cmd.tabId, { active:true }); break;
      case 'get-tabs': {
        const all = await chrome.tabs.query({});
        await fetch(`${BRIDGE}/tab`, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ type:'tabs-list', tabs:all.map(t=>({id:t.id,url:t.url,title:t.title,active:t.active})) }),
        });
        break;
      }

      default:
        console.warn('[THERA-BRIDGE] unknown command type:', cmd.type);
    }

    console.log('[THERA-BRIDGE] dispatch END:', cmd.type);
  } catch(e) {
    console.error('[THERA-BRIDGE] dispatch UNCAUGHT ERROR for', cmd.type, ':', e.message, e.stack);
    await reportResult(cmd.taskId, { ok: false, error: 'dispatch error: ' + e.message });
  }
}

async function reportResult(taskId, result) {
  if (!taskId) return;
  console.log('[THERA-BRIDGE] reportResult taskId:', taskId, 'result:', JSON.stringify(result).slice(0,200));
  try {
    const res = await fetch(`${BRIDGE}/tab`, { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ type:'automate-result', taskId, result }) });
    console.log('[THERA-BRIDGE] reportResult HTTP status:', res.status);
  } catch(e) {
    console.error('[THERA-BRIDGE] reportResult fetch failed:', e.message);
  }
}

chrome.tabs.query({ active:true, currentWindow:true }, tabs => { if (tabs[0]) sendTab(tabs[0]); });
