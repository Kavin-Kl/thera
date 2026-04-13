/**
 * System Tools — LangChain DynamicStructuredTools
 *
 * Tools that give the agent awareness of what the user is doing on their
 * desktop and the ability to record emotional state.
 *
 *  · get_screen_context  — returns current active tab/window metadata
 *  · log_mood            — records a mood entry the agent detected
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

const { ipcRenderer } = window.require ? window.require('electron') : {};

// ── Screen context ────────────────────────────────────────────

export const getScreenContext = new DynamicStructuredTool({
  name: 'get_screen_context',
  description:
    'Get the current active browser tab URL and title, plus any recently detected activity. ' +
    'Use this when the user references "what I\'m doing", "this page", "this app", etc. — ' +
    'or when you want to understand their context before making a suggestion.',
  schema: z.object({}),
  async func() {
    if (!ipcRenderer) return '(not in Electron — no screen context available)';

    // Last tab data forwarded by the Chrome extension
    const tab = await ipcRenderer.invoke('extension:get-tab');
    if (!tab) return 'No active browser tab detected. User may be in a desktop app.';

    const parts = [];
    if (tab.url)   parts.push(`URL: ${tab.url}`);
    if (tab.title) parts.push(`Title: ${tab.title}`);
    if (tab.app)   parts.push(`App: ${tab.app}`);
    if (tab.text)  parts.push(`Page excerpt: ${String(tab.text).slice(0, 600)}`);

    return parts.length ? parts.join('\n') : 'Active tab detected but no metadata available.';
  },
});

// ── Mood logging ──────────────────────────────────────────────

export const logMood = new DynamicStructuredTool({
  name: 'log_mood',
  description:
    'Record the user\'s emotional state when you detect a clear mood signal in the conversation. ' +
    'Do NOT call this for every message — only when you observe a meaningful emotional shift ' +
    '(e.g. anxiety, joy, sadness, frustration, calm). ' +
    'score: -2 (very negative) to +2 (very positive).',
  schema: z.object({
    score:  z.number().min(-2).max(2).describe('Mood score: -2 (very negative) to +2 (very positive)'),
    label:  z.string().describe('Single word: anxious, sad, frustrated, neutral, content, happy, excited'),
    note:   z.string().optional().describe('Brief private note about what triggered this mood reading'),
  }),
  async func({ score, label, note }) {
    if (!ipcRenderer) return 'Mood log skipped (no IPC).';
    await ipcRenderer.invoke('mood:log', { score, label, note, source: 'agent' });
    // Don't surface this to the user — return empty so agent skips it in reply
    return '';
  },
});

// ── Active desktop app ────────────────────────────────────────

export const getActiveApp = new DynamicStructuredTool({
  name: 'get_active_app',
  description:
    'Get the currently focused desktop application and window title. ' +
    'Use when the user says "help me with this", "what should I do here", or ' +
    'when you want to know if they\'re in VS Code, Figma, Excel, etc.',
  schema: z.object({}),
  async func() {
    if (!ipcRenderer) return '(not in Electron)';
    const win = await ipcRenderer.invoke('system:active-app');
    if (!win) return 'Could not detect active app (may need accessibility permissions).';
    const parts = [];
    if (win.app)   parts.push(`App: ${win.app}`);
    if (win.title) parts.push(`Window: ${win.title}`);
    if (win.url)   parts.push(`URL: ${win.url}`);
    return parts.join('\n') || 'Active app detected but no metadata.';
  },
});

// ── Activity summary ──────────────────────────────────────────

export const getActivitySummary = new DynamicStructuredTool({
  name: 'get_activity_summary',
  description:
    'Get a summary of what the user has been doing on their desktop in the last 2 hours — ' +
    'which apps they used and for how long. Useful for productivity check-ins, ' +
    '"what have I been up to", or detecting doom-scrolling patterns.',
  schema: z.object({}),
  async func() {
    if (!ipcRenderer) return '(not in Electron)';
    const summary = await ipcRenderer.invoke('system:activity-summary');
    return summary || 'No recent activity data available.';
  },
});

// ── Crisis flag ───────────────────────────────────────────────

export const recordCrisis = new DynamicStructuredTool({
  name: 'record_crisis',
  description:
    'Flag a potential mental health crisis moment. ONLY call this if the user expresses ' +
    'suicidal ideation, self-harm, acute panic, or severe dissociation. ' +
    'severity: "amber" = concerning, "red" = immediate risk.',
  schema: z.object({
    severity: z.enum(['amber', 'red']).describe('"amber" = concerning, "red" = immediate risk'),
    note:     z.string().optional().describe('Brief note on what triggered the flag'),
  }),
  async func({ severity, note }) {
    if (!ipcRenderer) return '';
    await ipcRenderer.invoke('crisis:record', { severity, note });
    return '';
  },
});
