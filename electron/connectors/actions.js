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
const bridgeClient = require('../bridgeClient');

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

async function gmailRead({ id }) {
  const auth = googleAuth.getClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
  const headers = Object.fromEntries((msg.data.payload?.headers || []).map(h => [h.name, h.value]));
  // Decode body — may be in parts or directly in body
  function decodePart(part) {
    if (!part) return '';
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf8');
    }
    if (part.parts) return part.parts.map(decodePart).join('');
    return '';
  }
  const body = decodePart(msg.data.payload) || Buffer.from(msg.data.payload?.body?.data || '', 'base64').toString('utf8');
  return {
    id: msg.data.id,
    threadId: msg.data.threadId,
    from: headers.From,
    to: headers.To,
    subject: headers.Subject,
    date: headers.Date,
    body: body.slice(0, 6000),
  };
}

async function gmailReply({ threadId, to, subject, body }) {
  const resolvedTo = await resolveRecipient(to);
  const auth = googleAuth.getClient();
  const gmail = google.gmail({ version: 'v1', auth });
  // Get thread to find the Message-ID to reply to
  const thread = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'metadata',
    metadataHeaders: ['Message-ID', 'References'] });
  const lastMsg = thread.data.messages?.slice(-1)[0];
  const lastHeaders = Object.fromEntries((lastMsg?.payload?.headers || []).map(h => [h.name, h.value]));
  const messageId = lastHeaders['Message-ID'] || '';
  const references = lastHeaders['References'] ? `${lastHeaders['References']} ${messageId}` : messageId;
  const lines = [
    `To: ${resolvedTo}`,
    `Subject: ${subject.startsWith('Re:') ? subject : `Re: ${subject}`}`,
    `In-Reply-To: ${messageId}`,
    `References: ${references}`,
    `Content-Type: text/plain; charset=utf-8`,
    '',
    body || '',
  ];
  const raw = Buffer.from(lines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw, threadId } });
  return { id: res.data.id, threadId: res.data.threadId };
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

async function docsRead({ docId }) {
  const auth = googleAuth.getClient();
  const docs = google.docs({ version: 'v1', auth });
  const doc = await docs.documents.get({ documentId: docId });
  function extractText(elements = []) {
    return elements.map(el => {
      if (el.paragraph) return el.paragraph.elements?.map(e => e.textRun?.content || '').join('') || '';
      if (el.table) return el.table.tableRows?.map(r => r.tableCells?.map(c => extractText(c.content)).join('\t')).join('\n') || '';
      return '';
    }).join('');
  }
  const text = extractText(doc.data.body?.content || []);
  return { id: doc.data.documentId, title: doc.data.title, text: text.slice(0, 8000) };
}

async function docsEdit({ docId, content, mode = 'append' }) {
  const auth = googleAuth.getClient();
  const docs = google.docs({ version: 'v1', auth });
  const doc = await docs.documents.get({ documentId: docId });
  const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;
  const requests = mode === 'append'
    ? [{ insertText: { location: { index: endIndex - 1 }, text: '\n' + content } }]
    : [
        { deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } },
        { insertText: { location: { index: 1 }, text: content } },
      ];
  await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests } });
  return { ok: true, docId };
}

// ── Sheets ────────────────────────────────────────────────────────
async function sheetsRead({ spreadsheetId, range }) {
  const auth = googleAuth.getClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
}

async function sheetsUpdate({ spreadsheetId, range, values }) {
  const auth = googleAuth.getClient();
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId, range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
  return { ok: true };
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
  const items = data?.[`${type}s`]?.items || [];
  return items.map(t => ({ name: t.name, uri: t.uri, artist: t.artists?.map(a=>a.name).join(', '), album: t.album?.name }));
}

async function spotifyGetCurrent() {
  const data = await spotify.api('/me/player/currently-playing');
  if (!data || !data.item) return { playing: false };
  return {
    playing: data.is_playing,
    track: data.item.name,
    artist: data.item.artists?.map(a => a.name).join(', '),
    album: data.item.album?.name,
    progress_ms: data.progress_ms,
    duration_ms: data.item.duration_ms,
  };
}

async function spotifyVolume({ volume_percent }) {
  await spotify.api('/me/player/volume', { method: 'PUT', query: { volume_percent } });
  return { ok: true };
}

