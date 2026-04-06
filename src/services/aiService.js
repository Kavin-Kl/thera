import { GoogleGenAI } from '@google/genai';
import { systemPrompt } from './systemPrompt';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

export async function sendMessageToAI(conversationHistory, memoryContext = '') {
  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // Add memory context to system prompt if available
    const memoryPriming = memoryContext
      ? `\n\n--- MEMORY CONTEXT (things you remember about this person from past conversations) ---\n${memoryContext}\n--- END MEMORY CONTEXT ---\nuse this context naturally. don't explicitly say "i remember you said..." unless it's genuinely relevant. just let it inform how you respond, like a friend who actually pays attention.`
      : '';

    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { role: 'user', parts: [{ text: systemPrompt + memoryPriming }] },
        { role: 'model', parts: [{ text: "got it. i'm thera." }] },
        ...conversationHistory,
      ],
      config: { maxOutputTokens: 2048 },
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
