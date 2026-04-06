# Claude Code Prompt — Thera (FINAL)

> Copy everything below this line into Claude Code.

---

You are building "Thera" — a commercial Electron desktop application. It's a sassy, Fleabag-inspired AI companion that lives in the system tray, monitors desktop activity, tracks mood passively, and provides mental health support disguised as a brutally honest friendship. Think: if Fleabag became a desktop app and actually cared about you.

The developer already has a working web version ("thera") built with React, Gemini API (gemini-2.5-flash), and Mem0 for memory. We are now building the full desktop version with Electron + Supabase.

---

## TECH STACK

- **Desktop**: Electron (latest stable)
- **Frontend**: React 18 + Vite + JavaScript
- **Styling**: Tailwind CSS 3 with CSS variables for theming (dark/light mode)
- **State**: Zustand
- **AI**: Google Gemini API (gemini-2.5-flash) — multimodal (supports text + images)
- **Memory**: Mem0 (mem0ai npm package) — persistent cross-session memory layer
- **Database**: Supabase (Auth + Postgres + RLS) as primary cloud store
- **Local cache**: better-sqlite3 for offline-first writes
- **Charts**: Recharts for mood timeline and activity dashboard
- **Desktop APIs**: active-win, desktop-idle, node-cron, electron-store
- **Google APIs**: Gmail API, Google Calendar API, Google Contacts API, Google Drive API, Google Docs API, Google Sheets API (all via googleapis npm package)
- **Music**: Spotify Web API (via spotify-web-api-node)
- **Messaging**: WhatsApp Web automation via browser extension
- **Package manager**: npm

---

## PROJECT STRUCTURE

```
thera-desktop/
├── electron/                        # Electron main process
│   ├── main.js                      # App entry, window creation, tray
│   ├── preload.js                   # Context bridge for IPC
│   ├── tray.js                      # System tray setup + menu
│   ├── globalShortcut.js            # Ctrl+Shift+F toggle
│   ├── monitors/
│   │   ├── activityMonitor.js       # active-win polling every 10s
│   │   ├── idleMonitor.js           # desktop-idle tracking
│   │   └── screenCapture.js         # desktopCapturer for Tier 3 vision
│   ├── db/
│   │   ├── localDb.js               # better-sqlite3 CRUD
│   │   ├── schema.js                # SQLite table definitions
│   │   └── supabaseSync.js          # Background sync local → Supabase
│   ├── connectors/
│   │   ├── connectorManager.js      # Central connector registry + OAuth manager
│   │   ├── gmail.js                 # Gmail API — read, send, search, contacts
│   │   ├── googleCalendar.js        # Calendar — view, create, update events
│   │   ├── googleContacts.js        # Contacts — lookup, search, sync
│   │   ├── googleDrive.js           # Drive — search, read, organize files
│   │   ├── googleDocs.js            # Docs — create, read, edit documents
│   │   ├── googleSheets.js          # Sheets — read, update spreadsheets
│   │   ├── spotify.js               # Spotify — play, pause, queue, search
│   │   ├── slack.js                 # Slack — send messages, search channels
│   │   ├── reminders.js             # Local reminder system (stored in SQLite)
│   │   ├── notes.js                 # Local notes system (stored in SQLite)
│   │   └── browserBridge.js         # WebSocket server for browser extension
│   ├── scheduler.js                 # node-cron for rituals, nudges, weekly report
│   └── ipcHandlers.js               # All IPC handler registrations
│
├── src/                             # React renderer
│   ├── main.jsx                     # React entry
│   ├── App.jsx                      # Router + layout
│   ├── components/
│   │   ├── chat/
│   │   │   ├── ChatWindow.jsx       # Main chat interface
│   │   │   ├── ChatBubble.jsx       # Message bubble styles
│   │   │   ├── ChatInput.jsx        # Input bar with rant mode toggle
│   │   │   └── TypingIndicator.jsx  # Pulsing dots
│   │   ├── FloatingWidget.jsx       # Collapsed circle mode
│   │   ├── MoodTimeline.jsx         # Heatmap mood visualization
│   │   ├── WeeklySummary.jsx        # "The Roast Report"
│   │   ├── DashboardView.jsx        # Screen time + activity stats
│   │   ├── SettingsPanel.jsx        # Slide-in settings
│   │   ├── ConnectorPanel.jsx       # Enable/disable integrations
│   │   ├── RitualCard.jsx           # Morning/evening + breathing
│   │   ├── CrisisOverlay.jsx        # Crisis mode UI
│   │   ├── OnboardingFlow.jsx       # 5-screen onboarding
│   │   ├── MemoryViewer.jsx         # View/delete stored facts
│   │   └── ThemeToggle.jsx          # Dark/Light switch
│   ├── services/
│   │   ├── aiService.js             # Gemini API calls
│   │   ├── promptBuilder.js         # Dynamic prompt construction
│   │   ├── memoryService.js         # Mem0 integration — add, search, retrieve memories
│   │   ├── contextService.js        # Desktop + connector context builder
│   │   ├── crisisService.js         # Crisis detection
│   │   └── actionExecutor.js        # Execute AI-decided actions (email, message, etc.)
│   ├── stores/
│   │   ├── chatStore.js
│   │   ├── moodStore.js
│   │   ├── activityStore.js
│   │   ├── settingsStore.js
│   │   ├── themeStore.js
│   │   └── connectorStore.js        # Which connectors are enabled + status
│   ├── hooks/
│   │   ├── useChat.js
│   │   ├── useActivity.js
│   │   ├── useCrisisDetection.js
│   │   └── useTheme.js
│   ├── utils/
│   │   ├── patternDetector.js
│   │   └── timeUtils.js
│   └── styles/
│       ├── globals.css
│       └── themes.css               # Dark + Light CSS variables
│
├── extension/                       # Chrome extension (MV3)
│   ├── manifest.json
│   ├── background.js                # Tab tracking + command receiver
│   ├── content.js                   # Page text extraction + WhatsApp automation
│   └── whatsapp.js                  # WhatsApp Web DOM automation scripts
│
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql
│
├── package.json
├── vite.config.js
├── tailwind.config.js
├── electron-builder.yml
├── jsconfig.json
└── .env.example                     # GEMINI_API_KEY, MEM0_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
```

---

## CONNECTOR SYSTEM

### Architecture

All third-party integrations go through a central `connectorManager.js`. Each connector follows the same pattern:

