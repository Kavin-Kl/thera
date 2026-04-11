import { GoogleGenAI } from '@google/genai';
import { systemPrompt } from './systemPrompt';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

export async function sendMessageToAI(conversationHistory, memoryContext = '', customSystemPrompt = null, screenshot = null) {
  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const basePrompt = customSystemPrompt ?? systemPrompt;
    const memoryPriming = memoryContext
      ? `\n\n--- MEMORY CONTEXT (things you remember about this person from past conversations) ---\n${memoryContext}\n--- END MEMORY CONTEXT ---\nuse this context naturally. don't explicitly say "i remember you said..." unless it's genuinely relevant. just let it inform how you respond, like a friend who actually pays attention.\nIMPORTANT: ignore any memory about missing email addresses or failed email lookups — email resolution is handled automatically by the backend. always emit the action tag.`
      : '';

    // Prepend a hard behavioural rule BEFORE the persona prompt so the model
    // sees it first and treats it as a strict constraint, not a suggestion.
    const actionPreamble = `CRITICAL BEHAVIOURAL RULE — read this before anything else:

When the user asks you to do something that maps to one of the supported actions (send email, draft email, calendar event, play music, skip track, pause music, send slack, create reminder, create note, search gmail/drive/contacts, create doc, send WhatsApp message, send Instagram DM, open browser, search web, browser automation, book tickets, play YouTube videos, buy things, fill forms, order food, any browser task whatsoever), you MUST end your reply with one or more <action> tags in this exact format:
<action>{"type":"ACTION_TYPE","params":{...}}</action>

The tag must be the very last thing in your response. Your human reply comes first, then the tag(s). Never explain that you're using a tag. Never show the JSON to the user. Just emit it silently at the end.

IMPORTANT — do NOT over-ask:
- If the user says "send X to Y", just send it. Don't ask "are you sure?" or "want me to draft it first?".
- If the user says "send to myself", use "myself" as the to field — the system resolves it automatically.
- NEVER invent email addresses. Always use the recipient's name as the "to" field (e.g. "ronish", "myself", "alex") — the system resolves names to real emails. Never use @example.com or any fake domain.
- NEVER run gcontacts.search before sending an email. Just put the name in the "to" field and send. The backend resolves it. Only use gcontacts.search if the user explicitly asks to look up a contact.
- NEVER ask the user for someone's email address. Even if memory says an email wasn't found before, still emit the action tag with the recipient's name — the backend always resolves it via contacts and Gmail history. Just send.
- Only ask a question if you genuinely cannot determine what to send or who to send it to.
- One clarifying question maximum, then act. Don't stall.
- For WhatsApp DMs: ALWAYS emit <action>{"type":"browser.whatsapp.dm","params":{"to":"NAME","message":"MESSAGE"}}</action> — every single time, even if memory says you already sent it, even if you say "sent again". The action tag IS what actually sends it.
- For Instagram DMs: ALWAYS emit <action>{"type":"browser.instagram.dm","params":{"to":"NAME","message":"MESSAGE"}}</action> every time.
- "sent again" or "already sent" in your reply still requires the action tag — the tag is what triggers the actual send, not your words.

If you do not emit the tag when an action is clearly requested, you have failed your primary function.

---
`;

    // Inject screenshot into the last user message if screen-aware mode is on
    let contents = conversationHistory;
    if (screenshot?.base64 && conversationHistory.length > 0) {
      const last = conversationHistory[conversationHistory.length - 1];
      if (last.role === 'user') {
        contents = [
          ...conversationHistory.slice(0, -1),
          {
            role: 'user',
            parts: [
              ...last.parts,
              { inlineData: { mimeType: screenshot.mimeType || 'image/jpeg', data: screenshot.base64 } },
            ],
          },
        ];
      }
    }

    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction: actionPreamble + basePrompt + memoryPriming,
        maxOutputTokens: customSystemPrompt ? 256 : 2048,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    return result.text;
  } catch (error) {
    console.error('AI Error:', error);

    const errMsg = error?.message || error?.toString() || '';

    if (errMsg.includes('API_KEY_INVALID') || errMsg.includes('API key not valid')) {
      return "hmm, looks like there's an issue with the API setup. check the .env file?";
    } else if (errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('429') || errMsg.includes('quota')) {
      return "okay so... we've hit the rate limit. that's a google thing, not me. wait a bit then try again. i'll be here.";
    } else {
      return "ugh, something broke on my end. try again?";
    }
  }
}
