/**
 * Thera Bridge — content script
 *
 * Used for general automation (Instagram DM, browser.automate steps, etc.)
 * WhatsApp uses chrome.scripting.executeScript({world:'MAIN'}) instead —
 * see background.js — because execCommand requires the page's main world.
 */

// Guard against double-injection (manifest auto-injects + background may inject)
if (!window.__theraContentLoaded) {
  window.__theraContentLoaded = true;
  console.log('[THERA-CONTENT] content script loaded on', location.href);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    console.log('[THERA-CONTENT] received message type:', msg.type, 'steps:', msg.steps?.length);
    if (msg.type === 'automate-steps') {
      executeSteps(msg.steps)
        .then(results => {
          console.log('[THERA-CONTENT] steps done:', JSON.stringify(results).slice(0, 300));
          sendResponse({ ok: true, results });
        })
        .catch(err => {
          console.error('[THERA-CONTENT] steps failed:', err.message);
          sendResponse({ ok: false, error: err.message });
        });
      return true;
    }
    if (msg.type === 'read-page') {
      sendResponse({ ok:true, title:document.title, url:location.href,
        text: document.body?.innerText?.slice(0,2000) || '' });
    }
  });

  // Doom-scroll detection
  const DOOM_HOSTS = ['twitter.com','x.com','reddit.com','youtube.com','instagram.com','tiktok.com','facebook.com'];
  const host = location.hostname.replace('www.','');
  if (DOOM_HOSTS.some(h => host === h || host.endsWith('.'+h))) {
    let scrollCount = 0, lastReport = 0;
    window.addEventListener('scroll', () => {
      scrollCount++;
      if (Date.now() - lastReport > 30000 && scrollCount > 10) {
        chrome.runtime.sendMessage({ type:'scroll-activity', host, scrollCount });
        scrollCount = 0; lastReport = Date.now();
      }
    }, { passive: true });
  }
} else {
  console.log('[THERA-CONTENT] already loaded, skipping re-init on', location.href);
}

// ── Step executor ──────────────────────────────────────────────

async function executeSteps(steps) {
  const results = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    console.log(`[THERA-CONTENT] step ${i+1}/${steps.length}: ${step.action}`, step.selector || '', step.text?.slice(0,40) || '');
    try {
      const r = await executeStep(step);
      console.log(`[THERA-CONTENT] step ${i+1} OK:`, r?.toString?.()?.slice(0,80) || r);
      results.push({ step: step.action, ok: true, value: r });
    } catch (e) {
      console.error(`[THERA-CONTENT] step ${i+1} FAILED (optional=${step.optional}):`, e.message);
      results.push({ step: step.action, ok: false, error: e.message });
      if (!step.optional) {
        console.error('[THERA-CONTENT] non-optional step failed, aborting remaining steps');
        break;
      }
    }
  }
  return results;
}

