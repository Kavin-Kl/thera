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

  CREATE INDEX IF NOT EXISTS idx_activity_started ON activity_logs(started_at);
  CREATE INDEX IF NOT EXISTS idx_activity_app ON activity_logs(app_name);
  CREATE INDEX IF NOT EXISTS idx_nudge_sent ON nudge_history(sent_at);
`);

console.log('[DB] Database initialized at:', dbPath);

// Activity log operations
const activityOps = {
  startSession(appName, windowTitle, category) {
    const stmt = db.prepare(`
      INSERT INTO activity_logs (app_name, window_title, started_at, category)
      VALUES (?, ?, ?, ?)
    `);
    const now = Date.now();
    return stmt.run(appName, windowTitle, now, category).lastInsertRowid;
  },

  endSession(id) {
    const stmt = db.prepare(`
      UPDATE activity_logs
      SET ended_at = ?, duration_seconds = (? - started_at) / 1000
      WHERE id = ?
    `);
    const now = Date.now();
    stmt.run(now, now, id);
  },

  getRecentActivity(hours = 24) {
    const stmt = db.prepare(`
      SELECT * FROM activity_logs
      WHERE started_at > ?
      ORDER BY started_at DESC
      LIMIT 100
    `);
    const since = Date.now() - (hours * 60 * 60 * 1000);
    return stmt.all(since);
  },

  getCurrentAppDuration(appName) {
    const stmt = db.prepare(`
      SELECT SUM(duration_seconds) as total
      FROM activity_logs
      WHERE app_name = ? AND started_at > ?
    `);
    const since = Date.now() - (24 * 60 * 60 * 1000); // Last 24 hours
    const result = stmt.get(appName, since);
    return result?.total || 0;
  },

  getCategoryDuration(category, hours = 24) {
    const stmt = db.prepare(`
      SELECT SUM(duration_seconds) as total
      FROM activity_logs
      WHERE category = ? AND started_at > ?
    `);
    const since = Date.now() - (hours * 60 * 60 * 1000);
    const result = stmt.get(category, since);
    return result?.total || 0;
  }
};

// Nudge operations
const nudgeOps = {
  recordNudge(type, message) {
    const stmt = db.prepare(`
      INSERT INTO nudge_history (nudge_type, message)
      VALUES (?, ?)
    `);
    return stmt.run(type, message).lastInsertRowid;
  },

  getLastNudge(type) {
    const stmt = db.prepare(`
      SELECT * FROM nudge_history
      WHERE nudge_type = ?
      ORDER BY sent_at DESC
      LIMIT 1
    `);
    return stmt.get(type);
  },

  shouldNudge(type, cooldownMinutes) {
    const lastNudge = this.getLastNudge(type);
    if (!lastNudge) return true;

    const cooldownMs = cooldownMinutes * 60 * 1000;
    const timeSince = Date.now() - (lastNudge.sent_at * 1000);
    return timeSince > cooldownMs;
  }
};

module.exports = { db, activityOps, nudgeOps };
