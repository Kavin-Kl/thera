const path = require('path');
const fs = require('fs');

// Load .env before anything else — dotenv v17 is ESM-only so we parse manually
try {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && !(key in process.env)) process.env[key] = val;
    }
  }
} catch (e) {
  console.warn('Failed to load .env:', e.message);
}

const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const settings = require('./settings');
const { sessionOps, messageOps, connectorOps, moodOps, crisisOps } = require('./db/localDb');
const googleConnector = require('./connectors/google');
const spotifyConnector = require('./connectors/spotify');
const slackConnector = require('./connectors/slack');
const actions = require('./connectors/actions');
const tokenStore = require('./connectors/tokenStore');
const { runOAuthFlow } = require('./connectors/oauthLoopback');
const bridgeClient = require('./bridgeClient');
const wsBridge = require('./wsBridge');

let mainWindow;
let widgetWindow;
let tray;
let store;
let closingAnimation = false; // prevents blur handler from hiding window mid-animation

// Current authenticated user — updated via auth:set-user IPC
let currentUserId = 'desktop_user';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 627,
    minWidth: 350,
    minHeight: 500,
    frame: false,
    transparent: true,
    hasShadow: true,
    skipTaskbar: false,
    alwaysOnTop: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Load the Vite dev server in development or the built files in production
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    //mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Hide window instead of closing
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // macOS tray highlight when main window is shown
  mainWindow.on('show', () => {
    if (process.platform === 'darwin' && tray && tray.setHighlightMode) {
      tray.setHighlightMode('always');
    }
  });

  // When main window is hidden → ensure widget is visible
  mainWindow.on('hide', () => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.webContents.send('widget-visibility', true);
    }
  });

  // Auto-hide when user clicks away (not during close animation)
  mainWindow.on('blur', () => {
    if (closingAnimation) return;
    setTimeout(() => {
      if (!closingAnimation && !mainWindow.isFocused() && mainWindow.isVisible()) {
        mainWindow.hide();
      }
    }, 200);
  });
}

function createWidgetWindow() {
  // Get position (default to top-center)
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // Window wide enough for expanded nudge, tall enough for multi-line text
  const W = 400, H = 110;
  const savedPosition = {
    x: Math.floor((screenWidth - W) / 2), // re-centred for new width
    y: 0,
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
      contextIsolation: false,
    },
  });

  // Load widget HTML
  if (process.env.VITE_DEV_SERVER_URL) {
    const baseURL = process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '');
    widgetWindow.loadURL(`${baseURL}/widget.html`);
  } else {
    widgetWindow.loadFile(path.join(__dirname, '../dist/widget.html'));
  }

  console.log('[WIDGET] Widget window created at position:', savedPosition);

  // Transparent areas pass clicks through to whatever is underneath.
  // The React side sends 'set-widget-interactive' on mouseenter/leave to toggle this.
  widgetWindow.setIgnoreMouseEvents(true, { forward: true });

  // Debug: Log window events
  widgetWindow.on('closed', () => {
    console.log('[WIDGET] Widget window closed');
  });

  widgetWindow.on('hide', () => {
    console.log('[WIDGET] Widget window hidden');
  });

  widgetWindow.on('show', () => {
    console.log('[WIDGET] Widget window shown');
  });

  widgetWindow.webContents.on('did-finish-load', () => {
    console.log('[WIDGET] Widget finished loading');
    // Send initial visibility — show widget unless main window is currently open & visible
    const mainVisible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
    widgetWindow.webContents.send('widget-visibility', !mainVisible);
  });

  widgetWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[WIDGET] Widget failed to load:', errorCode, errorDescription);
  });

  // TODO: Add position persistence later with electron-store
}

function createTray() {
  const { nativeImage } = require('electron');

  const iconSize = process.platform === 'darwin' ? 16 : 24;
  const trayIcon = nativeImage
    .createFromPath(path.join(__dirname, '..', 'thera.png'))
    .resize({ width: iconSize, height: iconSize });

  if (process.platform === 'darwin') {
    trayIcon.setTemplateImage(true);
  }

  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Thera',
      click: () => expandFromPill(),
    },
    {
      label: 'Hide Thera',
      click: () => {
        mainWindow.hide();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Thera - Your desktop companion');
  tray.setContextMenu(contextMenu);

  // Click tray icon to show/hide
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      ipcMain.emit('close-window'); // use the animated close
    } else {
      expandFromPill();
    }
  });
}

