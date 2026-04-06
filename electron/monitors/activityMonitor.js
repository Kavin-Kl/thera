const { activityOps, nudgeOps } = require('../db/localDb');
const { BrowserWindow }          = require('electron');
const fs   = require('fs');
const path = require('path');

/* ── active-win is ESM-only (v8+) — must dynamic-import it ───── */
let _activeWin = null;
async function getActiveWindow() {
  if (!_activeWin) {
    try {
      const mod = await import('active-win');
      _activeWin = mod.default ?? mod;
      console.log('[ACTIVITY] active-win loaded OK');
    } catch (e) {
      console.error('[ACTIVITY] Failed to load active-win:', e.message);
      return null;
    }
  }
  try {
    return await _activeWin();
  } catch (e) {
    console.error('[ACTIVITY] active-win() threw:', e.message);
    return null;
  }
}

/* ── Load API key from .env (main process has no import.meta.env) */
function readEnvVar(key) {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '../../.env'), 'utf8');
    const m   = raw.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return m ? m[1].trim() : '';
  } catch { return ''; }
}
const GEMINI_API_KEY = readEnvVar('VITE_GEMINI_API_KEY');

/* ── Gemini via plain fetch (no package needed, Node 18+) ────── */
async function callGemini(prompt) {
  if (!GEMINI_API_KEY) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents:         [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 60 },
        }),
      }
    );
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (e) {
    console.error('[NUDGE] Gemini fetch failed:', e.message);
    return null;
  }
}

