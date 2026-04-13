'use strict';

/**
 * WebSocket Bridge — Electron main process ↔ Chrome extension
 *
 * Replaces the HTTP long-poll /commands system for LangChain tool calls.
 * Extension connects once; commands flow in both directions synchronously.
 *
 * Protocol:
 *   Main → Extension:  { id, action, payload }
 *   Extension → Main:  { id, success, data?, error? }
 *   Extension → Main:  { type: 'tab-info' | 'automate-result', ... }
 */

const { WebSocketServer } = require('ws');

let wss = null;
let extensionSocket = null;
const pending = new Map(); // id → { resolve, reject, timer }
let _tabDataCallback = null;

function startWsBridge(onTabData) {
  _tabDataCallback = onTabData;

  wss = new WebSocketServer({ host: '127.0.0.1', port: 7980 });

  wss.on('connection', (ws) => {
    console.log('[WS-BRIDGE] Extension connected');
    extensionSocket = ws;

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

      // Unsolicited events from extension (tab info, doom scroll, etc.)
      if (msg.type === 'tab-info' || msg.type === 'automate-result' || msg.type === 'scroll-activity') {
        if (_tabDataCallback) _tabDataCallback(msg);
        return;
      }

      // Command response: { id, success, data?, error? }
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject, timer } = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.success) resolve(msg.data ?? {});
        else reject(new Error(msg.error || 'Extension command failed'));
      }
    });

    ws.on('close', () => {
      console.log('[WS-BRIDGE] Extension disconnected');
      extensionSocket = null;
      for (const [, { reject, timer }] of pending) {
        clearTimeout(timer);
        reject(new Error('Extension disconnected mid-command'));
      }
      pending.clear();
    });

    ws.on('error', (err) => {
      console.error('[WS-BRIDGE] Socket error:', err.message);
    });
  });

  wss.on('error', (err) => {
    console.error('[WS-BRIDGE] Server error:', err.message);
  });

  console.log('[WS-BRIDGE] WebSocket bridge started on ws://127.0.0.1:7980');
}

/**
 * Send a command to the extension and wait for the response.
 * Resolves with result data or rejects with an error.
 */
function sendCommand(action, payload, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (!extensionSocket || extensionSocket.readyState !== 1 /* OPEN */) {
      return reject(new Error(
        'Chrome extension not connected. Make sure the Thera Bridge extension is installed and Chrome is running.'
      ));
    }

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout (${timeoutMs}ms) waiting for extension response to: ${action}`));
    }, timeoutMs);

    pending.set(id, { resolve, reject, timer });

    try {
      extensionSocket.send(JSON.stringify({ id, action, payload }));
    } catch (e) {
      pending.delete(id);
      clearTimeout(timer);
      reject(new Error(`Failed to send command to extension: ${e.message}`));
    }
  });
}

function isConnected() {
  return extensionSocket !== null && extensionSocket.readyState === 1;
}

module.exports = { startWsBridge, sendCommand, isConnected };
