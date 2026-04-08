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
  const auth = googleAuth.getClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const raw = buildRawEmail({ to, subject, body });
  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return { id: res.data.id, threadId: res.data.threadId };
}

async function gmailDraft({ to, subject, body }) {
  const auth = googleAuth.getClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const raw = buildRawEmail({ to, subject, body });
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
  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary,
      description,
      start: { dateTime: start },
      end: { dateTime: end },
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
  const res = await people.people.searchContacts({
    query,
    readMask: 'names,emailAddresses,phoneNumbers',
  });
  return (res.data.results || []).map(r => ({
    name: r.person?.names?.[0]?.displayName,
    email: r.person?.emailAddresses?.[0]?.value,
    phone: r.person?.phoneNumbers?.[0]?.value,
  }));
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
async function spotifyPlay() { await spotify.api('/me/player/play', { method: 'PUT' }); return { ok: true }; }
async function spotifyPause() { await spotify.api('/me/player/pause', { method: 'PUT' }); return { ok: true }; }
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
  'spotify.queue': spotifyQueue,
  'spotify.search': spotifySearch,
  'slack.send': slackSend,
  'slack.search': slackSearch,
  'reminders.create': reminderCreate,
  'notes.create': noteCreate,
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
