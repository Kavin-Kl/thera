/**
 * Slack OAuth (v2) + thin REST helper.
 */
const tokenStore = require('./tokenStore');
const { runOAuthFlow } = require('./oauthLoopback');

const SCOPES = [
  'chat:write',
  'channels:read',
  'channels:history',
  'groups:read',
  'im:read',
  'im:write',
  'users:read',
  'search:read',
].join(',');

function hasCredentials() {
  return !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET
    && process.env.SLACK_CLIENT_ID !== 'your_slack_client_id');
}

async function connect() {
  if (!hasCredentials()) {
    throw new Error('Slack OAuth not configured. Add SLACK_CLIENT_ID and SLACK_CLIENT_SECRET to .env');
  }

  let capturedRedirect = null;
  const query = await runOAuthFlow({
    buildAuthUrl: (port) => {
      capturedRedirect = `http://127.0.0.1:${port}/oauth/callback`;
      const params = new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID,
        user_scope: SCOPES,
        redirect_uri: capturedRedirect,
      });
      return `https://slack.com/oauth/v2/authorize?${params}`;
    },
  });

  const body = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID,
    client_secret: process.env.SLACK_CLIENT_SECRET,
    code: query.code,
    redirect_uri: capturedRedirect,
  });
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack token exchange failed: ${data.error}`);
  // user-scoped token lives at data.authed_user.access_token
  const tokens = {
    access_token: data.authed_user?.access_token || data.access_token,
    user_id: data.authed_user?.id,
    team: data.team,
    raw: data,
  };
  tokenStore.set('slack', tokens);
  return tokens;
}

function disconnect() { tokenStore.clear('slack'); }
function isConnected() { return !!tokenStore.get('slack'); }

async function api(method, params = {}) {
  const tokens = tokenStore.get('slack');
  if (!tokens) throw new Error('Slack not connected');
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error}`);
  return data;
}

module.exports = { connect, disconnect, isConnected, hasCredentials, api };
