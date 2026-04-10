/**
 * Connector Action Executor.
 *
 * Single entry point: `execute({ type, params })` dispatches to the right
 * provider. The AI returns action JSON; main.js calls execute() and returns
 * the result back to the renderer.
 *
 * Supported actions:
 *   gmail.send         { to, subject, body }
 *   gmail.draft        { to, subject, body }
 *   gmail.search       { query, max? }
 *   gcal.create        { summary, start, end, description?, attendees? }
 *   gcal.list          { max?, timeMin?, timeMax? }
 *   gcontacts.search   { query }
 *   gdrive.search      { query, max? }
 *   gdocs.create       { title, content? }
 *   gsheets.read       { spreadsheetId, range }
 *   spotify.play       {}
 *   spotify.pause      {}
 *   spotify.queue      { uri }
 *   spotify.search     { query, type? }
 *   slack.send         { channel, text }
 *   slack.search       { query }
 *   reminders.create   { text, when? }   (built-in, written to local DB)
 *   notes.create       { text }          (built-in, written to local DB)
 */

const { google } = require('googleapis');
const googleAuth = require('./google');
const spotify = require('./spotify');
const slack = require('./slack');
const { db } = require('../db/localDb');

// Lazily ensure built-in tables exist
db.exec(`
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    due_at INTEGER,
    done INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
`);

// ── Gmail ─────────────────────────────────────────────────────────

const FAKE_DOMAINS = ['@example.com', '@example.org', '@test.com', '@placeholder.com'];
const FAKE_EMAIL_RE = /[\w.+-]+@(example|test|placeholder)\.(com|org|net)/i;

/** Resolve "myself", "me", first-name-only, etc. to a real email address. */
async function resolveRecipient(to) {
  if (!to) throw new Error('No recipient specified');

  // Strip fake domain suffix the AI invents — treat "ronish@example.com" as "ronish"
  const isFake = FAKE_DOMAINS.some(d => to.trim().toLowerCase().endsWith(d));
  const stripped = isFake ? to.trim().split('@')[0] : to.trim();
  const lower = stripped.toLowerCase();

  // "myself" / "me" → logged-in user's email
  if (lower === 'myself' || lower === 'me') {
    return await googleAuth.getUserEmail();
  }
  // Looks like a real email already
  if (!isFake && lower.includes('@')) return to;
  // Try contacts lookup for first-name-only ("alex", "ronish", etc.)
  try {
    const contacts = await contactsSearch({ query: to });
    if (contacts.length > 0 && contacts[0].email) return contacts[0].email;
  } catch (e) {
    console.warn('[ACTIONS] contacts lookup failed for', to, e.message);
  }
  // Last resort: search Gmail history for emails to/from this person
  try {
    const auth = googleAuth.getClient();
    const gmail = google.gmail({ version: 'v1', auth });
    const myEmail = await googleAuth.getUserEmail();
    const list = await gmail.users.messages.list({
      userId: 'me', q: stripped, maxResults: 10,
    });
    const messages = list.data.messages || [];
    for (const m of messages) {
      const msg = await gmail.users.messages.get({
        userId: 'me', id: m.id, format: 'metadata',
        metadataHeaders: ['From', 'To', 'Cc'],
      });
      const headers = Object.fromEntries(
        (msg.data.payload?.headers || []).map(h => [h.name, h.value])
      );
      // Extract all emails from From/To/Cc headers
      const allAddresses = [headers.From, headers.To, headers.Cc]
        .filter(Boolean).join(' ');
      // Find all "Name <email>" or bare email patterns
      const pairs = [...allAddresses.matchAll(/([^<,;]+?)\s*<([^>]+@[^>]+)>/g)];
      for (const pair of pairs) {
        const name = pair[1].trim().toLowerCase();
        const email = pair[2].trim();
        if (email === myEmail) continue;
        if (FAKE_EMAIL_RE.test(email)) continue; // skip fake addresses
        if (name.includes(lower) || lower.includes(name.split(' ')[0])) {
          console.log('[ACTIONS] resolved', stripped, '→', email, 'via gmail history');
          return email;
        }
      }
      // Fallback: any non-self, non-fake email in the thread
      const bareEmails = allAddresses.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || [];
      for (const email of bareEmails) {
        if (email === myEmail) continue;
        if (FAKE_EMAIL_RE.test(email)) continue;
        if (email.toLowerCase().includes(lower.split(' ')[0])) {
          console.log('[ACTIONS] resolved', stripped, '→', email, 'via gmail bare match');
          return email;
        }
      }
    }
  } catch (e) {
    console.warn('[ACTIONS] gmail history lookup failed for', to, e.message);
  }

  // Can't resolve — surface a clear error so the AI can ask for the email
  throw new Error(`no email address found for "${to}" — ask the user for their email`);
}

function buildRawEmail({ to, subject, body }) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body || '',
  ];
  return Buffer.from(lines.join('\r\n')).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function gmailSend({ to, subject, body }) {
  const resolvedTo = await resolveRecipient(to);
  const auth = googleAuth.getClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const raw = buildRawEmail({ to: resolvedTo, subject, body });
  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return { id: res.data.id, threadId: res.data.threadId };
}

