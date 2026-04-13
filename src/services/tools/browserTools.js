/**
 * Browser Control Tools — LangChain DynamicStructuredTools
 *
 * Each tool sends a structured command to the Chrome extension via IPC
 * (renderer → main → WebSocket → extension → DOM/CDP action → result).
 *
 * The extension is the execution engine; these tools are the bridge.
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

const { ipcRenderer } = window.require ? window.require('electron') : {};

/**
 * Send a browser command via IPC to the main process, which forwards it
 * over the WebSocket to the Chrome extension.
 */
async function browserCommand(action, payload, timeout = 30000) {
  if (!ipcRenderer) throw new Error('Not in Electron environment');
  const result = await ipcRenderer.invoke('browser:command', { action, payload, timeout });
  if (!result.success) throw new Error(result.error || `${action} failed`);
  return result.data ?? {};
}

// ── Navigation ────────────────────────────────────────────────

export const browserNavigate = new DynamicStructuredTool({
  name: 'browser_navigate',
  description: 'Navigate the active Chrome tab to a URL. Use this to open any website.',
  schema: z.object({
    url: z.string().describe('Full URL to navigate to, including https://'),
  }),
  async func({ url }) {
    const data = await browserCommand('browser.navigate', { url }, 25000);
    return `Navigated to ${url}${data.title ? `. Page title: "${data.title}"` : ''}`;
  },
});

// ── Element Interaction ───────────────────────────────────────

export const browserClick = new DynamicStructuredTool({
  name: 'browser_click',
  description: 'Click an element on the page using a CSS selector. Use browser_read_page first to identify selectors.',
  schema: z.object({
    selector: z.string().describe('CSS selector for the element to click (e.g. "button[type=submit]", "#login-btn")'),
    timeout: z.number().optional().describe('Max time to wait for element in ms (default 5000)'),
  }),
  async func({ selector, timeout = 5000 }) {
    await browserCommand('browser.click', { selector, timeout });
    return `Clicked: ${selector}`;
  },
});

export const browserClickText = new DynamicStructuredTool({
  name: 'browser_click_text',
  description: 'Click an element by its visible text. Use when you know the button label but not its CSS selector.',
  schema: z.object({
    text: z.string().describe('Exact visible text of the element to click (e.g. "Book Now", "Submit", "Continue")'),
    scope: z.string().optional().describe('Optional CSS selector to scope the search (e.g. "form", "#checkout")'),
  }),
  async func({ text, scope }) {
    await browserCommand('browser.click_text', { text, scope });
    return `Clicked element with text: "${text}"`;
  },
});

export const browserType = new DynamicStructuredTool({
  name: 'browser_type',
  description: 'Type text into an input field or text area. Uses real CDP input events — works on React, Angular, any framework.',
  schema: z.object({
    selector: z.string().describe('CSS selector for the input/textarea element'),
    text: z.string().describe('Text to type into the field'),
    clear: z.boolean().optional().describe('Clear existing content before typing (default false)'),
    timeout: z.number().optional().describe('Max wait for element in ms (default 5000)'),
  }),
  async func({ selector, text, clear = false, timeout = 5000 }) {
    await browserCommand('browser.type', { selector, text, clear, timeout });
    return `Typed "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}" into ${selector}`;
  },
});

export const browserPressKey = new DynamicStructuredTool({
  name: 'browser_press_key',
  description: 'Press a keyboard key. Use after typing to submit forms (Enter), close dialogs (Escape), or navigate dropdowns (ArrowDown).',
  schema: z.object({
    key: z.string().describe('Key name: Enter, Escape, Tab, Backspace, Delete, ArrowDown, ArrowUp, ArrowLeft, ArrowRight'),
    selector: z.string().optional().describe('Optional CSS selector to focus before pressing key'),
  }),
  async func({ key, selector }) {
    await browserCommand('browser.press_key', { key, selector });
    return `Pressed: ${key}`;
  },
});