// ── Slack ─────────────────────────────────────────────────────────
async function slackSend({ channel, text }) {
  return slack.api('chat.postMessage', { channel, text });
}
async function slackSearch({ query }) {
  return slack.api('search.messages', { query });
}
async function slackRead({ channel, limit = 20 }) {
  // Resolve channel ID if name given
  let channelId = channel;
  if (!channel.startsWith('C') && !channel.startsWith('D') && !channel.startsWith('G')) {
    const list = await slack.api('conversations.list', { types: 'public_channel,private_channel,im,mpim', limit: 200 });
    const found = (list.channels || []).find(c => c.name === channel.replace(/^#/, '') || c.id === channel);
    if (!found) throw new Error(`Slack channel not found: ${channel}`);
    channelId = found.id;
  }
  const res = await slack.api('conversations.history', { channel: channelId, limit });
  return (res.messages || []).map(m => ({ ts: m.ts, user: m.user, text: m.text, bot: !!m.bot_id }));
}
async function slackStatus({ status_text, status_emoji = ':speech_balloon:', duration_minutes = 0 }) {
  const expiration = duration_minutes > 0 ? Math.floor(Date.now() / 1000) + duration_minutes * 60 : 0;
  await slack.api('users.profile.set', {
    profile: { status_text, status_emoji, status_expiration: expiration },
  });
  return { ok: true };
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
  const taskId = `task_${Date.now()}`;
  await sendExtensionCommand({ type: 'automate', url, steps, waitAfterNav, taskId });
  return { ok: true };
}

// ── AI-driven agentic browser automation ──────────────────────────────────────

async function sendExtensionCommandAndWait(cmd, timeoutMs = 45000) {
  await sendExtensionCommand(cmd);
  return bridgeClient.waitForTask(cmd.taskId, timeoutMs);
}

/** Read the active tab's DOM context — URL, title, text, interactive elements. */
async function getPageContext() {
  const taskId = `read_${Date.now()}`;
  try {
    const result = await sendExtensionCommandAndWait({ type: 'read-page', taskId }, 15000);
    return result;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function browserAiTask({ goal, url }) {
  let GoogleGenAI;
  try {
    ({ GoogleGenAI } = require('@google/genai'));
  } catch (e) {
    throw new Error('GoogleGenAI not available in main process: ' + e.message);
  }

  const ai = new GoogleGenAI({ apiKey: process.env.VITE_GEMINI_API_KEY });

  // Navigate to starting URL if provided
  if (url) {
    await sendExtensionCommand({ type: 'open-url', url, newTab: true });
    await new Promise(r => setTimeout(r, 3000));
  }

  const MAX_ITERATIONS = 12;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    console.log(`[AI-TASK] iteration ${i + 1}/${MAX_ITERATIONS}, goal: ${goal}`);

    // Read DOM instead of taking a screenshot — much faster and cheaper
    const page = await getPageContext();
    if (!page.ok) {
      console.warn('[AI-TASK] read-page failed:', page.error);
      if (i === 0) throw new Error('Could not read browser page: ' + page.error);
      // If mid-task, give it another iteration (page might be loading)
      await sleep(2000);
      continue;
    }

    // Format interactive elements for the prompt
    const interactiveStr = page.interactive?.length
      ? '\n\nINTERACTIVE ELEMENTS ON PAGE:\n' + page.interactive.map(el => {
          if (el.type === 'button') return `  [BTN] "${el.text}"${el.sel ? '  sel=' + el.sel : ''}`;
          if (el.type === 'input')  return `  [INPUT] placeholder="${el.placeholder}"${el.sel ? '  sel=' + el.sel : ''}${el.value ? '  current="' + el.value + '"' : ''}`;
          if (el.type === 'link')   return `  [LINK] "${el.text}"  href=${el.href}`;
          if (el.type === 'select') return `  [SELECT]${el.sel ? ' sel=' + el.sel : ''}  options=[${el.options?.join(', ')}]`;
          return '';
        }).filter(Boolean).join('\n')
      : '';

    const prompt = `You are Thera's browser automation agent.

GOAL: "${goal}"
ITERATION: ${i + 1} of ${MAX_ITERATIONS}

CURRENT PAGE:
URL: ${page.url || 'unknown'}
TITLE: ${page.title || 'unknown'}

PAGE TEXT:
${(page.text || '(empty)').slice(0, 2500)}
${interactiveStr}

Decide the next steps to make progress toward the goal. Reply with ONLY a JSON object — no markdown, no explanation:
{
  "done": false,
  "summary": "",
  "steps": [
    {"action": "navigate", "url": "FULL_URL"},
    {"action": "click", "selector": "CSS_SELECTOR", "timeout": 8000},
    {"action": "click-text", "text": "EXACT_VISIBLE_BUTTON_OR_LINK_TEXT"},
    {"action": "type", "selector": "CSS_SELECTOR", "text": "TEXT_TO_TYPE", "clear": true},
    {"action": "press", "key": "Enter"},
    {"action": "scroll", "amount": 400},
    {"action": "wait", "selector": "CSS_SELECTOR", "timeout": 8000},
    {"action": "sleep", "ms": 1500}
  ]
}

Rules:
- If the goal is accomplished (visible in page text above), set "done": true with summary of what happened.
- Use "navigate" step to go to a URL — don't use a separate field.
- Prefer "click-text" with exact visible text from INTERACTIVE ELEMENTS when you can see the element listed.
- Prefer selectors from INTERACTIVE ELEMENTS (sel=...) over guessing class names.
- For search: type in the input field, then press Enter.
- Keep steps to 2–5 per iteration. The loop reads the page again after each batch.
- If page text shows a captcha or visual challenge, use {"action": "sleep", "ms": 3000} and we'll deal with it next turn.
- If you're stuck on the same page, try navigating to a more specific URL.
- NEVER set done:true unless the page text confirms the task is complete.`;

    let decision;
    try {
      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } },
      });
      const raw = result.text?.trim() || '{}';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) { console.warn('[AI-TASK] no JSON in response:', raw.slice(0, 200)); break; }
      decision = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('[AI-TASK] Gemini/parse error:', e.message);
      break;
    }

    console.log('[AI-TASK] decision:', JSON.stringify(decision).slice(0, 400));

    if (decision.done) {
      return { ok: true, summary: decision.summary || `completed: ${goal}`, iterations: i + 1 };
    }

    if (!decision.steps?.length) {
      console.warn('[AI-TASK] no steps and not done — stopping');
      break;
    }

    // Execute steps via CDP in the extension (no content script, no screenshots)
    const taskId = `ai_${Date.now()}`;
    try {
      const stepResult = await sendExtensionCommandAndWait(
        { type: 'automate-cdp', steps: decision.steps, taskId },
        40000
      );
      console.log('[AI-TASK] step results:', JSON.stringify(stepResult?.results || []).slice(0, 300));
    } catch (e) {
      console.warn('[AI-TASK] steps timed out or failed:', e.message, '— continuing');
    }

    // Wait for page to settle before reading DOM again
    await sleep(2500);
  }

  return { ok: true, summary: `attempted: ${goal}`, iterations: MAX_ITERATIONS };
}

