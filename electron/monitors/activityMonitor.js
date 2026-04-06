/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * INTELLIGENT ACTIVITY MONITOR v2
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Knows EXACTLY what you're doing and nudges contextually.
 *
 * For testing: Fast nudge checks (every 60s) with immediate pattern detection
 * For production: Slower checks (every 10s) with longer thresholds
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

const { activityOps, nudgeOps } = require('../db/localDb');
const { BrowserWindow } = require('electron');
const { detectActivity, detectPattern, analyzeAndDecide } = require('./contextAnalyzer');
const { captureScreen, shouldCapture } = require('./screenCapture');

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

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  STATE                                                                 */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

let currentSession = null;       // { id, app_name, window_title, category, started_at, duration_minutes }
let sessionHistory = [];          // Last 50 sessions for pattern detection
let monitorInterval = null;
let nudgeCheckInterval = null;
let lastNudgeCheck = 0;

// TESTING MODE: Fast checks, low thresholds
const TESTING_MODE = true;
const POLL_INTERVAL_MS = 5000;                    // Check window every 5s
const NUDGE_CHECK_INTERVAL_MS = TESTING_MODE ? 60000 : 120000;  // Check for nudges every 60s (testing) / 2min (prod)

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  HELPERS                                                               */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

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

function sendNudge(type, message, metadata = {}) {
  console.log(`[NUDGE] ${type}: "${message}"`);
  if (metadata.reasoning) {
    console.log(`[NUDGE] Reasoning: ${metadata.reasoning}`);
  }

  nudgeOps.recordNudge(type, message);

  const widget = BrowserWindow.getAllWindows().find(w => w.isAlwaysOnTop() && !w.frame);
  if (widget) {
    widget.webContents.send('show-nudge', message);
  } else {
    console.warn('[NUDGE] No widget window found');
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  INTELLIGENT NUDGE SYSTEM                                              */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

async function checkIntelligentNudges() {
  if (!currentSession) return;

  // Update duration
  currentSession.duration_minutes = (Date.now() - currentSession.started_at) / 60000;

  // Detect activity and patterns
  const activity = detectActivity(currentSession.app_name, currentSession.window_title);
  const patterns = detectPattern(sessionHistory, currentSession);

  console.log('[CONTEXT] Activity:', activity.type, '—', activity.detail);
  if (patterns.length > 0) {
    console.log('[CONTEXT] Patterns detected:', patterns.map(p => `${p.type} (${p.severity})`).join(', '));
  }

  // Check if we should take a screenshot for deeper context
  let screenshot = null;
  if (shouldCapture(currentSession, patterns, activity)) {
    screenshot = await captureScreen();
    if (screenshot) {
      console.log('[CONTEXT] Using screenshot for deeper analysis');
    }
  }

  // Let AI decide if we should nudge
  const decision = await analyzeAndDecide(currentSession, sessionHistory, screenshot);

  if (decision.shouldNudge) {
    sendNudge('intelligent', decision.message, {
      reasoning: decision.reasoning,
      ...decision.metadata
    });
  } else {
    console.log('[CONTEXT] No nudge —', decision.reasoning);
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  WINDOW TRACKING                                                       */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

async function pollActiveWindow() {
  try {
    const win = await getActiveWindow();

    if (!win) {
      console.log('[ACTIVITY] active-win returned null');
      if (currentSession) {
        activityOps.endSession(currentSession.id);

        // Add to history
        const duration_seconds = (Date.now() - currentSession.started_at) / 1000;
        sessionHistory.push({ ...currentSession, duration_seconds });
        if (sessionHistory.length > 50) sessionHistory.shift(); // Keep last 50

        currentSession = null;
      }
      return;
    }

    const appName = win.owner?.name || 'Unknown';
    const windowTitle = win.title || '';
    const category = categorizeApp(appName, windowTitle);

    // New session if app or window changed
    if (!currentSession ||
        currentSession.app_name !== appName ||
        currentSession.window_title !== windowTitle) {

      if (currentSession) {
        activityOps.endSession(currentSession.id);

        // Add to history
        const duration_seconds = (Date.now() - currentSession.started_at) / 1000;
        sessionHistory.push({ ...currentSession, duration_seconds });
        if (sessionHistory.length > 50) sessionHistory.shift();

        console.log(`[ACTIVITY] Ended: "${currentSession.app_name}" (${Math.floor(duration_seconds)}s)`);
      }

      const id = activityOps.startSession(appName, windowTitle, category);
      currentSession = {
        id,
        app_name: appName,
        window_title: windowTitle,
        category,
        started_at: Date.now(),
        duration_minutes: 0
      };

      console.log(`[ACTIVITY] Started: "${appName}" [${category}] — "${windowTitle.slice(0, 80)}"`);
    }

  } catch (e) {
    console.error('[ACTIVITY] Poll error:', e.message);
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  START / STOP                                                          */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function startMonitoring() {
  console.log('[ACTIVITY] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[ACTIVITY] Intelligent Activity Monitor v2 — TESTING MODE');
  console.log('[ACTIVITY] Window polling: every', POLL_INTERVAL_MS / 1000, 'seconds');
  console.log('[ACTIVITY] Nudge checks: every', NUDGE_CHECK_INTERVAL_MS / 1000, 'seconds');
  console.log('[ACTIVITY] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Load recent activity from database to seed history
  sessionHistory = activityOps.getRecentActivity(1).map(row => ({
    ...row,
    duration_minutes: row.duration_seconds / 60
  }));
  console.log('[ACTIVITY] Loaded', sessionHistory.length, 'recent sessions from DB');

  // Start polling active window
  pollActiveWindow();
  monitorInterval = setInterval(pollActiveWindow, POLL_INTERVAL_MS);

  // Start intelligent nudge checks (separate interval, slower)
  nudgeCheckInterval = setInterval(checkIntelligentNudges, NUDGE_CHECK_INTERVAL_MS);

  // Also run first nudge check after 30s
  setTimeout(checkIntelligentNudges, 30000);
}

function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    clearInterval(nudgeCheckInterval);
    if (currentSession) activityOps.endSession(currentSession.id);
    console.log('[ACTIVITY] Monitor stopped');
  }
}

startMonitoring();
process.on('exit', stopMonitoring);

module.exports = { startMonitoring, stopMonitoring };
