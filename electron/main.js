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

let mainWindow;
let widgetWindow;
let tray;
let store;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 627,
    minWidth: 350,
    minHeight: 500,
    frame: false,
    backgroundColor: '#18120a',
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

  // Show window on restore
  mainWindow.on('show', () => {
    // setHighlightMode is macOS-only
    if (process.platform === 'darwin' && tray.setHighlightMode) {
      tray.setHighlightMode('always');
    }
  });

  // Auto-hide when user clicks away
  mainWindow.on('blur', () => {
    setTimeout(() => {
      if (!mainWindow.isFocused() && mainWindow.isVisible()) {
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

  // On Windows: forward mouse events through transparent areas, but keep pill/chat interactive
  // On macOS: the React pointerEvents CSS handles this correctly
  if (process.platform === 'win32') {
    widgetWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    widgetWindow.setIgnoreMouseEvents(false);
  }

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
  });

  widgetWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[WIDGET] Widget failed to load:', errorCode, errorDescription);
  });

  // TODO: Add position persistence later with electron-store
}

function createTray() {
  const { nativeImage } = require('electron');

  const trayIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'thera.png'));

  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Thera',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
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
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Window control handlers
ipcMain.on('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('close-window', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.on('toggle-always-on-top', (event, alwaysOnTop) => {
  if (mainWindow) mainWindow.setAlwaysOnTop(alwaysOnTop);
});

// Widget interaction handlers
ipcMain.on('widget-clicked', () => {
  if (widgetWindow) widgetWindow.webContents.send('dismiss-nudge');
});

ipcMain.on('widget-long-press', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
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

// Enable/disable mouse event forwarding (for Windows drag fix)
ipcMain.on('set-widget-interactive', (_e, interactive) => {
  if (widgetWindow && process.platform === 'win32') {
    if (interactive) {
      widgetWindow.setIgnoreMouseEvents(false);
    } else {
      widgetWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  }
});

// Settings: get and set
ipcMain.handle('get-setting', (_e, key) => settings.get(key));
ipcMain.on('set-setting', (_e, key, value) => settings.set(key, value));

// Widget quick actions (Spotify controls)
const widgetActions = require('./widgetActions');
ipcMain.handle('widget:spotify:next', () => widgetActions.spotifyNext());
ipcMain.handle('widget:spotify:previous', () => widgetActions.spotifyPrevious());
ipcMain.handle('widget:spotify:toggle', () => widgetActions.spotifyToggle());
ipcMain.handle('widget:spotify:disable-repeat', () => widgetActions.spotifyDisableRepeat());
ipcMain.handle('widget:spotify:get-current', () => widgetActions.spotifyGetCurrent());

// ── Sessions ──────────────────────────────────────────────────
ipcMain.handle('sessions:list', () => sessionOps.list());
ipcMain.handle('sessions:create', (_e, { id, title } = {}) => {
  const sessionId = id || `thera_${Date.now()}`;
  return sessionOps.create(sessionId, title || 'new session');
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

// ── Connectors ────────────────────────────────────────────────
ipcMain.handle('connectors:list', () => connectorOps.list());
ipcMain.handle('connectors:upsert', (_e, { key, enabled, status, metadata }) => {
  connectorOps.upsert(key, { enabled, status, metadata });
  return connectorOps.get(key);
});

const GOOGLE_KEYS = ['gmail', 'gcal', 'gcontacts', 'gdrive', 'gdocs', 'gsheets'];

// Sync persisted token state into the connectors table on startup so the UI
// reflects what's actually authenticated even after a restart.
function syncConnectorStates() {
  if (googleConnector.isConnected()) {
    GOOGLE_KEYS.forEach(k => connectorOps.upsert(k, { enabled: true, status: 'connected' }));
  }
  if (spotifyConnector.isConnected()) {
    connectorOps.upsert('spotify', { enabled: true, status: 'connected' });
  }
  if (slackConnector.isConnected()) {
    connectorOps.upsert('slack', { enabled: true, status: 'connected' });
  }
}

ipcMain.handle('connectors:credentials', () => ({
  google: googleConnector.hasCredentials(),
  spotify: spotifyConnector.hasCredentials(),
  slack: slackConnector.hasCredentials(),
}));

ipcMain.handle('connectors:google:connect', async () => {
  try {
    await googleConnector.connect();
    GOOGLE_KEYS.forEach(k => connectorOps.upsert(k, { enabled: true, status: 'connected' }));
    return { ok: true };
  } catch (e) {
    console.error('[GOOGLE] connect failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('connectors:google:disconnect', async () => {
  googleConnector.disconnect();
  GOOGLE_KEYS.forEach(k => connectorOps.upsert(k, { enabled: false, status: 'disconnected' }));
  return { ok: true };
});

ipcMain.handle('connectors:spotify:connect', async () => {
  try {
    await spotifyConnector.connect();
    connectorOps.upsert('spotify', { enabled: true, status: 'connected' });
    return { ok: true };
  } catch (e) {
    console.error('[SPOTIFY] connect failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('connectors:spotify:disconnect', () => {
  spotifyConnector.disconnect();
  connectorOps.upsert('spotify', { enabled: false, status: 'disconnected' });
  return { ok: true };
});

ipcMain.handle('connectors:slack:connect', async () => {
  try {
    await slackConnector.connect();
    connectorOps.upsert('slack', { enabled: true, status: 'connected' });
    return { ok: true };
  } catch (e) {
    console.error('[SLACK] connect failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('connectors:slack:disconnect', () => {
  slackConnector.disconnect();
  connectorOps.upsert('slack', { enabled: false, status: 'disconnected' });
  return { ok: true };
});

// AI action executor
ipcMain.handle('actions:execute', (_e, action) => actions.execute(action));

// ── Mood ──────────────────────────────────────────────────────
ipcMain.handle('mood:log', (_e, entry) => moodOps.log(entry || {}));
ipcMain.handle('mood:daily', (_e, days) => moodOps.daily(days || 30));
ipcMain.handle('mood:recent', (_e, limit) => moodOps.recent(limit || 20));

// ── Crisis ────────────────────────────────────────────────────
ipcMain.handle('crisis:record', (_e, evt) => crisisOps.record(evt || { severity: 'amber' }));
ipcMain.handle('crisis:resolve', (_e, id) => { crisisOps.resolve(id); return true; });
ipcMain.handle('crisis:active', () => crisisOps.active());

// ── Weekly roast: pull last 7 days of mood + activity for Gemini to summarize
ipcMain.handle('roast:context', () => {
  const moodDays = moodOps.daily(7);
  const moodRecent = moodOps.recent(50);
  const activity = require('./db/localDb').activityOps.getRecentActivity(24 * 7);
  return { moodDays, moodRecent, activity };
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
          if (data.type === 'automate-result') {
            console.log('[BRIDGE] automate-result received:', JSON.stringify(data).slice(0, 300));
            const win = widgetWindow || mainWindow;
            if (win) win.webContents.send('extension-automate-result', data);
            else console.warn('[BRIDGE] automate-result: no window to send to');
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
