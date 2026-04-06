//#region \0rolldown/runtime.js
var __commonJSMin = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
//#endregion
//#region electron/db/localDb.js
var require_localDb = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Database = require("better-sqlite3");
	var path$1 = require("path");
	var { app: app$1 } = require("electron");
	var dbPath = path$1.join(app$1.getPath("userData"), "thera.db");
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
	var activeWin = require("active-win");
	var { activityOps, nudgeOps } = require_localDb();
	var { BrowserWindow: BrowserWindow$1 } = require("electron");
	var nudgeMessages = {
		social: [
			"not judging but you've been on {app} for a while...",
			"hey. still scrolling? just checking in.",
			"{app} isn't going anywhere. neither am i.",
			"okay but are you even enjoying this anymore?",
			"quick break maybe? i'll be here when you're back.",
			"instagram won't solve this one babe",
			"twitter drama can wait. you can't.",
			"doom-scrolling update: still dooming",
			"what if you just... closed {app}? wild idea i know",
			"your future self is begging you to stop"
		],
		noBreaks: [
			"you've been staring at {app} for 2 hours straight.",
			"friendly reminder: you have a body that needs things.",
			"not to be dramatic but when did you last blink?",
			"break time. seriously. i insist.",
			"still there? just making sure you're alive.",
			"water. movement. please. for me.",
			"pretty sure you've merged with your chair at this point",
			"2 hours on {app}. impressive. concerning. but impressive.",
			"your spine is crying. can you hear it?",
			"the world will still be here in 5 minutes. promise."
		]
	};
	function getRandomNudge(type, appName) {
		const messages = nudgeMessages[type] || nudgeMessages.social;
		return messages[Math.floor(Math.random() * messages.length)].replace("{app}", appName);
	}
	function categorizeApp(appName, windowTitle) {
		const app = appName.toLowerCase();
		const title = (windowTitle || "").toLowerCase();
		if (app.includes("discord") || app.includes("slack") || app.includes("whatsapp") || app.includes("telegram") || title.includes("twitter") || title.includes("facebook") || title.includes("instagram") || title.includes("tiktok")) return "social";
		if (app.includes("code") || app.includes("visual studio") || app.includes("intellij") || app.includes("pycharm") || app.includes("webstorm") || app.includes("sublime") || app.includes("atom") || app.includes("vim") || app.includes("terminal") || app.includes("cmd") || app.includes("powershell") || app.includes("cursor")) return "coding";
		if (app.includes("excel") || app.includes("word") || app.includes("powerpoint") || app.includes("outlook") || app.includes("teams") || app.includes("zoom") || app.includes("meet") || app.includes("notion") || title.includes("jira") || title.includes("asana")) return "work";
		if (app.includes("spotify") || app.includes("netflix") || app.includes("youtube") || app.includes("steam") || app.includes("game") || app.includes("twitch") || title.includes("youtube") || title.includes("netflix")) return "entertainment";
		if (app.includes("chrome") || app.includes("firefox") || app.includes("safari") || app.includes("edge") || app.includes("brave") || app.includes("browser")) return "browsing";
		return "other";
	}
	var currentSession = null;
	var lastActivity = null;
	var monitorInterval = null;
	var nudgeChecks = [{
		type: "doom-scrolling",
		check: () => {
			if (!lastActivity) return null;
			const duration = activityOps.getCategoryDuration("social", 24);
			console.log("[NUDGE] Checking doom-scrolling: category=social, duration=", duration, "seconds");
			if (duration > 20 && nudgeOps.shouldNudge("doom-scrolling", 30)) {
				const appName = currentSession?.app_name || "social media";
				console.log("[NUDGE] Triggering doom-scrolling nudge for:", appName);
				return getRandomNudge("social", appName);
			}
			return null;
		}
	}, {
		type: "no-breaks",
		check: () => {
			if (!lastActivity || !currentSession) return null;
			const sessionDuration = (Date.now() - lastActivity.started_at) / 1e3;
			console.log("[NUDGE] Checking no-breaks: sessionDuration=", sessionDuration, "seconds");
			if (sessionDuration > 30 && nudgeOps.shouldNudge("no-breaks", 45)) {
				const appName = currentSession?.app_name || "this app";
				console.log("[NUDGE] Triggering no-breaks nudge for:", appName);
				return getRandomNudge("noBreaks", appName);
			}
			return null;
		}
	}];
	function checkNudges() {
		nudgeChecks.forEach(({ type, check }) => {
			const message = check();
			if (message) sendNudge(type, message);
		});
	}
	function sendNudge(type, messageData) {
		const message = typeof messageData === "string" ? messageData : getRandomNudge(type, messageData);
		console.log(`[NUDGE] ${type}: ${message}`);
		nudgeOps.recordNudge(type, message);
		const widgetWindow = BrowserWindow$1.getAllWindows().find((w) => w.isAlwaysOnTop() && !w.frame);
		if (widgetWindow) widgetWindow.webContents.send("show-nudge", message);
	}
	async function pollActiveWindow() {
		try {
			const window = await activeWin();
			if (!window) {
				if (currentSession) {
					activityOps.endSession(currentSession.id);
					console.log("[ACTIVITY] Session ended:", currentSession.app_name);
					currentSession = null;
				}
				return;
			}
			const { owner: { name: appName }, title: windowTitle } = window;
			const category = categorizeApp(appName, windowTitle);
			if (!currentSession || currentSession.app_name !== appName || currentSession.window_title !== windowTitle) {
				if (currentSession) {
					activityOps.endSession(currentSession.id);
					const duration = (Date.now() - currentSession.started_at) / 1e3;
					console.log(`[ACTIVITY] Session ended: ${currentSession.app_name} (${Math.round(duration)}s)`);
				}
				currentSession = {
					id: activityOps.startSession(appName, windowTitle, category),
					app_name: appName,
					window_title: windowTitle,
					category,
					started_at: Date.now()
				};
				console.log(`[ACTIVITY] New session: ${appName} [${category}]`);
			}
			lastActivity = currentSession;
			checkNudges();
		} catch (error) {
			console.error("[ACTIVITY] Error polling window:", error.message);
		}
	}
	function startMonitoring() {
		console.log("[ACTIVITY] Starting activity monitor (polling every 10 seconds)");
		pollActiveWindow();
		monitorInterval = setInterval(pollActiveWindow, 1e4);
	}
	function stopMonitoring() {
		if (monitorInterval) {
			clearInterval(monitorInterval);
			if (currentSession) activityOps.endSession(currentSession.id);
			console.log("[ACTIVITY] Activity monitor stopped");
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
	if (process.env.VITE_DEV_SERVER_URL) {
		mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
		mainWindow.webContents.openDevTools();
	} else mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
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
	const savedPosition = {
		x: Math.floor((screenWidth - 300) / 2),
		y: 0
	};
	widgetWindow = new BrowserWindow({
		width: 300,
		height: 32,
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
		const widgetURL = `${process.env.VITE_DEV_SERVER_URL.replace(/\/$/, "")}/widget.html`;
		console.log("[WIDGET] Loading widget from:", widgetURL);
		widgetWindow.loadURL(widgetURL);
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
