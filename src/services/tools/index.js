/**
 * Tool Registry — all LangChain tools available to the Thera agent.
 */

// ── Browser tools ─────────────────────────────────────────────
export {
  browserNavigate,
  browserClick,
  browserClickText,
  browserType,
  browserPressKey,
  browserReadPage,
  browserExtract,
  browserWaitFor,
  browserScroll,
  tabList,
  tabSwitch,
  tabNew,
  tabClose,
  tabPin,
  whatsappSend,
  whatsappRead,
  instagramSend,
  instagramRead,
} from './browserTools.js';

// ── Connector tools ───────────────────────────────────────────
export {
  // Contacts
  contactsSearch,
  // Gmail
  gmailSend,
  gmailDraft,
  gmailSearch,
  gmailRead,
  gmailReply,
  // Calendar
  calendarCreate,
  calendarList,
  // Spotify
  spotifyPlay,
  spotifyControl,
  spotifyQueue,
  spotifySearch,
  spotifyGetCurrent,
  spotifyVolume,
  // Slack
  slackSend,
  slackSearch,
  slackRead,
  slackStatus,
  // Reminders
  reminderCreate,
  reminderList,
  reminderDelete,
  // Notes
  noteCreate,
  noteList,
  noteSearch,
  // Drive / Docs / Sheets
  driveSearch,
  docsCreate,
  docsRead,
  docsEdit,
  sheetsRead,
  sheetsUpdate,
  // Browser automation
  browserAiTask,
} from './connectorTools.js';

// ── System tools ──────────────────────────────────────────────
export {
  getScreenContext,
  getActiveApp,
  getActivitySummary,
  logMood,
  recordCrisis,
} from './systemTools.js';

// ── Imports for allTools array ────────────────────────────────
import {
  browserNavigate, browserClick, browserClickText, browserType,
  browserPressKey, browserReadPage, browserExtract, browserWaitFor,
  browserScroll,
  tabList, tabSwitch, tabNew, tabClose, tabPin,
  whatsappSend, whatsappRead, instagramSend, instagramRead,
} from './browserTools.js';

import {
  contactsSearch,
  gmailSend, gmailDraft, gmailSearch, gmailRead, gmailReply,
  calendarCreate, calendarList,
  spotifyPlay, spotifyControl, spotifyQueue, spotifySearch, spotifyGetCurrent, spotifyVolume,
  slackSend, slackSearch, slackRead, slackStatus,
  reminderCreate, reminderList, reminderDelete,
  noteCreate, noteList, noteSearch,
  driveSearch, docsCreate, docsRead, docsEdit, sheetsRead, sheetsUpdate,
  browserAiTask,
} from './connectorTools.js';

import {
  getScreenContext, getActiveApp, getActivitySummary, logMood, recordCrisis,
} from './systemTools.js';

/**
 * All tools passed to the AgentExecutor.
 * Order matters only for the LLM's tool selection heuristic — most-used first.
 */
export const allTools = [
  // ── System awareness (agent calls these for context) ──────
  getScreenContext,
  getActiveApp,
  getActivitySummary,
  logMood,
  recordCrisis,

  // ── Browser: read then interact ───────────────────────────
  browserReadPage,
  browserNavigate,
  browserWaitFor,
  browserClick,
  browserClickText,
  browserType,
  browserPressKey,
  browserExtract,
  browserScroll,

  // ── Tab management ────────────────────────────────────────
  tabList,
  tabSwitch,
  tabNew,
  tabClose,
  tabPin,

  // ── Messaging ─────────────────────────────────────────────
  whatsappSend,
  whatsappRead,
  instagramSend,
  instagramRead,

  // ── Autonomous browser tasks ──────────────────────────────
  browserAiTask,

  // ── Google ────────────────────────────────────────────────
  contactsSearch,
  gmailSend,
  gmailDraft,
  gmailSearch,
  gmailRead,
  gmailReply,
  calendarCreate,
  calendarList,
  driveSearch,
  docsCreate,
  docsRead,
  docsEdit,
  sheetsRead,
  sheetsUpdate,

  // ── Spotify ───────────────────────────────────────────────
  spotifyGetCurrent,
  spotifyPlay,
  spotifyControl,
  spotifyQueue,
  spotifySearch,
  spotifyVolume,

  // ── Slack ─────────────────────────────────────────────────
  slackSend,
  slackSearch,
  slackRead,
  slackStatus,

  // ── Built-ins ─────────────────────────────────────────────
  reminderCreate,
  reminderList,
  reminderDelete,
  noteCreate,
  noteList,
  noteSearch,
];
