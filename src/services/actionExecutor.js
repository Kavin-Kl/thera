/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ACTION EXECUTOR
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Parses <action>{json}</action> tags out of an AI response, dispatches
 * each to the main process via ipc (`actions:execute`), and returns the
 * stripped display text + execution summaries.
 *
 * The system prompt instructs Gemini to emit action tags at the end of
 * its reply. The user never sees the raw tags — only the natural prose
 * plus a compact result line when something ran.
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

const { ipcRenderer } = window.require ? window.require('electron') : {};

// Match both raw <action>...</action> and HTML-entity-escaped versions
// that Gemini sometimes emits (&lt;action&gt;...&lt;/action&gt;)
const ACTION_TAG_RE = /<action>\s*([\s\S]*?)\s*<\/action>/gi;
const ACTION_TAG_ENTITY_RE = /&lt;action&gt;\s*([\s\S]*?)\s*&lt;\/action&gt;/gi;

function unescapeHtml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Extract action blocks from raw AI text.
 * Returns { displayText, actions } where displayText has all tags stripped
 * and actions is an array of parsed { type, params } objects (malformed
 * blocks are skipped and logged).
 */
export function parseActions(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { displayText: rawText || '', actions: [] };
  }

  // Normalize HTML-escaped tags before matching
  const normalised = rawText.replace(ACTION_TAG_ENTITY_RE, (_, body) => `<action>${unescapeHtml(body)}</action>`);

  const actions = [];
  const matches = [...normalised.matchAll(ACTION_TAG_RE)];

  console.log('[ACTIONS] raw response length:', rawText.length, '| action tags found:', matches.length);

  for (const m of matches) {
    const body = m[1].trim();
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.type === 'string') {
        actions.push({
          type: parsed.type,
          params: parsed.params || {},
        });
      } else {
        console.warn('[ACTIONS] malformed action block (missing type):', body);
      }
    } catch (e) {
      console.warn('[ACTIONS] failed to parse action block:', body, e.message);
    }
  }

  const displayText = normalised.replace(ACTION_TAG_RE, '').trim();
  return { displayText, actions };
}

/**
 * Format a single action result as a short, user-facing line.
 * Keeps it in Thera's lowercase voice.
 */
function formatResult(action, response) {
  const { type } = action;
  if (!response) {
    return `${type} — no response from main process`;
  }
  if (response.ok === false) {
    return `${type} failed: ${response.error || 'unknown error'}`;
  }
  const result = response.result;

  switch (type) {
    case 'gmail.draft':
      return `draft saved${result?.id ? ` (id ${result.id.slice(0, 8)}…)` : ''}`;
    case 'gmail.send':
      return `email sent${result?.id ? ` (id ${result.id.slice(0, 8)}…)` : ''}`;
    case 'gmail.search': {
      const n = Array.isArray(result) ? result.length : 0;
      return `found ${n} email${n === 1 ? '' : 's'}`;
    }
    case 'gcal.create':
      return `event created${result?.link ? ` — ${result.link}` : ''}`;
    case 'gcal.list': {
      const n = Array.isArray(result) ? result.length : 0;
      return `${n} event${n === 1 ? '' : 's'} on the calendar`;
    }
    case 'gcontacts.search': {
      const n = Array.isArray(result) ? result.length : 0;
      return `found ${n} contact${n === 1 ? '' : 's'}`;
    }
    case 'gdrive.search': {
      const n = Array.isArray(result) ? result.length : 0;
      return `found ${n} file${n === 1 ? '' : 's'} in drive`;
    }
    case 'gdocs.create':
      return `doc created${result?.link ? ` — ${result.link}` : ''}`;
    case 'spotify.play':  return 'music playing';
    case 'spotify.pause': return 'music paused';
    case 'spotify.queue': return 'queued';
    case 'spotify.search': {
      const tracks = result?.tracks?.items?.length || 0;
      return `found ${tracks} track${tracks === 1 ? '' : 's'}`;
    }
    case 'slack.send':
      return 'slack message sent';
    case 'slack.search':
      return 'slack search done';
    case 'reminders.create':
      return `reminder saved${result?.id ? ` (#${result.id})` : ''}`;
    case 'notes.create':
      return `note saved${result?.id ? ` (#${result.id})` : ''}`;
    default:
      return response.ok ? `${type} done` : `${type} failed`;
  }
}

/**
 * Execute all parsed actions sequentially (some have ordering dependencies,
 * like spotify.search → spotify.queue). Returns an array of
 * { action, response, summary } entries.
 */
export async function runActions(actions) {
  if (!ipcRenderer) {
    console.warn('[ACTIONS] no ipcRenderer — cannot execute actions');
    return actions.map(a => ({
      action: a,
      response: { ok: false, error: 'no ipcRenderer' },
      summary: `${a.type} — not available in this context`,
    }));
  }

  const results = [];
  for (const action of actions) {
    try {
      console.log('[ACTIONS] executing', action.type, action.params);
      const response = await ipcRenderer.invoke('actions:execute', action);
      results.push({
        action,
        response,
        summary: formatResult(action, response),
      });
    } catch (e) {
      console.error('[ACTIONS] ipc invoke failed for', action.type, e);
      results.push({
        action,
        response: { ok: false, error: e.message },
        summary: `${action.type} failed: ${e.message}`,
      });
    }
  }
  return results;
}

/**
 * One-shot convenience: take raw AI text, strip actions, run them, return
 * everything the UI layer needs.
 *
 * Returns:
 *   {
 *     displayText,      // what to show the user (tags stripped)
 *     actions,          // parsed action objects (pre-execution)
 *     results,          // per-action { action, response, summary }
 *     resultSummary,    // short one-line summary for the AI's next turn
 *                       // (fed back as "[action result] ..." so Gemini can
 *                       //  react naturally on the following exchange)
 *   }
 */
export async function processAIResponse(rawText) {
  // Log raw AI output so you can see if action tags are being emitted
  // (check browser DevTools console — Ctrl+Shift+I in the app)
  console.log('[ACTIONS] AI raw response:', rawText);
  const { displayText, actions } = parseActions(rawText);
  if (actions.length === 0) {
    return { displayText, actions: [], results: [], resultSummary: '' };
  }

  const results = await runActions(actions);
  const resultSummary = results
    .map(r => `[action result] ${r.action.type}: ${r.summary}`)
    .join('\n');

  return { displayText, actions, results, resultSummary };
}
