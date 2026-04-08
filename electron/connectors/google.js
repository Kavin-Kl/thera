/**
 * Google OAuth + API client.
 *
 * One OAuth flow grants access to Gmail, Calendar, Contacts, Drive, Docs, Sheets.
 * Tokens are persisted via tokenStore. The exported `getClient()` returns an
 * authorized OAuth2 client ready to pass into googleapis services.
 */
const { google } = require('googleapis');
const tokenStore = require('./tokenStore');
const { runOAuthFlow } = require('./oauthLoopback');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/contacts.other.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
];

function hasCredentials() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    && process.env.GOOGLE_CLIENT_ID !== 'your_google_oauth_client_id');
}

function makeClient(redirectUri) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

async function connect() {
  if (!hasCredentials()) {
    throw new Error('Google OAuth not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env');
  }

  let capturedRedirect = null;
  const query = await runOAuthFlow({
    buildAuthUrl: (port) => {
      capturedRedirect = `http://127.0.0.1:${port}/oauth/callback`;
      const client = makeClient(capturedRedirect);
      return client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: SCOPES,
      });
    },
  });

  const client = makeClient(capturedRedirect);
  const { tokens } = await client.getToken(query.code);
  tokenStore.set('google', tokens);
  return tokens;
}

function disconnect() {
  tokenStore.clear('google');
}

function isConnected() {
  return !!tokenStore.get('google');
}

/** Returns an authorized OAuth2 client. Auto-persists refreshed tokens. */
function getClient() {
  const tokens = tokenStore.get('google');
  if (!tokens) throw new Error('Google not connected');
  const client = makeClient();
  client.setCredentials(tokens);
  client.on('tokens', (newTokens) => {
    const merged = { ...tokenStore.get('google'), ...newTokens };
    tokenStore.set('google', merged);
  });
  return client;
}

/** Returns the authenticated user's email address. Cached after first call. */
let _cachedEmail = null;
async function getUserEmail() {
  if (_cachedEmail) return _cachedEmail;
  const auth = getClient();
  const oauth2 = google.oauth2({ version: 'v2', auth });
  const res = await oauth2.userinfo.get();
  _cachedEmail = res.data.email;
  return _cachedEmail;
}

// Clear cache on disconnect
const _origDisconnect = disconnect;
function disconnectAndClear() {
  _cachedEmail = null;
  _origDisconnect();
}

module.exports = { connect, disconnect: disconnectAndClear, isConnected, getClient, hasCredentials, getUserEmail };
