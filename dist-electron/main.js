//#region \0rolldown/runtime.js
var __commonJSMin = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
//#endregion
//#region electron/db/localDb.js
var require_localDb = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Database = require("better-sqlite3");
	var path$2 = require("path");
	var { app: app$1 } = require("electron");
	var dbPath = path$2.join(app$1.getPath("userData"), "thera.db");
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

  CREATE INDEX IF NOT EXISTS idx_activity_started ON activity_logs(started_at);
  CREATE INDEX IF NOT EXISTS idx_activity_app ON activity_logs(app_name);
  CREATE INDEX IF NOT EXISTS idx_nudge_sent ON nudge_history(sent_at);
`);
	console.log("[DB] Database initialized at:", dbPath);
	module.exports = {
		db,
		activityOps: {
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
		},
		nudgeOps: {
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
		}
	};
}));
//#endregion
//#region electron/monitors/activityMonitor.js
var require_activityMonitor = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var { activityOps, nudgeOps } = require_localDb();
	var { BrowserWindow: BrowserWindow$1 } = require("electron");
	var fs = require("fs");
	var path$1 = require("path");
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
	function readEnvVar(key) {
		try {
			const m = fs.readFileSync(path$1.join(__dirname, "../../.env"), "utf8").match(new RegExp(`^${key}=(.+)$`, "m"));
			return m ? m[1].trim() : "";
		} catch {
			return "";
		}
	}
	var GEMINI_API_KEY = readEnvVar("VITE_GEMINI_API_KEY");
	async function callGemini(prompt) {
		if (!GEMINI_API_KEY) return null;
		try {
			return (await (await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
					generationConfig: { maxOutputTokens: 60 }
				})
			})).json()).candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
		} catch (e) {
			console.error("[NUDGE] Gemini fetch failed:", e.message);
			return null;
		}
	}
	var fallback = {
		social: [
			"not judging but you've been scrolling for a while...",
			"okay but are you even enjoying this anymore?",
			"your future self is begging you to stop",
			"doom-scrolling update: still dooming"
		],
		noBreaks: [
			"friendly reminder: you have a body that needs things.",
			"not to be dramatic but when did you last blink?",
			"water. movement. please. for me.",
			"your spine is crying. can you hear it?"
		]
	};
	var pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
	var WATCHED_SITES = [{
		key: "youtube",
		match: (t) => t.includes("youtube")
	}, {
		key: "instagram",
		match: (t) => t.includes("instagram")
	}];
	function detectSite(title) {
		const t = (title || "").toLowerCase();
		return WATCHED_SITES.find((s) => s.match(t)) || null;
	}
	async function generateContextualNudge(windowTitle, siteKey) {
		const aiText = await callGemini(`you're thera — a brutally honest, warm AI companion on the user's desktop.\nthe user just opened: "${windowTitle.replace(/[-|–]\s*youtube\s*$/i, "").replace(/[•|]\s*instagram.*$/i, "").trim() || siteKey}" (${{
			youtube: "they just opened a youtube video.",
			instagram: "they opened instagram — probably about to scroll mindlessly."
		}[siteKey] || siteKey})\n\nwrite ONE nudge. rules:\n- max 12 words, lowercase, no quotes\n- youtube: reference the video title if telling. be dry.\n- instagram: gentle sarcasm, no lecturing.\nrespond with ONLY the nudge, nothing else.`);
		if (aiText) {
			console.log(`[NUDGE] AI nudge for ${siteKey}: "${aiText}"`);
			return aiText.replace(/^["']|["']$/g, "");
		}
		return pick(fallback.social);
	}
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
	var currentSession = null;
	var lastActivity = null;
	var monitorInterval = null;
	var seenSiteKeys = /* @__PURE__ */ new Set();
	var siteFirstSeen = /* @__PURE__ */ new Map();
	function sendNudge(type, message) {
		console.log(`[NUDGE] ${type}: "${message}"`);
		nudgeOps.recordNudge(type, message);
		const widget = BrowserWindow$1.getAllWindows().find((w) => w.isAlwaysOnTop() && !w.frame);
		if (widget) widget.webContents.send("show-nudge", message);
		else console.warn("[NUDGE] No widget window found to send nudge to");
	}
	async function checkNudges() {
		if (currentSession) {
			const detected = detectSite(currentSession.window_title);
			if (detected) {
				const key = `${currentSession.app_name}::${currentSession.window_title}`;
				if (!seenSiteKeys.has(key)) {
					if (!siteFirstSeen.has(key)) siteFirstSeen.set(key, Date.now());
					const focusedMs = Date.now() - siteFirstSeen.get(key);
					if (focusedMs < 8e3) return;
					seenSiteKeys.add(key);
					siteFirstSeen.delete(key);
					console.log(`[NUDGE] Site focused >${focusedMs}ms: ${detected.key} — "${currentSession.window_title}"`);
					sendNudge("site-detection", await generateContextualNudge(currentSession.window_title, detected.key));
					return;
				}
			} else siteFirstSeen.clear();
		}
		if (lastActivity) {
			if (activityOps.getCategoryDuration("social", 24) > 20 && nudgeOps.shouldNudge("doom-scrolling", 30)) {
				sendNudge("doom-scrolling", pick(fallback.social).replace("{app}", currentSession?.app_name || "that"));
				return;
			}
		}
		if (currentSession && lastActivity) {
			if ((Date.now() - lastActivity.started_at) / 1e3 > 30 && nudgeOps.shouldNudge("no-breaks", 45)) {
				sendNudge("no-breaks", pick(fallback.noBreaks));
				return;
			}
		}
	}
	async function pollActiveWindow() {
		try {
			const win = await getActiveWindow();
			if (!win) {
				console.log("[ACTIVITY] active-win returned null (check Accessibility permissions on macOS)");
				if (currentSession) {
					activityOps.endSession(currentSession.id);
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
					console.log(`[ACTIVITY] Ended: "${currentSession.app_name}" (${currentSession.window_title.slice(0, 60)})`);
				}
				currentSession = {
					id: activityOps.startSession(appName, windowTitle, category),
					app_name: appName,
					window_title: windowTitle,
					category,
					started_at: Date.now()
				};
				console.log(`[ACTIVITY] Started: "${appName}" [${category}] — "${windowTitle.slice(0, 80)}"`);
			}
			lastActivity = currentSession;
			await checkNudges();
		} catch (e) {
			console.error("[ACTIVITY] Poll error:", e.message);
		}
	}
	function startMonitoring() {
		console.log("[ACTIVITY] Monitor started — polling every 10s");
		setTimeout(() => sendNudge("test", "pipeline check — widget works ✓"), 3e3);
		pollActiveWindow();
		monitorInterval = setInterval(pollActiveWindow, 1e4);
	}
	function stopMonitoring() {
		if (monitorInterval) {
			clearInterval(monitorInterval);
			if (currentSession) activityOps.endSession(currentSession.id);
			console.log("[ACTIVITY] Monitor stopped");
		}
	}
	startMonitoring();
	process.on("exit", stopMonitoring);
	module.exports = {
		startMonitoring,
		stopMonitoring
	};
}));
//#endregion
//#region electron/main.js
var { app, BrowserWindow, ipcMain, Tray, Menu } = require("electron");
var path = require("path");
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
	widgetWindow.setIgnoreMouseEvents(false);
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
ipcMain.on("widget-resize", (_e, { height }) => {
	if (widgetWindow) {
		const [w] = widgetWindow.getSize();
		widgetWindow.setSize(w, height);
	}
});
app.whenReady().then(() => {
	createWindow();
	createWidgetWindow();
	createTray();
	require_activityMonitor();
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
