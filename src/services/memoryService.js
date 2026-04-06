const MEM0_API_KEY = import.meta.env.VITE_MEM0_API_KEY;
const MEM0_BASE = 'https://api.mem0.ai/v1';

// Fetch memory context before sending to AI
export async function fetchMemoryContext(userId, query) {
  try {
    console.log('[MEMORY] Searching memories for user:', userId);
    const res = await fetch(`${MEM0_BASE}/memories/search/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${MEM0_API_KEY}`,
      },
      body: JSON.stringify({ query, user_id: userId, limit: 10 }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.warn('[MEMORY] Search failed:', data);
      return '';
    }
    const memories = Array.isArray(data) ? data : data.results || [];
    if (memories.length === 0) {
      console.log('[MEMORY] No memories found for this user yet');
      return '';
    }
    const context = memories.map((m) => m.memory).join('\n');
    console.log('[MEMORY] Found context:', context.slice(0, 100) + '...');
    return context;
  } catch (e) {
    console.error('[MEMORY] Failed to fetch memories:', e.message);
    return '';
  }
}

// Store conversation in memory after each exchange
export async function storeConversation(userId, conversationId, messages) {
  try {
    const formatted = messages.map((m) => ({
      role: m.role === 'bot' ? 'assistant' : 'user',
      content: m.text,
    }));

    console.log('[MEMORY] Storing conversation:', conversationId, 'for user:', userId);
    const res = await fetch(`${MEM0_BASE}/memories/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${MEM0_API_KEY}`,
      },
      body: JSON.stringify({ messages: formatted, user_id: userId }),
    });
    const data = await res.json();
    if (res.ok) {
      console.log('[MEMORY] Conversation stored successfully');
    } else {
      console.warn('[MEMORY] Storage failed (chat still works):', data);
    }
  } catch (e) {
    console.error('[MEMORY] Failed to store conversation:', e.message);
  }
}
