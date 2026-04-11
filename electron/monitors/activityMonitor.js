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
const { detectActivity, detectPattern, analyzeAndDecide, pickFallback } = require('./contextAnalyzer');
const { captureScreen } = require('./screenCapture');
const settings = require('../settings');

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
let screenshotInterval = null;
let lastNudgeCheck = 0;

// Fast social nudge (10s) — runs independently of the main intelligent nudge system
let socialSiteKey = null;   // which social site is currently active
let socialSiteStart = 0;    // epoch ms when they first landed on it
let socialNudgeFired = false; // only nudge once per contiguous visit
let screenshotCache = {
  periodic: null,        // Latest periodic screenshot (general context)
  triggered: null,       // Latest triggered screenshot (specific issue)
  lastPeriodicTime: 0,   // When periodic was last taken
  lastTriggeredTime: 0   // When triggered was last taken
};

// TESTING MODE: Fast checks, low thresholds
const TESTING_MODE = true;
const POLL_INTERVAL_MS = 5000;                    // Check window every 5s
const NUDGE_CHECK_INTERVAL_MS = TESTING_MODE ? 60000 : 120000;  // Check for nudges every 60s (testing) / 2min (prod)
const SCREENSHOT_INTERVAL_MS = TESTING_MODE ? 2 * 60 * 1000 : 15 * 60 * 1000;  // Periodic: every 2min (testing) / 15min (prod)
const TRIGGER_COOLDOWN_MS = TESTING_MODE ? 30 * 1000 : 5 * 60 * 1000;  // Trigger cooldown: 30s (testing) / 5min (prod)

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

function getEmotion(type, metadata) {
  if (type === 'social-quick') return 'concerned';
  if (type === 'intelligent') {
    const patterns = (metadata && metadata.patterns) || [];
    const types = patterns.map(p => (p.type || '').toLowerCase());
    if (types.some(t => t.includes('doom') || t.includes('social'))) return 'concerned';
    if (types.some(t => t.includes('late-night') || t.includes('overwork'))) return 'stressed';
    if (types.some(t => t.includes('stuck'))) return 'sad';
    if (metadata && metadata.spotifyLoop) return 'content';
    return 'neutral';
  }
  return 'neutral';
}

