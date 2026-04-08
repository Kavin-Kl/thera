/**
 * Spotify OAuth (Authorization Code flow) + thin REST helper.
 *
 * Uses raw fetch — no SDK dependency. Tokens auto-refresh on 401.
 */
const tokenStore = require('./tokenStore');
const { runOAuthFlow } = require('./oauthLoopback');

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'user-library-read',
].join(' ');

function hasCredentials() {
  return !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET
    && process.env.SPOTIFY_CLIENT_ID !== 'your_spotify_client_id');
}

async function connect() {
  if (!hasCredentials()) {
    throw new Error('Spotify OAuth not configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env');
  }

  // Spotify requires exact redirect URI matching — use a fixed port
  // You must add http://127.0.0.1:8888/oauth/callback to your Spotify app's
  // Redirect URIs at https://developer.spotify.com/dashboard
  const REDIRECT_URI = 'http://127.0.0.1:51234/oauth/callback';

  const query = await runOAuthFlow({
    fixedPort: 51234,
    buildAuthUrl: () => {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: process.env.SPOTIFY_CLIENT_ID,
        scope: SCOPES,
        redirect_uri: REDIRECT_URI,
      });
      return `https://accounts.spotify.com/authorize?${params}`;
    },
  });

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: query.code,
    redirect_uri: REDIRECT_URI,
  });
  const auth = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) throw new Error(`Spotify token exchange failed: ${res.status} ${await res.text()}`);
  const tokens = await res.json();
  // tokens: { access_token, refresh_token, expires_in, ... }
  tokens.expires_at = Date.now() + (tokens.expires_in * 1000);
  tokenStore.set('spotify', tokens);
  return tokens;
}

function disconnect() { tokenStore.clear('spotify'); }
function isConnected() { return !!tokenStore.get('spotify'); }

async function refreshIfNeeded() {
  const tokens = tokenStore.get('spotify');
  if (!tokens) throw new Error('Spotify not connected');
  if (tokens.expires_at && Date.now() < tokens.expires_at - 30_000) return tokens.access_token;

  const auth = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
  });
  if (!res.ok) throw new Error(`Spotify refresh failed: ${res.status}`);
  const fresh = await res.json();
  const merged = { ...tokens, ...fresh, expires_at: Date.now() + (fresh.expires_in * 1000) };
  tokenStore.set('spotify', merged);
  return merged.access_token;
}

/** Authorized fetch wrapper. */
async function api(pathOrUrl, { method = 'GET', body, query } = {}) {
  const token = await refreshIfNeeded();
  let url = pathOrUrl.startsWith('http') ? pathOrUrl : `https://api.spotify.com/v1${pathOrUrl}`;
  if (query) url += '?' + new URLSearchParams(query);
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Spotify API ${res.status}: ${await res.text()}`);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

module.exports = { connect, disconnect, isConnected, hasCredentials, api };
