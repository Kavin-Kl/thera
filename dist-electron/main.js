//#region \0rolldown/runtime.js
var __commonJSMin = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
//#endregion
//#region electron/settings.js
var require_settings = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* Simple persistent settings for Thera.
	* Stored as JSON next to the .env in the project root.
	*/
	var fs$3 = require("fs");
	var SETTINGS_PATH = require("path").join(process.cwd(), ".thera-settings.json");
	var DEFAULTS = { nsfwMode: false };
	var _settings = { ...DEFAULTS };
	function load() {
		try {
			const raw = fs$3.readFileSync(SETTINGS_PATH, "utf8");
			_settings = {
				...DEFAULTS,
				...JSON.parse(raw)
			};
		} catch (_) {}
	}
	function save() {
		try {
			fs$3.writeFileSync(SETTINGS_PATH, JSON.stringify(_settings, null, 2));
		} catch (e) {
			console.error("[SETTINGS] Failed to save:", e.message);
		}
	}
	function get(key) {
		return key ? _settings[key] : { ..._settings };
	}
	function set(key, value) {
		_settings[key] = value;
		save();
		console.log(`[SETTINGS] ${key} = ${value}`);
	}
	load();
	module.exports = {
		get,
		set
	};
}));
//#endregion
//#region electron/db/localDb.js
var require_localDb = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Database = require("better-sqlite3");
	var path$3 = require("path");
	var { app: app$2 } = require("electron");
	var dbPath = path$3.join(app$2.getPath("userData"), "thera.db");
	var db = new Database(dbPath);
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
    score INTEGER NOT NULL,           -- -2..+2
    label TEXT,                       -- low / flat / ok / good / great
    note TEXT,
    source TEXT,                      -- 'chat' | 'manual' | 'ritual'
    session_id TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS crisis_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    severity TEXT NOT NULL,           -- 'amber' | 'red'
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
	console.log("[DB] Database initialized at:", dbPath);
	var activityOps = {
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
			const since = Date.now() - hours * 60 * 60 * 1e3;
			return stmt.all(since);
		},
		getCurrentAppDuration(appName) {
			const stmt = db.prepare(`
      SELECT SUM(duration_seconds) as total
      FROM activity_logs
      WHERE app_name = ? AND started_at > ?
    `);
			const since = Date.now() - 1440 * 60 * 1e3;
			return stmt.get(appName, since)?.total || 0;
		},
		getCategoryDuration(category, hours = 24) {
			const stmt = db.prepare(`
      SELECT SUM(duration_seconds) as total
      FROM activity_logs
      WHERE category = ? AND started_at > ?
    `);
			const since = Date.now() - hours * 60 * 60 * 1e3;
			return stmt.get(category, since)?.total || 0;
		}
	};
	var nudgeOps = {
		recordNudge(type, message) {
			return db.prepare(`
      INSERT INTO nudge_history (nudge_type, message)
      VALUES (?, ?)
    `).run(type, message).lastInsertRowid;
		},
		getLastNudge(type) {
			return db.prepare(`
      SELECT * FROM nudge_history
      WHERE nudge_type = ?
      ORDER BY sent_at DESC
      LIMIT 1
    `).get(type);
		},
		shouldNudge(type, cooldownMinutes) {
			const lastNudge = this.getLastNudge(type);
			if (!lastNudge) return true;
			const cooldownMs = cooldownMinutes * 60 * 1e3;
			return Date.now() - lastNudge.sent_at * 1e3 > cooldownMs;
		}
	};
	var sessionOps = {
		create(id, title = "new session") {
			db.prepare(`
      INSERT INTO sessions (id, title, created_at, updated_at)
      VALUES (?, ?, strftime('%s','now'), strftime('%s','now'))
    `).run(id, title);
			return {
				id,
				title
			};
		},
		list(limit = 50) {
			return db.prepare(`
      SELECT id, title, created_at, updated_at
      FROM sessions
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(limit);
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
		}
	};
	module.exports = {
		db,
		activityOps,
		nudgeOps,
		sessionOps,
		messageOps: {
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
			}
		},
		connectorOps: {
			upsert(key, { enabled, status, metadata } = {}) {
				if (db.prepare(`SELECT key FROM connectors WHERE key = ?`).get(key)) db.prepare(`
        UPDATE connectors
        SET enabled = COALESCE(?, enabled),
            status = COALESCE(?, status),
            metadata = COALESCE(?, metadata),
            updated_at = strftime('%s','now')
        WHERE key = ?
      `).run(enabled === void 0 ? null : enabled ? 1 : 0, status ?? null, metadata ?? null, key);
				else db.prepare(`
        INSERT INTO connectors (key, enabled, status, metadata)
        VALUES (?, ?, ?, ?)
      `).run(key, enabled ? 1 : 0, status || "disconnected", metadata || null);
			},
			list() {
				return db.prepare(`SELECT key, enabled, status, metadata FROM connectors`).all().map((r) => ({
					...r,
					enabled: !!r.enabled
				}));
			},
			get(key) {
				const r = db.prepare(`SELECT key, enabled, status, metadata FROM connectors WHERE key = ?`).get(key);
				return r ? {
					...r,
					enabled: !!r.enabled
				} : null;
			}
		},
		moodOps: {
			log({ score, label, note, source = "chat", session_id = null }) {
				return db.prepare(`
      INSERT INTO mood_entries (score, label, note, source, session_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(score, label || null, note || null, source, session_id).lastInsertRowid;
			},
			daily(days = 30) {
				const since = Math.floor(Date.now() / 1e3) - days * 86400;
				return db.prepare(`
      SELECT
        date(created_at, 'unixepoch', 'localtime') AS day,
        AVG(score) AS avg_score,
        COUNT(*) AS count
      FROM mood_entries
      WHERE created_at >= ?
      GROUP BY day
      ORDER BY day ASC
    `).all(since);
			},
			recent(limit = 20) {
				return db.prepare(`
      SELECT id, score, label, note, source, created_at
      FROM mood_entries ORDER BY id DESC LIMIT ?
    `).all(limit);
			}
		},
		crisisOps: {
			record({ severity, trigger, session_id = null }) {
				return db.prepare(`
      INSERT INTO crisis_events (severity, trigger, session_id)
      VALUES (?, ?, ?)
    `).run(severity, trigger || null, session_id).lastInsertRowid;
			},
			resolve(id) {
				db.prepare(`UPDATE crisis_events SET resolved_at = strftime('%s','now') WHERE id = ?`).run(id);
			},
			active() {
				return db.prepare(`
      SELECT * FROM crisis_events WHERE resolved_at IS NULL ORDER BY id DESC LIMIT 1
    `).get();
			},
			recent(limit = 10) {
				return db.prepare(`SELECT * FROM crisis_events ORDER BY id DESC LIMIT ?`).all(limit);
			}
		}
	};
}));
//#endregion
//#region electron/connectors/tokenStore.js
var require_tokenStore = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* Token storage for connector OAuth credentials.
	*
	* Stored as a JSON file in the userData directory. Not encrypted on disk —
	* good enough for a local-first desktop companion. If you need hardening,
	* swap this for safeStorage.encryptString later.
	*/
	var fs$2 = require("fs");
	var path$2 = require("path");
	var { app: app$1, safeStorage } = require("electron");
	var TOKEN_PATH = path$2.join(app$1.getPath("userData"), "thera-tokens.json");
	var cache = null;
	function load() {
		if (cache) return cache;
		try {
			const raw = fs$2.readFileSync(TOKEN_PATH, "utf8");
			let parsed = JSON.parse(raw);
			if (parsed.__encrypted && safeStorage && safeStorage.isEncryptionAvailable()) {
				const buf = Buffer.from(parsed.payload, "base64");
				parsed = JSON.parse(safeStorage.decryptString(buf));
			}
			cache = parsed || {};
		} catch (_) {
			cache = {};
		}
		return cache;
	}
	function save() {
		try {
			let payload;
			if (safeStorage && safeStorage.isEncryptionAvailable()) {
				const enc = safeStorage.encryptString(JSON.stringify(cache));
				payload = JSON.stringify({
					__encrypted: true,
					payload: enc.toString("base64")
				});
			} else payload = JSON.stringify(cache, null, 2);
			fs$2.writeFileSync(TOKEN_PATH, payload);
		} catch (e) {
			console.error("[TOKENS] Failed to save:", e.message);
		}
	}
	function get(provider) {
		return load()[provider] || null;
	}
	function set(provider, tokens) {
		const all = load();
		all[provider] = {
			...tokens,
			_savedAt: Date.now()
		};
		cache = all;
		save();
	}
	function clear(provider) {
		const all = load();
		delete all[provider];
		cache = all;
		save();
	}
	module.exports = {
		get,
		set,
		clear
	};
}));
//#endregion
//#region electron/connectors/oauthLoopback.js
var require_oauthLoopback = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* Tiny loopback HTTP server used to receive OAuth redirects.
	*
	* Used by every OAuth provider (Google, Spotify, Slack). Listens on a
	* random ephemeral port, waits for the first request matching `path`,
	* resolves with the parsed query string, then shuts itself down.
	*/
	var http = require("http");
	var url = require("url");
	/**
	* Higher-level helper: starts the loopback, calls `buildAuthUrl(port)` to get
	* the URL to open in the browser, opens it, and returns the OAuth callback query.
	*/
	async function runOAuthFlow({ buildAuthUrl, callbackPath = "/oauth/callback", fixedPort = 0 }) {
		const { shell } = require("electron");
		return new Promise((resolve, reject) => {
			const server = http.createServer((req, res) => {
				const parsed = url.parse(req.url, true);
				if (parsed.pathname !== callbackPath) {
					res.writeHead(404);
					res.end();
					return;
				}
				const { query } = parsed;
				res.writeHead(200, { "Content-Type": "text/html" });
				res.end(`
        <!doctype html><html><head><meta charset="utf-8"><title>thera</title>
        <style>
          body { font-family: -apple-system, system-ui, sans-serif; background:#18120a; color:#f0e6d2;
                 display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
          h1 { color:#e8603a; font-weight:600; letter-spacing:-0.5px; }
          p { color:#8a7256; }
        </style></head>
        <body><div style="text-align:center">
          <h1>${query.error ? "something went wrong" : "all good. you can close this tab."}</h1>
          <p>${query.error ? String(query.error) : "thera has the keys."}</p>
        </div></body></html>
      `);
				server.close();
				clearTimeout(timer);
				if (query.error) reject(new Error(String(query.error)));
				else resolve(query);
			});
			const timer = setTimeout(() => {
				server.close();
				reject(/* @__PURE__ */ new Error("OAuth timed out after 5 min"));
			}, 300 * 1e3);
			server.on("error", (err) => {
				clearTimeout(timer);
				if (err.code === "EADDRINUSE") reject(/* @__PURE__ */ new Error(`Port ${fixedPort} is already in use. Close the app using it and try again.`));
				else reject(err);
			});
			server.listen(fixedPort, "127.0.0.1", async () => {
				const { port } = server.address();
				try {
					const authUrl = await buildAuthUrl(port);
					await shell.openExternal(authUrl);
				} catch (e) {
					server.close();
					clearTimeout(timer);
					reject(e);
				}
			});
		});
	}
	module.exports = { runOAuthFlow };
}));
//#endregion
//#region electron/connectors/google.js
var require_google = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* Google OAuth + API client.
	*
	* One OAuth flow grants access to Gmail, Calendar, Contacts, Drive, Docs, Sheets.
	* Tokens are persisted via tokenStore. The exported `getClient()` returns an
	* authorized OAuth2 client ready to pass into googleapis services.
	*/
	var { google: google$2 } = require("googleapis");
	var tokenStore = require_tokenStore();
	var { runOAuthFlow } = require_oauthLoopback();
	var SCOPES = [
		"https://www.googleapis.com/auth/gmail.readonly",
		"https://www.googleapis.com/auth/gmail.send",
		"https://www.googleapis.com/auth/gmail.compose",
		"https://www.googleapis.com/auth/calendar",
		"https://www.googleapis.com/auth/contacts.readonly",
		"https://www.googleapis.com/auth/contacts.other.readonly",
		"https://www.googleapis.com/auth/drive.readonly",
		"https://www.googleapis.com/auth/documents",
		"https://www.googleapis.com/auth/spreadsheets",
		"https://www.googleapis.com/auth/userinfo.email"
	];
	function hasCredentials() {
		return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CLIENT_ID !== "your_google_oauth_client_id");
	}
	function makeClient(redirectUri) {
		return new google$2.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri);
	}
	async function connect() {
		if (!hasCredentials()) throw new Error("Google OAuth not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env");
		let capturedRedirect = null;
		const query = await runOAuthFlow({ buildAuthUrl: (port) => {
			capturedRedirect = `http://127.0.0.1:${port}/oauth/callback`;
			return makeClient(capturedRedirect).generateAuthUrl({
				access_type: "offline",
				prompt: "consent",
				scope: SCOPES
			});
		} });
		const { tokens } = await makeClient(capturedRedirect).getToken(query.code);
		tokenStore.set("google", tokens);
		return tokens;
	}
	function disconnect() {
		tokenStore.clear("google");
	}
	function isConnected() {
		return !!tokenStore.get("google");
	}
	/** Returns an authorized OAuth2 client. Auto-persists refreshed tokens. */
	function getClient() {
		const tokens = tokenStore.get("google");
		if (!tokens) throw new Error("Google not connected");
		const client = makeClient();
		client.setCredentials(tokens);
		client.on("tokens", (newTokens) => {
			const merged = {
				...tokenStore.get("google"),
				...newTokens
			};
			tokenStore.set("google", merged);
		});
		return client;
	}
	/** Returns the authenticated user's email address. Cached after first call. */
	var _cachedEmail = null;
	async function getUserEmail() {
		if (_cachedEmail) return _cachedEmail;
		const auth = getClient();
		_cachedEmail = (await google$2.oauth2({
			version: "v2",
			auth
		}).userinfo.get()).data.email;
		return _cachedEmail;
	}
	var _origDisconnect = disconnect;
	function disconnectAndClear() {
		_cachedEmail = null;
		_origDisconnect();
	}
	module.exports = {
		connect,
		disconnect: disconnectAndClear,
		isConnected,
		getClient,
		hasCredentials,
		getUserEmail
	};
}));
//#endregion
//#region electron/connectors/spotify.js
var require_spotify = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* Spotify OAuth (Authorization Code flow) + thin REST helper.
	*
	* Uses raw fetch — no SDK dependency. Tokens auto-refresh on 401.
	*/
	var tokenStore = require_tokenStore();
	var { runOAuthFlow } = require_oauthLoopback();
	var SCOPES = [
		"user-read-playback-state",
		"user-modify-playback-state",
		"user-read-currently-playing",
		"playlist-read-private",
		"user-library-read"
	].join(" ");
	function hasCredentials() {
		return !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET && process.env.SPOTIFY_CLIENT_ID !== "your_spotify_client_id");
	}
	async function connect() {
		if (!hasCredentials()) throw new Error("Spotify OAuth not configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env");
		const REDIRECT_URI = "http://127.0.0.1:51234/oauth/callback";
		const query = await runOAuthFlow({
			fixedPort: 51234,
			buildAuthUrl: () => {
				return `https://accounts.spotify.com/authorize?${new URLSearchParams({
					response_type: "code",
					client_id: process.env.SPOTIFY_CLIENT_ID,
					scope: SCOPES,
					redirect_uri: REDIRECT_URI
				})}`;
			}
		});
		const body = new URLSearchParams({
			grant_type: "authorization_code",
			code: query.code,
			redirect_uri: REDIRECT_URI
		});
		const auth = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString("base64");
		const res = await fetch("https://accounts.spotify.com/api/token", {
			method: "POST",
			headers: {
				"Authorization": `Basic ${auth}`,
				"Content-Type": "application/x-www-form-urlencoded"
			},
			body
		});
		if (!res.ok) throw new Error(`Spotify token exchange failed: ${res.status} ${await res.text()}`);
		const tokens = await res.json();
		tokens.expires_at = Date.now() + tokens.expires_in * 1e3;
		tokenStore.set("spotify", tokens);
		return tokens;
	}
	function disconnect() {
		tokenStore.clear("spotify");
	}
	function isConnected() {
		return !!tokenStore.get("spotify");
	}
	async function refreshIfNeeded() {
		const tokens = tokenStore.get("spotify");
		if (!tokens) throw new Error("Spotify not connected");
		if (tokens.expires_at && Date.now() < tokens.expires_at - 3e4) return tokens.access_token;
		const auth = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString("base64");
		const res = await fetch("https://accounts.spotify.com/api/token", {
			method: "POST",
			headers: {
				"Authorization": `Basic ${auth}`,
				"Content-Type": "application/x-www-form-urlencoded"
			},
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: tokens.refresh_token
			})
		});
		if (!res.ok) throw new Error(`Spotify refresh failed: ${res.status}`);
		const fresh = await res.json();
		const merged = {
			...tokens,
			...fresh,
			expires_at: Date.now() + fresh.expires_in * 1e3
		};
		tokenStore.set("spotify", merged);
		return merged.access_token;
	}
	/** Authorized fetch wrapper. */
	async function api(pathOrUrl, { method = "GET", body, query } = {}) {
		const token = await refreshIfNeeded();
		let url = pathOrUrl.startsWith("http") ? pathOrUrl : `https://api.spotify.com/v1${pathOrUrl}`;
		if (query) url += "?" + new URLSearchParams(query);
		const res = await fetch(url, {
			method,
			headers: {
				"Authorization": `Bearer ${token}`,
				...body ? { "Content-Type": "application/json" } : {}
			},
			body: body ? JSON.stringify(body) : void 0
		});
		if (res.status === 204) return null;
		if (!res.ok) throw new Error(`Spotify API ${res.status}: ${await res.text()}`);
		return (res.headers.get("content-type") || "").includes("json") ? res.json() : res.text();
	}
	module.exports = {
		connect,
		disconnect,
		isConnected,
		hasCredentials,
		api
	};
}));
//#endregion
//#region electron/connectors/slack.js
var require_slack = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* Slack OAuth (v2) + thin REST helper.
	*/
	var tokenStore = require_tokenStore();
	var { runOAuthFlow } = require_oauthLoopback();
	var SCOPES = [
		"chat:write",
		"channels:read",
		"channels:history",
		"groups:read",
		"im:read",
		"im:write",
		"users:read",
		"search:read"
	].join(",");
	function hasCredentials() {
		return !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET && process.env.SLACK_CLIENT_ID !== "your_slack_client_id");
	}
	async function connect() {
		if (!hasCredentials()) throw new Error("Slack OAuth not configured. Add SLACK_CLIENT_ID and SLACK_CLIENT_SECRET to .env");
		let capturedRedirect = null;
		const query = await runOAuthFlow({ buildAuthUrl: (port) => {
			capturedRedirect = `http://127.0.0.1:${port}/oauth/callback`;
			return `https://slack.com/oauth/v2/authorize?${new URLSearchParams({
				client_id: process.env.SLACK_CLIENT_ID,
				user_scope: SCOPES,
				redirect_uri: capturedRedirect
			})}`;
		} });
		const body = new URLSearchParams({
			client_id: process.env.SLACK_CLIENT_ID,
			client_secret: process.env.SLACK_CLIENT_SECRET,
			code: query.code,
			redirect_uri: capturedRedirect
		});
		const data = await (await fetch("https://slack.com/api/oauth.v2.access", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body
		})).json();
		if (!data.ok) throw new Error(`Slack token exchange failed: ${data.error}`);
		const tokens = {
			access_token: data.authed_user?.access_token || data.access_token,
			user_id: data.authed_user?.id,
			team: data.team,
			raw: data
		};
		tokenStore.set("slack", tokens);
		return tokens;
	}
	function disconnect() {
		tokenStore.clear("slack");
	}
	function isConnected() {
		return !!tokenStore.get("slack");
	}
	async function api(method, params = {}) {
		const tokens = tokenStore.get("slack");
		if (!tokens) throw new Error("Slack not connected");
		const data = await (await fetch(`https://slack.com/api/${method}`, {
			method: "POST",
			headers: {
				"Authorization": `Bearer ${tokens.access_token}`,
				"Content-Type": "application/json; charset=utf-8"
			},
			body: JSON.stringify(params)
		})).json();
		if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error}`);
		return data;
	}
	module.exports = {
		connect,
		disconnect,
		isConnected,
		hasCredentials,
		api
	};
}));
//#endregion
//#region electron/connectors/actions.js
var require_actions = /* @__PURE__ */ __commonJSMin(((exports, module) => {
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
	var { google: google$1 } = require("googleapis");
	var googleAuth = require_google();
	var spotify = require_spotify();
	var slack = require_slack();
	var { db } = require_localDb();
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
	var FAKE_DOMAINS = [
		"@example.com",
		"@example.org",
		"@test.com",
		"@placeholder.com"
	];
	var FAKE_EMAIL_RE = /[\w.+-]+@(example|test|placeholder)\.(com|org|net)/i;
	/** Resolve "myself", "me", first-name-only, etc. to a real email address. */
	async function resolveRecipient(to) {
		if (!to) throw new Error("No recipient specified");
		const isFake = FAKE_DOMAINS.some((d) => to.trim().toLowerCase().endsWith(d));
		const stripped = isFake ? to.trim().split("@")[0] : to.trim();
		const lower = stripped.toLowerCase();
		if (lower === "myself" || lower === "me") return await googleAuth.getUserEmail();
		if (!isFake && lower.includes("@")) return to;
		try {
			const contacts = await contactsSearch({ query: to });
			if (contacts.length > 0 && contacts[0].email) return contacts[0].email;
		} catch (e) {
			console.warn("[ACTIONS] contacts lookup failed for", to, e.message);
		}
		try {
			const auth = googleAuth.getClient();
			const gmail = google$1.gmail({
				version: "v1",
				auth
			});
			const myEmail = await googleAuth.getUserEmail();
			const messages = (await gmail.users.messages.list({
				userId: "me",
				q: stripped,
				maxResults: 10
			})).data.messages || [];
			for (const m of messages) {
				const msg = await gmail.users.messages.get({
					userId: "me",
					id: m.id,
					format: "metadata",
					metadataHeaders: [
						"From",
						"To",
						"Cc"
					]
				});
				const headers = Object.fromEntries((msg.data.payload?.headers || []).map((h) => [h.name, h.value]));
				const allAddresses = [
					headers.From,
					headers.To,
					headers.Cc
				].filter(Boolean).join(" ");
				const pairs = [...allAddresses.matchAll(/([^<,;]+?)\s*<([^>]+@[^>]+)>/g)];
				for (const pair of pairs) {
					const name = pair[1].trim().toLowerCase();
					const email = pair[2].trim();
					if (email === myEmail) continue;
					if (FAKE_EMAIL_RE.test(email)) continue;
					if (name.includes(lower) || lower.includes(name.split(" ")[0])) {
						console.log("[ACTIONS] resolved", stripped, "→", email, "via gmail history");
						return email;
					}
				}
				const bareEmails = allAddresses.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || [];
				for (const email of bareEmails) {
					if (email === myEmail) continue;
					if (FAKE_EMAIL_RE.test(email)) continue;
					if (email.toLowerCase().includes(lower.split(" ")[0])) {
						console.log("[ACTIONS] resolved", stripped, "→", email, "via gmail bare match");
						return email;
					}
				}
			}
		} catch (e) {
			console.warn("[ACTIONS] gmail history lookup failed for", to, e.message);
		}
		throw new Error(`no email address found for "${to}" — ask the user for their email`);
	}
	function buildRawEmail({ to, subject, body }) {
		const lines = [
			`To: ${to}`,
			`Subject: ${subject}`,
			"Content-Type: text/plain; charset=utf-8",
			"",
			body || ""
		];
		return Buffer.from(lines.join("\r\n")).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	}
	async function gmailSend({ to, subject, body }) {
		const resolvedTo = await resolveRecipient(to);
		const auth = googleAuth.getClient();
		const gmail = google$1.gmail({
			version: "v1",
			auth
		});
		const raw = buildRawEmail({
			to: resolvedTo,
			subject,
			body
		});
		const res = await gmail.users.messages.send({
			userId: "me",
			requestBody: { raw }
		});
		return {
			id: res.data.id,
			threadId: res.data.threadId
		};
	}
	async function gmailDraft({ to, subject, body }) {
		const resolvedTo = await resolveRecipient(to);
		const auth = googleAuth.getClient();
		const gmail = google$1.gmail({
			version: "v1",
			auth
		});
		const raw = buildRawEmail({
			to: resolvedTo,
			subject,
			body
		});
		return { id: (await gmail.users.drafts.create({
			userId: "me",
			requestBody: { message: { raw } }
		})).data.id };
	}
	async function gmailSearch({ query, max = 10 }) {
		const auth = googleAuth.getClient();
		const gmail = google$1.gmail({
			version: "v1",
			auth
		});
		const messages = (await gmail.users.messages.list({
			userId: "me",
			q: query,
			maxResults: max
		})).data.messages || [];
		return (await Promise.all(messages.map((m) => gmail.users.messages.get({
			userId: "me",
			id: m.id,
			format: "metadata",
			metadataHeaders: [
				"From",
				"Subject",
				"Date"
			]
		})))).map((d) => {
			const headers = Object.fromEntries((d.data.payload?.headers || []).map((h) => [h.name, h.value]));
			return {
				id: d.data.id,
				from: headers.From,
				subject: headers.Subject,
				date: headers.Date,
				snippet: d.data.snippet
			};
		});
	}
	async function gcalCreate({ summary, start, end, description, attendees }) {
		const auth = googleAuth.getClient();
		const calendar = google$1.calendar({
			version: "v3",
			auth
		});
		let timeZone;
		try {
			timeZone = (await calendar.calendars.get({ calendarId: "primary" })).data.timeZone;
		} catch (_) {}
		timeZone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
		const res = await calendar.events.insert({
			calendarId: "primary",
			requestBody: {
				summary,
				description,
				start: {
					dateTime: start,
					timeZone
				},
				end: {
					dateTime: end,
					timeZone
				},
				attendees: (attendees || []).map((email) => ({ email }))
			}
		});
		return {
			id: res.data.id,
			link: res.data.htmlLink
		};
	}
	async function gcalList({ max = 10, timeMin, timeMax }) {
		const auth = googleAuth.getClient();
		return ((await google$1.calendar({
			version: "v3",
			auth
		}).events.list({
			calendarId: "primary",
			timeMin: timeMin || (/* @__PURE__ */ new Date()).toISOString(),
			timeMax,
			maxResults: max,
			singleEvents: true,
			orderBy: "startTime"
		})).data.items || []).map((e) => ({
			id: e.id,
			summary: e.summary,
			start: e.start?.dateTime || e.start?.date,
			end: e.end?.dateTime || e.end?.date,
			location: e.location
		}));
	}
	async function contactsSearch({ query }) {
		const auth = googleAuth.getClient();
		const people = google$1.people({
			version: "v1",
			auth
		});
		let results = [];
		try {
			results = ((await people.people.searchContacts({
				query,
				readMask: "names,emailAddresses,phoneNumbers"
			})).data.results || []).map((r) => ({
				name: r.person?.names?.[0]?.displayName,
				email: r.person?.emailAddresses?.[0]?.value,
				phone: r.person?.phoneNumbers?.[0]?.value
			})).filter((r) => r.email);
		} catch (_) {}
		if (results.length === 0) try {
			results = ((await people.otherContacts.search({
				query,
				readMask: "names,emailAddresses"
			})).data.results || []).map((r) => ({
				name: r.person?.names?.[0]?.displayName,
				email: r.person?.emailAddresses?.[0]?.value
			})).filter((r) => r.email);
		} catch (_) {}
		return results;
	}
	async function driveSearch({ query, max = 10 }) {
		const auth = googleAuth.getClient();
		return (await google$1.drive({
			version: "v3",
			auth
		}).files.list({
			q: `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`,
			pageSize: max,
			fields: "files(id, name, mimeType, modifiedTime, webViewLink)"
		})).data.files || [];
	}
	async function docsCreate({ title, content }) {
		const auth = googleAuth.getClient();
		const docs = google$1.docs({
			version: "v1",
			auth
		});
		const created = await docs.documents.create({ requestBody: { title } });
		if (content) await docs.documents.batchUpdate({
			documentId: created.data.documentId,
			requestBody: { requests: [{ insertText: {
				location: { index: 1 },
				text: content
			} }] }
		});
		return {
			id: created.data.documentId,
			link: `https://docs.google.com/document/d/${created.data.documentId}`
		};
	}
	async function sheetsRead({ spreadsheetId, range }) {
		const auth = googleAuth.getClient();
		return (await google$1.sheets({
			version: "v4",
			auth
		}).spreadsheets.values.get({
			spreadsheetId,
			range
		})).data.values || [];
	}
	async function spotifyPlay({ query, uri } = {}) {
		if (query) {
			const track = (await spotify.api("/search", { query: {
				q: query,
				type: "track",
				limit: 1
			} }))?.tracks?.items?.[0];
			if (!track) throw new Error(`No track found for "${query}"`);
			await spotify.api("/me/player/play", {
				method: "PUT",
				body: { uris: [track.uri] }
			});
			return {
				track: track.name,
				artist: track.artists?.map((a) => a.name).join(", ")
			};
		}
		if (uri) {
			await spotify.api("/me/player/play", {
				method: "PUT",
				body: { uris: [uri] }
			});
			return { ok: true };
		}
		await spotify.api("/me/player/play", { method: "PUT" });
		return { ok: true };
	}
	async function spotifyPause() {
		await spotify.api("/me/player/pause", { method: "PUT" });
		return { ok: true };
	}
	async function spotifyNext() {
		await spotify.api("/me/player/next", { method: "POST" });
		return { ok: true };
	}
	async function spotifyPrevious() {
		await spotify.api("/me/player/previous", { method: "POST" });
		return { ok: true };
	}
	async function spotifyQueue({ uri }) {
		await spotify.api("/me/player/queue", {
			method: "POST",
			query: { uri }
		});
		return { ok: true };
	}
	async function spotifySearch({ query, type = "track" }) {
		return await spotify.api("/search", { query: {
			q: query,
			type,
			limit: 10
		} });
	}
	async function slackSend({ channel, text }) {
		return slack.api("chat.postMessage", {
			channel,
			text
		});
	}
	async function slackSearch({ query }) {
		return slack.api("search.messages", { query });
	}
	async function sendExtensionCommand(cmd) {
		const http = require("http");
		console.log("[ACTIONS] sendExtensionCommand:", cmd.type, "taskId:", cmd.taskId);
		return new Promise((resolve, reject) => {
			const body = JSON.stringify(cmd);
			const req = http.request({
				hostname: "127.0.0.1",
				port: 7979,
				path: "/ext-command",
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(body)
				}
			}, (res) => {
				let d = "";
				res.on("data", (c) => d += c);
				res.on("end", () => {
					console.log("[ACTIONS] sendExtensionCommand response status:", res.statusCode, "body:", d.slice(0, 100));
					try {
						resolve(JSON.parse(d || "{}"));
					} catch (_) {
						resolve({});
					}
				});
			});
			req.on("error", (e) => {
				console.error("[ACTIONS] sendExtensionCommand FAILED (bridge not running?):", e.message);
				reject(e);
			});
			req.setTimeout(5e3, () => {
				console.error("[ACTIONS] sendExtensionCommand timed out after 5s");
				req.destroy(/* @__PURE__ */ new Error("timeout"));
			});
			req.write(body);
			req.end();
		});
	}
	async function browserOpen({ url, newTab = true }) {
		await sendExtensionCommand({
			type: "open-url",
			url,
			newTab
		});
		return { opened: url };
	}
	async function browserSearch({ query, engine = "google" }) {
		const engines = {
			google: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
			youtube: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
			maps: `https://www.google.com/maps/search/${encodeURIComponent(query)}`,
			amazon: `https://www.amazon.in/s?k=${encodeURIComponent(query)}`,
			zomato: `https://www.zomato.com/search?q=${encodeURIComponent(query)}`,
			bookmyshow: `https://in.bookmyshow.com/explore/movies?query=${encodeURIComponent(query)}`
		};
		const url = engines[engine] || engines.google;
		await sendExtensionCommand({
			type: "open-url",
			url,
			newTab: true
		});
		return { opened: url };
	}
	async function browserWhatsappDm({ to, message }) {
		const taskId = `wa_${Date.now()}`;
		await sendExtensionCommand({
			type: "whatsapp-dm",
			to,
			message,
			taskId
		});
		return {
			sent: true,
			to,
			platform: "whatsapp",
			taskId
		};
	}
	async function browserInstagramDm({ to, message }) {
		const taskId = `ig_${Date.now()}`;
		await sendExtensionCommand({
			type: "instagram-dm",
			to,
			message,
			taskId
		});
		return {
			sent: true,
			to,
			platform: "instagram",
			taskId
		};
	}
	async function browserAutomate({ url, steps, waitAfterNav }) {
		await sendExtensionCommand({
			type: "automate",
			url,
			steps,
			waitAfterNav,
			taskId: `task_${Date.now()}`
		});
		return { ok: true };
	}
	function reminderCreate({ text, when }) {
		const dueAt = when ? Math.floor(new Date(when).getTime() / 1e3) : null;
		return { id: db.prepare(`INSERT INTO reminders (text, due_at) VALUES (?, ?)`).run(text, dueAt).lastInsertRowid };
	}
	function noteCreate({ text }) {
		return { id: db.prepare(`INSERT INTO notes (text) VALUES (?)`).run(text).lastInsertRowid };
	}
	var HANDLERS = {
		"gmail.send": gmailSend,
		"gmail.draft": gmailDraft,
		"gmail.search": gmailSearch,
		"gcal.create": gcalCreate,
		"gcal.list": gcalList,
		"gcontacts.search": contactsSearch,
		"gdrive.search": driveSearch,
		"gdocs.create": docsCreate,
		"gsheets.read": sheetsRead,
		"spotify.play": spotifyPlay,
		"spotify.pause": spotifyPause,
		"spotify.next": spotifyNext,
		"spotify.previous": spotifyPrevious,
		"spotify.queue": spotifyQueue,
		"spotify.search": spotifySearch,
		"slack.send": slackSend,
		"slack.search": slackSearch,
		"reminders.create": reminderCreate,
		"notes.create": noteCreate,
		"browser.open": browserOpen,
		"browser.search": browserSearch,
		"browser.whatsapp.dm": browserWhatsappDm,
		"browser.instagram.dm": browserInstagramDm,
		"browser.automate": browserAutomate
	};
	async function execute({ type, params = {} }) {
		const handler = HANDLERS[type];
		if (!handler) throw new Error(`Unknown action: ${type}`);
		try {
			return {
				ok: true,
				result: await handler(params)
			};
		} catch (e) {
			console.error(`[ACTIONS] ${type} failed:`, e.message);
			return {
				ok: false,
				error: e.message
			};
		}
	}
	module.exports = {
		execute,
		HANDLERS
	};
}));
//#endregion
//#region electron/widgetActions.js
var require_widgetActions = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	* WIDGET QUICK ACTIONS
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	*
	* Actions that can be triggered from the widget (nudges + mini chat)
	* - Change Spotify song
	* - Pause/resume music
	* - Snooze reminders
	* - Quick replies
	*
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	*/
	var spotify = require_spotify();
	/**
	* Skip to next track
	*/
	async function spotifyNext() {
		try {
			if (!spotify.isConnected()) return {
				ok: false,
				error: "Spotify not connected"
			};
			await spotify.api("/me/player/next", { method: "POST" });
			await new Promise((resolve) => setTimeout(resolve, 500));
			const player = await spotify.api("/me/player");
			if (player?.item) return {
				ok: true,
				track: player.item.name,
				artist: player.item.artists?.map((a) => a.name).join(", ") || "Unknown"
			};
			return { ok: true };
		} catch (e) {
			console.error("[WIDGET:SPOTIFY] Skip failed:", e.message);
			return {
				ok: false,
				error: e.message
			};
		}
	}
	/**
	* Go to previous track
	*/
	async function spotifyPrevious() {
		try {
			if (!spotify.isConnected()) return {
				ok: false,
				error: "Spotify not connected"
			};
			await spotify.api("/me/player/previous", { method: "POST" });
			await new Promise((resolve) => setTimeout(resolve, 500));
			const player = await spotify.api("/me/player");
			if (player?.item) return {
				ok: true,
				track: player.item.name,
				artist: player.item.artists?.map((a) => a.name).join(", ") || "Unknown"
			};
			return { ok: true };
		} catch (e) {
			console.error("[WIDGET:SPOTIFY] Previous failed:", e.message);
			return {
				ok: false,
				error: e.message
			};
		}
	}
	/**
	* Toggle play/pause
	*/
	async function spotifyToggle() {
		try {
			if (!spotify.isConnected()) return {
				ok: false,
				error: "Spotify not connected"
			};
			if ((await spotify.api("/me/player"))?.is_playing) {
				await spotify.api("/me/player/pause", { method: "PUT" });
				return {
					ok: true,
					action: "paused"
				};
			} else {
				await spotify.api("/me/player/play", { method: "PUT" });
				return {
					ok: true,
					action: "playing"
				};
			}
		} catch (e) {
			console.error("[WIDGET:SPOTIFY] Toggle failed:", e.message);
			return {
				ok: false,
				error: e.message
			};
		}
	}
	/**
	* Turn off repeat (when user is looping)
	*/
	async function spotifyDisableRepeat() {
		try {
			if (!spotify.isConnected()) return {
				ok: false,
				error: "Spotify not connected"
			};
			await spotify.api("/me/player/repeat?state=off", { method: "PUT" });
			return { ok: true };
		} catch (e) {
			console.error("[WIDGET:SPOTIFY] Disable repeat failed:", e.message);
			return {
				ok: false,
				error: e.message
			};
		}
	}
	/**
	* Get current playback state
	*/
	async function spotifyGetCurrent() {
		try {
			if (!spotify.isConnected()) return {
				ok: false,
				error: "Spotify not connected"
			};
			const player = await spotify.api("/me/player");
			if (!player?.item) return {
				ok: true,
				isPlaying: false,
				track: null
			};
			return {
				ok: true,
				isPlaying: player.is_playing,
				track: player.item.name,
				artist: player.item.artists?.map((a) => a.name).join(", ") || "Unknown",
				album: player.item.album?.name || "Unknown",
				repeat: player.repeat_state,
				position_ms: player.progress_ms,
				duration_ms: player.item.duration_ms
			};
		} catch (e) {
			console.error("[WIDGET:SPOTIFY] Get current failed:", e.message);
			return {
				ok: false,
				error: e.message
			};
		}
	}
	module.exports = {
		spotifyNext,
		spotifyPrevious,
		spotifyToggle,
		spotifyDisableRepeat,
		spotifyGetCurrent
	};
}));
//#endregion
//#region electron/monitors/contextEnricher.js
var require_contextEnricher = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	* INTELLIGENT CONTEXT ENRICHER
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	*
	* Fetches real-time context from connected services to understand EXACTLY
	* what the user is doing right now.
	*
	* Examples:
	* - Spotify: current song, artist, album, play count
	* - Gmail: drafting to who, subject line preview
	* - Calendar: current meeting, attendees
	* - YouTube: video title, channel, watch time
	* - Code editor: file name, language, recent commits
	*
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	*/
	var spotify = require_spotify();
	var googleAuth = require_google();
	var { google } = require("googleapis");
	var lastSpotifyCheck = 0;
	var cachedSpotifyContext = null;
	var SPOTIFY_CACHE_MS = 1e4;
	/**
	* Get current Spotify playback state + track info
	* Returns: { track, artist, album, isPlaying, position_ms, duration_ms, repeat_state }
	*/
	async function getSpotifyContext() {
		try {
			if (!spotify.isConnected()) return null;
			const now = Date.now();
			if (cachedSpotifyContext && now - lastSpotifyCheck < SPOTIFY_CACHE_MS) return cachedSpotifyContext;
			const data = await spotify.api("/me/player");
			if (!data || !data.item) {
				cachedSpotifyContext = null;
				lastSpotifyCheck = now;
				return null;
			}
			const context = {
				track: data.item.name,
				artist: data.item.artists?.map((a) => a.name).join(", ") || "Unknown Artist",
				album: data.item.album?.name || "Unknown Album",
				isPlaying: data.is_playing,
				position_ms: data.progress_ms || 0,
				duration_ms: data.item.duration_ms || 0,
				repeat_state: data.repeat_state,
				uri: data.item.uri,
				popularity: data.item.popularity || 0
			};
			cachedSpotifyContext = context;
			lastSpotifyCheck = now;
			console.log("[CONTEXT:SPOTIFY]", context.isPlaying ? "▶" : "⏸", `"${context.track}" by ${context.artist}`);
			return context;
		} catch (e) {
			console.error("[CONTEXT:SPOTIFY] Failed:", e.message);
			return null;
		}
	}
	/**
	* Detect if user is looping a song (repeat_state = 'track')
	*/
	function isLoopingTrack(spotifyContext) {
		return spotifyContext?.repeat_state === "track";
	}
	/**
	* Detect if user has been listening to same song for a long time
	* (even without explicit repeat — might be manually replaying)
	*/
	var lastTrackUri = null;
	var trackPlayCount = 0;
	var firstPlayStart = 0;
	function detectSongLoop(spotifyContext) {
		if (!spotifyContext) return null;
		const currentUri = spotifyContext.uri;
		if (currentUri !== lastTrackUri) {
			lastTrackUri = currentUri;
			trackPlayCount = 1;
			firstPlayStart = Date.now();
			return null;
		}
		trackPlayCount++;
		const totalListenTime = Date.now() - firstPlayStart;
		totalListenTime / trackPlayCount;
		if (totalListenTime > 600 * 1e3 || trackPlayCount >= 3) return {
			track: spotifyContext.track,
			artist: spotifyContext.artist,
			playCount: trackPlayCount,
			totalMinutes: Math.floor(totalListenTime / 6e4),
			isRepeating: spotifyContext.repeat_state === "track"
		};
		return null;
	}
	/**
	* Get current Gmail draft (if composing)
	* Returns: { to, subject, snippet }
	*/
	async function getGmailDraftContext() {
		try {
			if (!googleAuth.isConnected()) return null;
			const auth = googleAuth.getClient();
			const gmail = google.gmail({
				version: "v1",
				auth
			});
			const list = await gmail.users.drafts.list({
				userId: "me",
				maxResults: 1
			});
			if (!list.data.drafts || list.data.drafts.length === 0) return null;
			const draft = await gmail.users.drafts.get({
				userId: "me",
				id: list.data.drafts[0].id,
				format: "metadata",
				metadataHeaders: ["To", "Subject"]
			});
			const headers = Object.fromEntries((draft.data.message?.payload?.headers || []).map((h) => [h.name, h.value]));
			return {
				to: headers.To || "unknown",
				subject: headers.Subject || "(no subject)",
				snippet: draft.data.message?.snippet || ""
			};
		} catch (e) {
			console.error("[CONTEXT:GMAIL] Failed:", e.message);
			return null;
		}
	}
	/**
	* Get current/upcoming calendar event
	* Returns: { summary, start, end, attendees, minutesUntil }
	*/
	async function getCalendarContext() {
		try {
			if (!googleAuth.isConnected()) return null;
			const auth = googleAuth.getClient();
			const calendar = google.calendar({
				version: "v3",
				auth
			});
			const now = /* @__PURE__ */ new Date();
			const soon = new Date(now.getTime() + 3600 * 1e3);
			const res = await calendar.events.list({
				calendarId: "primary",
				timeMin: now.toISOString(),
				timeMax: soon.toISOString(),
				maxResults: 1,
				singleEvents: true,
				orderBy: "startTime"
			});
			if (!res.data.items || res.data.items.length === 0) return null;
			const event = res.data.items[0];
			const startTime = new Date(event.start?.dateTime || event.start?.date);
			const minutesUntil = Math.floor((startTime - now) / 6e4);
			return {
				summary: event.summary,
				start: event.start?.dateTime || event.start?.date,
				end: event.end?.dateTime || event.end?.date,
				attendees: event.attendees?.map((a) => a.email) || [],
				minutesUntil,
				isNow: minutesUntil <= 5
			};
		} catch (e) {
			console.error("[CONTEXT:CALENDAR] Failed:", e.message);
			return null;
		}
	}
	/**
	* Enrich activity with real-time context from connected services
	* Only fetch context relevant to current activity type
	*/
	async function enrichContext(activity, windowTitle) {
		const enriched = { ...activity };
		try {
			const spotifyContext = await getSpotifyContext();
			if (spotifyContext && spotifyContext.isPlaying) {
				enriched.spotify = spotifyContext;
				const loopInfo = detectSongLoop(spotifyContext);
				if (loopInfo) enriched.spotifyLoop = loopInfo;
			}
			if (activity.type === "email-composing") {
				const gmailContext = await getGmailDraftContext();
				if (gmailContext) enriched.gmail = gmailContext;
			}
			const calendarContext = await getCalendarContext();
			if (calendarContext) enriched.calendar = calendarContext;
			return enriched;
		} catch (e) {
			console.error("[CONTEXT:ENRICH] Error:", e.message);
			return enriched;
		}
	}
	/**
	* Build a natural language summary for the AI prompt
	*/
	function buildContextSummary(enrichedActivity) {
		const parts = [];
		parts.push(`activity: ${enrichedActivity.detail}`);
		if (enrichedActivity.spotify) {
			const sp = enrichedActivity.spotify;
			const status = sp.isPlaying ? "playing" : "paused";
			parts.push(`spotify ${status}: "${sp.track}" by ${sp.artist}`);
			if (enrichedActivity.spotifyLoop) {
				const loop = enrichedActivity.spotifyLoop;
				if (loop.isRepeating) parts.push(`(on repeat for ${loop.totalMinutes} min)`);
				else parts.push(`(listened ${loop.playCount} times in ${loop.totalMinutes} min)`);
			}
		}
		if (enrichedActivity.gmail) {
			const gm = enrichedActivity.gmail;
			parts.push(`drafting email to ${gm.to} — subject: "${gm.subject}"`);
		}
		if (enrichedActivity.calendar) {
			const cal = enrichedActivity.calendar;
			if (cal.isNow) parts.push(`meeting NOW: "${cal.summary}" with ${cal.attendees.length} attendees`);
			else parts.push(`meeting in ${cal.minutesUntil} min: "${cal.summary}"`);
		}
		return parts.join("\n");
	}
	module.exports = {
		getSpotifyContext,
		isLoopingTrack,
		detectSongLoop,
		getGmailDraftContext,
		getCalendarContext,
		enrichContext,
		buildContextSummary
	};
}));
//#endregion
//#region electron/monitors/contextAnalyzer.js
var require_contextAnalyzer = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	* INTELLIGENT CONTEXT ANALYZER
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	*
	* Knows EXACTLY what the user is doing and decides when to nudge.
	*
	* Philosophy:
	* - Be helpful, not annoying
	* - Speak only when you have something worth saying
	* - Understand context deeply before interrupting
	*
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	*/
	var fs$1 = require("fs");
	var path$1 = require("path");
	var { enrichContext, buildContextSummary } = require_contextEnricher();
	function readEnvVar(key) {
		try {
			const envPath = path$1.join(process.cwd(), ".env");
			const match = fs$1.readFileSync(envPath, "utf8").match(new RegExp(`^${key}=(.+)$`, "m"));
			return match ? match[1].trim() : "";
		} catch (e) {
			console.error("[CONTEXT] Error reading .env:", e.message);
			return "";
		}
	}
	var GEMINI_API_KEY = readEnvVar("VITE_GEMINI_API_KEY") || readEnvVar("GEMINI_API_KEY");
	console.log("[CONTEXT] Gemini API key loaded:", GEMINI_API_KEY ? "YES" : "NO");
	async function callGemini(prompt, maxTokens = 150) {
		if (!GEMINI_API_KEY) {
			console.error("[CONTEXT] No Gemini API key found");
			return null;
		}
		try {
			const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
					generationConfig: {
						maxOutputTokens: maxTokens,
						temperature: .9,
						thinkingConfig: { thinkingBudget: 0 }
					}
				})
			});
			const data = await response.json();
			if (!response.ok) {
				console.error("[CONTEXT] Gemini API error:", response.status, data);
				return null;
			}
			const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
			console.log("[CONTEXT] Gemini returned:", result ? `"${result.substring(0, 50)}..."` : "null");
			return result;
		} catch (e) {
			console.error("[CONTEXT] Gemini call failed:", e.message, e.stack);
			return null;
		}
	}
	async function callGeminiWithImage(prompt, base64Image, maxTokens = 150) {
		if (!GEMINI_API_KEY) return null;
		try {
			return (await (await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }, { inline_data: {
						mime_type: "image/png",
						data: base64Image
					} }] }],
					generationConfig: {
						maxOutputTokens: maxTokens,
						temperature: .9,
						thinkingConfig: { thinkingBudget: 0 }
					}
				})
			})).json()).candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
		} catch (e) {
			console.error("[CONTEXT] Gemini vision call failed:", e.message);
			return null;
		}
	}
	/**
	* Detect specific activity patterns from window title + app
	*/
	function detectActivity(appName, windowTitle) {
		const app = appName.toLowerCase();
		const title = (windowTitle || "").toLowerCase();
		if (title.includes("gmail")) {
			if (title.includes("compose") || title.includes("draft")) return {
				type: "email-composing",
				confidence: "high",
				detail: "composing email"
			};
			if (title.includes("inbox") || title.includes("mail")) return {
				type: "email-reading",
				confidence: "medium",
				detail: "reading emails"
			};
			return {
				type: "email-general",
				confidence: "low",
				detail: "in gmail"
			};
		}
		if (title.includes("youtube")) {
			const cleanTitle = title.replace(/[-|–]\s*youtube\s*$/i, "").trim();
			if (cleanTitle.includes("tutorial") || cleanTitle.includes("learn") || cleanTitle.includes("course")) return {
				type: "learning",
				confidence: "high",
				detail: `learning: ${cleanTitle}`
			};
			return {
				type: "video-watching",
				confidence: "medium",
				detail: `youtube: ${cleanTitle}`
			};
		}
		if (title.includes("instagram")) return {
			type: "social-scrolling",
			confidence: "high",
			detail: "instagram"
		};
		if (title.includes("tiktok")) return {
			type: "social-scrolling",
			confidence: "high",
			detail: "tiktok"
		};
		if (title.includes("twitter") || title.includes("x.com")) return {
			type: "social-scrolling",
			confidence: "high",
			detail: "twitter"
		};
		if (title.includes("google docs") || title.includes("google sheets")) return {
			type: "document-editing",
			confidence: "high",
			detail: `editing: ${title.split("-")[0]?.trim() || "document"}`
		};
		if (app.includes("code") || app.includes("cursor") || app.includes("vim") || app.includes("sublime")) return {
			type: "coding",
			confidence: "high",
			detail: windowTitle
		};
		if (app.includes("slack") || app.includes("discord") || app.includes("teams")) return {
			type: "chatting",
			confidence: "medium",
			detail: "in team chat"
		};
		if (title.includes("netflix") || title.includes("prime video") || title.includes("disney")) return {
			type: "entertainment",
			confidence: "high",
			detail: "watching show"
		};
		return {
			type: "unknown",
			confidence: "low",
			detail: windowTitle
		};
	}
	/**
	* Detect behavioral patterns that warrant nudging
	*/
	function detectPattern(sessionHistory, currentSession) {
		const now = /* @__PURE__ */ new Date();
		const hour = now.getHours();
		const patterns = [];
		if (hour >= 23 || hour <= 5) {
			const activity = detectActivity(currentSession.app_name, currentSession.window_title);
			if (activity.type === "coding" || activity.type === "document-editing" || activity.type === "email-composing") patterns.push({
				type: "late-night-work",
				severity: "high",
				detail: `working on ${activity.detail} at ${hour}:${now.getMinutes().toString().padStart(2, "0")}`,
				shouldNudge: true
			});
		}
		if (currentSession.duration_minutes >= .5) {
			const activity = detectActivity(currentSession.app_name, currentSession.window_title);
			if (activity.type === "email-composing" || activity.type === "document-editing") patterns.push({
				type: "stuck-editing",
				severity: "medium",
				detail: `${activity.detail} for ${Math.floor(currentSession.duration_minutes)} min`,
				shouldNudge: true
			});
		}
		if (detectActivity(currentSession.app_name, currentSession.window_title).type === "social-scrolling" && currentSession.duration_minutes >= .5) {
			const socialTime = sessionHistory.filter((s) => {
				return detectActivity(s.app_name, s.window_title).type === "social-scrolling" && s.started_at > Date.now() - 3600 * 1e3;
			}).reduce((sum, s) => sum + (s.duration_seconds || 0), 0) / 60;
			patterns.push({
				type: "doom-scrolling",
				severity: socialTime > 20 ? "high" : "medium",
				detail: `${Math.floor(socialTime)} min on social media`,
				shouldNudge: true
			});
		}
		const recentApps = new Set(sessionHistory.filter((s) => s.started_at > Date.now() - 600 * 1e3).map((s) => s.app_name));
		if (recentApps.size >= 5) patterns.push({
			type: "distracted",
			severity: "low",
			detail: `switched between ${recentApps.size} different apps`,
			shouldNudge: false
		});
		return patterns;
	}
	var FALLBACKS = {
		"doom-scrolling-instagram": {
			sfw: [
				"instagram again? they literally design it to trap you, right?",
				"how many posts have you actually enjoyed in the last 20 minutes?",
				"you're in the explore feed. that's the danger zone.",
				"comparing yourself to strangers online? very healthy. love that for you.",
				"instagram is fine. 40 minutes of it is... a choice.",
				"still scrolling? the algorithm is winning. just so you know.",
				"every reel feels like 30 seconds. it's been 35 minutes. math.",
				"refreshing instagram won't fill the void, but okay.",
				"you opened instagram 'just to check'. that was a while ago.",
				"the reels keep coming. you keep watching. who's in charge here?",
				"genuinely asking: what are you looking for right now?",
				"you've seen enough strangers' lives today. i promise."
			],
			nsfw: [
				"instagram again? they literally design this to f*ck with your dopamine.",
				"what the hell are you even looking at anymore.",
				"you've been scrolling instagram for ages. what is wrong with us.",
				"babe the explore page is a trap and you walked right in. again.",
				"comparing yourself to strangers on instagram? jesus christ.",
				"every reel is 30 seconds and yet somehow 40 minutes just disappeared.",
				"still scrolling. absolutely unhinged behavior from someone who said 'just a quick check'."
			]
		},
		"doom-scrolling-youtube": {
			sfw: [
				"are you sure you wanna watch this video for this long?",
				"you opened youtube for one video. now you're in the rabbit hole, aren't you.",
				"that's the 4th autoplay in a row. youtube has you.",
				"you said 'just one more'. that was 45 minutes ago.",
				"your watch history is going to be embarrassing. just a heads up.",
				"the video ended but you're still here. what are we doing.",
				"youtube autoplay is not your friend. it's really not.",
				"you've watched enough for today. the internet will still be here tomorrow.",
				"fascinating how one video becomes a documentary series every time.",
				"did you come here for something specific? because i think you forgot.",
				"hour three of youtube. how's that going for you.",
				"the recommended section is not a to-do list."
			],
			nsfw: [
				"are you seriously still watching youtube? what the hell happened to your plans.",
				"you literally said 'just one video'. that was an hour ago. come on.",
				"youtube autoplay is a scam and you fall for it every damn time.",
				"the rabbit hole got you again. unbelievable. (it's very believable.)",
				"bro the recommended section is not a homework assignment, stop watching everything.",
				"your watch history is going to be so embarrassing. just saying."
			]
		},
		"doom-scrolling": {
			sfw: [
				"not judging but you've been scrolling for a while...",
				"okay but are you even enjoying this anymore?",
				"your future self is silently judging this.",
				"cool. so we're just... scrolling. no judgment. (some judgment.)",
				"social media was supposed to be a quick check. lol.",
				"the scroll continues. as it always does.",
				"hey. you doing okay in there?"
			],
			nsfw: [
				"what the hell are you scrolling for at this point.",
				"genuinely: are you okay? because this has been a while.",
				"the scroll never ends and neither will your regret. kidding. mostly."
			]
		},
		"stuck-editing": {
			sfw: [
				"you've been on that for a while. need a fresh pair of eyes?",
				"still editing? perfection is a myth and a time thief.",
				"how many times have you rewritten that intro?",
				"just. send. it.",
				"done is better than perfect. i know you know that.",
				"you're editing the same thing on loop. step away for two minutes.",
				"the document hasn't changed much in 20 minutes. your brain needs a reset."
			],
			nsfw: [
				"you've been editing this for how long? just send the damn thing.",
				"done is better than perfect. stop rewriting the intro for the fifth f*cking time.",
				"at what point does editing become procrastination? asking for a friend. (it's now.)"
			]
		},
		"late-night-work": {
			sfw: [
				"okay but assignments at 3am? should i be worried?",
				"working late again. this is becoming a pattern.",
				"it's late. this better be worth it.",
				"your sleep schedule is screaming. can you hear it?",
				"the work will still be there after you sleep. the sleep won't wait forever though.",
				"late night productivity is a lie your brain tells you. mostly.",
				"tired + deadline = a special kind of suffering. i see you."
			],
			nsfw: [
				"it's 3am and you're still working. what the hell are you doing to yourself.",
				"your sleep schedule is absolutely trashed and you're just okay with that?",
				"tired + deadline is a terrible combination. go to bed. please.",
				"working this late is genuinely not worth it. i'm serious this time."
			]
		}
	};
	async function generateMusicLoopNudge(loopInfo, nsfwMode) {
		const aiResponse = await callGemini(`you're thera. lowercase. dry. warm underneath.

they've been looping "${loopInfo.track}" by ${loopInfo.artist} for ${loopInfo.totalMinutes} minutes (${loopInfo.playCount} plays).

write ONE short observation or question about the song. max 12 words. lowercase. no quotes.

examples:
- "that song hits different when you're in your feelings huh"
- "stuck on ${loopInfo.track}. wanna talk about it?"
- "${loopInfo.playCount} times in a row. respect the dedication"
- "looping ${loopInfo.artist}. feeling something or just vibing"

${nsfwMode ? "you can swear if it fits naturally" : "keep it clean"}

respond with ONLY the nudge. nothing else.`, 60);
		if (!aiResponse || aiResponse.toLowerCase().includes("skip")) {
			const fallbacks = nsfwMode ? [
				`${loopInfo.track} on repeat. feeling it or stuck in your head`,
				`that's ${loopInfo.playCount} plays. the song hits or you're procrastinating`,
				`looping ${loopInfo.artist}. vibing or spiraling`
			] : [
				`still on ${loopInfo.track}. that one really speaks to you huh`,
				`${loopInfo.playCount} times. the song hits different today`,
				`looping ${loopInfo.artist}. you okay in there`
			];
			return fallbacks[Math.floor(Math.random() * fallbacks.length)];
		}
		return aiResponse.replace(/^["']|["']$/g, "").trim();
	}
	/**
	* Pick the right fallback bank based on pattern + current site + nsfwMode
	*/
	function pickFallback(patternType, activity, nsfwMode) {
		const mode = nsfwMode ? "nsfw" : "sfw";
		let bank;
		if (patternType === "doom-scrolling") {
			const detail = (activity.detail || "").toLowerCase();
			if (detail.includes("instagram")) bank = FALLBACKS["doom-scrolling-instagram"];
			else if (detail.includes("youtube")) bank = FALLBACKS["doom-scrolling-youtube"];
			else if (detail.includes("tiktok")) bank = FALLBACKS["doom-scrolling-tiktok"];
			else bank = FALLBACKS["doom-scrolling"];
		} else bank = FALLBACKS[patternType];
		const messages = bank?.[mode] || bank?.sfw || ["hey. take a break maybe?"];
		return messages[Math.floor(Math.random() * messages.length)];
	}
	/**
	* Decide if we should nudge + generate the message
	* Returns: { shouldNudge: boolean, message: string, reasoning: string }
	*/
	async function analyzeAndDecide(currentSession, sessionHistory, screenshot = null, options = {}) {
		const nsfwMode = options.nsfwMode ?? false;
		const activity = detectActivity(currentSession.app_name, currentSession.window_title);
		const patterns = detectPattern(sessionHistory, currentSession);
		console.log("[CONTEXT] Activity:", activity.type, "—", activity.detail);
		console.log("[CONTEXT] NSFW mode:", nsfwMode);
		if (patterns.length > 0) console.log("[CONTEXT] Patterns:", patterns.map((p) => p.type).join(", "));
		const enrichedActivity = await enrichContext(activity, currentSession.window_title);
		const contextSummary = buildContextSummary(enrichedActivity);
		if (contextSummary !== activity.detail) console.log("[CONTEXT] Enriched context:", contextSummary);
		if ([
			"coding",
			"email-reading",
			"chatting",
			"entertainment"
		].includes(activity.type) && patterns.length === 0) {
			if (enrichedActivity.spotifyLoop) return {
				shouldNudge: true,
				message: await generateMusicLoopNudge(enrichedActivity.spotifyLoop, nsfwMode),
				reasoning: "spotify loop detected",
				metadata: { spotifyLoop: enrichedActivity.spotifyLoop }
			};
			return {
				shouldNudge: false,
				reasoning: "user is focused, no concerning patterns"
			};
		}
		const highSeverityPatterns = patterns.filter((p) => p.shouldNudge);
		if (highSeverityPatterns.length === 0) return {
			shouldNudge: false,
			reasoning: "no concerning patterns warrant interruption"
		};
		const now = /* @__PURE__ */ new Date();
		const timeContext = `${now.getHours()}:${now.getMinutes().toString().padStart(2, "0")}`;
		const patternSummary = highSeverityPatterns.map((p) => `${p.type}: ${p.detail}`).join("; ");
		const detail = activity.detail || "";
		let siteContext = "";
		if (detail.toLowerCase().includes("instagram")) siteContext = "specifically on Instagram (reels, explore page, posts)";
		else if (detail.toLowerCase().includes("youtube")) siteContext = "specifically on YouTube (watching videos, autoplaying, rabbit hole)";
		else if (detail.toLowerCase().includes("tiktok")) siteContext = "specifically on TikTok (for you page, reels)";
		else if (detail.toLowerCase().includes("twitter") || detail.toLowerCase().includes("x.com")) siteContext = "specifically on Twitter/X (doom-scrolling the feed)";
		let enrichedContext = "";
		if (enrichedActivity.spotify) {
			const sp = enrichedActivity.spotify;
			enrichedContext += `\n- spotify: ${sp.isPlaying ? "playing" : "paused"} "${sp.track}" by ${sp.artist}`;
			if (enrichedActivity.spotifyLoop) enrichedContext += ` (on repeat ${enrichedActivity.spotifyLoop.playCount} times)`;
		}
		if (enrichedActivity.gmail) enrichedContext += `\n- gmail: drafting to ${enrichedActivity.gmail.to}, subject: "${enrichedActivity.gmail.subject}"`;
		if (enrichedActivity.calendar?.isNow) enrichedContext += `\n- calendar: meeting NOW "${enrichedActivity.calendar.summary}"`;
		let prompt = `you're thera. same skull as the fleabag woman. lowercase. dry. warm underneath.

you've caught them doing something concerning. write a nudge.

what you know:
- time: ${timeContext}
- activity: ${detail}${siteContext ? `\n- context: ${siteContext}` : ""}
- pattern: ${patternSummary}${enrichedContext}

write ONE short message. max 15 words. lowercase. no quotes. no punctuation at the end unless it's a question mark.

the voice:
- specific. "you've been on instagram for 40 minutes" not "maybe take a break"
- dry observation first. care underneath. "still scrolling?" not "i'm worried about your screen time"
- one-word asides when it fits: "ugh." "right." "knew it."
- real swearing on genuinely shit moments. not theater. ${nsfwMode ? "you can swear if it feels right (fuck, shit, hell)" : "keep it clean but still pointed"}
- no lectures. no leaflet language. no "have you considered."
- if it's late: dark humor about the time. "it's 2am and you're writing emails. respect."
- if they're stuck: exact time. "same document for 30 minutes."
- if social media: name the specific trap. "the explore page is designed for this." or "autoplay is winning."

respond with ONLY the nudge. nothing else. no explanation. just the line.`;
		if (screenshot) prompt += "\n\n[screenshot of their screen is attached — use it to understand context better and be more specific]";
		const aiResponse = screenshot ? await callGeminiWithImage(prompt, screenshot, 80) : await callGemini(prompt, 80);
		console.log("[CONTEXT] AI raw response:", aiResponse);
		let message;
		if (!aiResponse || aiResponse === "SKIP" || aiResponse.toLowerCase().includes("skip")) {
			console.log("[CONTEXT] AI failed or returned SKIP — using fallback message");
			const patternType = highSeverityPatterns[0]?.type;
			message = pickFallback(patternType, activity, nsfwMode);
		} else message = aiResponse.replace(/^["']|["']$/g, "").trim();
		console.log("[CONTEXT] Final nudge message:", message);
		return {
			shouldNudge: true,
			message,
			reasoning: patternSummary,
			metadata: {
				patterns: highSeverityPatterns,
				activity: activity.type,
				usedScreenshot: !!screenshot
			}
		};
	}
	module.exports = {
		detectActivity,
		detectPattern,
		analyzeAndDecide,
		pickFallback,
		callGemini,
		callGeminiWithImage
	};
}));
//#endregion
//#region electron/monitors/screenCapture.js
var require_screenCapture = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	* TIER 3 — SCREEN VISION (on-demand, expensive)
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	*
	* Use Electron's desktopCapturer to screenshot the active window and send
	* to Gemini Vision for deep context understanding.
	*
	* Rate limits:
	* - Max once every 5 minutes (for testing: 1 minute)
	* - Only when patterns indicate we need deeper understanding
	*
	* Triggers:
	* - Unrecognized app for 15+ min
	* - Late night work sessions (to understand what they're working on)
	* - User stuck on same task 20+ min
	* - Rapid context switching (might be frustrated)
	*
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	*/
	var { desktopCapturer } = require("electron");
	/**
	* Capture screenshot of the primary screen
	* Returns: base64 encoded PNG string (without data:image/png;base64, prefix)
	* Note: Rate limiting removed - now called periodically from activityMonitor
	*/
	async function captureScreen() {
		try {
			const sources = await desktopCapturer.getSources({
				types: ["screen"],
				thumbnailSize: {
					width: 1280,
					height: 720
				}
			});
			if (sources.length === 0) {
				console.error("[SCREENSHOT] No screen sources available");
				return null;
			}
			const base64Image = sources[0].thumbnail.toPNG().toString("base64");
			console.log("[SCREENSHOT] Captured screen:", base64Image.length, "bytes");
			return base64Image;
		} catch (e) {
			console.error("[SCREENSHOT] Failed to capture:", e.message);
			return null;
		}
	}
	module.exports = { captureScreen };
}));
//#endregion
//#region electron/monitors/activityMonitor.js
var require_activityMonitor = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	* INTELLIGENT ACTIVITY MONITOR v2
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	*
	* Knows EXACTLY what you're doing and nudges contextually.
	*
	* For testing: Fast nudge checks (every 60s) with immediate pattern detection
	* For production: Slower checks (every 10s) with longer thresholds
	*
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	*/
	var { activityOps, nudgeOps } = require_localDb();
	var { BrowserWindow: BrowserWindow$1 } = require("electron");
	var { detectActivity, detectPattern, analyzeAndDecide, pickFallback } = require_contextAnalyzer();
	var { captureScreen } = require_screenCapture();
	var settings = require_settings();
	var _activeWin = null;
	async function getActiveWindow() {
		if (!_activeWin) try {
			const mod = await import("active-win");
			_activeWin = mod.default ?? mod;
			console.log("[ACTIVITY] active-win loaded OK");
		} catch (e) {
			console.error("[ACTIVITY] Failed to load active-win:", e.message);
			return null;
		}
		try {
			return await _activeWin();
		} catch (e) {
			console.error("[ACTIVITY] active-win() threw:", e.message);
			return null;
		}
	}
	var currentSession = null;
	var sessionHistory = [];
	var monitorInterval = null;
	var nudgeCheckInterval = null;
	var screenshotInterval = null;
	var socialSiteKey = null;
	var socialSiteStart = 0;
	var socialNudgeFired = false;
	var screenshotCache = {
		periodic: null,
		triggered: null,
		lastPeriodicTime: 0,
		lastTriggeredTime: 0
	};
	var POLL_INTERVAL_MS = 5e3;
	var NUDGE_CHECK_INTERVAL_MS = 6e4;
	var SCREENSHOT_INTERVAL_MS = 120 * 1e3;
	var TRIGGER_COOLDOWN_MS = 30 * 1e3;
	function categorizeApp(appName, windowTitle) {
		const a = appName.toLowerCase();
		const t = (windowTitle || "").toLowerCase();
		if (a.includes("discord") || a.includes("slack") || a.includes("whatsapp") || t.includes("twitter") || t.includes("instagram") || t.includes("tiktok")) return "social";
		if (a.includes("code") || a.includes("cursor") || a.includes("terminal") || a.includes("vim") || a.includes("intellij") || a.includes("pycharm")) return "coding";
		if (a.includes("excel") || a.includes("word") || a.includes("outlook") || a.includes("teams") || a.includes("zoom") || a.includes("notion")) return "work";
		if (a.includes("spotify") || a.includes("netflix") || a.includes("steam") || t.includes("youtube") || t.includes("netflix") || t.includes("twitch")) return "entertainment";
		if (a.includes("chrome") || a.includes("firefox") || a.includes("safari") || a.includes("edge") || a.includes("brave")) return "browsing";
		return "other";
	}
	function sendNudge(type, message, metadata = {}) {
		console.log(`[NUDGE] ${type}: "${message}"`);
		if (metadata.reasoning) console.log(`[NUDGE] Reasoning: ${metadata.reasoning}`);
		nudgeOps.recordNudge(type, message);
		const widget = BrowserWindow$1.getAllWindows().find((w) => w.isAlwaysOnTop() && !w.frame);
		if (widget) widget.webContents.send("show-nudge", message);
		else console.warn("[NUDGE] No widget window found");
	}
	async function checkIntelligentNudges() {
		if (!currentSession) return;
		currentSession.duration_minutes = (Date.now() - currentSession.started_at) / 6e4;
		const activity = detectActivity(currentSession.app_name, currentSession.window_title);
		const patterns = detectPattern(sessionHistory, currentSession);
		console.log("[CONTEXT] Activity:", activity.type, "—", activity.detail);
		if (patterns.length > 0) console.log("[CONTEXT] Patterns detected:", patterns.map((p) => `${p.type} (${p.severity})`).join(", "));
		let screenshot = null;
		if (shouldTakeTriggeredScreenshot(currentSession, patterns, activity)) screenshot = await captureTriggeredScreenshot(activity, patterns);
		else if (screenshotCache.triggered && Date.now() - screenshotCache.lastTriggeredTime < 120 * 1e3) {
			screenshot = screenshotCache.triggered;
			console.log("[CONTEXT] Using recent triggered screenshot");
		} else if (screenshotCache.periodic) {
			screenshot = screenshotCache.periodic;
			console.log("[CONTEXT] Using periodic screenshot for general context");
		}
		const decision = await analyzeAndDecide(currentSession, sessionHistory, screenshot, { nsfwMode: settings.get("nsfwMode") });
		if (decision.shouldNudge) sendNudge("intelligent", decision.message, {
			reasoning: decision.reasoning,
			...decision.metadata
		});
		else console.log("[CONTEXT] No nudge —", decision.reasoning);
	}
	/**
	* Periodic screenshot - captures general context every 15 min
	* Good for: understanding work patterns, email habits, general productivity
	*/
	async function capturePeriodicScreenshot() {
		console.log("[SCREENSHOT:PERIODIC] Capturing for general context...");
		const screenshot = await captureScreen();
		if (screenshot) {
			screenshotCache.periodic = screenshot;
			screenshotCache.lastPeriodicTime = Date.now();
			console.log("[SCREENSHOT:PERIODIC] Cached:", screenshot.length, "bytes");
		} else console.log("[SCREENSHOT:PERIODIC] Failed to capture");
	}
	/**
	* Check if we should take a triggered screenshot right now
	* Triggers:
	* - Currently doom-scrolling social media 20+ min
	* - Currently stuck editing/composing 20+ min
	* - Late night work (11pm-5am)
	* - Unrecognized app for long time
	*/
	function shouldTakeTriggeredScreenshot(currentSession, patterns, activity) {
		if (Date.now() - screenshotCache.lastTriggeredTime < TRIGGER_COOLDOWN_MS) return false;
		if (activity.type === "social-scrolling" && currentSession.duration_minutes >= .5) {
			console.log("[SCREENSHOT:TRIGGER] Detected: doom-scrolling on", activity.detail);
			return true;
		}
		if (currentSession.duration_minutes >= 20) {
			if ([
				"email-composing",
				"document-editing",
				"coding"
			].includes(activity.type)) {
				console.log("[SCREENSHOT:TRIGGER] Detected: stuck on", activity.type);
				return true;
			}
		}
		const hour = (/* @__PURE__ */ new Date()).getHours();
		if ((hour >= 23 || hour <= 5) && currentSession.duration_minutes >= 10) {
			if ([
				"coding",
				"document-editing",
				"email-composing"
			].includes(activity.type)) {
				console.log("[SCREENSHOT:TRIGGER] Detected: late night work");
				return true;
			}
		}
		if (activity.type === "unknown" && currentSession.duration_minutes >= 15) {
			console.log("[SCREENSHOT:TRIGGER] Detected: unrecognized app");
			return true;
		}
		return false;
	}
	/**
	* Take triggered screenshot for specific concerning behavior
	*/
	async function captureTriggeredScreenshot(activity, patterns) {
		console.log("[SCREENSHOT:TRIGGER] Capturing for immediate context...");
		const screenshot = await captureScreen();
		if (screenshot) {
			screenshotCache.triggered = screenshot;
			screenshotCache.lastTriggeredTime = Date.now();
			console.log("[SCREENSHOT:TRIGGER] Captured:", screenshot.length, "bytes");
			return screenshot;
		} else {
			console.log("[SCREENSHOT:TRIGGER] Failed to capture");
			return null;
		}
	}
	async function pollActiveWindow() {
		try {
			const win = await getActiveWindow().catch((e) => {
				if (e.code !== "EPIPE") console.error("[ACTIVITY] getActiveWindow error:", e.message);
				return null;
			});
			if (!win) {
				console.log("[ACTIVITY] active-win returned null");
				if (currentSession) {
					activityOps.endSession(currentSession.id);
					const duration_seconds = (Date.now() - currentSession.started_at) / 1e3;
					sessionHistory.push({
						...currentSession,
						duration_seconds
					});
					if (sessionHistory.length > 50) sessionHistory.shift();
					currentSession = null;
				}
				return;
			}
			const appName = win.owner?.name || "Unknown";
			const windowTitle = win.title || "";
			const category = categorizeApp(appName, windowTitle);
			if (!currentSession || currentSession.app_name !== appName || currentSession.window_title !== windowTitle) {
				if (currentSession) {
					activityOps.endSession(currentSession.id);
					const duration_seconds = (Date.now() - currentSession.started_at) / 1e3;
					sessionHistory.push({
						...currentSession,
						duration_seconds
					});
					if (sessionHistory.length > 50) sessionHistory.shift();
					console.log(`[ACTIVITY] Ended: "${currentSession.app_name}" (${Math.floor(duration_seconds)}s)`);
				}
				currentSession = {
					id: activityOps.startSession(appName, windowTitle, category),
					app_name: appName,
					window_title: windowTitle,
					category,
					started_at: Date.now(),
					duration_minutes: 0
				};
				console.log(`[ACTIVITY] Started: "${appName}" [${category}] — "${windowTitle.slice(0, 80)}"`);
			}
			const activity = detectActivity(appName, windowTitle);
			if (activity.type === "social-scrolling" || activity.type === "video-watching") {
				const siteKey = activity.detail;
				if (siteKey !== socialSiteKey) {
					socialSiteKey = siteKey;
					socialSiteStart = Date.now();
					socialNudgeFired = false;
				} else if (!socialNudgeFired && Date.now() - socialSiteStart >= 5e3) {
					socialNudgeFired = true;
					console.log("[ACTIVITY] Social 5s threshold hit — nudging");
					sendNudge("social-quick", pickFallback("doom-scrolling", activity, settings.get("nsfwMode") ?? false));
				}
			} else {
				socialSiteKey = null;
				socialSiteStart = 0;
				socialNudgeFired = false;
			}
		} catch (e) {
			console.error("[ACTIVITY] Poll error:", e.message);
		}
	}
	function startMonitoring() {
		try {
			console.log("[ACTIVITY] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
			console.log("[ACTIVITY] Intelligent Activity Monitor v2 — HYBRID SCREENSHOTS");
			console.log("[ACTIVITY] Window polling: every", POLL_INTERVAL_MS / 1e3, "seconds");
			console.log("[ACTIVITY] Nudge checks: every", NUDGE_CHECK_INTERVAL_MS / 1e3, "seconds");
			console.log("[ACTIVITY] Periodic screenshots: every", SCREENSHOT_INTERVAL_MS / 1e3, "seconds");
			console.log("[ACTIVITY] Triggered screenshots: when concerning patterns detected");
			console.log("[ACTIVITY] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
		} catch (e) {}
		sessionHistory = activityOps.getRecentActivity(1).map((row) => ({
			...row,
			duration_minutes: row.duration_seconds / 60
		}));
		console.log("[ACTIVITY] Loaded", sessionHistory.length, "recent sessions from DB");
		pollActiveWindow();
		monitorInterval = setInterval(pollActiveWindow, POLL_INTERVAL_MS);
		nudgeCheckInterval = setInterval(checkIntelligentNudges, NUDGE_CHECK_INTERVAL_MS);
		capturePeriodicScreenshot();
		screenshotInterval = setInterval(capturePeriodicScreenshot, SCREENSHOT_INTERVAL_MS);
		setTimeout(checkIntelligentNudges, 3e4);
	}
	function stopMonitoring() {
		if (monitorInterval) {
			clearInterval(monitorInterval);
			clearInterval(nudgeCheckInterval);
			clearInterval(screenshotInterval);
			if (currentSession) activityOps.endSession(currentSession.id);
			screenshotCache = {
				periodic: null,
				triggered: null,
				lastPeriodicTime: 0,
				lastTriggeredTime: 0
			};
			console.log("[ACTIVITY] Monitor stopped");
		}
	}
	process.on("exit", stopMonitoring);
	module.exports = {
		startMonitoring,
		stopMonitoring
	};
}));
//#endregion
//#region electron/main.js
var path = require("path");
var fs = require("fs");
try {
	const envPath = path.resolve(__dirname, "../.env");
	if (fs.existsSync(envPath)) {
		const lines = fs.readFileSync(envPath, "utf8").split("\n");
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const idx = trimmed.indexOf("=");
			if (idx === -1) continue;
			const key = trimmed.slice(0, idx).trim();
			const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
			if (key && !(key in process.env)) process.env[key] = val;
		}
	}
} catch (e) {
	console.warn("Failed to load .env:", e.message);
}
var { app, BrowserWindow, ipcMain, Tray, Menu } = require("electron");
var settings = require_settings();
var { sessionOps, messageOps, connectorOps, moodOps, crisisOps } = require_localDb();
var googleConnector = require_google();
var spotifyConnector = require_spotify();
var slackConnector = require_slack();
var actions = require_actions();
var mainWindow;
var widgetWindow;
var tray;
function createWindow() {
	mainWindow = new BrowserWindow({
		width: 400,
		height: 600,
		minWidth: 350,
		minHeight: 500,
		frame: false,
		backgroundColor: "#18120a",
		skipTaskbar: false,
		alwaysOnTop: false,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false
		}
	});
	if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
	else mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
	mainWindow.on("close", (event) => {
		if (!app.isQuitting) {
			event.preventDefault();
			mainWindow.hide();
		}
	});
	mainWindow.on("show", () => {
		if (process.platform === "darwin" && tray.setHighlightMode) tray.setHighlightMode("always");
	});
	mainWindow.on("blur", () => {
		setTimeout(() => {
			if (!mainWindow.isFocused() && mainWindow.isVisible()) mainWindow.hide();
		}, 200);
	});
}
function createWidgetWindow() {
	const { screen } = require("electron");
	const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
	const W = 400, H = 110;
	const savedPosition = {
		x: Math.floor((screenWidth - W) / 2),
		y: 0
	};
	widgetWindow = new BrowserWindow({
		width: W,
		height: H,
		x: savedPosition.x,
		y: savedPosition.y,
		frame: false,
		transparent: true,
		alwaysOnTop: true,
		skipTaskbar: true,
		resizable: false,
		hasShadow: false,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false
		}
	});
	if (process.env.VITE_DEV_SERVER_URL) {
		const baseURL = process.env.VITE_DEV_SERVER_URL.replace(/\/$/, "");
		widgetWindow.loadURL(`${baseURL}/widget.html`);
	} else widgetWindow.loadFile(path.join(__dirname, "../dist/widget.html"));
	console.log("[WIDGET] Widget window created at position:", savedPosition);
	if (process.platform === "win32") widgetWindow.setIgnoreMouseEvents(true, { forward: true });
	else widgetWindow.setIgnoreMouseEvents(false);
	widgetWindow.on("closed", () => {
		console.log("[WIDGET] Widget window closed");
	});
	widgetWindow.on("hide", () => {
		console.log("[WIDGET] Widget window hidden");
	});
	widgetWindow.on("show", () => {
		console.log("[WIDGET] Widget window shown");
	});
	widgetWindow.webContents.on("did-finish-load", () => {
		console.log("[WIDGET] Widget finished loading");
	});
	widgetWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
		console.error("[WIDGET] Widget failed to load:", errorCode, errorDescription);
	});
}
function createTray() {
	const { nativeImage } = require("electron");
	nativeImage.createEmpty();
	tray = new Tray(nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABOSURBVDiNY/z//z8DJYCRUgNgYBgF+MDu3bv/M1AJmDZtGvUMuHjx4n8GKgHLly+nngFoYBTgY8C1a9f+M1AJWLhwIfUMgIFRAFYBANJ4Cul0TKhpAAAAAElFTkSuQmCC"));
	const contextMenu = Menu.buildFromTemplate([
		{
			label: "Show Thera",
			click: () => {
				mainWindow.show();
				mainWindow.focus();
			}
		},
		{
			label: "Hide Thera",
			click: () => {
				mainWindow.hide();
			}
		},
		{ type: "separator" },
		{
			label: "Quit",
			click: () => {
				app.isQuitting = true;
				app.quit();
			}
		}
	]);
	tray.setToolTip("Thera - Your desktop companion");
	tray.setContextMenu(contextMenu);
	tray.on("click", () => {
		if (mainWindow.isVisible()) mainWindow.hide();
		else {
			mainWindow.show();
			mainWindow.focus();
		}
	});
}
ipcMain.on("minimize-window", () => {
	if (mainWindow) mainWindow.minimize();
});
ipcMain.on("close-window", () => {
	if (mainWindow) mainWindow.hide();
});
ipcMain.on("toggle-always-on-top", (event, alwaysOnTop) => {
	if (mainWindow) mainWindow.setAlwaysOnTop(alwaysOnTop);
});
ipcMain.on("widget-clicked", () => {
	if (widgetWindow) widgetWindow.webContents.send("dismiss-nudge");
});
ipcMain.on("widget-long-press", () => {
	if (mainWindow) {
		mainWindow.show();
		mainWindow.focus();
	}
});
ipcMain.on("move-widget", (_e, { x, y }) => {
	if (widgetWindow) widgetWindow.setPosition(Math.round(x), Math.round(y));
});
ipcMain.handle("get-widget-position", () => {
	if (widgetWindow) {
		const [x, y] = widgetWindow.getPosition();
		return {
			x,
			y
		};
	}
	return {
		x: 0,
		y: 0
	};
});
ipcMain.on("widget-resize", (_e, { height }) => {
	if (widgetWindow) {
		const [w] = widgetWindow.getSize();
		widgetWindow.setSize(w, height);
	}
});
ipcMain.on("set-widget-interactive", (_e, interactive) => {
	if (widgetWindow && process.platform === "win32") if (interactive) widgetWindow.setIgnoreMouseEvents(false);
	else widgetWindow.setIgnoreMouseEvents(true, { forward: true });
});
ipcMain.handle("get-setting", (_e, key) => settings.get(key));
ipcMain.on("set-setting", (_e, key, value) => settings.set(key, value));
var widgetActions = require_widgetActions();
ipcMain.handle("widget:spotify:next", () => widgetActions.spotifyNext());
ipcMain.handle("widget:spotify:previous", () => widgetActions.spotifyPrevious());
ipcMain.handle("widget:spotify:toggle", () => widgetActions.spotifyToggle());
ipcMain.handle("widget:spotify:disable-repeat", () => widgetActions.spotifyDisableRepeat());
ipcMain.handle("widget:spotify:get-current", () => widgetActions.spotifyGetCurrent());
ipcMain.handle("sessions:list", () => sessionOps.list());
ipcMain.handle("sessions:create", (_e, { id, title } = {}) => {
	const sessionId = id || `thera_${Date.now()}`;
	return sessionOps.create(sessionId, title || "new session");
});
ipcMain.handle("sessions:rename", (_e, { id, title }) => {
	sessionOps.rename(id, title);
	return true;
});
ipcMain.handle("sessions:delete", (_e, { id }) => {
	sessionOps.delete(id);
	return true;
});
ipcMain.handle("sessions:messages", (_e, { id }) => messageOps.listForSession(id));
ipcMain.handle("sessions:add-message", (_e, { sessionId, role, text }) => {
	return messageOps.add(sessionId, role, text);
});
ipcMain.handle("connectors:list", () => connectorOps.list());
ipcMain.handle("connectors:upsert", (_e, { key, enabled, status, metadata }) => {
	connectorOps.upsert(key, {
		enabled,
		status,
		metadata
	});
	return connectorOps.get(key);
});
var GOOGLE_KEYS = [
	"gmail",
	"gcal",
	"gcontacts",
	"gdrive",
	"gdocs",
	"gsheets"
];
function syncConnectorStates() {
	if (googleConnector.isConnected()) GOOGLE_KEYS.forEach((k) => connectorOps.upsert(k, {
		enabled: true,
		status: "connected"
	}));
	if (spotifyConnector.isConnected()) connectorOps.upsert("spotify", {
		enabled: true,
		status: "connected"
	});
	if (slackConnector.isConnected()) connectorOps.upsert("slack", {
		enabled: true,
		status: "connected"
	});
}
ipcMain.handle("connectors:credentials", () => ({
	google: googleConnector.hasCredentials(),
	spotify: spotifyConnector.hasCredentials(),
	slack: slackConnector.hasCredentials()
}));
ipcMain.handle("connectors:google:connect", async () => {
	try {
		await googleConnector.connect();
		GOOGLE_KEYS.forEach((k) => connectorOps.upsert(k, {
			enabled: true,
			status: "connected"
		}));
		return { ok: true };
	} catch (e) {
		console.error("[GOOGLE] connect failed:", e.message);
		return {
			ok: false,
			error: e.message
		};
	}
});
ipcMain.handle("connectors:google:disconnect", async () => {
	googleConnector.disconnect();
	GOOGLE_KEYS.forEach((k) => connectorOps.upsert(k, {
		enabled: false,
		status: "disconnected"
	}));
	return { ok: true };
});
ipcMain.handle("connectors:spotify:connect", async () => {
	try {
		await spotifyConnector.connect();
		connectorOps.upsert("spotify", {
			enabled: true,
			status: "connected"
		});
		return { ok: true };
	} catch (e) {
		console.error("[SPOTIFY] connect failed:", e.message);
		return {
			ok: false,
			error: e.message
		};
	}
});
ipcMain.handle("connectors:spotify:disconnect", () => {
	spotifyConnector.disconnect();
	connectorOps.upsert("spotify", {
		enabled: false,
		status: "disconnected"
	});
	return { ok: true };
});
ipcMain.handle("connectors:slack:connect", async () => {
	try {
		await slackConnector.connect();
		connectorOps.upsert("slack", {
			enabled: true,
			status: "connected"
		});
		return { ok: true };
	} catch (e) {
		console.error("[SLACK] connect failed:", e.message);
		return {
			ok: false,
			error: e.message
		};
	}
});
ipcMain.handle("connectors:slack:disconnect", () => {
	slackConnector.disconnect();
	connectorOps.upsert("slack", {
		enabled: false,
		status: "disconnected"
	});
	return { ok: true };
});
ipcMain.handle("actions:execute", (_e, action) => actions.execute(action));
ipcMain.handle("mood:log", (_e, entry) => moodOps.log(entry || {}));
ipcMain.handle("mood:daily", (_e, days) => moodOps.daily(days || 30));
ipcMain.handle("mood:recent", (_e, limit) => moodOps.recent(limit || 20));
ipcMain.handle("crisis:record", (_e, evt) => crisisOps.record(evt || { severity: "amber" }));
ipcMain.handle("crisis:resolve", (_e, id) => {
	crisisOps.resolve(id);
	return true;
});
ipcMain.handle("crisis:active", () => crisisOps.active());
ipcMain.handle("roast:context", () => {
	return {
		moodDays: moodOps.daily(7),
		moodRecent: moodOps.recent(50),
		activity: require_localDb().activityOps.getRecentActivity(168)
	};
});
ipcMain.handle("request-permissions", async () => {
	const { systemPreferences } = require("electron");
	if (process.platform === "darwin") {
		const accessibilityStatus = systemPreferences.getMediaAccessStatus("screen");
		console.log("[PERMISSIONS] macOS screen recording status:", accessibilityStatus);
		if (accessibilityStatus !== "granted") {
			const { shell } = require("electron");
			await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
			return {
				granted: false,
				platform: "darwin",
				message: "Please grant screen recording permission in System Preferences > Privacy & Security > Screen Recording"
			};
		}
		return {
			granted: true,
			platform: "darwin"
		};
	} else if (process.platform === "win32") {
		console.log("[PERMISSIONS] Windows - no special permissions required");
		return {
			granted: true,
			platform: "win32"
		};
	}
	return {
		granted: true,
		platform: "unknown"
	};
});
var lastTabData = null;
var pendingExtCommands = [];
var longPollWaiters = [];
function startExtensionBridge() {
	const server = require("http").createServer((req, res) => {
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type");
		res.setHeader("Access-Control-Allow-Private-Network", "true");
		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}
		if (req.url === "/tab" && req.method === "POST") {
			let body = "";
			req.on("data", (c) => body += c);
			req.on("end", () => {
				try {
					const data = JSON.parse(body);
					if (data.type === "automate-result") {
						console.log("[BRIDGE] automate-result received:", JSON.stringify(data).slice(0, 300));
						const win = widgetWindow || mainWindow;
						if (win) win.webContents.send("extension-automate-result", data);
						else console.warn("[BRIDGE] automate-result: no window to send to");
					} else {
						lastTabData = data;
						if (widgetWindow) widgetWindow.webContents.send("extension-tab", data);
					}
				} catch (e) {
					console.error("[BRIDGE] /tab parse error:", e.message);
				}
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ ok: true }));
			});
			return;
		}
		if (req.url.startsWith("/commands") && req.method === "GET") {
			const cmds = pendingExtCommands.splice(0);
			if (cmds.length > 0 || !req.url.includes("wait=1")) {
				if (cmds.length > 0) console.log("[BRIDGE] /commands returning immediately:", cmds.map((c) => c.type));
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(cmds));
			} else {
				console.log("[BRIDGE] /commands long-poll registered, waiters now:", longPollWaiters.length + 1);
				const timer = setTimeout(() => {
					const i = longPollWaiters.findIndex((w) => w.res === res);
					if (i >= 0) longPollWaiters.splice(i, 1);
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end("[]");
				}, 25e3);
				longPollWaiters.push({
					res,
					timer
				});
				req.on("close", () => {
					clearTimeout(timer);
					const i = longPollWaiters.findIndex((w) => w.res === res);
					if (i >= 0) longPollWaiters.splice(i, 1);
				});
			}
			return;
		}
		if (req.url === "/ext-command" && req.method === "POST") {
			let body = "";
			req.on("data", (c) => body += c);
			req.on("end", () => {
				try {
					const cmd = JSON.parse(body);
					console.log("[BRIDGE] /ext-command received:", cmd.type, "taskId:", cmd.taskId, "| waiters:", longPollWaiters.length);
					pendingExtCommands.push(cmd);
					if (longPollWaiters.length > 0) {
						const { res: waitRes, timer } = longPollWaiters.shift();
						clearTimeout(timer);
						const toFlush = pendingExtCommands.splice(0);
						console.log("[BRIDGE] flushing to long-poll waiter:", toFlush.map((c) => c.type));
						waitRes.writeHead(200, { "Content-Type": "application/json" });
						waitRes.end(JSON.stringify(toFlush));
					} else console.warn("[BRIDGE] no long-poll waiter — command queued, extension will pick up next poll (extension connected?)");
				} catch (e) {
					console.error("[BRIDGE] /ext-command parse error:", e.message);
				}
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ ok: true }));
			});
			return;
		}
		res.writeHead(404);
		res.end();
	});
	server.on("error", (e) => console.warn("[BRIDGE] Extension bridge error:", e.message));
	server.listen(7979, "127.0.0.1", () => console.log("[BRIDGE] Extension bridge on port 7979"));
}
ipcMain.handle("extension:get-tab", () => lastTabData);
ipcMain.handle("extension:send-command", (_e, cmd) => {
	pendingExtCommands.push(cmd);
	return { ok: true };
});
app.whenReady().then(() => {
	syncConnectorStates();
	createWindow();
	createWidgetWindow();
	createTray();
	startExtensionBridge();
	setTimeout(() => {
		const { startMonitoring } = require_activityMonitor();
		startMonitoring();
	}, 2e3);
});
app.on("window-all-closed", (e) => {
	e.preventDefault();
});
app.on("before-quit", () => {
	app.isQuitting = true;
});
app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
	else mainWindow.show();
});
//#endregion
