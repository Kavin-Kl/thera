// Central registry of all Thera connectors.
// UI-only metadata. OAuth/extension wiring lands in later slices.

export const GOOGLE_KEYS = ['gmail', 'gcal', 'gcontacts', 'gdrive', 'gdocs', 'gsheets'];

export const CONNECTORS = [
  // Google bundle — connected via single OAuth flow
  { key: 'gmail',     name: 'Gmail',           icon: '✉',  group: 'google',  description: 'send, draft, search emails' },
  { key: 'gcal',      name: 'Calendar',        icon: '◷',  group: 'google',  description: 'events & scheduling' },
  { key: 'gcontacts', name: 'Contacts',        icon: '◉',  group: 'google',  description: 'lookup people' },
  { key: 'gdrive',    name: 'Drive',           icon: '◇',  group: 'google',  description: 'search files (local index)' },
  { key: 'gdocs',     name: 'Docs',            icon: '▤',  group: 'google',  description: 'create, read, edit docs' },
  { key: 'gsheets',   name: 'Sheets',          icon: '▦',  group: 'google',  description: 'read & update sheets' },

  // Standalone OAuth
  { key: 'spotify',   name: 'Spotify',         icon: '♪',  group: 'oauth',   description: 'play, queue, search' },
  { key: 'slack',     name: 'Slack',           icon: '#',  group: 'oauth',   description: 'send messages, search' },

  // Extension-based
  { key: 'whatsapp',  name: 'WhatsApp',        icon: '◕',  group: 'extension', description: 'via browser extension' },
  { key: 'browser',   name: 'Browser Control', icon: '◐',  group: 'extension', description: 'tabs, focus mode' },

  // Built-in (always on)
  { key: 'reminders', name: 'Reminders',       icon: '⏰', group: 'builtin', description: 'always on' },
  { key: 'notes',     name: 'Notes',           icon: '✎',  group: 'builtin', description: 'always on' },
];

export const CONNECTORS_BY_KEY = Object.fromEntries(CONNECTORS.map(c => [c.key, c]));
