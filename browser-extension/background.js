/**
 * Thera Bridge — background service worker
 *
 * Uses long-polling so commands execute within ~1 second of being queued.
 * The SW stays alive because it always has an open fetch connection.
 */

const BRIDGE = 'http://127.0.0.1:7979';

// ── Tab tracking ───────────────────────────────────────────────
const DOOM_HOSTS = ['twitter.com', 'x.com', 'reddit.com', 'youtube.com', 'instagram.com', 'tiktok.com', 'facebook.com'];
const doomTimers = {};

function isDoom(url) {
  try {
    const h = new URL(url).hostname.replace('www.', '');
    return DOOM_HOSTS.some(d => h === d || h.endsWith('.' + d));
  } catch (_) { return false; }
}

async function sendTab(tab) {
  if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;
  const doom = isDoom(tab.url);
  if (doom && !doomTimers[tab.id]) doomTimers[tab.id] = Date.now();
  if (!doom) delete doomTimers[tab.id];
  const doomMinutes = doom && doomTimers[tab.id] ? Math.floor((Date.now() - doomTimers[tab.id]) / 60000) : 0;
  try {
    await fetch(`${BRIDGE}/tab`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: tab.url, title: tab.title || '', tabId: tab.id, isDoom: doom, doomMinutes, timestamp: Date.now() }),
    });
  } catch (_) {}
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try { sendTab(await chrome.tabs.get(tabId)); } catch (_) {}
});
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (change.status === 'complete' && tab.active) sendTab(tab);
});

// ── Long-poll command loop ─────────────────────────────────────
// Keeps a persistent open connection to the bridge server.
// Server holds the response until a command arrives (or 25s timeout).
// This means commands execute within ~1 second with no polling delay.
// The open fetch also keeps the service worker alive.
let polling = false;

async function startPolling() {
  if (polling) return;
  polling = true;
  while (true) {
    try {
      const res = await fetch(`${BRIDGE}/commands?wait=1`, { signal: AbortSignal.timeout(28000) });
      if (res.ok) {
        const commands = await res.json();
        for (const cmd of commands) await dispatch(cmd);
      }
    } catch (_) {
      // Bridge not running or request timed out — wait a bit before retry
      await sleep(2000);
    }
  }
}

startPolling();

// ── Command dispatcher ─────────────────────────────────────────
async function dispatch(cmd) {
  if (!cmd?.type) return;
  try {
    switch (cmd.type) {

      case 'open-url': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (cmd.newTab || !tabs[0]) {
          await chrome.tabs.create({ url: cmd.url, active: true });
        } else {
          await chrome.tabs.update(tabs[0].id, { url: cmd.url });
        }
        break;
      }

      case 'automate': {
        let tabId = cmd.tabId;
        if (cmd.url) {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = tabs[0]?.id;
          if (!tabId) break;
          await chrome.tabs.update(tabId, { url: cmd.url, active: true });
          await waitForTabLoad(tabId);
          await sleep(cmd.waitAfterNav || 2000);
        }
        if (!tabId) {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = tabs[0]?.id;
        }
        if (!tabId || !cmd.steps?.length) break;
        const result = await chrome.tabs.sendMessage(tabId, { type: 'automate-steps', steps: cmd.steps });
        await reportResult(cmd.taskId, result);
        break;
      }

      case 'whatsapp-dm': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        let tabId = tabs[0]?.id;
        if (!tabId) break;

        const tab = tabs[0];
        const onWA = tab.url?.includes('web.whatsapp.com');
        if (!onWA) {
          await chrome.tabs.update(tabId, { url: 'https://web.whatsapp.com', active: true });
          await waitForTabLoad(tabId);
          await sleep(4000); // WhatsApp SPA needs time
        } else {
          await sleep(500);
        }

        // Use multiple selector fallbacks for WhatsApp Web
        const searchSel = '[data-testid="search-input"], [title="Search input textbox"], div[contenteditable][data-tab="3"]';
        const msgSel    = '[data-testid="conversation-compose-box-input"], div[contenteditable][data-tab="10"], footer div[contenteditable]';

        await chrome.tabs.sendMessage(tabId, {
          type: 'automate-steps',
          steps: [
            { action: 'wait',  selector: searchSel, timeout: 15000 },
            { action: 'click', selector: searchSel },
            { action: 'type',  selector: searchSel, text: cmd.to, clear: true },
            { action: 'sleep', ms: 1500 },
            // Click the first search result — WhatsApp renders the contact name in a span
            { action: 'click', selector: `span[title*="${cmd.to}"]`, optional: true },
            { action: 'wait',  selector: msgSel, timeout: 6000 },
            { action: 'click', selector: msgSel },
            { action: 'type',  selector: msgSel, text: cmd.message },
            { action: 'press', key: 'Enter', selector: msgSel },
          ],
        });
        break;
      }

      case 'instagram-dm': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (!tabId) break;
        await chrome.tabs.update(tabId, { url: 'https://www.instagram.com/direct/inbox/', active: true });
        await waitForTabLoad(tabId);
        await sleep(3000);
        await chrome.tabs.sendMessage(tabId, {
          type: 'automate-steps',
          steps: [
            { action: 'wait',  selector: 'svg[aria-label="New message"]', timeout: 10000 },
            { action: 'click', selector: 'svg[aria-label="New message"]' },
            { action: 'wait',  selector: 'input[placeholder="Search..."], input[name="queryBox"]', timeout: 5000 },
            { action: 'type',  selector: 'input[placeholder="Search..."], input[name="queryBox"]', text: cmd.to },
            { action: 'sleep', ms: 1500 },
            { action: 'click', selector: `span:has-text("${cmd.to}")`, optional: true },
            { action: 'click', selector: 'button[type="submit"]', optional: true },
            { action: 'wait',  selector: 'textarea[placeholder*="Message"], [aria-label*="Message"]', timeout: 5000 },
            { action: 'click', selector: 'textarea[placeholder*="Message"], [aria-label*="Message"]' },
            { action: 'type',  selector: 'textarea[placeholder*="Message"], [aria-label*="Message"]', text: cmd.message },
            { action: 'press', key: 'Enter' },
          ],
        });
        break;
      }

      case 'close-tab':
        if (cmd.tabId) await chrome.tabs.remove(cmd.tabId);
        break;
      case 'focus-tab':
        if (cmd.tabId) await chrome.tabs.update(cmd.tabId, { active: true });
        break;
      case 'get-tabs': {
        const all = await chrome.tabs.query({});
        await fetch(`${BRIDGE}/tab`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'tabs-list', tabs: all.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active })) }),
        });
        break;
      }
    }
  } catch (e) {
    console.error('[THERA] command dispatch failed:', cmd.type, e.message);
  }
}

async function reportResult(taskId, result) {
  try {
    await fetch(`${BRIDGE}/tab`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'automate-result', taskId, result }),
    });
  } catch (_) {}
}

function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(resolve, 10000);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Send current tab on load
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  if (tabs[0]) sendTab(tabs[0]);
});