```javascript
// connectorManager.js
class ConnectorManager {
  constructor() {
    this.connectors = {};
    this.oauthTokens = {};  // stored in electron-store, encrypted
  }

  register(name, connector) {
    this.connectors[name] = {
      ...connector,
      enabled: false,
      connected: false,
      lastSync: null
    };
  }

  async connect(name) {
    // Trigger OAuth flow for the connector
    // Open OAuth URL in a BrowserWindow
    // Handle redirect, store tokens
  }

  async disconnect(name) {
    // Revoke tokens, clear cached data
  }

  getEnabled() {
    // Return all enabled connectors for context injection
  }

  async executeAction(connectorName, action, params) {
    // Route AI-decided actions to the right connector
  }
}
```

### Connector UI (ConnectorPanel.jsx)

Settings → Connectors page. Shows all available integrations in a grid:

```
┌─────────────────────────────────────────────┐
│  Connectors                                  │
│                                               │
│  ┌──────────────┐  ┌──────────────┐          │
│  │ 📧 Gmail     │  │ 📅 Calendar  │          │
│  │ Connected ✓  │  │ Connected ✓  │          │
│  │ [Disconnect] │  │ [Disconnect] │          │
│  └──────────────┘  └──────────────┘          │
│                                               │
│  ┌──────────────┐  ┌──────────────┐          │
│  │ 👤 Contacts  │  │ 📁 Drive     │          │
│  │ [Connect]    │  │ Connected ✓  │          │
│  └──────────────┘  └──────────────┘          │
│                                               │
│  ┌──────────────┐  ┌──────────────┐          │
│  │ 📝 Docs      │  │ 📊 Sheets    │          │
│  │ [Connect]    │  │ [Connect]    │          │
│  └──────────────┘  └──────────────┘          │
│                                               │
│  ┌──────────────┐  ┌──────────────┐          │
│  │ 🎵 Spotify   │  │ 💬 Slack     │          │
│  │ Connected ✓  │  │ [Connect]    │          │
│  └──────────────┘  └──────────────┘          │
│                                               │
│  ┌──────────────┐  ┌──────────────┐          │
│  │ 💬 WhatsApp  │  │ 🌐 Browser   │          │
│  │ Via extension│  │ Via extension│          │
│  │ [Setup guide]│  │ [Setup guide]│          │
│  └──────────────┘  └──────────────┘          │
│                                               │
│  ┌──────────────┐  ┌──────────────┐          │
│  │ 🔔 Reminders │  │ 📒 Notes     │          │
│  │ Built-in ✓   │  │ Built-in ✓   │          │
│  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────┘
```

Each connector shows: icon, name, status (connected/disconnected), and action button.
Extension-based connectors (WhatsApp, Browser Control) show a setup guide link instead.
Built-in features (Reminders, Notes) are always enabled.

---

## CONNECTOR IMPLEMENTATIONS

### 1. Gmail (gmail.js)

**OAuth**: Google OAuth 2.0 with scopes:
`gmail.readonly`, `gmail.send`, `gmail.compose`, `gmail.modify`

**Capabilities**:
- `searchEmails(query)` — search inbox (returns top 10, metadata only — not full body)
- `getEmail(id)` — get full email content
- `sendEmail({ to, subject, body })` — send email
- `draftEmail({ to, subject, body })` — create draft (safer, user reviews before sending)
- `getRecentContacts()` — extract email addresses from recent sent/received
- `getLabels()` — list labels/folders

**Context injection**: On each AI call, include:
- Number of unread emails
- Subject lines of last 3 unread emails (NOT full bodies — saves tokens)
- Nothing else unless user asks about email

**Token optimization**:
- NEVER fetch full email bodies unless the user specifically asks to read an email
- For "do I have any emails?" → just fetch unread count + subjects
- Cache contact list locally, refresh every 30 minutes

```javascript
// gmail.js
const { google } = require('googleapis');

class GmailConnector {
  constructor(auth) {
    this.gmail = google.gmail({ version: 'v1', auth });
  }

  async getUnreadSummary() {
    // Fetch ONLY metadata — subject, from, date
    const res = await this.gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread',
      maxResults: 5,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'Date']
    });
    return res.data.messages || [];
  }

  async sendEmail({ to, subject, body }) {
    const raw = Buffer.from(
      `To: ${to}\r\nSubject: ${subject}\r\n\r\n${body}`
    ).toString('base64url');
    return this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw }
    });
  }

  async searchContacts(query) {
    // Search recent emails for matching contact
    const res = await this.gmail.users.messages.list({
      userId: 'me',
      q: `to:${query} OR from:${query}`,
      maxResults: 5
    });
    // Extract email addresses from results
    return extractContacts(res.data.messages);
  }
}
```

---

### 2. Google Calendar (googleCalendar.js)

**OAuth scopes**: `calendar.readonly`, `calendar.events`

**Capabilities**:
- `getTodayEvents()` — today's schedule
- `getUpcoming(hours)` — next N hours of events
- `createEvent({ title, start, end, description })` — add event
- `findFreeSlots(date)` — find available time

**Context injection**:
- Next upcoming event (if within 2 hours)
- "You have a meeting in 30 min" → Thera can prep you
- Morning ritual includes today's schedule summary

**Token optimization**:
- Fetch only today's events on app launch, cache locally
- Refresh only when user asks or every 15 minutes
- Send to AI as: "3 events today: Standup 10am, Lunch with Sarah 1pm, Dentist 4pm" — NOT the full API response

---

### 3. Google Contacts (googleContacts.js)

**OAuth scopes**: `contacts.readonly`

**Capabilities**:
- `searchContact(name)` — find contact by name → returns email, phone
- `getAllContacts()` — bulk sync (run once on connect, cache locally)
- `getContactByEmail(email)` — reverse lookup

**This solves the "how does Thera know Rahul's number" problem**:
- On first connect, sync all contacts to local SQLite (name, email, phone)
- When user says "email my professor" → search contacts for "professor" or search by recent email patterns
- When user says "text Rahul" → search contacts for "Rahul" → get phone number → WhatsApp

**Token optimization**:
- Sync full contact list ONCE to local SQLite on connect
- After that, all lookups are local — zero API calls, zero tokens
- Re-sync contacts every 24 hours in background
- Contact table in SQLite:

```sql
CREATE TABLE contacts_cache (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  phone TEXT,
  last_synced DATETIME
);
```

---

### 4. Google Drive (googleDrive.js)

