/**
 * Connector Tools — LangChain DynamicStructuredTools
 *
 * Thin wrappers around the existing actions:execute IPC channel.
 * The agent uses these to interact with Gmail, Calendar, Spotify, Slack, etc.
 * No connector logic lives here — all of that is in electron/connectors/actions.js.
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

const { ipcRenderer } = window.require ? window.require('electron') : {};

async function runAction(type, params) {
  if (!ipcRenderer) throw new Error('Not in Electron environment');
  const result = await ipcRenderer.invoke('actions:execute', { type, params });
  if (result?.error) throw new Error(result.error);
  return result;
}

// ── Contacts ──────────────────────────────────────────────────

export const contactsSearch = new DynamicStructuredTool({
  name: 'contacts_search',
  description: 'Search Google Contacts by name. Returns email address and phone. Use when you need to find someone\'s email before sending.',
  schema: z.object({
    query: z.string().describe('Name or partial name to search for'),
  }),
  async func({ query }) {
    const result = await runAction('gcontacts.search', { query });
    if (!result?.result?.length) return `No contacts found for "${query}".`;
    return result.result.map((c, i) =>
      `${i + 1}. ${c.name || '?'} — ${c.email || 'no email'}${c.phone ? ` | ${c.phone}` : ''}`
    ).join('\n');
  },
});

// ── Gmail ─────────────────────────────────────────────────────

export const gmailSend = new DynamicStructuredTool({
  name: 'gmail_send',
  description: 'Send an email via Gmail. Use the recipient\'s name — the system resolves it to an email address automatically. Never use fake email addresses.',
  schema: z.object({
    to: z.string().describe('Recipient name (e.g. "Alex", "mom") or email address'),
    subject: z.string().describe('Email subject line'),
    body: z.string().describe('Full email body text'),
  }),
  async func({ to, subject, body }) {
    await runAction('gmail.send', { to, subject, body });
    return `Email sent to "${to}" — subject: "${subject}"`;
  },
});

export const gmailDraft = new DynamicStructuredTool({
  name: 'gmail_draft',
  description: 'Save an email as a draft in Gmail without sending it.',
  schema: z.object({
    to: z.string().describe('Recipient name or email address'),
    subject: z.string().describe('Email subject'),
    body: z.string().describe('Email body text'),
  }),
  async func({ to, subject, body }) {
    await runAction('gmail.draft', { to, subject, body });
    return `Draft saved — to: "${to}", subject: "${subject}"`;
  },
});

export const gmailSearch = new DynamicStructuredTool({
  name: 'gmail_search',
  description: 'Search Gmail for emails matching a query. Returns from, subject, snippet, and message ID.',
  schema: z.object({
    query: z.string().describe('Gmail search query (e.g. "from:boss subject:report", "invoice", "unread")'),
    limit: z.number().optional().describe('Max number of results (default 5)'),
  }),
  async func({ query, limit = 5 }) {
    const result = await runAction('gmail.search', { query, limit });
    const msgs = result?.result || result?.messages || [];
    if (!msgs.length) return 'No emails found for that query.';
    return msgs.map((m, i) =>
      `${i + 1}. [id:${m.id}] From: ${m.from || '?'} | Subject: ${m.subject || '?'} | ${m.snippet || ''}`
    ).join('\n');
  },
});

export const gmailRead = new DynamicStructuredTool({
  name: 'gmail_read',
  description: 'Read the full body of an email by its ID. Get the ID from gmail_search first.',
  schema: z.object({
    id: z.string().describe('Email message ID (from gmail_search results)'),
  }),
  async func({ id }) {
    const result = await runAction('gmail.read', { id });
    const m = result?.result || result;
    return `From: ${m.from}\nTo: ${m.to}\nSubject: ${m.subject}\nDate: ${m.date}\n\n${m.body}`;
  },
});

export const gmailReply = new DynamicStructuredTool({
  name: 'gmail_reply',
  description: 'Reply to an email thread. Get threadId from gmail_search or gmail_read.',
  schema: z.object({
    threadId: z.string().describe('Thread ID to reply to'),
    to: z.string().describe('Recipient name or email'),
    subject: z.string().describe('Email subject (Re: will be prepended if not already there)'),
    body: z.string().describe('Reply body text'),
  }),
  async func({ threadId, to, subject, body }) {
    await runAction('gmail.reply', { threadId, to, subject, body });
    return `Reply sent in thread ${threadId}`;
  },
});

// ── Google Calendar ───────────────────────────────────────────

export const calendarCreate = new DynamicStructuredTool({
  name: 'calendar_create',
  description: 'Create a Google Calendar event.',
  schema: z.object({
    title: z.string().describe('Event title'),
    date: z.string().describe('Date in YYYY-MM-DD format'),
    time: z.string().optional().describe('Start time in HH:MM 24-hour format (e.g. "14:30")'),
    duration: z.number().optional().describe('Duration in minutes (default 60)'),
    description: z.string().optional().describe('Event description or notes'),
  }),
  async func({ title, date, time, duration = 60, description }) {
    await runAction('gcal.create', { title, date, time, duration, description });
    return `Calendar event "${title}" created for ${date}${time ? ` at ${time}` : ''}`;
  },
});

export const calendarList = new DynamicStructuredTool({
  name: 'calendar_list',
  description: 'List upcoming Google Calendar events.',
  schema: z.object({
    days: z.number().optional().describe('Number of days to look ahead (default 7)'),
  }),
  async func({ days = 7 }) {
    const result = await runAction('gcal.list', { days });
    if (!result?.events?.length) return 'No upcoming events found.';
    return result.events.map((e, i) =>
      `${i + 1}. ${e.summary || 'Untitled'} — ${e.start?.dateTime || e.start?.date || '?'}`
    ).join('\n');
  },
});

// ── Spotify ───────────────────────────────────────────────────

export const spotifyPlay = new DynamicStructuredTool({
  name: 'spotify_play',
  description: 'Play a song, artist, playlist, or album on Spotify.',
  schema: z.object({
    query: z.string().describe('What to play — song name, artist, playlist title, etc.'),
    type: z.enum(['track', 'artist', 'playlist', 'album']).optional().describe('Type of content (default: track)'),
  }),
  async func({ query, type = 'track' }) {
    await runAction('spotify.play', { query, type });
    return `Playing on Spotify: "${query}"`;
  },
});

export const spotifyControl = new DynamicStructuredTool({
  name: 'spotify_control',
  description: 'Control Spotify playback — pause, resume, skip, or go back.',
  schema: z.object({
    action: z.enum(['pause', 'resume', 'next', 'previous']).describe('Playback action'),
  }),
  async func({ action }) {
    await runAction(`spotify.${action}`, {});
    return `Spotify: ${action}`;
  },
});

export const spotifyQueue = new DynamicStructuredTool({
  name: 'spotify_queue',
  description: 'Add a track to the Spotify queue by its Spotify URI (from spotify_search results).',
  schema: z.object({
    uri: z.string().describe('Spotify track URI, e.g. "spotify:track:4iV5W9uYEdYUVa79Axb7Rh"'),
  }),
  async func({ uri }) {
    await runAction('spotify.queue', { uri });
    return `Added to queue: ${uri}`;
  },
});

export const spotifySearch = new DynamicStructuredTool({
  name: 'spotify_search',
  description: 'Search Spotify for tracks, albums, artists, or playlists without playing. Returns name, URI, and artist.',
  schema: z.object({
    query: z.string().describe('Search query'),
    type: z.enum(['track', 'album', 'artist', 'playlist']).optional().describe('Type to search (default: track)'),
  }),
  async func({ query, type = 'track' }) {
    const result = await runAction('spotify.search', { query, type });
    const items = result?.result || [];
    if (!items.length) return 'No results found.';
    return items.slice(0, 5).map((t, i) =>
      `${i + 1}. ${t.name}${t.artist ? ` — ${t.artist}` : ''}${t.album ? ` (${t.album})` : ''} [${t.uri}]`
    ).join('\n');
  },
});

export const spotifyGetCurrent = new DynamicStructuredTool({
  name: 'spotify_get_current',
  description: 'Get what\'s currently playing on Spotify — track name, artist, album, and progress.',
  schema: z.object({}),
  async func() {
    const result = await runAction('spotify.get_current', {});
    const r = result?.result || result;
    if (!r?.playing && !r?.track) return 'Nothing is playing on Spotify right now.';
    const pct = r.duration_ms ? Math.round((r.progress_ms / r.duration_ms) * 100) : 0;
    return `${r.playing ? '▶' : '⏸'} ${r.track} — ${r.artist} (${r.album}) [${pct}%]`;
  },
});

export const spotifyVolume = new DynamicStructuredTool({
  name: 'spotify_volume',
  description: 'Set Spotify playback volume.',
  schema: z.object({
    volume_percent: z.number().min(0).max(100).describe('Volume level 0–100'),
  }),
  async func({ volume_percent }) {
    await runAction('spotify.volume', { volume_percent });
    return `Spotify volume set to ${volume_percent}%`;
  },
});

// ── Slack ─────────────────────────────────────────────────────

export const slackSend = new DynamicStructuredTool({
  name: 'slack_send',
  description: 'Send a message to a Slack channel or person.',
  schema: z.object({
    channel: z.string().describe('Channel name (e.g. "general", "random") or username with @ (e.g. "@alex")'),
    message: z.string().describe('Message to send'),
  }),
  async func({ channel, message }) {
    await runAction('slack.send', { channel, message });
    return `Slack message sent to ${channel}`;
  },
});

export const slackSearch = new DynamicStructuredTool({
  name: 'slack_search',
  description: 'Search Slack messages across all channels.',
  schema: z.object({
    query: z.string().describe('Search query'),
  }),
  async func({ query }) {
    const result = await runAction('slack.search', { query });
    const matches = result?.result?.messages?.matches || [];
    if (!matches.length) return 'No Slack messages found.';
    return matches.slice(0, 5).map((m, i) =>
      `${i + 1}. [#${m.channel?.name || '?'}] ${m.username || '?'}: ${m.text?.slice(0, 120) || ''}`
    ).join('\n');
  },
});

export const slackRead = new DynamicStructuredTool({
  name: 'slack_read',
  description: 'Read recent messages from a Slack channel.',
  schema: z.object({
    channel: z.string().describe('Channel name (e.g. "general") or channel ID'),
    limit: z.number().optional().describe('Number of messages to fetch (default 20)'),
  }),
  async func({ channel, limit = 20 }) {
    const result = await runAction('slack.read', { channel, limit });
    const msgs = result?.result || [];
    if (!msgs.length) return `No messages found in #${channel}.`;
    return msgs.map((m, i) => `${i + 1}. ${m.bot ? '[bot]' : `<${m.user}>`}: ${m.text}`).join('\n');
  },
});

export const slackStatus = new DynamicStructuredTool({
  name: 'slack_status',
  description: 'Set your Slack status text and emoji.',
  schema: z.object({
    status_text: z.string().describe('Status message (e.g. "In a meeting", "Focusing")'),
    status_emoji: z.string().optional().describe('Slack emoji code (e.g. ":coffee:", ":headphones:"). Default: :speech_balloon:'),
    duration_minutes: z.number().optional().describe('Auto-clear after N minutes. 0 = never expires.'),
  }),
  async func({ status_text, status_emoji = ':speech_balloon:', duration_minutes = 0 }) {
    await runAction('slack.status', { status_text, status_emoji, duration_minutes });
    return `Slack status set: ${status_emoji} ${status_text}${duration_minutes ? ` (${duration_minutes}min)` : ''}`;
  },
});

// ── Reminders & Notes ─────────────────────────────────────────

export const reminderCreate = new DynamicStructuredTool({
  name: 'reminder_create',
  description: 'Create a reminder. Stored locally.',
  schema: z.object({
    text: z.string().describe('What to remind about'),
    due_at: z.string().optional().describe('When to remind — ISO datetime string e.g. "2026-04-14T09:00:00"'),
  }),
  async func({ text, due_at }) {
    await runAction('reminders.create', { text, when: due_at });
    return `Reminder created: "${text}"${due_at ? ` — due ${due_at}` : ''}`;
  },
});

export const reminderList = new DynamicStructuredTool({
  name: 'reminder_list',
  description: 'List upcoming reminders that are not yet done.',
  schema: z.object({
    days: z.number().optional().describe('Look ahead N days (default 7). Use 365 for all future reminders.'),
  }),
  async func({ days = 7 }) {
    const result = await runAction('reminders.list', { days });
    const rows = result?.result || [];
    if (!rows.length) return 'No upcoming reminders.';
    return rows.map((r, i) => {
      const due = r.due_at ? new Date(r.due_at * 1000).toLocaleString() : 'no due date';
      return `${i + 1}. [id:${r.id}] ${r.text} — ${due}`;
    }).join('\n');
  },
});

export const reminderDelete = new DynamicStructuredTool({
  name: 'reminder_delete',
  description: 'Mark a reminder as done/deleted by its ID (from reminder_list).',
  schema: z.object({
    id: z.number().describe('Reminder ID from reminder_list'),
  }),
  async func({ id }) {
    await runAction('reminders.delete', { id });
    return `Reminder ${id} marked as done.`;
  },
});

export const noteCreate = new DynamicStructuredTool({
  name: 'note_create',
  description: 'Save a note. Stored locally.',
  schema: z.object({
    text: z.string().describe('Note content to save'),
  }),
  async func({ text }) {
    await runAction('notes.create', { text });
    return `Note saved: "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"`;
  },
});

export const noteList = new DynamicStructuredTool({
  name: 'note_list',
  description: 'List recent notes.',
  schema: z.object({
    limit: z.number().optional().describe('How many notes to return (default 20)'),
  }),
  async func({ limit = 20 }) {
    const result = await runAction('notes.list', { limit });
    const rows = result?.result || [];
    if (!rows.length) return 'No notes saved yet.';
    return rows.map((r, i) =>
      `${i + 1}. [id:${r.id}] ${r.text.slice(0, 120)}${r.text.length > 120 ? '...' : ''}`
    ).join('\n');
  },
});

export const noteSearch = new DynamicStructuredTool({
  name: 'note_search',
  description: 'Search saved notes by keyword.',
  schema: z.object({
    query: z.string().describe('Search keyword'),
  }),
  async func({ query }) {
    const result = await runAction('notes.search', { query });
    const rows = result?.result || [];
    if (!rows.length) return `No notes matching "${query}".`;
    return rows.map((r, i) =>
      `${i + 1}. [id:${r.id}] ${r.text.slice(0, 160)}${r.text.length > 160 ? '...' : ''}`
    ).join('\n');
  },
});

export const browserAiTask = new DynamicStructuredTool({
  name: 'browser_ai_task',
  description:
    'Autonomous multi-step browser task with AI-driven decision making. ' +
    'Use for complex goals like "book a flight", "fill out a form", "find the best price". ' +
    'The agent reads the page DOM, decides actions, executes them, and loops until done. ' +
    'Slower than direct tools but handles unpredictable UIs.',
  schema: z.object({
    goal: z.string().describe('What to accomplish (e.g. "Book 2 tickets for Dune at PVR on 15 April at 7pm")'),
    url: z.string().optional().describe('Starting URL (optional — navigates here first)'),
  }),
  async func({ goal, url }) {
    const result = await runAction('browser.ai_task', { goal, url });
    const r = result?.result || result;
    return r?.summary || (r?.ok ? `Task completed: ${goal}` : `Task attempted but may not have completed: ${goal}`);
  },
});

// ── Google Drive / Docs / Sheets ──────────────────────────────

export const driveSearch = new DynamicStructuredTool({
  name: 'drive_search',
  description: 'Search Google Drive for files by name.',
  schema: z.object({
    query: z.string().describe('Search query (e.g. "Q4 report", "budget 2026")'),
  }),
  async func({ query }) {
    const result = await runAction('gdrive.search', { query });
    const files = result?.result || result?.files || [];
    if (!files.length) return 'No files found.';
    return files.map((f, i) =>
      `${i + 1}. [${f.id}] ${f.name} (${f.mimeType?.split('.').pop() || 'file'}) — ${f.webViewLink || ''}`
    ).join('\n');
  },
});

export const docsCreate = new DynamicStructuredTool({
  name: 'docs_create',
  description: 'Create a new Google Doc with optional content.',
  schema: z.object({
    title: z.string().describe('Document title'),
    content: z.string().optional().describe('Initial text content to put in the doc'),
  }),
  async func({ title, content }) {
    const result = await runAction('gdocs.create', { title, content });
    const r = result?.result || result;
    return `Google Doc created: "${title}" — ${r.link}`;
  },
});

export const docsRead = new DynamicStructuredTool({
  name: 'docs_read',
  description: 'Read the text content of a Google Doc by its document ID. Get the ID from drive_search.',
  schema: z.object({
    docId: z.string().describe('Google Doc document ID'),
  }),
  async func({ docId }) {
    const result = await runAction('gdocs.read', { docId });
    const r = result?.result || result;
    return `Title: ${r.title}\n\n${r.text}`;
  },
});

export const docsEdit = new DynamicStructuredTool({
  name: 'docs_edit',
  description: 'Append text to a Google Doc, or replace its entire content.',
  schema: z.object({
    docId: z.string().describe('Google Doc document ID'),
    content: z.string().describe('Text to write'),
    mode: z.enum(['append', 'replace']).optional().describe('"append" adds at end (default), "replace" overwrites everything'),
  }),
  async func({ docId, content, mode = 'append' }) {
    await runAction('gdocs.edit', { docId, content, mode });
    return `Doc ${docId} updated (${mode})`;
  },
});

export const sheetsRead = new DynamicStructuredTool({
  name: 'sheets_read',
  description: 'Read rows from a Google Sheet by spreadsheet ID and range.',
  schema: z.object({
    spreadsheetId: z.string().describe('Google Sheets spreadsheet ID'),
    range: z.string().describe('A1 notation range, e.g. "Sheet1!A1:D20" or "A:C"'),
  }),
  async func({ spreadsheetId, range }) {
    const result = await runAction('gsheets.read', { spreadsheetId, range });
    const rows = result?.result || result;
    if (!rows?.length) return 'No data in that range.';
    return rows.map(r => r.join('\t')).join('\n');
  },
});

export const sheetsUpdate = new DynamicStructuredTool({
  name: 'sheets_update',
  description: 'Write values to cells in a Google Sheet.',
  schema: z.object({
    spreadsheetId: z.string().describe('Spreadsheet ID'),
    range: z.string().describe('A1 notation range to write to, e.g. "Sheet1!A2:C2"'),
    values: z.array(z.array(z.string())).describe('2D array of values, e.g. [["Alice","30","Engineer"]]'),
  }),
  async func({ spreadsheetId, range, values }) {
    await runAction('gsheets.update', { spreadsheetId, range, values });
    return `Updated ${range} in spreadsheet ${spreadsheetId}`;
  },
});
