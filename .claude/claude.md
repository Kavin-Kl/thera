# Thera — Project Context

## What is Thera?

Thera is a **commercial Electron desktop application** — a Fleabag-inspired AI companion that lives in your system tray, monitors desktop activity, tracks mood passively, and provides mental health support disguised as a brutally honest friendship.

Think: if Fleabag became a desktop app and actually cared about you.

## Current State

This is the **desktop version** being built with Electron. The developer already has a working **web version** (`fleabot`) built with React, Gemini API, and Mem0 for memory.

**Location**: `C:\Users\Kavin\Documents\thera`

**What's Built So Far**:
- Basic Electron skeleton (main.js, index.html, package.json)
- Vite + React setup
- Tailwind CSS configuration
- Intro sequence component (from therafront replication)
- Home/chat component (from therafront replication)

**What's NOT Built Yet** (from THERA_FINAL_PROMPT.md):
- System tray integration
- Activity monitoring (3-tier system)
- Connector system (Gmail, Calendar, Drive, Spotify, etc.)
- Mem0 memory integration
- Supabase database + auth
- AI action executor
- Mood tracking & crisis detection
- All the other features from the spec

## Tech Stack

- **Desktop**: Electron (latest stable)
- **Frontend**: React 18 + Vite + JavaScript
- **Styling**: Tailwind CSS 3 with CSS variables (dark/light themes)
- **State**: Zustand
- **AI**: Google Gemini API (gemini-2.5-flash) — multimodal
- **Memory**: Mem0 (mem0ai npm package) — persistent cross-session memory
- **Database**: Supabase (Auth + Postgres + RLS)
- **Local cache**: better-sqlite3 for offline-first writes
- **Charts**: Recharts for mood visualization
- **Desktop APIs**: active-win, desktop-idle, node-cron, electron-store
- **Google APIs**: Gmail, Calendar, Contacts, Drive, Docs, Sheets (via googleapis)
- **Music**: Spotify Web API (via spotify-web-api-node)
- **Messaging**: WhatsApp Web automation via Chrome extension

## Personality

Thera is:
- Witty, self-aware, occasionally self-destructive in humor
- Fourth-wall breaks are her signature — she KNOWS she's an AI living on your desktop
- Underneath the sass, she genuinely, deeply cares
- Validates before redirecting. No toxic positivity.
- Short responses. Punchy. Like texts from a friend, not essays from a therapist.
- Can help with ANYTHING — emails, decisions, recommendations, venting, boredom, movie tickets, WhatsApp messages — not just mental health
- Has opinions. Has taste. Not neutral.

## Key Features to Build

1. **System Tray** + frameless chat window (400×600px) + global shortcut (Ctrl+Shift+F)
2. **Connector System** — 12 integrations:
   - Gmail (send, draft, search, contacts)
   - Google Calendar (events, scheduling)
   - Google Contacts (contact lookup)
   - Google Drive (search, read files) — with local indexing for speed
   - Google Docs (create, read, edit)
   - Google Sheets (read, update)
   - Spotify (play, pause, queue, search)
   - Slack (send messages, search)
   - WhatsApp (via browser extension automation)
   - Browser Control (via extension — tab management, focus mode)
   - Reminders (built-in, SQLite + Supabase)
   - Notes (built-in, SQLite + Supabase)

3. **Activity Monitoring** (3-tier):
   - Tier 1: Window metadata (active-win) — always on, free
   - Tier 2: Browser extension — rich web data
   - Tier 3: Screen vision (desktopCapturer) — on-demand, expensive

4. **AI Action System**: AI can execute actions like:
   - Send/draft emails
   - Create calendar events
   - Send WhatsApp messages
   - Play music
   - Create reminders
   - Search files
   - Control browser tabs

5. **Memory Layer**: Mem0 integration
   - Persistent cross-session memory
   - Semantic search (not keyword-based)
   - Memory viewer UI (user can delete memories)