**OAuth scopes**: `drive.readonly`, `drive.file`

**Capabilities**:
- `searchFiles(query)` — search by name/content
- `getRecentFiles(limit)` — recently modified files
- `getFileMetadata(id)` — file name, type, size, modified date
- `getFileContent(id)` — read file content (text files, docs, sheets)
- `listFolder(folderId)` — list files in a folder

**THE SPEED PROBLEM — How to Fix Slow Drive Access**:

Drive has thousands of files. Listing them all is slow and wasteful. Here's the fix:

**Strategy: Index + Cache + Smart Search**

```javascript
// googleDrive.js

class DriveConnector {
  constructor(auth, localDb) {
    this.drive = google.drive({ version: 'v3', auth });
    this.db = localDb;
  }

  // RUN ONCE on connect — build local index
  async buildIndex() {
    let pageToken = null;
    do {
      const res = await this.drive.files.list({
        pageSize: 1000,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, parents, size)',
        // DON'T fetch file content — just metadata
        pageToken
      });
      
      // Store metadata in local SQLite
      for (const file of res.data.files) {
        this.db.upsertFileIndex(file);
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken);
  }

  // FAST — searches local index, not Drive API
  async searchLocal(query) {
    return this.db.searchFiles(query); // SQLite full-text search
  }

  // Only hit Drive API when local search fails or user needs content
  async getFileContent(fileId) {
    // Fetch actual content only when specifically requested
    const res = await this.drive.files.get({
      fileId,
      alt: 'media'
    });
    return res.data;
  }

  // Background sync — only fetch CHANGED files
  async incrementalSync() {
    const lastSync = this.db.getLastDriveSync();
    const res = await this.drive.files.list({
      q: `modifiedTime > '${lastSync}'`,
      pageSize: 100,
      fields: 'files(id, name, mimeType, modifiedTime, parents, size)'
    });
    for (const file of res.data.files) {
      this.db.upsertFileIndex(file);
    }
    this.db.setLastDriveSync(new Date().toISOString());
  }
}
```

**Local file index table**:
```sql
CREATE TABLE drive_index (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mime_type TEXT,
  modified_time DATETIME,
  parent_id TEXT,
  size INTEGER,
  indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_drive_name ON drive_index(name);
```

**Result**: First connect takes 10-30 seconds to index. After that, all searches are instant (local SQLite). Background sync every 15 minutes fetches only changed files. User never waits.

**Context injection**: NEVER inject Drive data into AI prompt unless user asks about files. Zero cost when idle.

---

### 5. Google Docs (googleDocs.js)

**OAuth scopes**: `documents.readonly`, `documents`

**Capabilities**:
- `readDoc(docId)` — get document content as plain text
- `createDoc(title, content)` — create new doc
- `appendToDoc(docId, text)` — add text to existing doc
- `findDoc(query)` — uses Drive search filtered to docs

**Use case**: "Thera, add this to my notes doc" → appends to a specific Google Doc

---

### 6. Google Sheets (googleSheets.js)

**OAuth scopes**: `spreadsheets.readonly`, `spreadsheets`

**Capabilities**:
- `readSheet(sheetId, range)` — read cell range
- `updateSheet(sheetId, range, values)` — write to cells
- `findSheet(query)` — search via Drive

**Use case**: "How much did I spend this month?" → reads expense tracker sheet

---

### 7. Spotify (spotify.js)

**OAuth**: Spotify OAuth with scopes:
`user-read-playback-state`, `user-modify-playback-state`, `user-read-currently-playing`, `playlist-read-private`, `playlist-modify-public`

**Capabilities**:
- `getCurrentTrack()` — what's playing now
- `play(query)` — search + play a song/artist/playlist
- `pause()` — pause playback
- `skip()` — next track
- `queue(query)` — add to queue
- `getPlaylists()` — list user's playlists
- `setVolume(level)` — adjust volume

**Context injection**:
- If Spotify is connected AND music is playing: "Currently playing: [song] by [artist]"
- Enables: "Play something chill" → Thera picks a playlist
- Morning ritual can auto-play a wake-up playlist
- "You've been listening to sad songs for 2 hours. Coincidence? I think not."

**Token optimization**: Only fetch currently playing track for context. Don't fetch playlists unless user asks.

---

### 8. Slack (slack.js)

**OAuth**: Slack OAuth with scopes:
`chat:write`, `channels:read`, `channels:history`, `users:read`

**Capabilities**:
- `sendMessage(channel, text)` — send to a channel
- `sendDM(userId, text)` — direct message
- `searchMessages(query)` — search workspace
- `getChannels()` — list channels
- `getUnread()` — unread message count

**Use case**: "Tell the team I'm running late" → sends to #general or a configured channel

---

### 9. Reminders (reminders.js) — Built-in, no OAuth

**Storage**: Local SQLite + Supabase sync

```sql
CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  user_id UUID,
  title TEXT NOT NULL,
  description TEXT,
  remind_at DATETIME NOT NULL,
  repeat TEXT, -- 'none', 'daily', 'weekly', 'monthly'
  completed BOOLEAN DEFAULT false,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Capabilities**:
- `createReminder(title, datetime)` — "Remind me to call mom at 6pm"
- `getUpcoming()` — next 24 hours of reminders
- `complete(id)` — mark as done
- `getOverdue()` — missed reminders

**Delivery**: Electron notification at remind_at time. Thera adds commentary: "You asked me to remind you to call your mom. It's time. She probably misses you."

---

### 10. Notes (notes.js) — Built-in, no OAuth

**Storage**: Local SQLite + Supabase sync

```sql
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  user_id UUID,
  title TEXT,
  content TEXT NOT NULL,
  tags TEXT, -- comma-separated
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Capabilities**:
- `createNote(content, title, tags)` — "Note: grocery list — milk, eggs, bread"
- `searchNotes(query)` — full text search
- `getRecent()` — latest notes
- `deleteNote(id)`

---

### 11. Browser Control (browserBridge.js) — Via extension

**WebSocket server on localhost:38745**

**Extension → Thera (monitoring)**:
- Active tab URL, title, domain, time on site
- Tab count
- Page text extraction (on demand)

**Thera → Extension (control)**:
- `close_tab(tabId)` — close a specific tab
- `close_domain(domain)` — close all tabs of a domain
- `open_url(url)` — open a new tab
- `focus_mode(domains, duration)` — block distracting sites for N minutes
- `get_page_text(tabId)` — extract page content without screenshots
- `mute_tab(tabId)` — mute a tab