// Window control handlers
ipcMain.on('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

/* ── Pill geometry (shared by both animations) ──────────── */
const PILL_W = 180, PILL_H = 36;

function getPillBounds() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    const [wx, wy] = widgetWindow.getPosition();
    const [ww]     = widgetWindow.getSize();
    return {
      x: wx + Math.round((ww - PILL_W) / 2),
      y: wy + 8,
      w: PILL_W,
      h: PILL_H,
    };
  }
  return { x: 0, y: 0, w: PILL_W, h: PILL_H };
}

function getCenteredBounds() {
  const { screen } = require('electron');
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const W = 900, H = 627;
  return { x: Math.round((width - W) / 2), y: Math.round((height - H) / 2), w: W, h: H };
}

/* ── CLOSE: main window flies into the pill ─────────────── */
ipcMain.on('close-window', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.webContents.send('start-close-animation');

  const [startX, startY] = mainWindow.getPosition();
  const [startW, startH] = mainWindow.getSize();
  const pill = getPillBounds();

  mainWindow.setMinimumSize(1, 1);
  closingAnimation = true;

  const DURATION = 350, FPS = 60, FRAME_MS = 1000 / FPS;
  const FRAMES = Math.round(DURATION / FRAME_MS);
  let frame = 0, widgetShown = false;

  const tick = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) { clearInterval(tick); return; }

    frame++;
    const t    = Math.min(frame / FRAMES, 1);
    const ease = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;

    mainWindow.setPosition(
      Math.round(startX + (pill.x - startX) * ease),
      Math.round(startY + (pill.y - startY) * ease),
    );
    mainWindow.setSize(
      Math.max(Math.round(startW + (pill.w - startW) * ease), 1),
      Math.max(Math.round(startH + (pill.h - startH) * ease), 1),
    );

    // Fade out window opacity (including shadow) in the last 35%
    mainWindow.setOpacity(t >= 0.65 ? Math.max(0, 1 - (t - 0.65) / 0.35) : 1);

    // Show widget at 50% — alwaysOnTop covers the fading window
    if (!widgetShown && t >= 0.50) {
      widgetShown = true;
      if (widgetWindow && !widgetWindow.isDestroyed()) {
        widgetWindow.webContents.send('widget-visibility', true);
      }
    }

    if (t >= 1) {
      clearInterval(tick);
      setTimeout(() => {
        closingAnimation = false;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.hide();
          mainWindow.setOpacity(1);         // restore for next open
          mainWindow.setMinimumSize(350, 500);
          mainWindow.setSize(startW, startH);
          mainWindow.setPosition(startX, startY);
        }
      }, 60);
    }
  }, FRAME_MS);
});

ipcMain.on('toggle-always-on-top', (event, alwaysOnTop) => {
  if (mainWindow) mainWindow.setAlwaysOnTop(alwaysOnTop);
});

/* ── OPEN: pill expands into the main window ─────────────── */
function expandFromPill() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const pill    = getPillBounds();
  const target  = getCenteredBounds();

  // Place window at pill, invisible, then animate outward
  mainWindow.setMinimumSize(1, 1);
  mainWindow.setSize(pill.w, pill.h);
  mainWindow.setPosition(pill.x, pill.y);
  mainWindow.setOpacity(0);
  mainWindow.showInactive(); // show without stealing focus yet

  // Hide widget immediately — window will expand over its position
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.webContents.send('widget-visibility', false);
  }

  mainWindow.webContents.send('start-open-animation');

  const DURATION = 350, FPS = 60, FRAME_MS = 1000 / FPS;
  const FRAMES = Math.round(DURATION / FRAME_MS);
  let frame = 0;

  const tick = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) { clearInterval(tick); return; }

    frame++;
    const t    = Math.min(frame / FRAMES, 1);
    const ease = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;

    mainWindow.setPosition(
      Math.round(pill.x + (target.x - pill.x) * ease),
      Math.round(pill.y + (target.y - pill.y) * ease),
    );
    mainWindow.setSize(
      Math.max(Math.round(pill.w + (target.w - pill.w) * ease), 1),
      Math.max(Math.round(pill.h + (target.h - pill.h) * ease), 1),
    );

    // Fade window in during first 35%
    mainWindow.setOpacity(t <= 0.35 ? t / 0.35 : 1);

    if (t >= 1) {
      clearInterval(tick);
      mainWindow.setOpacity(1);
      mainWindow.setMinimumSize(350, 500);
      mainWindow.setSize(target.w, target.h);
      mainWindow.setPosition(target.x, target.y);
      mainWindow.focus();
    }
  }, FRAME_MS);
}

