/**
 * Token storage for connector OAuth credentials.
 *
 * Stored in the userData directory, encrypted with Electron safeStorage when
 * available. Tokens are namespaced per Supabase user ID so each profile has
 * isolated connector credentials.
 */
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const TOKEN_PATH = path.join(app.getPath('userData'), 'thera-tokens.json');

let cache = null;
let currentUserId = 'desktop_user';

/** Called by main.js when auth state changes. */
function setUser(userId) {
  currentUserId = userId || 'desktop_user';
  cache = null; // invalidate cache so next access re-reads with new namespace
}

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(TOKEN_PATH, 'utf8');
    let parsed = JSON.parse(raw);
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

/** Build the namespaced storage key. */
function _key(provider) {
  return `${currentUserId}:${provider}`;
}

/** Retrieve tokens for a provider under the current user. */
function get(provider) {
  const all = load();
  // Try user-namespaced key first; fall back to legacy flat key for migration
  return all[_key(provider)] || all[provider] || null;
}

/** Store tokens for a provider under the current user. */
function set(provider, tokens) {
  const all = load();
  all[_key(provider)] = { ...tokens, _savedAt: Date.now() };
  // Remove legacy flat key if present (migrate to namespaced)
  delete all[provider];
  cache = all;
  save();
}

/** Clear tokens for a provider under the current user. */
function clear(provider) {
  const all = load();
  delete all[_key(provider)];
  delete all[provider]; // also clear legacy flat key
  cache = all;
  save();
}

/** Clear ALL tokens for the current user (used on disconnect all). */
function clearUser() {
  const all = load();
  const prefix = `${currentUserId}:`;
  for (const key of Object.keys(all)) {
    if (key.startsWith(prefix)) delete all[key];
  }
  cache = all;
  save();
}

module.exports = { get, set, clear, setUser, clearUser };