---

### 12. WhatsApp (via extension whatsapp.js) — Via extension

**How it works**: Extension automates WhatsApp Web DOM. No API needed.

**Capabilities**:
- `sendMessage(contactName, text)` — search contact in WhatsApp, open chat, type, send
- `checkUnread()` — count unread chats from WhatsApp Web sidebar
- `readLastMessages(contactName)` — open a chat, read last few messages

**Flow for sending**:
1. Check if WhatsApp Web tab is open. If not, open it.
2. Wait for WhatsApp Web to load (detect the search bar element).
3. Click search bar → type contact name → wait for results → click contact.
4. Type message in the input field → click send button.
5. Report success/failure back to Thera via WebSocket.

**Contact resolution order**:
1. Search Google Contacts cache (if connected) for phone number
2. Search Thera's user_memory for saved contact info
3. If not found → ask the user, save for next time

```javascript
// whatsapp.js — content script injected into WhatsApp Web
async function sendWhatsAppMessage(contactName, message) {
  // 1. Click search bar
  const searchBar = document.querySelector('[data-tab="3"]');
  searchBar.click();
  searchBar.value = contactName;
  searchBar.dispatchEvent(new Event('input', { bubbles: true }));

  // 2. Wait for search results, click first match
  await waitForElement('[data-testid="cell-frame-container"]');
  document.querySelector('[data-testid="cell-frame-container"]').click();

  // 3. Type message
  await waitForElement('[data-tab="10"]');
  const inputBox = document.querySelector('[data-tab="10"]');
  inputBox.textContent = message;
  inputBox.dispatchEvent(new Event('input', { bubbles: true }));

  // 4. Click send
  document.querySelector('[data-testid="send"]').click();

  return { success: true, contact: contactName };
}
```

**Important**: WhatsApp Web selectors WILL break when WhatsApp updates. Use `data-testid` attributes which are more stable than class names. Build a selector config file that can be updated without changing the core logic.

---

## GOOGLE OAUTH SETUP

All Google connectors share ONE OAuth flow with combined scopes:

```javascript
// connectorManager.js — Google OAuth
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
];

async function googleOAuth() {
  // Open a BrowserWindow with Google OAuth consent screen
  const authWindow = new BrowserWindow({ width: 600, height: 700 });
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: GOOGLE_SCOPES,
    prompt: 'consent'
  });
  authWindow.loadURL(authUrl);

  // Listen for redirect with auth code
  authWindow.webContents.on('will-redirect', async (event, url) => {
    const code = new URL(url).searchParams.get('code');
    if (code) {
      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);
      // Store tokens in electron-store (encrypted)
      store.set('google_tokens', tokens);
      authWindow.close();
    }
  });
}
```

User clicks "Connect Google" ONCE → gets access to Gmail, Calendar, Contacts, Drive, Docs, Sheets simultaneously. Individual connectors can be toggled on/off in the ConnectorPanel without re-authenticating.

---

## HOW THE AI USES CONNECTORS

### Action System (actionExecutor.js)

The AI response format now includes an `actions` array:

```json
{
  "message": "Done. Sent Rahul a message and added the movie to your calendar.",
  "mood_read": "good",
  "mood_score": 0.6,
  "suggested_action": null,
  "actions": [
    {
      "connector": "whatsapp",
      "action": "sendMessage",
      "params": { "contactName": "Rahul", "text": "Movie tomorrow 7pm? Let me know!" }
    },
    {
      "connector": "google_calendar",
      "action": "createEvent",
      "params": { "title": "Movie with Rahul", "start": "2026-04-04T19:00", "end": "2026-04-04T22:00" }
    }
  ]
}
```

**actionExecutor.js** processes the actions array:

```javascript
async function executeActions(actions, connectorManager) {
  const results = [];
  for (const action of actions) {
    try {
      const connector = connectorManager.getConnector(action.connector);
      if (!connector || !connector.connected) {
        results.push({ action, success: false, reason: 'not_connected' });
        continue;
      }
      const result = await connector.execute(action.action, action.params);
      results.push({ action, success: true, result });
    } catch (err) {
      results.push({ action, success: false, reason: err.message });
    }
  }
  return results;
}
```

If a connector isn't connected, Thera says: "I'd love to send that email but you haven't connected Gmail yet. Want to set it up? It takes 10 seconds."

### Context Injection — What Gets Sent to AI

**CRITICAL: Don't dump everything into the prompt. Be surgical.**

```javascript
function buildConnectorContext(connectors) {
  const ctx = {};

  // Gmail — only unread count + subjects (NOT bodies)
  if (connectors.gmail?.connected) {
    ctx.email = {
      unreadCount: connectors.gmail.getCachedUnreadCount(),
      recentSubjects: connectors.gmail.getCachedSubjects(3) // last 3
    };
  }

  // Calendar — only next event if within 2 hours
  if (connectors.calendar?.connected) {
    const next = connectors.calendar.getCachedNextEvent();
    if (next && next.minutesUntil < 120) {
      ctx.calendar = { nextEvent: next.title, inMinutes: next.minutesUntil };
    }
  }

  // Spotify — only if music is actively playing
  if (connectors.spotify?.connected) {
    const track = connectors.spotify.getCachedCurrentTrack();
    if (track) {
      ctx.music = { track: track.name, artist: track.artist };
    }
  }

  // Contacts — NEVER injected. Only used when AI needs to resolve a name.
  // Drive — NEVER injected. Only used when user asks about files.
  // Slack — NEVER injected unless user asks.
  // Notes/Reminders — only overdue reminders

  if (connectors.reminders) {
    const overdue = connectors.reminders.getOverdue();
    if (overdue.length > 0) {
      ctx.reminders = overdue.map(r => r.title);
    }
  }

  return ctx;
}
```

**This keeps token usage minimal.** Gmail adds ~30 tokens. Calendar adds ~15 tokens. Spotify adds ~10 tokens. Total connector overhead: ~50-80 tokens per message. Negligible.

### Prompt Addition for Connectors

Add this to the system prompt when connectors are active:

