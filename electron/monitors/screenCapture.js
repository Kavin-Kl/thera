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

/**
 * Capture screenshot of the primary screen
 * Returns: base64 encoded PNG string (without data:image/png;base64, prefix)
 * Note: Rate limiting removed - now called periodically from activityMonitor
 */
async function captureScreen() {
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

    console.log('[SCREENSHOT] Captured screen:', base64Image.length, 'bytes');

    return base64Image;
  } catch (e) {
    console.error('[SCREENSHOT] Failed to capture:', e.message);
    return null;
  }
}

module.exports = {
  captureScreen
};
