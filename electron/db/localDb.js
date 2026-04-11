const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

const dbPath = path.join(app.getPath('userData'), 'thera.db');
const db = new Database(dbPath);

// Create tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'desktop_user',
    app_name TEXT NOT NULL,
    window_title TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    duration_seconds INTEGER,
    category TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS nudge_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'desktop_user',
    nudge_type TEXT NOT NULL,
    message TEXT NOT NULL,
    sent_at INTEGER DEFAULT (strftime('%s', 'now')),
    was_dismissed INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'desktop_user',
    title TEXT NOT NULL DEFAULT 'new session',
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS connectors (
    key TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'disconnected',
    metadata TEXT,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS mood_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    score INTEGER NOT NULL,
    label TEXT,
    note TEXT,
    source TEXT,
    session_id TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS crisis_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    severity TEXT NOT NULL,
    trigger TEXT,
    session_id TEXT,
    resolved_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_mood_created ON mood_entries(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_crisis_created ON crisis_events(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_activity_started ON activity_logs(started_at);
  CREATE INDEX IF NOT EXISTS idx_activity_app ON activity_logs(app_name);
  CREATE INDEX IF NOT EXISTS idx_nudge_sent ON nudge_history(sent_at);
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
`);

// ── Migrations: add user_id to tables that don't have it yet ──
const migrations = [
  `ALTER TABLE mood_entries ADD COLUMN user_id TEXT NOT NULL DEFAULT 'desktop_user'`,
  `ALTER TABLE crisis_events ADD COLUMN user_id TEXT NOT NULL DEFAULT 'desktop_user'`,
  `CREATE INDEX IF NOT EXISTS idx_mood_user ON mood_entries(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_crisis_user ON crisis_events(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
];

for (const sql of migrations) {
  try { db.exec(sql); } catch (_) { /* column/index already exists — safe to ignore */ }
}

console.log('[DB] Database initialized at:', dbPath);

// ── Activity log operations ────────────────────────────────────
const activityOps = {
  startSession(appName, windowTitle, category, userId = 'desktop_user') {
    const now = Date.now();
    return db.prepare(`
      INSERT INTO activity_logs (app_name, window_title, started_at, category, user_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(appName, windowTitle, now, category, userId).lastInsertRowid;
  },

  endSession(id) {
    const now = Date.now();
    db.prepare(`
      UPDATE activity_logs
      SET ended_at = ?, duration_seconds = (? - started_at) / 1000
      WHERE id = ?
    `).run(now, now, id);
  },

  getRecentActivity(hours = 24, userId = 'desktop_user') {
    const since = Date.now() - (hours * 60 * 60 * 1000);
    return db.prepare(`
      SELECT * FROM activity_logs
      WHERE started_at > ? AND user_id = ?
      ORDER BY started_at DESC
      LIMIT 100
    `).all(since, userId);
  },

  getCurrentAppDuration(appName, userId = 'desktop_user') {
    const since = Date.now() - (24 * 60 * 60 * 1000);
    const result = db.prepare(`
      SELECT SUM(duration_seconds) as total
      FROM activity_logs
      WHERE app_name = ? AND started_at > ? AND user_id = ?
    `).get(appName, since, userId);
    return result?.total || 0;
  },

  getCategoryDuration(category, hours = 24, userId = 'desktop_user') {
    const since = Date.now() - (hours * 60 * 60 * 1000);
    const result = db.prepare(`
      SELECT SUM(duration_seconds) as total
      FROM activity_logs
      WHERE category = ? AND started_at > ? AND user_id = ?
    `).get(category, since, userId);
    return result?.total || 0;
  },
};

// ── Nudge operations ───────────────────────────────────────────
const nudgeOps = {
  recordNudge(type, message, userId = 'desktop_user') {
    return db.prepare(`
      INSERT INTO nudge_history (nudge_type, message, user_id)
      VALUES (?, ?, ?)
    `).run(type, message, userId).lastInsertRowid;
  },

  getLastNudge(type, userId = 'desktop_user') {
    return db.prepare(`
      SELECT * FROM nudge_history
      WHERE nudge_type = ? AND user_id = ?
      ORDER BY sent_at DESC
      LIMIT 1
    `).get(type, userId);
  },

  shouldNudge(type, cooldownMinutes, userId = 'desktop_user') {
    const lastNudge = this.getLastNudge(type, userId);
    if (!lastNudge) return true;
    const cooldownMs = cooldownMinutes * 60 * 1000;
    const timeSince = Date.now() - (lastNudge.sent_at * 1000);
    return timeSince > cooldownMs;
  },
};

// ── Session operations ─────────────────────────────────────────
const sessionOps = {
  create(id, title = 'new session', userId = 'desktop_user') {
    db.prepare(`
      INSERT INTO sessions (id, title, user_id, created_at, updated_at)
      VALUES (?, ?, ?, strftime('%s','now'), strftime('%s','now'))
    `).run(id, title, userId);
    return { id, title };
  },

  list(userId = 'desktop_user', limit = 50) {
    return db.prepare(`
      SELECT id, title, created_at, updated_at
      FROM sessions
      WHERE user_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(userId, limit);
  },

  rename(id, title) {
    db.prepare(`
      UPDATE sessions SET title = ?, updated_at = strftime('%s','now') WHERE id = ?
    `).run(title, id);
  },

  touch(id) {
    db.prepare(`UPDATE sessions SET updated_at = strftime('%s','now') WHERE id = ?`).run(id);
  },

  delete(id) {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  },
};

// ── Message operations ─────────────────────────────────────────
const messageOps = {
  add(sessionId, role, text) {
    const info = db.prepare(`
      INSERT INTO messages (session_id, role, text) VALUES (?, ?, ?)
    `).run(sessionId, role, text);
    sessionOps.touch(sessionId);
    return info.lastInsertRowid;
  },

  listForSession(sessionId) {
    return db.prepare(`
      SELECT id, role, text, created_at FROM messages
      WHERE session_id = ? ORDER BY id ASC
    `).all(sessionId);
  },
};

// ── Connector operations ───────────────────────────────────────
// Keys are stored as `userId:connectorName` to isolate per profile.
const connectorOps = {
  upsert(key, { enabled, status, metadata } = {}) {
    const existing = db.prepare(`SELECT key FROM connectors WHERE key = ?`).get(key);
    if (existing) {
      db.prepare(`
        UPDATE connectors
        SET enabled = COALESCE(?, enabled),
            status = COALESCE(?, status),
            metadata = COALESCE(?, metadata),
            updated_at = strftime('%s','now')
        WHERE key = ?
      `).run(
        enabled === undefined ? null : (enabled ? 1 : 0),
        status ?? null,
        metadata ?? null,
        key
      );
    } else {
      db.prepare(`
        INSERT INTO connectors (key, enabled, status, metadata)
        VALUES (?, ?, ?, ?)
      `).run(key, enabled ? 1 : 0, status || 'disconnected', metadata || null);
    }
  },

  /** List connectors for a specific user (strips userId prefix from key). */
  listForUser(userId = 'desktop_user') {
    const prefix = `${userId}:`;
    return db.prepare(`
      SELECT key, enabled, status, metadata FROM connectors
      WHERE key LIKE ?
    `).all(`${prefix}%`)
      .map(r => ({ ...r, key: r.key.slice(prefix.length), enabled: !!r.enabled }));
  },

  /** Legacy list — returns all connectors without filtering. */
  list() {
    return db.prepare(`SELECT key, enabled, status, metadata FROM connectors`).all()
      .map(r => ({ ...r, enabled: !!r.enabled }));
  },

  get(key) {
    const r = db.prepare(`SELECT key, enabled, status, metadata FROM connectors WHERE key = ?`).get(key);
    return r ? { ...r, enabled: !!r.enabled } : null;
  },
};

// ── Mood operations ────────────────────────────────────────────
const moodOps = {
  log({ score, label, note, source = 'chat', session_id = null, user_id = 'desktop_user' }) {
    return db.prepare(`
      INSERT INTO mood_entries (score, label, note, source, session_id, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(score, label || null, note || null, source, session_id, user_id).lastInsertRowid;
  },

  daily(days = 30, userId = 'desktop_user') {
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    return db.prepare(`
      SELECT
        date(created_at, 'unixepoch', 'localtime') AS day,
        AVG(score) AS avg_score,
        COUNT(*) AS count
      FROM mood_entries
      WHERE created_at >= ? AND user_id = ?
      GROUP BY day
      ORDER BY day ASC
    `).all(since, userId);
  },

  recent(limit = 20, userId = 'desktop_user') {
    return db.prepare(`
      SELECT id, score, label, note, source, created_at
      FROM mood_entries
      WHERE user_id = ?
      ORDER BY id DESC LIMIT ?
    `).all(userId, limit);
  },
};

// ── Crisis operations ──────────────────────────────────────────
const crisisOps = {
  record({ severity, trigger, session_id = null, user_id = 'desktop_user' }) {
    return db.prepare(`
      INSERT INTO crisis_events (severity, trigger, session_id, user_id)
      VALUES (?, ?, ?, ?)
    `).run(severity, trigger || null, session_id, user_id).lastInsertRowid;
  },

  resolve(id) {
    db.prepare(`UPDATE crisis_events SET resolved_at = strftime('%s','now') WHERE id = ?`).run(id);
  },

  active(userId = 'desktop_user') {
    return db.prepare(`
      SELECT * FROM crisis_events
      WHERE resolved_at IS NULL AND user_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(userId);
  },

  recent(limit = 10, userId = 'desktop_user') {
    return db.prepare(`
      SELECT * FROM crisis_events WHERE user_id = ? ORDER BY id DESC LIMIT ?
    `).all(userId, limit);
  },
};

module.exports = { db, activityOps, nudgeOps, sessionOps, messageOps, connectorOps, moodOps, crisisOps };
