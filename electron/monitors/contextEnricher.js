/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * INTELLIGENT CONTEXT ENRICHER
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Fetches real-time context from connected services to understand EXACTLY
 * what the user is doing right now.
 *
 * Examples:
 * - Spotify: current song, artist, album, play count
 * - Gmail: drafting to who, subject line preview
 * - Calendar: current meeting, attendees
 * - YouTube: video title, channel, watch time
 * - Code editor: file name, language, recent commits
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

const spotify = require('../connectors/spotify');
const googleAuth = require('../connectors/google');
const { google } = require('googleapis');

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  SPOTIFY CONTEXT                                                      */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

let lastSpotifyCheck = 0;
let cachedSpotifyContext = null;
const SPOTIFY_CACHE_MS = 10000; // Cache for 10s to avoid rate limits

/**
 * Get current Spotify playback state + track info
 * Returns: { track, artist, album, isPlaying, position_ms, duration_ms, repeat_state }
 */
async function getSpotifyContext() {
  try {
    if (!spotify.isConnected()) return null;

    // Use cache if recent
    const now = Date.now();
    if (cachedSpotifyContext && (now - lastSpotifyCheck) < SPOTIFY_CACHE_MS) {
      return cachedSpotifyContext;
    }

    const data = await spotify.api('/me/player');

    if (!data || !data.item) {
      cachedSpotifyContext = null;
      lastSpotifyCheck = now;
      return null;
    }

    const context = {
      track: data.item.name,
      artist: data.item.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
      album: data.item.album?.name || 'Unknown Album',
      isPlaying: data.is_playing,
      position_ms: data.progress_ms || 0,
      duration_ms: data.item.duration_ms || 0,
      repeat_state: data.repeat_state, // 'off', 'track', 'context'
      uri: data.item.uri,
      popularity: data.item.popularity || 0,
    };

    cachedSpotifyContext = context;
    lastSpotifyCheck = now;

    console.log('[CONTEXT:SPOTIFY]', context.isPlaying ? '▶' : '⏸', `"${context.track}" by ${context.artist}`);

    return context;
  } catch (e) {
    console.error('[CONTEXT:SPOTIFY] Failed:', e.message);
    return null;
  }
}

/**
 * Detect if user is looping a song (repeat_state = 'track')
 */
function isLoopingTrack(spotifyContext) {
  return spotifyContext?.repeat_state === 'track';
}

/**
 * Detect if user has been listening to same song for a long time
 * (even without explicit repeat — might be manually replaying)
 */
let lastTrackUri = null;
let trackPlayCount = 0;
let firstPlayStart = 0;

