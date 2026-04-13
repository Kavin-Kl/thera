# Thera — Architecture & Tool Reference

## What Thera is

A Fleabag-inspired AI desktop companion built on Electron. It lives in your system tray, monitors your desktop activity, tracks mood passively, and can control your browser, send emails, play music, and do almost anything — all through natural conversation.

---

## Architecture

### High-level stack

```
┌─────────────────────────────────────────────────────────────┐
│  React UI (Vite + Tailwind)                                  │
│  Home.jsx — chat, session management, screenMode            │
└────────────────────┬────────────────────────────────────────┘
                     │ ipcRenderer.invoke / ipcRenderer.send
┌────────────────────▼────────────────────────────────────────┐
│  Electron Main Process                                       │
│  main.js — IPC handlers, window management, tray, bridges  │
│  wsBridge.js — WebSocket server (port 7980)                 │
│  bridgeClient.js — HTTP bridge client (port 7979)           │
└────┬──────────────┬───────────────┬───────────────┬─────────┘
     │              │               │               │
  Google         Spotify         Slack          SQLite
  APIs           API             API            (localDb)
     │
  googleapis
```

### AI layer

```
User message
  │
  ├── [screenMode ON] desktopCapturer → JPEG base64
  │
  ├── Mem0 semantic search → relevant past memories
  │
  └── runAgent(sessionId, text, memory, screenshot?)
        │
        │  agent.js — LangChain AgentExecutor
        │    - ChatGoogleGenerativeAI (gemini-2.5-flash)
        │    - createToolCallingAgent
        │    - InMemoryChatMessageHistory (per session)
        │
        └── LOOP until done (max 15 iterations):
              1. Build prompt:
                 [system] + [chat_history] + [input + optional screenshot] + [scratchpad]
              2. Call Gemini → decide: tool_call OR final_answer
              3. If tool_call → run tool.func(args) → append result to scratchpad
              4. If final_answer → return text
```

### Browser control flow

```
Agent calls browser_navigate / browser_click / etc.
  │
  │  browserTools.js tool.func()
  └── ipcRenderer.invoke('browser:command', { action, payload, timeout })
        │
        │  main.js ipcMain.handle('browser:command')
        └── wsBridge.sendCommand(action, payload, timeout)
              │
              │  WebSocket message → port 7980
              └── background.js (Chrome extension service worker)
                    │
                    └── WS_ACTIONS[action](payload)
                          │
                          ├── chrome.tabs.* (tab management, navigation)
                          ├── CDP (Chrome DevTools Protocol)
                          │     - cdpAttach / cdpDetach
                          │     - cdpClick (real mouse coordinates)
                          │     - cdpType (real keyboard events)
                          │     - evaluate() (JS in page context)
                          │     - waitForRect() (poll until element visible)
                          └── Result → WebSocket → wsBridge → IPC → tool return value
```

### Connector (Google / Spotify / Slack) flow

```
Agent calls gmail_send / spotify_play / etc.
  │
  │  connectorTools.js tool.func()
  └── ipcRenderer.invoke('actions:execute', { type, params })
        │
        │  main.js ipcMain.handle('actions:execute')
        └── actions.js HANDLERS[type](params)
              │
              ├── Google APIs (googleapis) — gmail, calendar, drive, docs, sheets, contacts
              ├── Spotify REST API — spotify.js thin wrapper with auto token refresh
              └── Slack Web API — slack.js thin wrapper
```

### Activity monitoring

```
activityMonitor.js (starts 2s after app launch)
  │
  ├── active-win (every 10s) — what app / window is focused
  ├── Chrome extension → HTTP bridge (port 7979) → tab URL/title
  ├── activityOps → SQLite (local cache)
  └── Nudge system → widget window IPC
```

### Memory

