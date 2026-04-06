const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');

let mainWindow;
let widgetWindow;
let tray;
let store;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
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

  // Always capture mouse events — widget is interactive
  widgetWindow.setIgnoreMouseEvents(false);

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
  // Create a simple programmatic tray icon (orange square - thera's brand color)
  const { nativeImage } = require('electron');

  // Create a 16x16 orange square icon
  const iconCanvas = nativeImage.createEmpty();
  const iconSize = 16;

  // Simple fallback - use system default or create from base64
  const iconData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABOSURBVDiNY/z//z8DJYCRUgNgYBgF+MDu3bv/M1AJmDZtGvUMuHjx4n8GKgHLly+nngFoYBTgY8C1a9f+M1AJWLhwIfUMgIFRAFYBANJ4Cul0TKhpAAAAAElFTkSuQmCC';
  const trayIcon = nativeImage.createFromDataURL(iconData);

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

// Resize widget window (idle ↔ mini chat)
ipcMain.on('widget-resize', (_e, { height }) => {
  if (widgetWindow) {
    const [w] = widgetWindow.getSize();
    widgetWindow.setSize(w, height);
  }
});

app.whenReady().then(() => {
  createWindow();
  createWidgetWindow();
  createTray();

  // Start activity monitoring
  require('./monitors/activityMonitor');
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