// ── Built-ins ─────────────────────────────────────────────────────
function reminderCreate({ text, when }) {
  const dueAt = when ? Math.floor(new Date(when).getTime() / 1000) : null;
  const info = db.prepare(`INSERT INTO reminders (text, due_at) VALUES (?, ?)`).run(text, dueAt);
  return { id: info.lastInsertRowid };
}
function reminderList({ days = 7 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now + days * 86400;
  return db.prepare(
    `SELECT id, text, due_at, done FROM reminders WHERE done = 0 AND (due_at IS NULL OR due_at <= ?) ORDER BY due_at ASC LIMIT 50`
  ).all(cutoff);
}
function reminderDelete({ id }) {
  db.prepare(`UPDATE reminders SET done = 1 WHERE id = ?`).run(id);
  return { ok: true };
}
function noteCreate({ text }) {
  const info = db.prepare(`INSERT INTO notes (text) VALUES (?)`).run(text);
  return { id: info.lastInsertRowid };
}
function noteList({ limit = 20 } = {}) {
  return db.prepare(`SELECT id, text, created_at FROM notes ORDER BY created_at DESC LIMIT ?`).all(limit);
}
function noteSearch({ query }) {
  return db.prepare(`SELECT id, text, created_at FROM notes WHERE text LIKE ? ORDER BY created_at DESC LIMIT 20`)
    .all(`%${query}%`);
}

// ── Dispatcher ────────────────────────────────────────────────────
const HANDLERS = {
  // Gmail
  'gmail.send':    gmailSend,
  'gmail.draft':   gmailDraft,
  'gmail.search':  gmailSearch,
  'gmail.read':    gmailRead,
  'gmail.reply':   gmailReply,
  // Calendar
  'gcal.create':   gcalCreate,
  'gcal.list':     gcalList,
  // Contacts
  'gcontacts.search': contactsSearch,
  // Drive
  'gdrive.search': driveSearch,
  // Docs
  'gdocs.create':  docsCreate,
  'gdocs.read':    docsRead,
  'gdocs.edit':    docsEdit,
  // Sheets
  'gsheets.read':   sheetsRead,
  'gsheets.update': sheetsUpdate,
  // Spotify
  'spotify.play':        spotifyPlay,
  'spotify.pause':       spotifyPause,
  'spotify.next':        spotifyNext,
  'spotify.previous':    spotifyPrevious,
  'spotify.queue':       spotifyQueue,
  'spotify.search':      spotifySearch,
  'spotify.get_current': spotifyGetCurrent,
  'spotify.volume':      spotifyVolume,
  // Slack
  'slack.send':   slackSend,
  'slack.search': slackSearch,
  'slack.read':   slackRead,
  'slack.status': slackStatus,
  // Built-ins
  'reminders.create': reminderCreate,
  'reminders.list':   reminderList,
  'reminders.delete': reminderDelete,
  'notes.create':     noteCreate,
  'notes.list':       noteList,
  'notes.search':     noteSearch,
  // Browser automation
  'browser.open':          browserOpen,
  'browser.search':        browserSearch,
  'browser.whatsapp.dm':   browserWhatsappDm,
  'browser.instagram.dm':  browserInstagramDm,
  'browser.automate':      browserAutomate,
  'browser.ai_task':       browserAiTask,
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