```
Every conversation turn:
  Before:  Mem0.search(userId, userMessage) → inject relevant memories as context
  After:   Mem0.add(userId, [userMsg, botMsg]) → store for future retrieval

Mem0 is semantic (vector search), not keyword — finds relevant past context
even when exact words don't match.
```

---

## Tool Reference (50 tools)

### System awareness

| Tool | Description |
|---|---|
| `get_screen_context` | Last browser tab URL + title from Chrome extension |
| `get_active_app` | Currently focused desktop app + window title (active-win) |
| `get_activity_summary` | What the user did in the last 2 hours (app time breakdown) |
| `log_mood` | Silently record mood score −2..+2 when emotional signal detected |
| `record_crisis` | Flag crisis event (amber/red) — only for genuine safety signals |

### Browser control

| Tool | Description |
|---|---|
| `browser_read_page` | Read current page URL, title, and full text content |
| `browser_navigate` | Navigate active Chrome tab to a URL |
| `browser_wait_for` | Wait for a CSS selector to appear (for dynamic content) |
| `browser_click` | Click element by CSS selector (real CDP mouse event) |
| `browser_click_text` | Click element by its visible text label |
| `browser_type` | Type into an input field (real CDP keyboard events, works on React) |
| `browser_press_key` | Press Enter, Escape, Tab, Arrow keys, etc. |
| `browser_extract` | Extract text from a specific element |
| `browser_scroll` | Scroll the page up or down |

### Tab management

| Tool | Description |
|---|---|
| `tab_list` | List all open Chrome tabs with IDs, titles, URLs |
| `tab_switch` | Switch focus to a tab by ID, title, or URL substring |
| `tab_new` | Open a new tab, optionally at a URL |
| `tab_close` | Close a tab by ID or close the current tab |
| `tab_pin` | Pin or unpin a tab |

### Messaging

| Tool | Description |
|---|---|
| `whatsapp_send` | Send a WhatsApp message via CDP on WhatsApp Web |
| `whatsapp_read` | Read recent messages from a WhatsApp chat |
| `instagram_send` | Send an Instagram DM via CDP |
| `instagram_read` | Read recent Instagram DMs |

### Autonomous browser tasks

| Tool | Description |
|---|---|
| `browser_ai_task` | Multi-step browser goal with AI loop (navigate → read → act → verify). Use for complex flows like booking, form-filling, price comparison. |

### Google — Contacts

| Tool | Description |
|---|---|
| `contacts_search` | Find a contact by name → returns email + phone |

### Google — Gmail

| Tool | Description |
|---|---|
| `gmail_search` | Search emails by query — returns from, subject, snippet, message ID |
| `gmail_read` | Read full body of a specific email by message ID |
| `gmail_send` | Send email (resolves name → email automatically) |
| `gmail_draft` | Save email as draft |
| `gmail_reply` | Reply to an email thread |

### Google — Calendar

| Tool | Description |
|---|---|
| `calendar_create` | Create a calendar event |
| `calendar_list` | List upcoming events |

### Google — Drive / Docs / Sheets

| Tool | Description |
|---|---|
| `drive_search` | Search files by name |
| `docs_create` | Create a new Google Doc |
| `docs_read` | Read text content of a Doc by ID |
| `docs_edit` | Append or replace content in a Doc |
| `sheets_read` | Read rows from a Sheet by spreadsheet ID + range |
| `sheets_update` | Write values to a range in a Sheet |

### Spotify

| Tool | Description |
|---|---|
| `spotify_get_current` | What's playing right now (track, artist, progress) |
| `spotify_play` | Play a song, artist, playlist, or album by name |
| `spotify_control` | Pause, resume, next, previous |
| `spotify_queue` | Add a track to the queue by URI |
| `spotify_search` | Search without playing — returns name + URI |
| `spotify_volume` | Set volume 0–100 |

### Slack

| Tool | Description |
|---|---|
| `slack_send` | Send a message to a channel or person |
| `slack_search` | Search messages across Slack |
| `slack_read` | Read recent messages from a channel |
| `slack_status` | Set your Slack status text + emoji + expiry |