/* ── Fallback nudge bank ─────────────────────────────────────── */
const fallback = {
  social:   [
    "not judging but you've been scrolling for a while...",
    "okay but are you even enjoying this anymore?",
    "your future self is begging you to stop",
    "doom-scrolling update: still dooming",
  ],
  noBreaks: [
    "friendly reminder: you have a body that needs things.",
    "not to be dramatic but when did you last blink?",
    "water. movement. please. for me.",
    "your spine is crying. can you hear it?",
  ],
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* ── Sites to watch ──────────────────────────────────────────── */
const WATCHED_SITES = [
  { key: 'youtube',   match: t => t.includes('youtube')   },
  { key: 'instagram', match: t => t.includes('instagram') },
];

function detectSite(title) {
  const t = (title || '').toLowerCase();
  return WATCHED_SITES.find(s => s.match(t)) || null;
}

/* ── Generate AI nudge for a detected page ───────────────────── */
async function generateContextualNudge(windowTitle, siteKey) {
  const pageContext = windowTitle
    .replace(/[-|–]\s*youtube\s*$/i, '')
    .replace(/[•|]\s*instagram.*$/i, '')
    .trim() || siteKey;

  const hint = {
    youtube:   'they just opened a youtube video.',
    instagram: 'they opened instagram — probably about to scroll mindlessly.',
  };

  const prompt =
    `you're thera — a brutally honest, warm AI companion on the user's desktop.\n` +
    `the user just opened: "${pageContext}" (${hint[siteKey] || siteKey})\n\n` +
    `write ONE nudge. rules:\n` +
    `- max 12 words, lowercase, no quotes\n` +
    `- youtube: reference the video title if telling. be dry.\n` +
    `- instagram: gentle sarcasm, no lecturing.\n` +
    `respond with ONLY the nudge, nothing else.`;

  const aiText = await callGemini(prompt);
  if (aiText) {
    console.log(`[NUDGE] AI nudge for ${siteKey}: "${aiText}"`);
    return aiText.replace(/^["']|["']$/g, '');
  }
  return pick(fallback.social);
}

/* ── App categorisation ──────────────────────────────────────── */
function categorizeApp(appName, windowTitle) {
  const a = appName.toLowerCase();
  const t = (windowTitle || '').toLowerCase();
  if (a.includes('discord') || a.includes('slack') || a.includes('whatsapp') ||
      t.includes('twitter') || t.includes('instagram') || t.includes('tiktok')) return 'social';
  if (a.includes('code') || a.includes('cursor') || a.includes('terminal') ||
      a.includes('vim') || a.includes('intellij') || a.includes('pycharm'))    return 'coding';
  if (a.includes('excel') || a.includes('word') || a.includes('outlook') ||
      a.includes('teams') || a.includes('zoom') || a.includes('notion'))       return 'work';
  if (a.includes('spotify') || a.includes('netflix') || a.includes('steam') ||
      t.includes('youtube') || t.includes('netflix') || t.includes('twitch'))  return 'entertainment';
  if (a.includes('chrome') || a.includes('firefox') || a.includes('safari') ||
      a.includes('edge') || a.includes('brave'))                               return 'browsing';
  return 'other';
}

/* ── State ───────────────────────────────────────────────────── */
let currentSession  = null;
let lastActivity    = null;
let monitorInterval = null;
const seenSiteKeys   = new Set();   // prevents re-nudging the same tab
const siteFirstSeen  = new Map();   // key → timestamp when we first saw the site focused

/* ── Send nudge to widget ────────────────────────────────────── */
function sendNudge(type, message) {
  console.log(`[NUDGE] ${type}: "${message}"`);
  nudgeOps.recordNudge(type, message);
  const widget = BrowserWindow.getAllWindows().find(w => w.isAlwaysOnTop() && !w.frame);
  if (widget) {
    widget.webContents.send('show-nudge', message);
  } else {
    console.warn('[NUDGE] No widget window found to send nudge to');
  }
}

/* ── Nudge checks ────────────────────────────────────────────── */
async function checkNudges() {

  /* 1 — SITE DETECTION
     Only fires when the tab is the active (foreground) window AND has been
     focused for at least 8 seconds — prevents nudging on quick tab switches. */
  if (currentSession) {
    const detected = detectSite(currentSession.window_title);
    if (detected) {
      const key = `${currentSession.app_name}::${currentSession.window_title}`;

      if (!seenSiteKeys.has(key)) {
        // Record first time we see this tab in focus
        if (!siteFirstSeen.has(key)) {
          siteFirstSeen.set(key, Date.now());
        }

        const focusedMs = Date.now() - siteFirstSeen.get(key);
        if (focusedMs < 8000) return; // still in foreground but not long enough yet

        seenSiteKeys.add(key);
        siteFirstSeen.delete(key);
        console.log(`[NUDGE] Site focused >${focusedMs}ms: ${detected.key} — "${currentSession.window_title}"`);
        const msg = await generateContextualNudge(currentSession.window_title, detected.key);
        sendNudge('site-detection', msg);
        return;
      }
    } else {
      // User switched away — clear any pending first-seen timers so
      // coming back to the same tab resets the 8-second clock
      siteFirstSeen.clear();
    }
  }

  /* 2 — DOOM-SCROLLING (accumulated social time) */
  if (lastActivity) {
    const duration = activityOps.getCategoryDuration('social', 24);
    // TEST: 20s threshold. Production: 30 * 60
    if (duration > 20 && nudgeOps.shouldNudge('doom-scrolling', 30)) {
      sendNudge('doom-scrolling', pick(fallback.social).replace('{app}', currentSession?.app_name || 'that'));
      return;
    }
  }

  /* 3 — NO BREAKS (same window too long) */
  if (currentSession && lastActivity) {
    const age = (Date.now() - lastActivity.started_at) / 1000;
    // TEST: 30s threshold. Production: 120 * 60
    if (age > 30 && nudgeOps.shouldNudge('no-breaks', 45)) {
      sendNudge('no-breaks', pick(fallback.noBreaks));
      return;
    }
  }
}

/* ── Main poll ───────────────────────────────────────────────── */
async function pollActiveWindow() {
  try {
    const win = await getActiveWindow();

    if (!win) {
      console.log('[ACTIVITY] active-win returned null (check Accessibility permissions on macOS)');
      if (currentSession) { activityOps.endSession(currentSession.id); currentSession = null; }
      return;
    }

    const appName     = win.owner?.name  || 'Unknown';
    const windowTitle = win.title        || '';
    const category    = categorizeApp(appName, windowTitle);

    if (!currentSession ||
        currentSession.app_name     !== appName ||
        currentSession.window_title !== windowTitle) {

      if (currentSession) {
        activityOps.endSession(currentSession.id);
        console.log(`[ACTIVITY] Ended: "${currentSession.app_name}" (${currentSession.window_title.slice(0, 60)})`);
      }

      const id = activityOps.startSession(appName, windowTitle, category);
      currentSession = { id, app_name: appName, window_title: windowTitle, category, started_at: Date.now() };
      console.log(`[ACTIVITY] Started: "${appName}" [${category}] — "${windowTitle.slice(0, 80)}"`);
    }

    lastActivity = currentSession;
    await checkNudges();

  } catch (e) {
    console.error('[ACTIVITY] Poll error:', e.message);
  }
}

/* ── Start / stop ────────────────────────────────────────────── */
function startMonitoring() {
  console.log('[ACTIVITY] Monitor started — polling every 10s');

  // TEST: remove once nudges confirmed working
  setTimeout(() => sendNudge('test', 'pipeline check — widget works ✓'), 3000);

  pollActiveWindow();
  monitorInterval = setInterval(pollActiveWindow, 10000);
}

function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    if (currentSession) activityOps.endSession(currentSession.id);
    console.log('[ACTIVITY] Monitor stopped');
  }
}

startMonitoring();
process.on('exit', stopMonitoring);
module.exports = { startMonitoring, stopMonitoring };