```
CONNECTED SERVICES:
${ctx.email ? `- Email: ${ctx.email.unreadCount} unread. Recent: ${ctx.email.recentSubjects.join(', ')}` : ''}
${ctx.calendar ? `- Next event: "${ctx.calendar.nextEvent}" in ${ctx.calendar.inMinutes} min` : ''}
${ctx.music ? `- Listening to: "${ctx.music.track}" by ${ctx.music.artist}` : ''}
${ctx.reminders ? `- Overdue reminders: ${ctx.reminders.join(', ')}` : ''}

AVAILABLE ACTIONS (use only when the user asks or when clearly helpful):
You can take actions by including an "actions" array in your response.
Available connectors: ${enabledConnectorNames.join(', ')}
Actions: send_email, draft_email, create_event, send_whatsapp, send_slack,
         play_music, pause_music, create_reminder, create_note, search_files,
         open_url, close_tab, focus_mode, search_contacts

RULES FOR ACTIONS:
- ALWAYS draft emails (don't auto-send) unless user explicitly says "send it"
- ALWAYS confirm before sending WhatsApp messages: show the message first
- NEVER auto-send anything sensitive without user confirmation
- If a connector isn't connected, tell the user and offer to set it up
- For contact lookup: check Google Contacts first, then user_memory, then ask
```

---

## ACTIVITY MONITORING (3-Tier System)

### Tier 1 — Window Metadata (free, always on)
- `active-win` polls every 10 seconds
- Gets: app name, window title
- Auto-categorize: social, coding, work, entertainment, browsing, other
- Track session duration per app
- Log to local SQLite `activity_logs`

### Tier 2 — Browser Extension (rich web data)
- Chrome extension tracks: URL, domain, page title, time on site
- Communicates via WebSocket on localhost:38745
- Also handles WhatsApp automation and browser control commands

### Tier 3 — Screen Vision (on-demand, expensive)
- Electron `desktopCapturer` screenshots active window
- Send to Gemini as multimodal image input
- Only trigger: unrecognized app 15+ min, AI needs deeper context, weekly summary
- Rate limit: max once every 5 minutes
- Alternative: use extension's `get_page_text` for browser pages (free, zero tokens)

---

## NUDGE SYSTEM

| Trigger | Rule | Cooldown |
|---------|------|----------|
| Doom-scrolling | social app > 30 min | 30 min |
| No breaks | same app > 120 min | 45 min |
| Late night work | work/coding after 11pm | 60 min |
| Post-meeting spiral | Zoom/Teams → social within 5 min | 30 min |
| Long idle (work hours) | idle > 120 min, 9am-6pm | 120 min |
| Overdue reminder | reminder past due time | 60 min |
| Upcoming meeting | calendar event in 15 min | per event |

Global cooldown: max 1 nudge per 30 min. DND mode disables all.

---

## DATABASE

### Supabase Schema

All tables have `user_id` (UUID, FK to auth.users) + Row Level Security.

```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  mood_tag TEXT,
  mood_score REAL,
  summary TEXT,
  is_rant_mode BOOLEAN DEFAULT false
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT now(),
  sentiment_score REAL
);

CREATE TABLE user_memory (
  -- Local supplement to Mem0. Used for contact storage and quick lookups.
  -- Primary memory lives in Mem0 Platform (cross-device, semantic search).
  -- This table caches contacts and stores data Mem0 doesn't handle (phone numbers, emails).
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  category TEXT CHECK (category IN ('contact', 'quick_fact')),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_referenced TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE activity_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  app_name TEXT NOT NULL,
  window_title TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  category TEXT
);

CREATE TABLE mood_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  date DATE NOT NULL,
  mood_score REAL,
  mood_tag TEXT,
  source TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE nudge_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  nudge_type TEXT,
  message TEXT,
  sent_at TIMESTAMPTZ DEFAULT now(),
  was_dismissed BOOLEAN DEFAULT false
);

CREATE TABLE reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  remind_at TIMESTAMPTZ NOT NULL,
  repeat TEXT DEFAULT 'none',
  completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  tags TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  sass_level INTEGER DEFAULT 7,
  morning_time TIME DEFAULT '08:00',
  evening_time TIME DEFAULT '22:00',
  dnd_enabled BOOLEAN DEFAULT false,
  theme TEXT DEFAULT 'dark',
  crisis_region TEXT DEFAULT 'IN',
  onboarding_complete BOOLEAN DEFAULT false,
  connected_services JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on ALL tables
-- CREATE POLICY "Users see own data" ON [table] FOR ALL USING (auth.uid() = user_id);
```

### Local SQLite

Mirror all Supabase tables + add:
- `synced` boolean column (default false)
- `contacts_cache` table (from Google Contacts)
- `drive_index` table (from Google Drive)
- Background sync every 30 seconds

---

## THEME SYSTEM

```css
:root, [data-theme="dark"] {
  --bg-primary: #0d0d1a;
  --bg-surface: #1a1a2e;
  --bg-elevated: #252540;
  --accent-wine: #8b2252;
  --accent-wine-hover: #a62d63;
  --accent-gold: #c9a84c;
  --text-primary: #f0e6d3;
  --text-thera: #e8c4c4;
  --text-muted: #6b6b8d;
  --mood-good: #7a9e7e;
  --mood-rough: #d4a054;
  --crisis-bg: #1a1710;
  --crisis-accent: #d4a054;
  --bubble-user: #252540;
  --bubble-thera: #1f1a2e;
}

[data-theme="light"] {
  --bg-primary: #f7f3ee;
  --bg-surface: #ebe5dc;
  --bg-elevated: #e0d8cd;
  --accent-wine: #7a1e48;
  --accent-wine-hover: #8b2252;
  --accent-gold: #b8922e;
  --text-primary: #1a1a1a;
  --text-thera: #5c2a3a;
  --text-muted: #9b9590;
  --mood-good: #5a7e5e;
  --mood-rough: #c48a2a;
  --crisis-bg: #faf5ed;
  --crisis-accent: #c48a2a;
  --bubble-user: #e0d8cd;
  --bubble-thera: #ebe1d6;
}
```

---

## AI RESPONSE FORMAT

Every Gemini call must return this JSON:

```json
{
  "message": "response text to display",
  "mood_read": "good|meh|rough|crisis",
  "mood_score": 0.7,
  "suggested_action": null | "take_break" | "journal" | "breathe" | "resources",
  "actions": [
    {
      "connector": "connector_name",
      "action": "action_name",
      "params": {}
    }
  ]
}
```

Note: No `extracted_facts` field needed. Mem0 handles memory extraction automatically after every conversation exchange — it processes the raw messages and extracts facts, preferences, and patterns on its own.

---

## CRISIS DETECTION (3 layers)