// Widget interaction handlers
ipcMain.on('widget-clicked', () => {
  if (widgetWindow) widgetWindow.webContents.send('dismiss-nudge');
});

ipcMain.on('widget-long-press', () => {
  expandFromPill();
});

// Drag: move widget window to absolute screen position
ipcMain.on('move-widget', (_e, { x, y }) => {
  if (widgetWindow) widgetWindow.setPosition(Math.round(x), Math.round(y));
});

// Get widget position (fix drift on Windows)
ipcMain.handle('get-widget-position', () => {
  if (widgetWindow) {
    const [x, y] = widgetWindow.getPosition();
    return { x, y };
  }
  return { x: 0, y: 0 };
});

// Resize widget window (idle ↔ mini chat)
ipcMain.on('widget-resize', (_e, { height }) => {
  if (widgetWindow) {
    const [w] = widgetWindow.getSize();
    widgetWindow.setSize(w, height);
  }
});

// Mouse over pill → capture events; mouse out → pass through to desktop
ipcMain.on('set-widget-interactive', (_e, interactive) => {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  if (interactive) {
    widgetWindow.setIgnoreMouseEvents(false);
  } else {
    widgetWindow.setIgnoreMouseEvents(true, { forward: true });
  }
});

// Settings: get and set
ipcMain.handle('get-setting', (_e, key) => settings.get(key));
ipcMain.on('set-setting', (_e, key, value) => settings.set(key, value));

// ── Auth ──────────────────────────────────────────────────────
// Renderer notifies main of the current Supabase user on login/logout
ipcMain.on('auth:set-user', (_e, userId) => {
  currentUserId = userId || 'desktop_user';
  tokenStore.setUser(currentUserId);
  console.log('[AUTH] User set to:', currentUserId);
  syncConnectorStates(); // re-sync connector UI for this user
});

// Supabase Google OAuth via loopback — renderer sends the OAuth URL,
// main opens it in the system browser and captures the code.
const AUTH_CALLBACK_PORT = 51235;
ipcMain.handle('auth:google-oauth', async (_e, authUrl) => {
  try {
    const query = await runOAuthFlow({
      buildAuthUrl: () => authUrl,
      callbackPath: '/auth/callback',
      fixedPort: AUTH_CALLBACK_PORT,
    });
    console.log('[AUTH] Google OAuth callback received');
    return { code: query.code };
  } catch (e) {
    console.error('[AUTH] Google OAuth failed:', e.message);
    return { error: e.message };
  }
});

// Widget quick actions (Spotify controls)
const widgetActions = require('./widgetActions');
ipcMain.handle('widget:spotify:next', () => widgetActions.spotifyNext());
ipcMain.handle('widget:spotify:previous', () => widgetActions.spotifyPrevious());
ipcMain.handle('widget:spotify:toggle', () => widgetActions.spotifyToggle());
ipcMain.handle('widget:spotify:disable-repeat', () => widgetActions.spotifyDisableRepeat());
ipcMain.handle('widget:spotify:get-current', () => widgetActions.spotifyGetCurrent());

// ── Sessions ──────────────────────────────────────────────────
ipcMain.handle('sessions:list', () => sessionOps.list(currentUserId));
ipcMain.handle('sessions:create', (_e, { id, title } = {}) => {
  const sessionId = id || `thera_${Date.now()}`;
  return sessionOps.create(sessionId, title || 'new session', currentUserId);
});
ipcMain.handle('sessions:rename', (_e, { id, title }) => {
  sessionOps.rename(id, title);
  return true;
});
ipcMain.handle('sessions:delete', (_e, { id }) => {
  sessionOps.delete(id);
  return true;
});
ipcMain.handle('sessions:messages', (_e, { id }) => messageOps.listForSession(id));
ipcMain.handle('sessions:add-message', (_e, { sessionId, role, text }) => {
  return messageOps.add(sessionId, role, text);
});