// ── Page Reading ──────────────────────────────────────────────

export const browserReadPage = new DynamicStructuredTool({
  name: 'browser_read_page',
  description: 'Read the current page URL, title, and text content. ALWAYS use this before interacting with an unfamiliar page to understand its structure.',
  schema: z.object({}),
  async func() {
    const data = await browserCommand('browser.read_page', {});
    const text = (data.text || '').slice(0, 4000);
    return `URL: ${data.url}\nTitle: ${data.title}\n\n--- Page Content ---\n${text}${data.text?.length > 4000 ? '\n[truncated...]' : ''}`;
  },
});

export const browserExtract = new DynamicStructuredTool({
  name: 'browser_extract',
  description: 'Extract text content from a specific element on the page. Useful for reading prices, booking confirmations, search results, etc.',
  schema: z.object({
    selector: z.string().optional().describe('CSS selector to extract from. Omit to get full page text.'),
  }),
  async func({ selector }) {
    const data = await browserCommand('browser.extract', { selector });
    return data.text || '(no text found)';
  },
});

// ── Waiting ───────────────────────────────────────────────────

export const browserWaitFor = new DynamicStructuredTool({
  name: 'browser_wait_for',
  description: 'Wait for an element to appear on the page. Use before clicking elements that load dynamically (popups, search results, modals).',
  schema: z.object({
    selector: z.string().describe('CSS selector to wait for'),
    timeout: z.number().optional().describe('Max wait time in ms (default 8000)'),
  }),
  async func({ selector, timeout = 8000 }) {
    await browserCommand('browser.wait_for', { selector, timeout });
    return `Element found: ${selector}`;
  },
});

// ── Scrolling ─────────────────────────────────────────────────

export const browserScroll = new DynamicStructuredTool({
  name: 'browser_scroll',
  description: 'Scroll the page to reveal more content.',
  schema: z.object({
    amount: z.number().optional().describe('Pixels to scroll. Positive = down, negative = up. Default 400.'),
  }),
  async func({ amount = 400 }) {
    await browserCommand('browser.scroll', { amount });
    return `Scrolled ${amount > 0 ? 'down' : 'up'} ${Math.abs(amount)}px`;
  },
});

// ── Messaging ─────────────────────────────────────────────────

// ── Tab Management ────────────────────────────────────────────

export const tabList = new DynamicStructuredTool({
  name: 'tab_list',
  description: 'List all open Chrome tabs with their ID, title, and URL. Use before tab_switch to find the right tab.',
  schema: z.object({}),
  async func() {
    const data = await browserCommand('browser.tab_list', {});
    const tabs = Array.isArray(data) ? data : (data.tabs || []);
    if (!tabs.length) return 'No tabs open.';
    return tabs.map((t, i) =>
      `${i + 1}. [id:${t.id}] ${t.active ? '▶ ' : '  '}${t.title || 'Untitled'} — ${t.url || ''}`
    ).join('\n');
  },
});

export const tabSwitch = new DynamicStructuredTool({
  name: 'tab_switch',
  description: 'Switch Chrome focus to a specific tab by ID, title substring, or URL substring.',
  schema: z.object({
    id:    z.number().optional().describe('Tab ID from tab_list'),
    title: z.string().optional().describe('Partial title to match (e.g. "Gmail", "YouTube")'),
    url:   z.string().optional().describe('Partial URL to match (e.g. "github.com", "docs.google")'),
  }),
  async func({ id, title, url }) {
    const data = await browserCommand('browser.tab_switch', { id, title, url });
    return `Switched to tab: "${data.title}" — ${data.url}`;
  },
});

export const tabNew = new DynamicStructuredTool({
  name: 'tab_new',
  description: 'Open a new Chrome tab, optionally navigating to a URL.',
  schema: z.object({
    url: z.string().optional().describe('URL to open in the new tab (omit for blank tab)'),
  }),
  async func({ url }) {
    const data = await browserCommand('browser.tab_new', { url: url || 'about:newtab' });
    return `New tab opened (id:${data.id})${url ? ` at ${url}` : ''}`;
  },
});

