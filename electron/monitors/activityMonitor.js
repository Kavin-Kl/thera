const activeWin = require('active-win');
const { activityOps, nudgeOps } = require('../db/localDb');
const { BrowserWindow } = require('electron');

// Fleabag-style nudge messages
const nudgeMessages = {
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
    "your future self is begging you to stop",
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
    "the world will still be here in 5 minutes. promise.",
  ],
};

function getRandomNudge(type, appName) {
  const messages = nudgeMessages[type] || nudgeMessages.social;
  const message = messages[Math.floor(Math.random() * messages.length)];
  return message.replace('{app}', appName);
}

// Activity categorization
function categorizeApp(appName, windowTitle) {
  const app = appName.toLowerCase();
  const title = (windowTitle || '').toLowerCase();

  // Social media
  if (app.includes('discord') || app.includes('slack') || app.includes('whatsapp') ||
      app.includes('telegram') || title.includes('twitter') || title.includes('facebook') ||
      title.includes('instagram') || title.includes('tiktok')) {
    return 'social';
  }

  // Coding
  if (app.includes('code') || app.includes('visual studio') || app.includes('intellij') ||
      app.includes('pycharm') || app.includes('webstorm') || app.includes('sublime') ||
      app.includes('atom') || app.includes('vim') || app.includes('terminal') ||
      app.includes('cmd') || app.includes('powershell') || app.includes('cursor')) {
    return 'coding';
  }

  // Work
  if (app.includes('excel') || app.includes('word') || app.includes('powerpoint') ||
      app.includes('outlook') || app.includes('teams') || app.includes('zoom') ||
      app.includes('meet') || app.includes('notion') || title.includes('jira') ||
      title.includes('asana')) {
    return 'work';
  }

  // Entertainment
  if (app.includes('spotify') || app.includes('netflix') || app.includes('youtube') ||
      app.includes('steam') || app.includes('game') || app.includes('twitch') ||
      title.includes('youtube') || title.includes('netflix')) {
    return 'entertainment';
  }

  // Browsing
  if (app.includes('chrome') || app.includes('firefox') || app.includes('safari') ||
      app.includes('edge') || app.includes('brave') || app.includes('browser')) {
    return 'browsing';
  }

  return 'other';
}

// State tracking
let currentSession = null;
let lastActivity = null;
let monitorInterval = null;

// Nudge detection
const nudgeChecks = [
  {
    type: 'doom-scrolling',
    check: () => {
      if (!lastActivity) return null;
      const duration = activityOps.getCategoryDuration('social', 24);
      console.log('[NUDGE] Checking doom-scrolling: category=social, duration=', duration, 'seconds');
      // Reduced from 30*60 to 20 for testing
      if (duration > 20 && nudgeOps.shouldNudge('doom-scrolling', 30)) {
        const appName = currentSession?.app_name || 'social media';
        console.log('[NUDGE] Triggering doom-scrolling nudge for:', appName);
        return getRandomNudge('social', appName);
      }
      return null;
    }
  },
  {
    type: 'no-breaks',
    check: () => {
      if (!lastActivity || !currentSession) return null;
      const sessionDuration = (Date.now() - lastActivity.started_at) / 1000;
      console.log('[NUDGE] Checking no-breaks: sessionDuration=', sessionDuration, 'seconds');
      // Reduced from 120*60 to 30 for testing
      if (sessionDuration > 30 && nudgeOps.shouldNudge('no-breaks', 45)) {
        const appName = currentSession?.app_name || 'this app';
        console.log('[NUDGE] Triggering no-breaks nudge for:', appName);
        return getRandomNudge('noBreaks', appName);
      }
      return null;
    }
  }
];

function checkNudges() {
  nudgeChecks.forEach(({ type, check }) => {
    const message = check();
    if (message) {
      sendNudge(type, message);
    }
  });
}

function sendNudge(type, messageData) {
  const message = typeof messageData === 'string' ? messageData : getRandomNudge(type, messageData);
  console.log(`[NUDGE] ${type}: ${message}`);
  nudgeOps.recordNudge(type, message);

  // Send to widget window to show nudge
  const windows = BrowserWindow.getAllWindows();
  // Find widget window (the one that's always on top and frameless)
  const widgetWindow = windows.find(w => w.isAlwaysOnTop() && !w.frame);
  if (widgetWindow) {
    widgetWindow.webContents.send('show-nudge', message);
  }
}

// Main monitoring function
async function pollActiveWindow() {
  try {
    const window = await activeWin();

    if (!window) {
      // End current session if window closed
      if (currentSession) {
        activityOps.endSession(currentSession.id);
        console.log('[ACTIVITY] Session ended:', currentSession.app_name);
        currentSession = null;
      }
      return;
    }

    const { owner: { name: appName }, title: windowTitle } = window;
    const category = categorizeApp(appName, windowTitle);

    // Check if switched apps
    if (!currentSession || currentSession.app_name !== appName || currentSession.window_title !== windowTitle) {
      // End previous session
      if (currentSession) {
        activityOps.endSession(currentSession.id);
        const duration = (Date.now() - currentSession.started_at) / 1000;
        console.log(`[ACTIVITY] Session ended: ${currentSession.app_name} (${Math.round(duration)}s)`);
      }

      // Start new session
      const sessionId = activityOps.startSession(appName, windowTitle, category);
      currentSession = {
        id: sessionId,
        app_name: appName,
        window_title: windowTitle,
        category,
        started_at: Date.now()
      };
      console.log(`[ACTIVITY] New session: ${appName} [${category}]`);
    }

    lastActivity = currentSession;

    // Check for nudges
    checkNudges();

  } catch (error) {
    console.error('[ACTIVITY] Error polling window:', error.message);
  }
}

// Start monitoring
function startMonitoring() {
  console.log('[ACTIVITY] Starting activity monitor (polling every 10 seconds)');
  pollActiveWindow(); // Initial poll
  monitorInterval = setInterval(pollActiveWindow, 10000); // Poll every 10 seconds
}

// Stop monitoring
function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    if (currentSession) {
      activityOps.endSession(currentSession.id);
    }
    console.log('[ACTIVITY] Activity monitor stopped');
  }
}

// Start on load
startMonitoring();

// Cleanup on app quit
process.on('exit', stopMonitoring);

module.exports = { startMonitoring, stopMonitoring };