async function executeStep(step) {
  switch (step.action) {

    case 'wait': {
      console.log('[THERA-CONTENT] waiting for:', step.selector, 'timeout:', step.timeout || 8000);
      const el = await waitFor(step.selector, step.timeout || 8000);
      console.log('[THERA-CONTENT] found:', step.selector, '| tag:', el.tagName, 'visible:', el.offsetParent !== null);
      return el;
    }

    case 'click': {
      console.log('[THERA-CONTENT] clicking:', step.selector);
      const el = await waitFor(step.selector, step.timeout || 5000);
      console.log('[THERA-CONTENT] click target:', el.tagName, el.className?.slice(0,60), 'aria-label:', el.getAttribute('aria-label'));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true }));
      el.dispatchEvent(new MouseEvent('mouseup',   { bubbles:true, cancelable:true }));
      el.click();
      el.focus();
      return 'clicked';
    }

    case 'type': {
      const el = await waitFor(step.selector, step.timeout || 5000);
      el.focus();
      const isCE = el.contentEditable === 'true' || el.isContentEditable;
      console.log('[THERA-CONTENT] typing into:', el.tagName, 'contentEditable:', isCE, 'text len:', step.text?.length);

      if (step.clear) {
        if (isCE) {
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
        } else {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
            || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (setter) setter.call(el, ''); else el.value = '';
        }
        el.dispatchEvent(new Event('input', { bubbles:true }));
        await sleep(150);
      }

      if (isCE) {
        // Use ClipboardEvent paste — works on React inputs where execCommand is unreliable
        el.focus();
        const dt = new DataTransfer();
        dt.setData('text/plain', step.text);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        await sleep(100);
        const contentAfter = el.textContent || el.innerText || '';
        console.log('[THERA-CONTENT] after paste, element content:', contentAfter.slice(0,80));
        // Fallback: try execCommand if paste didn't populate anything
        if (!contentAfter.includes(step.text.slice(0, 5))) {
          console.log('[THERA-CONTENT] paste fallback: trying execCommand insertText');
          document.execCommand('insertText', false, step.text);
        }
      } else {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        for (const char of step.text) {
          if (setter) setter.call(el, el.value + char); else el.value += char;
          el.dispatchEvent(new Event('input', { bubbles:true }));
          el.dispatchEvent(new KeyboardEvent('keydown',  { key:char, bubbles:true }));
          el.dispatchEvent(new KeyboardEvent('keypress', { key:char, bubbles:true }));
          el.dispatchEvent(new KeyboardEvent('keyup',    { key:char, bubbles:true }));
          await sleep(30 + Math.random() * 40);
        }
      }
      return 'typed';
    }

    case 'paste': {
      // Force-paste via ClipboardEvent — reliable on React inputs (Instagram, etc.)
      console.log('[THERA-CONTENT] paste action, selector:', step.selector, 'text len:', step.text?.length);
      const el = step.selector ? await waitFor(step.selector, step.timeout || 5000) : document.activeElement;
      console.log('[THERA-CONTENT] paste target:', el.tagName, el.getAttribute('role'), 'contentEditable:', el.contentEditable);
      el.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', step.text);
      dt.setData('text', step.text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      await sleep(100);
      const contentAfter = el.textContent || el.innerText || el.value || '';
      console.log('[THERA-CONTENT] paste done, element content after:', contentAfter.slice(0,80));
      return 'pasted';
    }

    case 'click-text': {
      // Click a button/link by its visible text content
      console.log('[THERA-CONTENT] click-text looking for text:', step.text, 'in scope:', step.selector || '(default)');
      const scope = step.selector ? document.querySelectorAll(step.selector) : document.querySelectorAll('button, [role="button"], a, div[tabindex]');
      console.log('[THERA-CONTENT] click-text candidates:', scope.length);
      const needle = step.text.trim().toLowerCase();
      // Log first 10 candidates for debugging
      [...scope].slice(0, 10).forEach((e, i) => {
        const t = (e.textContent || '').trim().slice(0, 40);
        console.log(`[THERA-CONTENT]   candidate ${i}: "${t}" tag=${e.tagName} role=${e.getAttribute('role')}`);
      });
      const el = [...scope].find(e => {
        const t = (e.textContent || e.innerText || '').trim().toLowerCase();
        return t === needle || t.includes(needle);
      });
      if (!el) throw new Error(`No element with text "${step.text}" (searched ${scope.length} elements)`);
      console.log('[THERA-CONTENT] click-text found:', el.tagName, el.className?.slice(0,40));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true }));
      el.dispatchEvent(new MouseEvent('mouseup',   { bubbles:true, cancelable:true }));
      el.click();
      return 'clicked text: ' + step.text;
    }

    case 'press': {
      const el = step.selector ? await waitFor(step.selector, 3000) : document.activeElement;
      el.focus();
      const key = step.key;
      const kc  = keyCode(key);
      console.log('[THERA-CONTENT] pressing key:', key, 'on:', el.tagName, el.getAttribute('role'));
      const init = { key, code: key, keyCode: kc, which: kc, bubbles:true, cancelable:true };
      el.dispatchEvent(new KeyboardEvent('keydown',  init));
      el.dispatchEvent(new KeyboardEvent('keypress', init));
      el.dispatchEvent(new KeyboardEvent('keyup',    init));
      return 'pressed ' + key;
    }

    case 'read': {
      const el = step.selector ? document.querySelector(step.selector) : document.body;
      const text = el?.innerText?.trim().slice(0, 500) || '';
      console.log('[THERA-CONTENT] read:', text.slice(0,80));
      return text;
    }

    case 'scroll':
      window.scrollBy(0, step.amount || 300);
      return 'scrolled';

    case 'sleep':
      await sleep(step.ms || 1000);
      return 'slept';

    default:
      throw new Error('Unknown step action: ' + step.action);
  }
}

// ── Helpers ────────────────────────────────────────────────────

function waitFor(selector, timeoutMs) {
  return new Promise((resolve, reject) => {
    try {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
    } catch(e) {
      return reject(new Error(`Invalid selector "${selector}": ${e.message}`));
    }
    const ob = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) { ob.disconnect(); clearTimeout(t); resolve(found); }
    });
    ob.observe(document.body, { childList:true, subtree:true });
    const t = setTimeout(() => {
      ob.disconnect();
      // Dump what IS on the page for debugging
      const allRoles = [...new Set([...document.querySelectorAll('[role]')].map(e=>e.getAttribute('role')))].join(', ');
      reject(new Error(`Timeout (${timeoutMs}ms) waiting for "${selector}". Page roles present: ${allRoles.slice(0,200)}`));
    }, timeoutMs);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function keyCode(key) {
  const map = { Enter:13, Tab:9, Escape:27, Backspace:8, Delete:46, ArrowDown:40, ArrowUp:38, ArrowLeft:37, ArrowRight:39 };
  return map[key] || key.charCodeAt(0);
}
