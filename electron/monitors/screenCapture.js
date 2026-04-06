/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * TIER 3 — SCREEN VISION (on-demand, expensive)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Use Electron's desktopCapturer to screenshot the active window and send
 * to Gemini Vision for deep context understanding.
 *
 * Rate limits:
 * - Max once every 5 minutes (for testing: 1 minute)
 * - Only when patterns indicate we need deeper understanding
 *
 * Triggers:
 * - Unrecognized app for 15+ min
 * - Late night work sessions (to understand what they're working on)
 * - User stuck on same task 20+ min
 * - Rapid context switching (might be frustrated)
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

const { desktopCapturer } = require('electron');

// Rate limiting
let lastScreenshotTime = 0;
const SCREENSHOT_COOLDOWN_MS = 60 * 1000; // 1 min for testing (5 min for production)

/**
 * Capture screenshot of the primary screen
 * Returns: base64 encoded PNG string (without data:image/png;base64, prefix)
 */
async function captureScreen() {
  // Check rate limit
  const now = Date.now();
  if (now - lastScreenshotTime < SCREENSHOT_COOLDOWN_MS) {
    console.log('[SCREENSHOT] Rate limited — cooldown not expired');
    return null;
  }

  try {
    // Get available sources
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 } // Scaled down for token efficiency
    });

    if (sources.length === 0) {
      console.error('[SCREENSHOT] No screen sources available');
      return null;
    }

    // Get primary screen
    const primarySource = sources[0];
    const thumbnail = primarySource.thumbnail;

    // Convert to base64 PNG
    const base64Image = thumbnail.toPNG().toString('base64');

    lastScreenshotTime = now;
    console.log('[SCREENSHOT] Captured screen:', base64Image.length, 'bytes');

    return base64Image;
  } catch (e) {
    console.error('[SCREENSHOT] Failed to capture:', e.message);
    return null;
  }
}

/**
 * Decide if we should take a screenshot for this session
 */
function shouldCapture(currentSession, patterns, activity) {
  // Never capture if on cooldown
  if (Date.now() - lastScreenshotTime < SCREENSHOT_COOLDOWN_MS) {
    return false;
  }

  // ── Trigger 1: Unrecognized app for 15+ min ───────────────────────
  if (activity.type === 'unknown' && currentSession.duration_minutes >= 15) {
    console.log('[SCREENSHOT] Trigger: unrecognized app 15+ min');
    return true;
  }

  // ── Trigger 2: Late night work ─────────────────────────────────────
  const hour = new Date().getHours();
  const isLateNight = hour >= 23 || hour <= 5;
  if (isLateNight && currentSession.duration_minutes >= 10) {
    const workTypes = ['coding', 'document-editing', 'email-composing'];
    if (workTypes.includes(activity.type)) {
      console.log('[SCREENSHOT] Trigger: late night work session');
      return true;
    }
  }

  // ── Trigger 3: Stuck on same thing 20+ min ─────────────────────────
  if (currentSession.duration_minutes >= 20) {
    const stuckTypes = ['email-composing', 'document-editing', 'coding'];
    if (stuckTypes.includes(activity.type)) {
      console.log('[SCREENSHOT] Trigger: stuck 20+ min on', activity.type);
      return true;
    }
  }

  // ── Trigger 4: User seems frustrated (from patterns) ───────────────
  const frustratedPatterns = patterns.filter(p =>
    p.type === 'distracted' || p.type === 'stuck-editing'
  );
  if (frustratedPatterns.length >= 2) {
    console.log('[SCREENSHOT] Trigger: multiple frustration signals');
    return true;
  }

  return false;
}

/**
 * Reset cooldown timer (for testing)
 */
function resetCooldown() {
  lastScreenshotTime = 0;
  console.log('[SCREENSHOT] Cooldown reset');
}

module.exports = {
  captureScreen,
  shouldCapture,
  resetCooldown
};
