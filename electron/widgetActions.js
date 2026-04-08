/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * WIDGET QUICK ACTIONS
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Actions that can be triggered from the widget (nudges + mini chat)
 * - Change Spotify song
 * - Pause/resume music
 * - Snooze reminders
 * - Quick replies
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

const spotify = require('./connectors/spotify');

/**
 * Skip to next track
 */
async function spotifyNext() {
  try {
    if (!spotify.isConnected()) {
      return { ok: false, error: 'Spotify not connected' };
    }

    await spotify.api('/me/player/next', { method: 'POST' });

    // Wait a moment for the skip to register
    await new Promise(resolve => setTimeout(resolve, 500));

    // Get the new track info
    const player = await spotify.api('/me/player');
    if (player?.item) {
      return {
        ok: true,
        track: player.item.name,
        artist: player.item.artists?.map(a => a.name).join(', ') || 'Unknown',
      };
    }

    return { ok: true };
  } catch (e) {
    console.error('[WIDGET:SPOTIFY] Skip failed:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Go to previous track
 */
async function spotifyPrevious() {
  try {
    if (!spotify.isConnected()) {
      return { ok: false, error: 'Spotify not connected' };
    }

    await spotify.api('/me/player/previous', { method: 'POST' });

    await new Promise(resolve => setTimeout(resolve, 500));

    const player = await spotify.api('/me/player');
    if (player?.item) {
      return {
        ok: true,
        track: player.item.name,
        artist: player.item.artists?.map(a => a.name).join(', ') || 'Unknown',
      };
    }

    return { ok: true };
  } catch (e) {
    console.error('[WIDGET:SPOTIFY] Previous failed:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Toggle play/pause
 */
async function spotifyToggle() {
  try {
    if (!spotify.isConnected()) {
      return { ok: false, error: 'Spotify not connected' };
    }

    const player = await spotify.api('/me/player');
    const isPlaying = player?.is_playing;

    if (isPlaying) {
      await spotify.api('/me/player/pause', { method: 'PUT' });
      return { ok: true, action: 'paused' };
    } else {
      await spotify.api('/me/player/play', { method: 'PUT' });
      return { ok: true, action: 'playing' };
    }
  } catch (e) {
    console.error('[WIDGET:SPOTIFY] Toggle failed:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Turn off repeat (when user is looping)
 */
async function spotifyDisableRepeat() {
  try {
    if (!spotify.isConnected()) {
      return { ok: false, error: 'Spotify not connected' };
    }

    await spotify.api('/me/player/repeat?state=off', { method: 'PUT' });
    return { ok: true };
  } catch (e) {
    console.error('[WIDGET:SPOTIFY] Disable repeat failed:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Get current playback state
 */
async function spotifyGetCurrent() {
  try {
    if (!spotify.isConnected()) {
      return { ok: false, error: 'Spotify not connected' };
    }

    const player = await spotify.api('/me/player');
    if (!player?.item) {
      return { ok: true, isPlaying: false, track: null };
    }

    return {
      ok: true,
      isPlaying: player.is_playing,
      track: player.item.name,
      artist: player.item.artists?.map(a => a.name).join(', ') || 'Unknown',
      album: player.item.album?.name || 'Unknown',
      repeat: player.repeat_state,
      position_ms: player.progress_ms,
      duration_ms: player.item.duration_ms,
    };
  } catch (e) {
    console.error('[WIDGET:SPOTIFY] Get current failed:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = {
  spotifyNext,
  spotifyPrevious,
  spotifyToggle,
  spotifyDisableRepeat,
  spotifyGetCurrent,
};