async function gmailDraft({ to, subject, body }) {
  const resolvedTo = await resolveRecipient(to);
  const auth = googleAuth.getClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const raw = buildRawEmail({ to: resolvedTo, subject, body });
  const res = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });
  return { id: res.data.id };
}

async function gmailSearch({ query, max = 10 }) {
  const auth = googleAuth.getClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: max });
  const messages = list.data.messages || [];
  // Fetch metadata only — never full bodies (token optimization)
  const detailed = await Promise.all(messages.map(m =>
    gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'] })
  ));
  return detailed.map(d => {
    const headers = Object.fromEntries((d.data.payload?.headers || []).map(h => [h.name, h.value]));
    return {
      id: d.data.id,
      from: headers.From,
      subject: headers.Subject,
      date: headers.Date,
      snippet: d.data.snippet,
    };
  });
}

// ── Calendar ──────────────────────────────────────────────────────
async function gcalCreate({ summary, start, end, description, attendees }) {
  const auth = googleAuth.getClient();
  const calendar = google.calendar({ version: 'v3', auth });

  // Get the user's calendar timezone; fall back to local system timezone
  let timeZone;
  try {
    const cal = await calendar.calendars.get({ calendarId: 'primary' });
    timeZone = cal.data.timeZone;
  } catch (_) {}
  timeZone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary,
      description,
      start: { dateTime: start, timeZone },
      end: { dateTime: end, timeZone },
      attendees: (attendees || []).map(email => ({ email })),
    },
  });
  return { id: res.data.id, link: res.data.htmlLink };
}

async function gcalList({ max = 10, timeMin, timeMax }) {
  const auth = googleAuth.getClient();
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: timeMin || new Date().toISOString(),
    timeMax,
    maxResults: max,
    singleEvents: true,
    orderBy: 'startTime',
  });
  return (res.data.items || []).map(e => ({
    id: e.id,
    summary: e.summary,
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    location: e.location,
  }));
}

// ── Contacts ──────────────────────────────────────────────────────
async function contactsSearch({ query }) {
  const auth = googleAuth.getClient();
  const people = google.people({ version: 'v1', auth });

  // Search personal contacts first
  let results = [];
  try {
    const res = await people.people.searchContacts({
      query,
      readMask: 'names,emailAddresses,phoneNumbers',
    });
    results = (res.data.results || []).map(r => ({
      name: r.person?.names?.[0]?.displayName,
      email: r.person?.emailAddresses?.[0]?.value,
      phone: r.person?.phoneNumbers?.[0]?.value,
    })).filter(r => r.email);
  } catch (_) {}

  // Fall back to "Other Contacts" (auto-created from past emails — Gmail autocomplete uses these)
  if (results.length === 0) {
    try {
      const res = await people.otherContacts.search({
        query,
        readMask: 'names,emailAddresses',
      });
      results = (res.data.results || []).map(r => ({
        name: r.person?.names?.[0]?.displayName,
        email: r.person?.emailAddresses?.[0]?.value,
      })).filter(r => r.email);
    } catch (_) {}
  }

  return results;
}

// ── Drive ─────────────────────────────────────────────────────────
async function driveSearch({ query, max = 10 }) {
  const auth = googleAuth.getClient();
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.list({
    q: `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`,
    pageSize: max,
    fields: 'files(id, name, mimeType, modifiedTime, webViewLink)',
  });
  return res.data.files || [];
}

// ── Docs ──────────────────────────────────────────────────────────
async function docsCreate({ title, content }) {
  const auth = googleAuth.getClient();
  const docs = google.docs({ version: 'v1', auth });
  const created = await docs.documents.create({ requestBody: { title } });
  if (content) {
    await docs.documents.batchUpdate({
      documentId: created.data.documentId,
      requestBody: {
        requests: [{ insertText: { location: { index: 1 }, text: content } }],
      },
    });
  }
  return { id: created.data.documentId, link: `https://docs.google.com/document/d/${created.data.documentId}` };
}

// ── Sheets ────────────────────────────────────────────────────────
async function sheetsRead({ spreadsheetId, range }) {
  const auth = googleAuth.getClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
}

// ── Spotify ───────────────────────────────────────────────────────
async function spotifyPlay({ query, uri } = {}) {
  if (query) {
    const data = await spotify.api('/search', { query: { q: query, type: 'track', limit: 1 } });
    const track = data?.tracks?.items?.[0];
    if (!track) throw new Error(`No track found for "${query}"`);
    await spotify.api('/me/player/play', { method: 'PUT', body: { uris: [track.uri] } });
    return { track: track.name, artist: track.artists?.map(a => a.name).join(', ') };
  }
  if (uri) {
    await spotify.api('/me/player/play', { method: 'PUT', body: { uris: [uri] } });
    return { ok: true };
  }
  await spotify.api('/me/player/play', { method: 'PUT' });
  return { ok: true };
}
async function spotifyPause() { await spotify.api('/me/player/pause', { method: 'PUT' }); return { ok: true }; }
async function spotifyNext() { await spotify.api('/me/player/next', { method: 'POST' }); return { ok: true }; }
async function spotifyPrevious() { await spotify.api('/me/player/previous', { method: 'POST' }); return { ok: true }; }
async function spotifyQueue({ uri }) {
  await spotify.api('/me/player/queue', { method: 'POST', query: { uri } });
  return { ok: true };
}
async function spotifySearch({ query, type = 'track' }) {
  const data = await spotify.api('/search', { query: { q: query, type, limit: 10 } });
  return data;
}

