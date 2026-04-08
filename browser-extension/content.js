/**
 * Thera Bridge — content script
 *
 * Executes automation steps sent from the background service worker.
 * Steps: wait, click, type, press, read, scroll, clear
 */

// ── Automation executor ────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'automate-steps') {
    executeSteps(msg.steps)
      .then(results => sendResponse({ ok: true, results }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async
  }

  if (msg.type === 'read-page') {
    sendResponse({
      ok: true,
      title: document.title,
      url: location.href,
      text: document.body?.innerText?.slice(0, 2000) || '',
    });
  }
});

async function executeSteps(steps) {
  const results = [];
  for (const step of steps) {
    try {
      const r = await executeStep(step);
      results.push({ step: step.action, ok: true, value: r });
    } catch (e) {
      results.push({ step: step.action, ok: false, error: e.message });
      if (!step.optional) break; // halt on error unless step is marked optional
    }
  }
  return results;
}

async function executeStep(step) {
  switch (step.action) {

    case 'wait': {
      return await waitFor(step.selector, step.timeout || 8000);
    }

    case 'click': {
      const el = await waitFor(step.selector, step.timeout || 5000);
      el.click();
      return 'clicked';
    }

    case 'type': {
      const el = await waitFor(step.selector, step.timeout || 5000);
      el.focus();
      const isContentEditable = el.contentEditable === 'true' || el.isContentEditable;

      if (step.clear) {
        if (isContentEditable) {
          el.innerHTML = '';
        } else {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
            || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (setter) setter.call(el, '');
          else el.value = '';
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(100);
      }

      if (isContentEditable) {
        // WhatsApp / Instagram use contenteditable divs.
        // execCommand is the most reliable way to trigger their event handlers.
        document.execCommand('insertText', false, step.text);
      } else {
        // Standard input / textarea — type char-by-char to trigger React
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        for (const char of step.text) {
          if (setter) setter.call(el, el.value + char);
          else el.value += char;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keydown',  { key: char, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup',    { key: char, bubbles: true }));
          await sleep(30 + Math.random() * 40);
        }
      }
      return 'typed';
    }

    case 'press': {
      const target = step.selector ? await waitFor(step.selector, 3000) : document.activeElement;
      const key = step.key;
      target.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode: keyCode(key), bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keypress', { key, keyCode: keyCode(key), bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keyup', { key, keyCode: keyCode(key), bubbles: true }));
      return 'pressed ' + key;
    }

    case 'read': {
      const el = step.selector
        ? document.querySelector(step.selector)
        : document.body;
      return el?.innerText?.trim().slice(0, 500) || '';
    }

    case 'scroll': {
      window.scrollBy(0, step.amount || 300);
      return 'scrolled';
    }

    case 'sleep': {
      await sleep(step.ms || 1000);
      return 'slept';
    }

    default:
      throw new Error(`Unknown step action: ${step.action}`);
  }
}

// ── Helpers ────────────────────────────────────────────────────
function waitFor(selector, timeoutMs) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);

    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(found);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for "${selector}"`));
    }, timeoutMs);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function keyCode(key) {
  const map = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowDown: 40, ArrowUp: 38 };
  return map[key] || key.charCodeAt(0);
}

// ── Doom-scroll detection ──────────────────────────────────────
const DOOM_HOSTS = ['twitter.com', 'x.com', 'reddit.com', 'youtube.com', 'instagram.com', 'tiktok.com', 'facebook.com'];
const host = location.hostname.replace('www.', '');
if (DOOM_HOSTS.some(h => host === h || host.endsWith('.' + h))) {
  let scrollCount = 0, lastReport = 0;
  window.addEventListener('scroll', () => {
    scrollCount++;
    if (Date.now() - lastReport > 30000 && scrollCount > 10) {
      chrome.runtime.sendMessage({ type: 'scroll-activity', host, scrollCount });
      scrollCount = 0; lastReport = Date.now();
    }
  }, { passive: true });
}