6. **Mood Tracking**: Passive from conversations
   - Mood timeline heatmap (30 days)
   - Pattern detection
   - Crisis detection (3 layers)

7. **Nudge System**: Smart interruptions
   - Doom-scrolling detection
   - Break reminders
   - Meeting prep
   - Overdue reminders

8. **Rituals**: Morning/evening check-ins
9. **Weekly Roast Report**: AI-generated weekly summary
10. **Crisis Mode**: UI transformation when crisis detected

## Design Philosophy

**Three Rules**:
1. Never feel clinical — no pastel blues, no meditation imagery
2. Never feel corporate — no sharp cards, no dashboards-first
3. Always feel personal — like this app was made for YOU

**Color Palette** (Dark Mode):
- Deep midnight background (#0d0d1a)
- Wine-red accent (#8b2252) — Fleabag energy
- Gold accent (#c9a84c) — warmth, sparingly
- Warm cream text (#f0e6d3)
- Pale rose for Thera's text (#e8c4c4)

**Typography**:
- Thera's messages: JetBrains Mono (monospace = she's IN the machine)
- User's messages: System font stack
- Headings: Space Mono or IBM Plex Mono

## Important Implementation Notes

1. **Offline-first**: All writes to local SQLite, sync to Supabase when online
2. **Token optimization**:
   - Gmail: NEVER fetch full email bodies unless user asks
   - Drive: Local index, NEVER list all files
   - Connector context adds max ~80 tokens
3. **Action confirmation**: ALWAYS draft emails/messages before sending
4. **Drive speed fix**: Index once on connect, search locally, incremental sync
5. **Contact resolution**: Google Contacts → Mem0 → user_memory table → ask user
6. **Mem0 flow**: Search before EVERY Gemini call, add after EVERY exchange

## Build Order (from spec)

See `THERA_FINAL_PROMPT.md` lines 1061-1100 for the complete 37-step build order.

Currently at: **Step 1-2** (scaffold + theme started)

## Related Projects

- **fleabot** (`C:\Users\Kavin\Documents\fleabot`): Web version with Gemini + Mem0 already working
- **therafront** (`C:\Users\Kavin\Documents\therafront`): React frontend that was replicated into this Electron app's intro/chat UI

## Environment Variables

See `.env` file in project root. Required APIs:
- Gemini API key
- Mem0 API key
- Supabase URL + Anon Key
- Google OAuth (Client ID + Secret)
- Spotify OAuth (Client ID + Secret)
- Slack OAuth (Client ID + Secret)

## Documentation

- Full spec: `THERA_FINAL_PROMPT.md` (1508 lines)
- Contains: complete UI specs, connector implementations, system prompt template, database schema, response format, etc.

## Development Commands

```bash
npm start        # Start Electron app (dev mode)
npm run dev      # Alternative start command
npm run build    # Build for production (not set up yet)
```

## Key Architectural Decisions

1. **Google OAuth**: ONE OAuth flow for all Google services (Gmail, Calendar, Drive, Docs, Sheets, Contacts)
2. **Connector Manager**: Central registry for all third-party integrations
3. **Action Executor**: Processes AI-decided actions from response JSON
4. **Context Builder**: Surgical injection of connector data (not everything at once)
5. **WhatsApp via Extension**: No API — automates WhatsApp Web DOM
6. **Drive Indexing**: Build local SQLite index once, search locally for speed

## Current Focus

The immediate next steps should follow the build order:
1. Complete theme system (CSS variables done, need dark/light toggle)
2. System tray setup
3. Frameless window with custom controls
4. Global shortcut (Ctrl+Shift+F)
5. Then move to connector system and AI integration

## Notes for Claude

- The developer has experience with Gemini API and Mem0 from fleabot
- Prefers JavaScript over TypeScript
- Already has working Vite + React + Tailwind setup
- The intro/chat UI from therafront has been replicated but needs to be adapted for Thera's personality
- Focus on building features end-to-end before moving to next feature
- Test as you go