// ── Connectors — see per-user handlers registered above ───────

const GOOGLE_KEYS = ['gmail', 'gcal', 'gcontacts', 'gdrive', 'gdocs', 'gsheets'];

/** Build a per-user connector key for the DB. */
function userKey(connector) {
  return `${currentUserId}:${connector}`;
}

// Sync persisted token state into the connectors table so the UI reflects
// what's actually authenticated even after a restart.
function syncConnectorStates() {
  if (googleConnector.isConnected()) {
    GOOGLE_KEYS.forEach(k => connectorOps.upsert(userKey(k), { enabled: true, status: 'connected' }));
  } else {
    GOOGLE_KEYS.forEach(k => connectorOps.upsert(userKey(k), { enabled: false, status: 'disconnected' }));
  }
  if (spotifyConnector.isConnected()) {
    connectorOps.upsert(userKey('spotify'), { enabled: true, status: 'connected' });
  } else {
    connectorOps.upsert(userKey('spotify'), { enabled: false, status: 'disconnected' });
  }
  if (slackConnector.isConnected()) {
    connectorOps.upsert(userKey('slack'), { enabled: true, status: 'connected' });
  } else {
    connectorOps.upsert(userKey('slack'), { enabled: false, status: 'disconnected' });
  }
}

// List connectors for the current user (strips userId prefix before returning)
ipcMain.handle('connectors:list', () => connectorOps.listForUser(currentUserId));

ipcMain.handle('connectors:upsert', (_e, { key, enabled, status, metadata }) => {
  const dbKey = userKey(key);
  connectorOps.upsert(dbKey, { enabled, status, metadata });
  const r = connectorOps.get(dbKey);
  return r ? { ...r, key } : null; // strip prefix before returning
});

ipcMain.handle('connectors:credentials', () => ({
  google: googleConnector.hasCredentials(),
  spotify: spotifyConnector.hasCredentials(),
  slack: slackConnector.hasCredentials(),
}));

