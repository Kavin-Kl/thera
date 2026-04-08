/**
 * Token storage for connector OAuth credentials.
 *
 * Stored as a JSON file in the userData directory. Not encrypted on disk —
 * good enough for a local-first desktop companion. If you need hardening,
 * swap this for safeStorage.encryptString later.
 */
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const TOKEN_PATH = path.join(app.getPath('userData'), 'thera-tokens.json');

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(TOKEN_PATH, 'utf8');
    let parsed = JSON.parse(raw);
    // If safeStorage is available and the payload looks encrypted, decrypt
    if (parsed.__encrypted && safeStorage && safeStorage.isEncryptionAvailable()) {
      const buf = Buffer.from(parsed.payload, 'base64');
      parsed = JSON.parse(safeStorage.decryptString(buf));
    }
    cache = parsed || {};
  } catch (_) {
    cache = {};
  }
  return cache;
}

function save() {
  try {
    let payload;
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const enc = safeStorage.encryptString(JSON.stringify(cache));
      payload = JSON.stringify({ __encrypted: true, payload: enc.toString('base64') });
    } else {
      payload = JSON.stringify(cache, null, 2);
    }
    fs.writeFileSync(TOKEN_PATH, payload);
  } catch (e) {
    console.error('[TOKENS] Failed to save:', e.message);
  }
}

function get(provider) {
  const all = load();
  return all[provider] || null;
}

function set(provider, tokens) {
  const all = load();
  all[provider] = { ...tokens, _savedAt: Date.now() };
  cache = all;
  save();
}

function clear(provider) {
  const all = load();
  delete all[provider];
  cache = all;
  save();
}

module.exports = { get, set, clear };