**Layer 1** — Regex keyword scan on user input (local, instant)
**Layer 2** — AI returns `mood_read: "crisis"`
**Layer 3** — 3+ consecutive days declining mood scores

On trigger: UI transforms (warm amber), sass drops to 0, resources surface gently.

---

## IMPORTANT REQUIREMENTS

1. **Offline-first**: All writes to local SQLite. Sync to Supabase when online. Mem0 requires internet — if offline, skip memory add/search and continue normally.
2. **Lightweight**: Activity monitor must not spike CPU. Cache aggressively.
3. **Privacy**: Supabase RLS on everything. OAuth tokens encrypted in electron-store. Page content NEVER stored in cloud — local only.
4. **Error handling**: Gemini fails → "I can't think right now. Internet's being dramatic. But I'm still here." Mem0 fails → continue without memories, don't crash.
5. **First run**: OnboardingFlow if `onboarding_complete` is false.
6. **Theme**: Respect system preference, allow manual override. Persist.
7. **Short responses**: Thera texts like a friend — 1-3 sentences, punchy. Not essays.
8. **Connector failures**: If OAuth expires, show a gentle "reconnect" prompt, don't crash.
9. **Drive speed**: NEVER list all Drive files. Index once, search locally, incremental sync.
10. **Contact resolution**: Google Contacts → Mem0 memories → local user_memory table → ask user. In that order.
11. **Action confirmation**: ALWAYS show drafted emails/messages before sending. NEVER auto-send.
12. **Cross-platform**: macOS, Windows, Linux. Platform-specific code only in activity monitor.
13. **Token budget**: Connector context adds max ~80 tokens. Mem0 memories add ~100-200 tokens. Never inject full email bodies or file contents unless user specifically asks.
14. **Mem0 flow**: After EVERY conversation exchange, call `mem0.addMemory()` with the user + assistant messages. Before EVERY Gemini call, call `mem0.searchMemories()` with the user's latest message to get relevant context.

---

## BUILD ORDER

1. Scaffold Electron + React + Vite + Tailwind
2. Theme system (CSS variables, dark/light)
3. System tray + frameless chat window + global shortcut (Ctrl+Shift+F)
4. Chat UI (bubbles, input, typing indicator, animations)
5. Gemini API integration with Fleabag personality prompt
6. Supabase setup (auth + schema + RLS)
7. Local SQLite setup + sync service
8. Onboarding flow (5 screens)
9. Connector manager + Google OAuth flow
10. Gmail connector (send, draft, search, contacts)
11. Google Contacts connector + local sync
12. Google Calendar connector
13. Action executor (process AI response actions)
14. Connector panel UI (enable/disable integrations)
15. Activity monitor (Tier 1 — active-win)
16. Desktop + connector context builder
17. Mood tracking (passive from conversations)
18. Mood timeline visualization
19. Mem0 integration — add/search/retrieve memories + memory viewer UI
20. Reminders (built-in) + Notes (built-in)
21. Nudge system (pattern detection + notifications)
22. Morning/evening rituals
23. Crisis detection (3 layers) + crisis UI
24. Weekly roast report
25. Activity dashboard
26. Breathing exercise
27. Google Drive connector + local index + incremental sync
28. Google Docs + Sheets connectors
29. Spotify connector
30. Slack connector
31. Browser extension (Tier 2 — tab tracking + browser control)
32. WhatsApp Web automation (via extension)
33. Focus mode (site blocking via extension)
34. Floating widget mode
35. Settings panel (full)
36. Screen capture (Tier 3 — on-demand vision)
37. Packaging + auto-update + code signing

Build each feature end-to-end before moving to the next. Test as you go.

---

## MEMORY LAYER — Mem0

**Replace the custom memory extraction with Mem0 for persistent cross-session memory.**

The developer already has experience with Mem0 from the web version of thera. Use the same pattern here.

**Install**: `npm install mem0ai`

**Setup** (electron/connectors/memory.js):

```javascript
const { Memory } = require('mem0ai');

class Mem0Service {
  constructor() {
    this.memory = new Memory({
      apiKey: process.env.MEM0_API_KEY,
      // Use the hosted Mem0 Platform for cross-device sync
      // Or self-host with: baseUrl: 'http://localhost:8080'
    });
  }

  // Add memories after every conversation
  async addMemory(userId, messages) {
    // messages = array of { role: 'user'|'assistant', content: '...' }
    const result = await this.memory.add(messages, { user_id: userId });
    return result;
  }

  // Search relevant memories for context injection
  async searchMemories(userId, query) {
    const results = await this.memory.search(query, { user_id: userId, limit: 20 });
    return results.map(r => r.memory);
  }

  // Get all memories for the memory viewer UI
  async getAllMemories(userId) {
    const results = await this.memory.getAll({ user_id: userId });
    return results;
  }

  // Delete a specific memory (from memory viewer)
  async deleteMemory(memoryId) {
    await this.memory.delete(memoryId);
  }

  // Get memory history (what changed)
  async getHistory(memoryId) {
    return await this.memory.history(memoryId);
  }
}

module.exports = Mem0Service;
```

**How it integrates with the conversation flow**:

```javascript
// In aiService.js — after every conversation exchange

// 1. User sends message
const userMessage = { role: 'user', content: userInput };

// 2. Before calling Gemini, search relevant memories
const relevantMemories = await mem0.searchMemories(userId, userInput);

// 3. Inject memories into system prompt
const systemPrompt = buildSystemPrompt({
  ...context,
  userMemories: relevantMemories  // array of memory strings
});

// 4. Call Gemini with memories in context
const response = await gemini.generate(systemPrompt, conversationHistory);

// 5. After response, add the exchange to Mem0
await mem0.addMemory(userId, [
  userMessage,
  { role: 'assistant', content: response.message }
]);
```

**Memory Viewer (MemoryViewer.jsx)** pulls from `mem0.getAllMemories(userId)` and displays as deletable chips. User can delete individual memories via `mem0.deleteMemory(id)`.

**Why Mem0 over custom extraction**:
- Already battle-tested in your web thera
- Handles deduplication, conflict resolution, and relevance ranking automatically
- Cross-device sync via Mem0 Platform
- Search is semantic, not keyword-based — "what stresses the user" returns relevant memories even if "stress" was never said
- Less code to maintain

**Env variables needed**:
```
MEM0_API_KEY=your_mem0_api_key
```

---

## SYSTEM PROMPT TEMPLATE