function detectSongLoop(spotifyContext) {
  if (!spotifyContext) return null;

  const currentUri = spotifyContext.uri;

  if (currentUri !== lastTrackUri) {
    // New song
    lastTrackUri = currentUri;
    trackPlayCount = 1;
    firstPlayStart = Date.now();
    return null;
  }

  // Same song still playing
  trackPlayCount++;
  const totalListenTime = Date.now() - firstPlayStart;
  const avgPlayTime = totalListenTime / trackPlayCount;

  // If they've been on the same song for 10+ min or played 3+ times
  if (totalListenTime > 10 * 60 * 1000 || trackPlayCount >= 3) {
    return {
      track: spotifyContext.track,
      artist: spotifyContext.artist,
      playCount: trackPlayCount,
      totalMinutes: Math.floor(totalListenTime / 60000),
      isRepeating: spotifyContext.repeat_state === 'track',
    };
  }

  return null;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  GMAIL CONTEXT                                                        */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Get current Gmail draft (if composing)
 * Returns: { to, subject, snippet }
 */
async function getGmailDraftContext() {
  try {
    if (!googleAuth.isConnected()) return null;

    const auth = googleAuth.getClient();
    const gmail = google.gmail({ version: 'v1', auth });

    // Get most recent draft
    const list = await gmail.users.drafts.list({ userId: 'me', maxResults: 1 });
    if (!list.data.drafts || list.data.drafts.length === 0) return null;

    const draft = await gmail.users.drafts.get({
      userId: 'me',
      id: list.data.drafts[0].id,
      format: 'metadata',
      metadataHeaders: ['To', 'Subject']
    });

    const headers = Object.fromEntries(
      (draft.data.message?.payload?.headers || []).map(h => [h.name, h.value])
    );

    return {
      to: headers.To || 'unknown',
      subject: headers.Subject || '(no subject)',
      snippet: draft.data.message?.snippet || '',
    };
  } catch (e) {
    console.error('[CONTEXT:GMAIL] Failed:', e.message);
    return null;
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  CALENDAR CONTEXT                                                     */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Get current/upcoming calendar event
 * Returns: { summary, start, end, attendees, minutesUntil }
 */
async function getCalendarContext() {
  try {
    if (!googleAuth.isConnected()) return null;

    const auth = googleAuth.getClient();
    const calendar = google.calendar({ version: 'v3', auth });

    const now = new Date();
    const soon = new Date(now.getTime() + 60 * 60 * 1000); // Next hour

    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: soon.toISOString(),
      maxResults: 1,
      singleEvents: true,
      orderBy: 'startTime',
    });

    if (!res.data.items || res.data.items.length === 0) return null;

    const event = res.data.items[0];
    const startTime = new Date(event.start?.dateTime || event.start?.date);
    const minutesUntil = Math.floor((startTime - now) / 60000);

    return {
      summary: event.summary,
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
      attendees: event.attendees?.map(a => a.email) || [],
      minutesUntil,
      isNow: minutesUntil <= 5,
    };
  } catch (e) {
    console.error('[CONTEXT:CALENDAR] Failed:', e.message);
    return null;
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  UNIFIED CONTEXT BUILDER                                              */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Enrich activity with real-time context from connected services
 * Only fetch context relevant to current activity type
 */
async function enrichContext(activity, windowTitle) {
  const enriched = { ...activity };

  try {
    // SPOTIFY CONTEXT (if Spotify is active OR playing in background)
    const spotifyContext = await getSpotifyContext();
    if (spotifyContext && spotifyContext.isPlaying) {
      enriched.spotify = spotifyContext;

      // Check for loop behavior
      const loopInfo = detectSongLoop(spotifyContext);
      if (loopInfo) {
        enriched.spotifyLoop = loopInfo;
      }
    }

    // GMAIL CONTEXT (if composing email)
    if (activity.type === 'email-composing') {
      const gmailContext = await getGmailDraftContext();
      if (gmailContext) {
        enriched.gmail = gmailContext;
      }
    }

    // CALENDAR CONTEXT (always check for upcoming meetings)
    const calendarContext = await getCalendarContext();
    if (calendarContext) {
      enriched.calendar = calendarContext;
    }

    return enriched;
  } catch (e) {
    console.error('[CONTEXT:ENRICH] Error:', e.message);
    return enriched;
  }
}

/**
 * Build a natural language summary for the AI prompt
 */
function buildContextSummary(enrichedActivity) {
  const parts = [];

  // Base activity
  parts.push(`activity: ${enrichedActivity.detail}`);

  // Spotify context
  if (enrichedActivity.spotify) {
    const sp = enrichedActivity.spotify;
    const status = sp.isPlaying ? 'playing' : 'paused';
    parts.push(`spotify ${status}: "${sp.track}" by ${sp.artist}`);

    if (enrichedActivity.spotifyLoop) {
      const loop = enrichedActivity.spotifyLoop;
      if (loop.isRepeating) {
        parts.push(`(on repeat for ${loop.totalMinutes} min)`);
      } else {
        parts.push(`(listened ${loop.playCount} times in ${loop.totalMinutes} min)`);
      }
    }
  }

  // Gmail context
  if (enrichedActivity.gmail) {
    const gm = enrichedActivity.gmail;
    parts.push(`drafting email to ${gm.to} — subject: "${gm.subject}"`);
  }

  // Calendar context
  if (enrichedActivity.calendar) {
    const cal = enrichedActivity.calendar;
    if (cal.isNow) {
      parts.push(`meeting NOW: "${cal.summary}" with ${cal.attendees.length} attendees`);
    } else {
      parts.push(`meeting in ${cal.minutesUntil} min: "${cal.summary}"`);
    }
  }

  return parts.join('\n');
}

module.exports = {
  getSpotifyContext,
  isLoopingTrack,
  detectSongLoop,
  getGmailDraftContext,
  getCalendarContext,
  enrichContext,
  buildContextSummary,
};