### Reminders

| Tool | Description |
|---|---|
| `reminder_create` | Create a reminder with optional due date |
| `reminder_list` | List upcoming undone reminders |
| `reminder_delete` | Mark a reminder as done by ID |

### Notes

| Tool | Description |
|---|---|
| `note_create` | Save a note |
| `note_list` | List recent notes |
| `note_search` | Search notes by keyword |

---

## screenMode

The 👁 button in the chat input enables screen context. When on:

1. On each message send, Electron's `desktopCapturer` captures a half-resolution JPEG of the primary display
2. The screenshot is encoded as base64 and included as an `image_url` content part in the `HumanMessage` sent to Gemini
3. Gemini sees both your text and your screen — can read content, describe what's visible, help with whatever is shown

This is NOT a tool — it's direct multimodal input. The screenshot is embedded in the question itself, not fetched on demand.

---

## Data flow for a single message

```
1. User types and hits Enter
2. Home.jsx send():
   a. [screenMode] → screen:capture IPC → desktopCapturer → base64 JPEG
   b. fetchMemoryContext() → Mem0 vector search → relevant memories string
   c. runAgent(sessionId, text, memory, screenshot?)
3. agent.js runAgent():
   a. Load LangChain history for this session (InMemoryChatMessageHistory)
   b. Build HumanMessage: [{ type:'text', text }, { type:'image_url', url }?]
   c. AgentExecutor.invoke({ input:[HumanMessage], chat_history })
4. AgentExecutor loop (Gemini decides):
   a. Browser tools → IPC → WebSocket → Chrome extension → CDP
   b. Connector tools → IPC → actions.js → Google/Spotify/Slack APIs
   c. System tools → IPC → active-win / activityOps / mood:log
5. Final text response returned
6. Save HumanMessage + AIMessage to LangChain history (in-memory)
7. Persist both to SQLite via sessions:add-message IPC
8. Baseline mood:log tick (score 0, source: conversation)
9. storeConversation() → Mem0 (async, background)
10. Render bot message in UI
```

---

## Environment variables required

| Variable | Where to get it |
|---|---|
| `VITE_GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) |
| `VITE_MEM0_API_KEY` | [app.mem0.ai](https://app.mem0.ai) |
| `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` | [supabase.com](https://supabase.com) |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Google Cloud Console → Credentials → **Desktop app** type |
| `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET` | [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) |
| `SLACK_CLIENT_ID` + `SLACK_CLIENT_SECRET` | [api.slack.com/apps](https://api.slack.com/apps) |

**Important for Google:** OAuth client must be type **Desktop app**, not Web application. This allows the loopback redirect URI (`http://127.0.0.1:<port>/oauth/callback`) without pre-registering specific ports.

---

## Ports used

| Port | Purpose |
|---|---|
| `5173` (Vite dev) | React frontend dev server |
| `7979` | HTTP long-poll bridge — Chrome extension → Electron (legacy connector actions) |
| `7980` | WebSocket bridge — Electron ↔ Chrome extension (LangChain browser tools) |
| `51234` | Spotify OAuth loopback callback |
| `51235` | Google Supabase OAuth loopback callback |

---

## Chrome Extension

The extension (`browser-extension/`) is a Manifest V3 service worker that:

1. **HTTP polling** (port 7979): polls `/commands` for connector actions (WhatsApp DOM automation, legacy browser control)
2. **WebSocket** (port 7980): persistent bidirectional connection for LangChain browser tools
3. **CDP (Chrome DevTools Protocol)**: attaches to tabs for real mouse/keyboard simulation — bot-resistant, works on React/Angular/Lexical
4. **Content scripts**: injected for page reading, scrolling, text extraction

Both channels run simultaneously. HTTP is legacy (backward compat). WebSocket is the primary channel for all new tool commands.