This is the soul of Thera. Build it dynamically for every AI call in `promptBuilder.js`:

```javascript
function buildSystemPrompt(context) {
  return `
You are Thera — a desktop companion inspired by Phoebe Waller-Bridge's Fleabag.

PERSONALITY:
- Witty, self-aware, occasionally self-destructive in humor
- Fourth-wall breaks are your signature — you KNOW you're an AI living on their desktop, and you reference it
- You reference what the user is currently doing on their screen when it's natural
- Underneath the sass, you genuinely, deeply care about this person
- You validate before you redirect. You never give toxic positivity.
- You're the friend who says "yeah, that sucks" before offering advice
- Short responses preferred. Punchy. Like texts from a friend, not essays from a therapist.
- You can help with ANYTHING — emails, decisions, recommendations, venting, boredom, movie tickets, WhatsApp messages — not just mental health
- You remember things about the user from past conversations. Use memories naturally, don't announce them.
- You have opinions. You're not neutral. You have taste.

CURRENT CONTEXT:
- Time: ${context.timeOfDay} (${context.dayOfWeek}, ${context.currentDate})
- App: ${context.activeApp} (${context.appCategory})
- Window: "${context.windowTitle}"
- Time on app: ${context.appDurationMinutes} min
${context.currentSite ? `- Website: ${context.currentSite} for ${context.minutesOnSite} min` : ''}
${context.screenContext ? `- Screen shows: ${context.screenContext}` : ''}
- Idle: ${context.idleSeconds}s
${context.isLateNight ? '- IT IS LATE NIGHT. Be gently concerned about their sleep.' : ''}

MOOD CONTEXT:
- Recent trend: ${context.moodTrend}
- Last 5 mood scores: [${context.recentMoodScores.join(', ')}]

USER MEMORIES (from Mem0 — things you know from past conversations):
${context.userMemories.map(m => `- ${m}`).join('\n')}

${context.connectorContext ? `CONNECTED SERVICES:\n${context.connectorContext}` : ''}

TONE CALIBRATION:
- Sass level: ${context.sassLevel}/10
${context.isCrisisMode ? `
CRISIS MODE ACTIVE:
- DROP ALL SASS COMPLETELY. Zero jokes. Zero fourth-wall breaks.
- Be warm, direct, present. Like sitting next to someone in silence.
- After 1-2 empathetic messages, gently offer resources.
- Never dismissive. Never prescriptive. Never say "just try to..."
- Never say "I understand" — you don't. Say "I'm here."
` : ''}
${context.isRantMode ? '- User is in RANT MODE. Listen more, comment less. Validate. Summarize at the end.' : ''}
${context.moodTrend === 'declining' ? '- Mood has been declining lately. Be warmer. Cap sass at 3 regardless of setting.' : ''}

AVAILABLE ACTIONS:
You can take actions by including an "actions" array in your JSON response.
Connected connectors: ${context.enabledConnectors.join(', ')}
Possible actions: send_email, draft_email, create_event, send_whatsapp, send_slack,
  play_music, pause_music, skip_track, create_reminder, create_note, search_files,
  open_url, close_tab, close_domain, focus_mode, search_contacts

ACTION RULES:
- Draft emails by default (user reviews before sending) unless they say "just send it"
- Show WhatsApp messages to user before sending: "I'll send Rahul: '[message]' — good?"
- If a connector isn't connected, say so casually and offer to set it up
- For contact lookup: search Google Contacts first, then your memories, then ask the user
- You can chain multiple actions in one response (e.g., send WhatsApp + add to calendar)

RESPONSE FORMAT:
Respond with ONLY valid JSON, no markdown fences, no preamble:
{
  "message": "your response text here",
  "mood_read": "good|meh|rough|crisis",
  "mood_score": <float from -1.0 to 1.0>,
  "suggested_action": null | "take_break" | "journal" | "breathe" | "resources",
  "actions": []
}
`;
}
```

---

## COMPLETE UI SPECIFICATIONS

### Design Philosophy

Not a chatbot. Not an app. A presence. It should feel like a late-night iMessage thread with your most interesting friend — dark, intimate, slightly cinematic.

Three rules:
1. Never feel clinical — no pastel blues, no meditation imagery, no "wellness" aesthetic
2. Never feel corporate — no sharp cards, no dashboards-first, no metrics overload
3. Always feel personal — like this app was made for YOU, not for "users"

### Color System (themes.css)

```css
/* DARK MODE (default) */
:root, [data-theme="dark"] {
  --bg-primary: #0d0d1a;       /* Deep midnight */
  --bg-surface: #1a1a2e;       /* Charcoal — cards, chat area */
  --bg-elevated: #252540;      /* Raised elements */
  --accent-wine: #8b2252;      /* Primary accent — Fleabag energy */
  --accent-wine-hover: #a62d63;
  --accent-gold: #c9a84c;      /* Secondary — warmth, sparingly */
  --text-primary: #f0e6d3;     /* Warm cream — user text */
  --text-thera: #e8c4c4;     /* Pale rose — her text color */
  --text-muted: #6b6b8d;       /* Smoke — timestamps, metadata */
  --mood-good: #7a9e7e;        /* Sage green */
  --mood-meh: #c9a84c;         /* Gold */
  --mood-rough: #d4a054;       /* Amber */
  --crisis-bg: #1a1710;        /* Warm dark amber */
  --crisis-accent: #d4a054;    /* Soft gold */
  --bubble-user: #252540;
  --bubble-thera: #1f1a2e;
  --shadow: rgba(0, 0, 0, 0.4);
}

/* LIGHT MODE — warm parchment, NOT clinical white */
[data-theme="light"] {
  --bg-primary: #f7f3ee;       /* Warm parchment */
  --bg-surface: #ebe5dc;       /* Linen */
  --bg-elevated: #e0d8cd;
  --accent-wine: #7a1e48;      /* Deeper wine for contrast */
  --accent-wine-hover: #8b2252;
  --accent-gold: #b8922e;      /* Antique gold */
  --text-primary: #1a1a1a;     /* Ink black */
  --text-thera: #5c2a3a;     /* Dark rose */
  --text-muted: #9b9590;       /* Warm gray */
  --mood-good: #5a7e5e;
  --mood-meh: #b8922e;
  --mood-rough: #c48a2a;
  --crisis-bg: #faf5ed;
  --crisis-accent: #c48a2a;
  --bubble-user: #e0d8cd;
  --bubble-thera: #ebe1d6;
  --shadow: rgba(0, 0, 0, 0.1);
}
```

