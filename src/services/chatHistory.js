/**
 * ──────────────────────────────────────────────────────────────────────
 * LANGCHAIN CHAT HISTORY REGISTRY
 * ──────────────────────────────────────────────────────────────────────
 *
 * Single source of truth for all in-memory conversation histories.
 * Each session (Home.jsx chat) and the widget mini-chat get their own
 * InMemoryChatMessageHistory instance, keyed by session ID.
 *
 * The widget uses a LimitedChatMessageHistory that auto-trims to the
 * last N messages to keep the context small.
 *
 * Used by:
 *   - aiService.js  → RunnableWithMessageHistory looks up history here
 *   - Home.jsx      → seeds from DB on load, clears on session switch
 *   - widget.jsx    → uses 'widget' key with auto-trim
 * ──────────────────────────────────────────────────────────────────────
 */

import { InMemoryChatMessageHistory } from '@langchain/core/chat_history';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

/* ── Registry ────────────────────────────────────────────────── */
const histories = new Map();

/**
 * Chat history that automatically trims to the most recent `maxMessages`
 * messages. Used for the widget mini-chat to keep context tight.
 */
class LimitedChatMessageHistory extends InMemoryChatMessageHistory {
  constructor(maxMessages = 12) {
    super();
    this.maxMessages = maxMessages;
  }
  async addMessages(messages) {
    await super.addMessages(messages);
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }
  }
}

/* ── Public API ──────────────────────────────────────────────── */

/**
 * Get or create the history for a session.
 * Call initWidgetHistory() before using 'widget' to ensure it's limited.
 */
export function getHistory(sessionId) {
  if (!histories.has(sessionId)) {
    histories.set(sessionId, new InMemoryChatMessageHistory());
  }
  return histories.get(sessionId);
}

/**
 * Initialize the widget's limited history (max 12 messages = 6 turns).
 * Call once in the Widget component's useEffect.
 */
export function initWidgetHistory() {
  if (!histories.has('widget')) {
    histories.set('widget', new LimitedChatMessageHistory(12));
  }
}

/**
 * Seed a session history from DB rows (called when loading an existing chat).
 * Clears any existing in-memory state for this session first.
 */
export async function seedHistory(sessionId, dbMessages) {
  const hist = getHistory(sessionId);
  await hist.clear();
  if (!dbMessages?.length) return;
  const langchainMessages = dbMessages.map(m =>
    m.role === 'user' ? new HumanMessage(m.text) : new AIMessage(m.text)
  );
  await hist.addMessages(langchainMessages);
}

/**
 * Manually append a human (user) message to a session's history.
 * Used to inject action results back so the AI sees what succeeded.
 */
export async function addHumanMessage(sessionId, text) {
  await getHistory(sessionId).addMessage(new HumanMessage(text));
}

/**
 * Manually append an AI message to a session's history.
 * Used to add the brief ack ('got it.') after action results are injected.
 */
export async function addAIMessage(sessionId, text) {
  await getHistory(sessionId).addMessage(new AIMessage(text));
}

/**
 * Remove a session's history from the registry.
 * Call when the user switches sessions or deletes a chat.
 */
export function clearHistory(sessionId) {
  histories.delete(sessionId);
}