export const tabClose = new DynamicStructuredTool({
  name: 'tab_close',
  description: 'Close a Chrome tab by ID, or close the currently active tab.',
  schema: z.object({
    id:      z.number().optional().describe('Tab ID to close (from tab_list). Omit to close current tab.'),
    current: z.boolean().optional().describe('Set true to close the currently active tab'),
  }),
  async func({ id, current }) {
    const data = await browserCommand('browser.tab_close', { id, current });
    return `Tab ${data.closed} closed.`;
  },
});

export const tabPin = new DynamicStructuredTool({
  name: 'tab_pin',
  description: 'Pin or unpin a Chrome tab.',
  schema: z.object({
    id:     z.number().optional().describe('Tab ID (omit for current tab)'),
    pinned: z.boolean().optional().describe('true to pin, false to unpin (default true)'),
  }),
  async func({ id, pinned = true }) {
    const data = await browserCommand('browser.tab_pin', { id, pinned });
    return `Tab ${data.id} ${data.pinned ? 'pinned' : 'unpinned'}.`;
  },
});

// ── Messaging reads ───────────────────────────────────────────

export const whatsappRead = new DynamicStructuredTool({
  name: 'whatsapp_read',
  description: 'Read recent messages from a WhatsApp conversation. WhatsApp Web must be open in Chrome.',
  schema: z.object({
    contact: z.string().optional().describe('Contact name to open before reading. Omit to read the currently open chat.'),
    limit: z.number().optional().describe('Number of messages to read (default 10)'),
  }),
  async func({ contact, limit = 10 }) {
    const data = await browserCommand('whatsapp.read', { contact, limit }, 30000);
    const msgs = data.messages || [];
    if (!msgs.length) return 'No messages found.';
    return msgs.map((m, i) =>
      `${i + 1}. [${m.direction}] ${m.text}${m.time ? ` (${m.time})` : ''}`
    ).join('\n');
  },
});

export const instagramRead = new DynamicStructuredTool({
  name: 'instagram_read',
  description: 'Read recent Instagram DM messages. Instagram must be open in Chrome.',
  schema: z.object({
    username: z.string().optional().describe('Instagram username to open before reading'),
    limit: z.number().optional().describe('Number of messages to read (default 10)'),
  }),
  async func({ username, limit = 10 }) {
    const data = await browserCommand('instagram.read', { username, limit }, 30000);
    const msgs = data.messages || [];
    if (!msgs.length) return 'No messages found.';
    return msgs.map((m, i) => `${i + 1}. ${m.text}`).join('\n');
  },
});

export const whatsappSend = new DynamicStructuredTool({
  name: 'whatsapp_send',
  description: 'Send a WhatsApp message to a contact via WhatsApp Web. Uses CDP — works on logged-in WhatsApp Web session.',
  schema: z.object({
    to: z.string().describe('Contact name (as it appears in WhatsApp) or phone number with country code e.g. "+919876543210"'),
    message: z.string().describe('Message text to send'),
  }),
  async func({ to, message }) {
    await browserCommand('whatsapp.send', { to, message }, 60000);
    return `WhatsApp message sent to "${to}": "${message.slice(0, 80)}${message.length > 80 ? '...' : ''}"`;
  },
});

export const instagramSend = new DynamicStructuredTool({
  name: 'instagram_send',
  description: 'Send a direct message to someone on Instagram.',
  schema: z.object({
    to: z.string().describe('Instagram username (without @)'),
    message: z.string().describe('Message text to send'),
  }),
  async func({ to, message }) {
    await browserCommand('instagram.send', { to, message }, 60000);
    return `Instagram DM sent to @${to}: "${message.slice(0, 80)}${message.length > 80 ? '...' : ''}"`;
  },
});