ipcMain.handle('connectors:google:connect', async () => {
  try {
    await googleConnector.connect();
    GOOGLE_KEYS.forEach(k => connectorOps.upsert(userKey(k), { enabled: true, status: 'connected' }));
    return { ok: true };
  } catch (e) {
    console.error('[GOOGLE] connect failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('connectors:google:disconnect', async () => {
  googleConnector.disconnect();
  GOOGLE_KEYS.forEach(k => connectorOps.upsert(userKey(k), { enabled: false, status: 'disconnected' }));
  return { ok: true };
});

ipcMain.handle('connectors:spotify:connect', async () => {
  try {
    await spotifyConnector.connect();
    connectorOps.upsert(userKey('spotify'), { enabled: true, status: 'connected' });
    return { ok: true };
  } catch (e) {
    console.error('[SPOTIFY] connect failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('connectors:spotify:disconnect', () => {
  spotifyConnector.disconnect();
  connectorOps.upsert(userKey('spotify'), { enabled: false, status: 'disconnected' });
  return { ok: true };
});

ipcMain.handle('connectors:slack:connect', async () => {
  try {
    await slackConnector.connect();
    connectorOps.upsert(userKey('slack'), { enabled: true, status: 'connected' });
    return { ok: true };
  } catch (e) {
    console.error('[SLACK] connect failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('connectors:slack:disconnect', () => {
  slackConnector.disconnect();
  connectorOps.upsert(userKey('slack'), { enabled: false, status: 'disconnected' });
  return { ok: true };
});

// AI action executor
ipcMain.handle('actions:execute', (_e, action) => actions.execute(action));

// ── Browser command bridge (LangChain tools → WebSocket → extension) ──────────
// Tools in src/services/tools/ call this IPC handler to forward commands to
// the Chrome extension over the WebSocket bridge (wsBridge.js).
ipcMain.handle('browser:command', async (_e, { action, payload, timeout }) => {
  try {
    const data = await wsBridge.sendCommand(action, payload, timeout || 30000);
    return { success: true, data };
  } catch (err) {
    console.error('[BROWSER-CMD]', action, 'failed:', err.message);
    return { success: false, error: err.message };
  }
});

// ── Mood ──────────────────────────────────────────────────────
ipcMain.handle('mood:log', (_e, entry) => moodOps.log({ ...(entry || {}), user_id: currentUserId }));
ipcMain.handle('mood:daily', (_e, days) => moodOps.daily(days || 30, currentUserId));
ipcMain.handle('mood:recent', (_e, limit) => moodOps.recent(limit || 20, currentUserId));

// ── Crisis ────────────────────────────────────────────────────
ipcMain.handle('crisis:record', (_e, evt) => crisisOps.record({ severity: 'amber', ...(evt || {}), user_id: currentUserId }));
ipcMain.handle('crisis:resolve', (_e, id) => { crisisOps.resolve(id); return true; });
ipcMain.handle('crisis:active', () => crisisOps.active(currentUserId));

// ── Weekly roast: pull last 7 days of mood + activity for Gemini to summarize
ipcMain.handle('roast:context', () => {
  const moodDays   = moodOps.daily(7, currentUserId);
  const moodRecent = moodOps.recent(50, currentUserId);
  const activity   = require('./db/localDb').activityOps.getRecentActivity(24 * 7, currentUserId);
  return { moodDays, moodRecent, activity };
});

// Screen capture for AI context (Tier 3 — on-demand, main-process only in Electron 20+)
ipcMain.handle('screen:capture', async () => {
  const { desktopCapturer, screen } = require('electron');
  try {
    const { width, height } = screen.getPrimaryDisplay().bounds;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(width / 2), height: Math.round(height / 2) },
    });
    if (!sources.length) return { ok: false, error: 'no screen sources found' };
    const dataURL = sources[0].thumbnail.toDataURL('image/jpeg', 0.7);
    return { ok: true, base64: dataURL.split(',')[1], mimeType: 'image/jpeg' };
  } catch (e) {
    console.error('[SCREEN] capture error:', e.message);
    return { ok: false, error: e.message };
  }
});

// ── System context ────────────────────────────────────────────
// Returns current active desktop window via active-win (ESM, lazy-imported)
ipcMain.handle('system:active-app', async () => {
  try {
    const mod = await import('active-win');
    const activeWin = mod.default ?? mod;
    const win = await activeWin();
    if (!win) return null;
    return {
      app:   win.owner?.name || win.owner?.processName || null,
      title: win.title || null,
      url:   win.url || null,
      pid:   win.owner?.processId || null,
    };
  } catch (e) {
    console.warn('[SYSTEM] active-win failed:', e.message);
    return null;
  }
});

// Returns a short summary of recent desktop activity from the activity monitor
ipcMain.handle('system:activity-summary', () => {
  try {
    const { activityOps } = require('./db/localDb');
    const recent = activityOps.getRecentActivity(2, currentUserId); // last 2 hours
    if (!recent?.length) return 'No recent activity recorded.';
    const grouped = {};
    for (const row of recent) {
      const key = row.app_name || 'Unknown';
      grouped[key] = (grouped[key] || 0) + (row.duration_seconds || 0);
    }
    const lines = Object.entries(grouped)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([app, secs]) => `${app}: ${Math.round(secs / 60)} min`);
    return `Last 2 hours:\n${lines.join('\n')}`;
  } catch (e) {
    return 'Activity data unavailable.';
  }
});

// Permission requests
ipcMain.handle('request-permissions', async () => {
  const { systemPreferences } = require('electron');

  if (process.platform === 'darwin') {
    // macOS - request accessibility and screen recording permissions
    const accessibilityStatus = systemPreferences.getMediaAccessStatus('screen');
    console.log('[PERMISSIONS] macOS screen recording status:', accessibilityStatus);

    if (accessibilityStatus !== 'granted') {
      // Open System Preferences
      const { shell } = require('electron');
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');

      return {
        granted: false,
        platform: 'darwin',
        message: 'Please grant screen recording permission in System Preferences > Privacy & Security > Screen Recording'
      };
    }

    return { granted: true, platform: 'darwin' };
  } else if (process.platform === 'win32') {
    // Windows - no special permissions needed, active-win works without prompts
    console.log('[PERMISSIONS] Windows - no special permissions required');
    return { granted: true, platform: 'win32' };
  }

  return { granted: true, platform: 'unknown' };
});

// ── Browser Extension Bridge ──────────────────────────────────
let lastTabData = null;
const pendingExtCommands = [];
const longPollWaiters = []; // resolve functions waiting for next command

function startExtensionBridge() {
  const http = require('http');
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    // Required for Chrome/Edge Manifest V3 extensions fetching localhost (Private Network Access)
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.url === '/tab' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.type === 'automate-result' || data.type === 'screenshot-result') {
            console.log('[BRIDGE]', data.type, 'received taskId:', data.taskId, JSON.stringify(data).slice(0, 200));
            // Resolve any pending waitForTask() in actions.js
            bridgeClient.resolveTask(data.taskId, data.result || data);
            const win = widgetWindow || mainWindow;
            if (win) win.webContents.send('extension-automate-result', data);
            else console.warn('[BRIDGE]', data.type, ': no window to send to');
          } else {
            lastTabData = data;
            if (widgetWindow) widgetWindow.webContents.send('extension-tab', data);
          }
        } catch (e) { console.error('[BRIDGE] /tab parse error:', e.message); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    if (req.url.startsWith('/commands') && req.method === 'GET') {
      const cmds = pendingExtCommands.splice(0);
      if (cmds.length > 0 || !req.url.includes('wait=1')) {
        if (cmds.length > 0) console.log('[BRIDGE] /commands returning immediately:', cmds.map(c=>c.type));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(cmds));
      } else {
        // Long-poll: hold the response for up to 25s, flush when command arrives
        console.log('[BRIDGE] /commands long-poll registered, waiters now:', longPollWaiters.length + 1);
        const timer = setTimeout(() => {
          const i = longPollWaiters.findIndex(w => w.res === res);
          if (i >= 0) longPollWaiters.splice(i, 1);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('[]');
        }, 25000);
        longPollWaiters.push({ res, timer });
        req.on('close', () => {
          clearTimeout(timer);
          const i = longPollWaiters.findIndex(w => w.res === res);
          if (i >= 0) longPollWaiters.splice(i, 1);
        });
      }
      return;
    }

    // actions.js calls this to queue a command for the extension
    if (req.url === '/ext-command' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const cmd = JSON.parse(body);
          console.log('[BRIDGE] /ext-command received:', cmd.type, 'taskId:', cmd.taskId, '| waiters:', longPollWaiters.length);
          pendingExtCommands.push(cmd);
          // Immediately flush to any waiting long-poll connection
          if (longPollWaiters.length > 0) {
            const { res: waitRes, timer } = longPollWaiters.shift();
            clearTimeout(timer);
            const toFlush = pendingExtCommands.splice(0);
            console.log('[BRIDGE] flushing to long-poll waiter:', toFlush.map(c=>c.type));
            waitRes.writeHead(200, { 'Content-Type': 'application/json' });
            waitRes.end(JSON.stringify(toFlush));
          } else {
            console.warn('[BRIDGE] no long-poll waiter — command queued, extension will pick up next poll (extension connected?)');
          }
        } catch (e) { console.error('[BRIDGE] /ext-command parse error:', e.message); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    res.writeHead(404); res.end();
  });

  server.on('error', e => console.warn('[BRIDGE] Extension bridge error:', e.message));
  server.listen(7979, '127.0.0.1', () => console.log('[BRIDGE] Extension bridge on port 7979'));
}

ipcMain.handle('extension:get-tab', () => lastTabData);
ipcMain.handle('extension:send-command', (_e, cmd) => {
  pendingExtCommands.push(cmd);
  return { ok: true };
});

app.whenReady().then(() => {
  syncConnectorStates();
  createWindow();
  createWidgetWindow();
  createTray();
  startExtensionBridge();

  // Start WebSocket bridge for LangChain tool commands (port 7980)
  wsBridge.startWsBridge((msg) => {
    // Forward unsolicited extension events (tab info, scroll activity) to windows
    const win = widgetWindow || mainWindow;
    if (!win) return;
    if (msg.type === 'tab-info') win.webContents.send('extension-tab', msg);
    else if (msg.type === 'automate-result') win.webContents.send('extension-automate-result', msg);
  });

  // Start activity monitoring after windows are created
  setTimeout(() => {
    const { startMonitoring } = require('./monitors/activityMonitor');
    startMonitoring();
  }, 2000); // Give windows time to fully initialize
});

app.on('window-all-closed', (e) => {
  // Keep app running in background
  e.preventDefault();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    mainWindow.show();
  }
});
