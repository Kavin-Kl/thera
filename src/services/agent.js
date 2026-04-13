/**
 * Thera Agent — LangChain-based AI agent
 *
 * Replaces the stateless sendMessageToAI() pattern with a proper agent that:
 *   1. Maintains conversation history per session (via chatHistory.js)
 *   2. Calls tools for real-world actions (browser, Gmail, Spotify, etc.)
 *   3. Handles multi-step reasoning (e.g. navigate → read → click → verify)
 *
 * The LLM decides WHAT to do. Tools decide HOW to do it.
 * The Chrome extension is the execution engine — no Puppeteer, no Playwright.
 */

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { createToolCallingAgent, AgentExecutor } from 'langchain/agents';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { getHistory, seedHistory } from './chatHistory.js';
import { allTools } from './tools/index.js';
import { systemPrompt } from './systemPrompt.js';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// ── System prompt ─────────────────────────────────────────────

// LangChain ChatPromptTemplate treats { } as template variables.
// Escape all literal braces in the system prompt so JSON examples don't break the parser.
const escapedSystemPrompt = systemPrompt.replace(/\{/g, '{{').replace(/\}/g, '}}');

const AGENT_SYSTEM = `${escapedSystemPrompt}

--- TOOL USE ---
You have tools for real-world actions. Use them when the user asks you to do something.

Tool-use principles:
- For any browser task (booking, filling forms, searching, navigating): use browser tools
- Always read_page before interacting with an unfamiliar site — you need to know the structure
- For multi-step flows (e.g. book tickets): navigate → read_page → wait_for → click/type → verify
- Never assume a DOM element exists without waiting for it first
- For WhatsApp/Instagram: use the dedicated tools — don't navigate manually
- For email: use gmail_send directly — never ask for email addresses, the system resolves names
- After completing a multi-step task, briefly summarise what was done in your natural voice

Screen context:
- When the user sends a message with a screenshot attached (screenMode on), you can SEE their screen
- Use get_screen_context when they say "this page", "what I'm looking at", "help me with this", etc.
- If you see a screenshot, describe what you see and reference it naturally

Mood & wellbeing:
- Call log_mood silently when you detect a clear emotional signal (do NOT mention you're doing this)
- Call record_crisis ONLY for genuine crisis signals — suicidal ideation, self-harm, acute panic
- Both tools return empty strings — never surface them in your reply

DO NOT explain your tool usage to the user unless it fails. Just do it and respond naturally.`;

// ── Rate-limit retry ──────────────────────────────────────────

/**
 * Retry an async fn on 429 with exponential backoff.
 * Gemini free tier: 10 RPM on gemini-2.5-flash.
 * Each agent tool-call iteration is a separate request, so multi-step
 * tasks burn through the limit fast. Back off and retry transparently.
 */
async function withRetry(fn, retries = 5, baseDelayMs = 3000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err?.message || String(err);
      const is429 = msg.includes('429') || msg.includes('Too Many Requests')
                 || err?.status === 429 || err?.response?.status === 429;

      if (!is429 || attempt === retries) throw err;

      // Honour Retry-After header if Gemini sends one (seconds)
      const retryAfter = err?.response?.headers?.get?.('retry-after');
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000;

      console.warn(`[AGENT] 429 rate-limited — retry ${attempt + 1}/${retries} in ${Math.round(waitMs / 1000)}s`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
}

// ── Agent singleton ───────────────────────────────────────────

let _executor = null;

function buildExecutor() {
  const llm = new ChatGoogleGenerativeAI({
    model: 'gemini-2.5-flash',
    apiKey: GEMINI_API_KEY,
    temperature: 0.7,
    maxOutputTokens: 2048,
    maxRetries: 2,          // LangChain's own retry layer (fast, for transient errors)
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', AGENT_SYSTEM],
    new MessagesPlaceholder('chat_history'),
    // 'input' is passed as [HumanMessage] so we can include multimodal content
    // (screenshot image parts) when screenMode is active.
    new MessagesPlaceholder('input'),
    new MessagesPlaceholder('agent_scratchpad'),
  ]);

  const agent = createToolCallingAgent({ llm, tools: allTools, prompt });

  return new AgentExecutor({
    agent,
    tools: allTools,
    verbose: false,
    maxIterations: 10,        // was 15 — fewer iterations = fewer RPM-burning calls
    returnIntermediateSteps: false,
    handleParsingErrors: "ran into a snag. let me try differently.",
  });
}

function getExecutor() {
  if (!_executor) _executor = buildExecutor();
  return _executor;
}

// ── Public API ────────────────────────────────────────────────

/**
 * Run the agent for a single user turn.
 *
 * @param {string} sessionId         - Session key for history lookup
 * @param {string} userMessage       - The user's raw input text
 * @param {string} [memoryContext]   - Mem0 memory context string (optional)
 * @param {object|null} [screenshot] - { base64, mimeType } from screen:capture (optional)
 * @returns {Promise<string>}        - Agent's response text
 */
export async function runAgent(sessionId, userMessage, memoryContext = '', screenshot = null) {
  const executor = getExecutor();
  const history = getHistory(sessionId);
  const chatHistory = await history.getMessages();

  // Prepend memory context inline — keeps history clean, informs this turn only
  const textInput = memoryContext
    ? `${userMessage}\n\n[context from memory: ${memoryContext}]`
    : userMessage;

  // Build multimodal content array — text always present, image appended when
  // the user has screenMode active and a screenshot was successfully captured.
  const content = [{ type: 'text', text: textInput }];
  if (screenshot?.base64) {
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${screenshot.mimeType || 'image/jpeg'};base64,${screenshot.base64}`,
      },
    });
  }

  // Wrap in a HumanMessage array — the prompt uses MessagesPlaceholder('input')
  // so the executor receives a list of messages rather than a raw string.
  const inputMessages = [new HumanMessage({ content })];

  let output;
  try {
    const result = await withRetry(() =>
      executor.invoke({ input: inputMessages, chat_history: chatHistory })
    );
    // Guarantee a plain string — AgentExecutor can return objects in edge cases
    output = typeof result.output === 'string'
      ? result.output
      : (result.output != null ? JSON.stringify(result.output) : null);
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes('429') || msg.includes('Too Many Requests')) {
      console.error('[AGENT] Rate limit exhausted after retries');
      output = "gemini's rate limit is cooked — too many requests too fast. give it a minute?";
    } else {
      console.error('[AGENT] Error:', msg);
      output = null;
    }
  }

  // Final fallback — never let undefined/null reach SQLite or Mem0
  if (!output) output = "ugh, something broke on my end. try again?";

  // Persist this turn to history — store plain text only (no image bytes in history).
  await history.addMessage(new HumanMessage(userMessage));
  await history.addMessage(new AIMessage(output));

  return output;
}

// Re-export seedHistory for Home.jsx to seed on session load
export { seedHistory };