function sendNudge(type, message, metadata = {}) {
  const emotion = getEmotion(type, metadata);
  console.log(`[NUDGE] ${type} (${emotion}): "${message}"`);
  if (metadata.reasoning) {
    console.log(`[NUDGE] Reasoning: ${metadata.reasoning}`);
  }

  nudgeOps.recordNudge(type, message);

  const widget = BrowserWindow.getAllWindows().find(w => w.isAlwaysOnTop() && !w.frame);
  if (widget) {
    widget.webContents.send('show-nudge', { text: message, emotion });
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

  // Check if we should take a TRIGGERED screenshot for immediate context
  let screenshot = null;
  const shouldTrigger = shouldTakeTriggeredScreenshot(currentSession, patterns, activity);

  if (shouldTrigger) {
    screenshot = await captureTriggeredScreenshot(activity, patterns);
  } else if (screenshotCache.triggered && (Date.now() - screenshotCache.lastTriggeredTime < 2 * 60 * 1000)) {
    // Use recent triggered screenshot if available (within 2 min)
    screenshot = screenshotCache.triggered;
    console.log('[CONTEXT] Using recent triggered screenshot');
  } else if (screenshotCache.periodic) {
    // Fall back to periodic screenshot for general context
    screenshot = screenshotCache.periodic;
    console.log('[CONTEXT] Using periodic screenshot for general context');
  }

  // Let AI decide if we should nudge
  const decision = await analyzeAndDecide(currentSession, sessionHistory, screenshot, {
    nsfwMode: settings.get('nsfwMode'),
  });

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
/*  HYBRID SCREENSHOT SYSTEM                                             */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Periodic screenshot - captures general context every 15 min
 * Good for: understanding work patterns, email habits, general productivity
 */
async function capturePeriodicScreenshot() {
  console.log('[SCREENSHOT:PERIODIC] Capturing for general context...');
  const screenshot = await captureScreen();
  if (screenshot) {
    screenshotCache.periodic = screenshot;
    screenshotCache.lastPeriodicTime = Date.now();
    console.log('[SCREENSHOT:PERIODIC] Cached:', screenshot.length, 'bytes');
  } else {
    console.log('[SCREENSHOT:PERIODIC] Failed to capture');
  }
}

/**
 * Check if we should take a triggered screenshot right now
 * Triggers:
 * - Currently doom-scrolling social media 20+ min
 * - Currently stuck editing/composing 20+ min
 * - Late night work (11pm-5am)
 * - Unrecognized app for long time
 */
function shouldTakeTriggeredScreenshot(currentSession, patterns, activity) {
  // Check cooldown - don't spam triggered screenshots
  const timeSinceLastTrigger = Date.now() - screenshotCache.lastTriggeredTime;
  if (timeSinceLastTrigger < TRIGGER_COOLDOWN_MS) {
    return false;
  }

  // Trigger 1: Currently doom-scrolling
  if (activity.type === 'social-scrolling' && currentSession.duration_minutes >= 0.5) {
    console.log('[SCREENSHOT:TRIGGER] Detected: doom-scrolling on', activity.detail);
    return true;
  }

  // Trigger 2: Currently stuck on same task
  if (currentSession.duration_minutes >= 20) {
    const stuckTypes = ['email-composing', 'document-editing', 'coding'];
    if (stuckTypes.includes(activity.type)) {
      console.log('[SCREENSHOT:TRIGGER] Detected: stuck on', activity.type);
      return true;
    }
  }

  // Trigger 3: Late night work
  const hour = new Date().getHours();
  const isLateNight = hour >= 23 || hour <= 5;
  if (isLateNight && currentSession.duration_minutes >= 10) {
    const workTypes = ['coding', 'document-editing', 'email-composing'];
    if (workTypes.includes(activity.type)) {
      console.log('[SCREENSHOT:TRIGGER] Detected: late night work');
      return true;
    }
  }

  // Trigger 4: Unrecognized app for extended time
  if (activity.type === 'unknown' && currentSession.duration_minutes >= 15) {
    console.log('[SCREENSHOT:TRIGGER] Detected: unrecognized app');
    return true;
  }

  return false;
}

/**
 * Take triggered screenshot for specific concerning behavior
 */
async function captureTriggeredScreenshot(activity, patterns) {
  console.log('[SCREENSHOT:TRIGGER] Capturing for immediate context...');
  const screenshot = await captureScreen();
  if (screenshot) {
    screenshotCache.triggered = screenshot;
    screenshotCache.lastTriggeredTime = Date.now();
    console.log('[SCREENSHOT:TRIGGER] Captured:', screenshot.length, 'bytes');
    return screenshot;
  } else {
    console.log('[SCREENSHOT:TRIGGER] Failed to capture');
    return null;
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  WINDOW TRACKING                                                       */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

async function pollActiveWindow() {
  try {
    const win = await getActiveWindow().catch(e => {
      // Ignore EPIPE errors from console.log
      if (e.code !== 'EPIPE') console.error('[ACTIVITY] getActiveWindow error:', e.message);
      return null;
    });

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

    // ── Fast social nudge: fire after 10s on any social/video site ────
    const activity = detectActivity(appName, windowTitle);
    const isSocial = activity.type === 'social-scrolling' || activity.type === 'video-watching';

    if (isSocial) {
      const siteKey = activity.detail; // e.g. "scrolling social media" or video title
      if (siteKey !== socialSiteKey) {
        // New social site — reset tracker
        socialSiteKey   = siteKey;
        socialSiteStart = Date.now();
        socialNudgeFired = false;
      } else if (!socialNudgeFired && Date.now() - socialSiteStart >= 5000) {
        socialNudgeFired = true;
        console.log('[ACTIVITY] Social 5s threshold hit — nudging');
        const nsfwMode = settings.get('nsfwMode') ?? false;
        const message = pickFallback('doom-scrolling', activity, nsfwMode);
        sendNudge('social-quick', message);
      }
    } else {
      // Left the social site — reset so next visit triggers fresh
      socialSiteKey    = null;
      socialSiteStart  = 0;
      socialNudgeFired = false;
    }

  } catch (e) {
    console.error('[ACTIVITY] Poll error:', e.message);
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  START / STOP                                                          */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function startMonitoring() {
  try {
    console.log('[ACTIVITY] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[ACTIVITY] Intelligent Activity Monitor v2 — HYBRID SCREENSHOTS');
    console.log('[ACTIVITY] Window polling: every', POLL_INTERVAL_MS / 1000, 'seconds');
    console.log('[ACTIVITY] Nudge checks: every', NUDGE_CHECK_INTERVAL_MS / 1000, 'seconds');
    console.log('[ACTIVITY] Periodic screenshots: every', SCREENSHOT_INTERVAL_MS / 1000, 'seconds');
    console.log('[ACTIVITY] Triggered screenshots: when concerning patterns detected');
    console.log('[ACTIVITY] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (e) {
    // Ignore EPIPE errors on startup
  }

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

  // Start periodic screenshot capture (for general context)
  capturePeriodicScreenshot(); // Capture immediately on start
  screenshotInterval = setInterval(capturePeriodicScreenshot, SCREENSHOT_INTERVAL_MS);

  // Also run first nudge check after 30s
  setTimeout(checkIntelligentNudges, 30000);
}

function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    clearInterval(nudgeCheckInterval);
    clearInterval(screenshotInterval);
    if (currentSession) activityOps.endSession(currentSession.id);
    screenshotCache = { periodic: null, triggered: null, lastPeriodicTime: 0, lastTriggeredTime: 0 };
    console.log('[ACTIVITY] Monitor stopped');
  }
}

// Don't start immediately — wait for main process to be ready
// startMonitoring() is called from main.js after windows are created

process.on('exit', stopMonitoring);

module.exports = { startMonitoring, stopMonitoring };