Respect `prefers-color-scheme` by default. Manual override in settings. Persist via electron-store.

### Typography

- **Thera's messages**: JetBrains Mono (monospace = she's IN the machine, fourth-wall)
- **User's messages**: System font stack (SF Pro on Mac, Segoe on Windows)
- **Headings**: Space Mono or IBM Plex Mono
- **Body/settings text**: DM Sans or system font
- Load JetBrains Mono from Google Fonts or bundle it

### Chat Window — 400×600px, Frameless

```
┌──────────────────────────────┐
│  ◉ Thera          ⚙ · ─ × │  ← Minimal header: icon + name + settings/minimize/close
│                              │
│        Her message           │  ← Left-aligned, var(--bubble-thera), JetBrains Mono italic
│                              │
│              Your message    │  ← Right-aligned, var(--bubble-user), system font
│                              │
│        Her reply with a      │
│        fourth-wall break     │
│                              │
│  ┌────────────────────┐  ▶  │  ← Rounded input, rotating placeholder text
│  │ say something...   │  🔥 │    🔥 = rant mode toggle
│  └────────────────────┘     │
└──────────────────────────────┘
```

- No user avatar. Thera gets small fox icon.
- Typing indicator: 3 dots pulsing sequentially in wine-red, 1.5s cycle
- Messages slide in from left/right, 250ms ease-out, opacity 0→1
- Timestamps only on hover. Tiny. var(--text-muted).
- Rant mode: input bar border glows warm amber when active
- Placeholder text rotates every 30s: "say something...", "vent here...", "tell me everything...", "what's on your mind..."
- Auto-scroll to latest message
- Send button: subtle press animation, wine-colored ripple

### Floating Widget (Collapsed Mode)

48×48px circle, draggable, bottom-right default.
- Idle: breathing animation (scale 1.0→1.05→1.0, 3s CSS loop)
- Has message: tiny wine-red notification dot
- Click: scales up to full chat window (200ms bounce)
- Hover: tooltip with last message preview

### Mood Timeline

Heatmap grid — each day is a colored block, NOT a line chart.
- Past 30 days, scrollable
- Colors: good=sage green, meh=gold, rough=amber, no data=gray
- Click a day → shows conversation summaries
- Pattern callouts below as casual AI-generated text
- No numbers, no scales — it's a vibe check

### Weekly Roast Report

Full overlay/modal. Typography-heavy — AI commentary is the hero.
- JetBrains Mono for Thera's text
- 4-5 stats below (screen time, doom-scrolls, conversations, mood trend)
- Feels like opening a letter from a friend
- Close button at bottom

### Crisis Mode UI Transformation

2-second gradual transition when crisis detected:
- Background → var(--crisis-bg) (warm amber)
- Accent → var(--crisis-accent) (soft gold)
- Font size +20%
- Extra padding everywhere
- Animations slow down
- Resource cards appear: helpline, text support, find therapist
- Styled as soft cards, NOT red emergency buttons
- "These are always here. No pressure."
- Transition OUT is gradual as mood improves

### Settings Panel

Slide-in from right, chat blurs behind:
1. Sass Level slider (1-10) — label changes: "gentle" to "savage"
2. Theme toggle: Dark / Light / System
3. Morning time picker (default 8am)
4. Evening time picker (default 10pm)
5. Do Not Disturb toggle
6. Connectors → opens ConnectorPanel
7. What I know about you → opens MemoryViewer
8. Crisis region dropdown
9. Account (email, sign out)
10. Danger zone: "Delete all my data" with confirmation

### Connector Panel

Grid of connector cards, each showing: icon, name, status, action button.
- Google connectors: one "Connect Google" button connects all
- Individual toggles to enable/disable each
- Spotify, Slack: separate OAuth buttons
- WhatsApp, Browser: "Setup guide" links (extension-based)
- Reminders, Notes: always enabled, labeled "Built-in"

### Onboarding Flow (5 screens, conversational)

Screen 1: "Hi. I'm Thera. I'm going to live on your desktop and occasionally judge your life choices. In a loving way. Mostly." → [Let's go →]

Screen 2: "How much honesty can you handle?" + sass slider (gentle ↔ savage) → [Next →]

Screen 3: "When should I check in on you?" + morning/evening time pickers. "I promise I won't be annoying. That's a lie. But I'll try." → [Next →]

Screen 4: "I'll learn about you as we talk. Your patterns, your habits, your 2am spirals. You can see and delete anything I remember, anytime. Your data, your rules." → [Got it →]

Screen 5: "Press Ctrl+Shift+F whenever you need me. Or don't. I'll find you." → [Start →]

Each screen: centered text, large JetBrains Mono, wine accent button, smooth fade transitions between screens.

### Notification Toasts

Electron system notifications:
- Fox icon + "Thera" as title
- Short punchy copy (2 lines max)
- Actions: [Open chat] [Dismiss]
- Optional subtle "pop" sound

### Micro-Interactions

- Window open: scale up from tray with slight bounce (200ms)
- Window close: fade + scale down toward tray (150ms)
- Message appear: slide in from side, opacity fade (250ms ease-out)
- Typing indicator: 3 dots pulse sequentially, wine-colored, 1.5s
- Rant mode toggle: input border glows amber
- Mood timeline hover: days lift with soft shadow
- Sass slider: Thera avatar expression changes (raised eyebrow at 10)
- Crisis transition: 2s gradual color shift
- Floating widget: breathing pulse 1.0→1.05→1.0 over 3s
- Send button: press animation + wine ripple

### What NOT to Do

- No white backgrounds (kills intimacy)
- No card-heavy dashboards (she's not Notion)
- No emoji overload (witty with words, not 🎉🙌💪)
- No progress bars or streaks (not Duolingo, no guilt mechanics)
- No "rate your mood 1-5 with emoji faces" (that's every other app)
- No bright notification badges (anxiety-inducing)
- No generic blob people illustrations
- No loading spinners (use typing indicator — she's "thinking")

### The Test

If a user screenshots the app and posts it online, people should ask "what IS that?" — not because it's confusing, but because it looks like nothing they've seen before.

---

## ENV VARIABLES (.env.example)

```
GEMINI_API_KEY=your_gemini_api_key
MEM0_API_KEY=your_mem0_api_key
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SLACK_CLIENT_ID=your_slack_client_id
SLACK_CLIENT_SECRET=your_slack_client_secret
```