// ── Slack ─────────────────────────────────────────────────────────
async function slackSend({ channel, text }) {
  return slack.api('chat.postMessage', { channel, text });
}
async function slackSearch({ query }) {
  return slack.api('search.messages', { query });
}

// ── Browser automation ────────────────────────────────────────────
// Requires the Thera Bridge extension + bridge server running (port 7979)
async function sendExtensionCommand(cmd) {
  const http = require('http');
  console.log('[ACTIONS] sendExtensionCommand:', cmd.type, 'taskId:', cmd.taskId);
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(cmd);
    const req = http.request(
      { hostname: '127.0.0.1', port: 7979, path: '/ext-command', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          console.log('[ACTIONS] sendExtensionCommand response status:', res.statusCode, 'body:', d.slice(0,100));
          try { resolve(JSON.parse(d || '{}')); } catch(_) { resolve({}); }
        });
      }
    );
    req.on('error', (e) => {
      console.error('[ACTIONS] sendExtensionCommand FAILED (bridge not running?):', e.message);
      reject(e);
    });
    req.setTimeout(5000, () => {
      console.error('[ACTIONS] sendExtensionCommand timed out after 5s');
      req.destroy(new Error('timeout'));
    });
    req.write(body);
    req.end();
  });
}

async function browserOpen({ url, newTab = true }) {
  await sendExtensionCommand({ type: 'open-url', url, newTab });
  return { opened: url };
}

async function browserSearch({ query, engine = 'google' }) {
  const engines = {
    google: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    youtube: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    maps: `https://www.google.com/maps/search/${encodeURIComponent(query)}`,
    amazon: `https://www.amazon.in/s?k=${encodeURIComponent(query)}`,
    zomato: `https://www.zomato.com/search?q=${encodeURIComponent(query)}`,
    bookmyshow: `https://in.bookmyshow.com/explore/movies?query=${encodeURIComponent(query)}`,
  };
  const url = engines[engine] || engines.google;
  await sendExtensionCommand({ type: 'open-url', url, newTab: true });
  return { opened: url };
}

async function browserWhatsappDm({ to, message }) {
  const taskId = `wa_${Date.now()}`;
  await sendExtensionCommand({ type: 'whatsapp-dm', to, message, taskId });
  return { sent: true, to, platform: 'whatsapp', taskId };
}

async function browserInstagramDm({ to, message }) {
  const taskId = `ig_${Date.now()}`;
  await sendExtensionCommand({ type: 'instagram-dm', to, message, taskId });
  return { sent: true, to, platform: 'instagram', taskId };
}

async function browserAutomate({ url, steps, waitAfterNav }) {
  await sendExtensionCommand({ type: 'automate', url, steps, waitAfterNav, taskId: `task_${Date.now()}` });
  return { ok: true };
}

// ── Built-ins ─────────────────────────────────────────────────────
function reminderCreate({ text, when }) {
  const dueAt = when ? Math.floor(new Date(when).getTime() / 1000) : null;
  const info = db.prepare(`INSERT INTO reminders (text, due_at) VALUES (?, ?)`).run(text, dueAt);
  return { id: info.lastInsertRowid };
}
function noteCreate({ text }) {
  const info = db.prepare(`INSERT INTO notes (text) VALUES (?)`).run(text);
  return { id: info.lastInsertRowid };
}

// ── Dispatcher ────────────────────────────────────────────────────
const HANDLERS = {
  'gmail.send': gmailSend,
  'gmail.draft': gmailDraft,
  'gmail.search': gmailSearch,
  'gcal.create': gcalCreate,
  'gcal.list': gcalList,
  'gcontacts.search': contactsSearch,
  'gdrive.search': driveSearch,
  'gdocs.create': docsCreate,
  'gsheets.read': sheetsRead,
  'spotify.play': spotifyPlay,
  'spotify.pause': spotifyPause,
  'spotify.next': spotifyNext,
  'spotify.previous': spotifyPrevious,
  'spotify.queue': spotifyQueue,
  'spotify.search': spotifySearch,
  'slack.send': slackSend,
  'slack.search': slackSearch,
  'reminders.create': reminderCreate,
  'notes.create': noteCreate,
  'browser.open': browserOpen,
  'browser.search': browserSearch,
  'browser.whatsapp.dm': browserWhatsappDm,
  'browser.instagram.dm': browserInstagramDm,
  'browser.automate': browserAutomate,
};

async function execute({ type, params = {} }) {
  const handler = HANDLERS[type];
  if (!handler) throw new Error(`Unknown action: ${type}`);
  try {
    const result = await handler(params);
    return { ok: true, result };
  } catch (e) {
    console.error(`[ACTIONS] ${type} failed:`, e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { execute, HANDLERS };
