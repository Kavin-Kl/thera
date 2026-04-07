/**
 * Simple persistent settings for Thera.
 * Stored as JSON next to the .env in the project root.
 */

const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(process.cwd(), '.thera-settings.json');

const DEFAULTS = {
  nsfwMode: false,  // false = safe for work (no swearing), true = Thera can swear
};

let _settings = { ...DEFAULTS };

function load() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    _settings = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {
    // File doesn't exist yet — use defaults
  }
}

function save() {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(_settings, null, 2));
  } catch (e) {
    console.error('[SETTINGS] Failed to save:', e.message);
  }
}

function get(key) {
  return key ? _settings[key] : { ..._settings };
}

function set(key, value) {
  _settings[key] = value;
  save();
  console.log(`[SETTINGS] ${key} = ${value}`);
}

// Load on first require
load();

module.exports = { get, set };
