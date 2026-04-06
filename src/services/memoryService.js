const BACKEND_URL = 'http://localhost:3001';

// Fetch memory context before sending to AI
export async function fetchMemoryContext(userId, query) {
  try {
    console.log('[MEMORY] Searching memories for user:', userId);
    const res = await fetch(`${BACKEND_URL}/search-memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, query }),
    });
    const data = await res.json();
    if (data.context) {
      console.log('[MEMORY] Found context:', data.context.slice(0, 100) + '...');
    } else {
      console.log('[MEMORY] No memories found for this user yet');
    }
    return data.context || '';
  } catch (e) {
    console.error('[MEMORY] Failed to fetch memories:', e.message);
    return '';
  }
}

// Store conversation in memory after each exchange
export async function storeConversation(userId, conversationId, messages) {
  try {
    const content = messages
      .map((m) => `${m.role === 'bot' ? 'assistant' : 'user'}: ${m.text}`)
      .join('\n');

    console.log('[MEMORY] Storing conversation:', conversationId, 'for user:', userId);
    const res = await fetch(`${BACKEND_URL}/store-memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, conversationId, content }),
    });
    const data = await res.json();
    if (data.ok) {
      console.log('[MEMORY] Conversation stored successfully');
    } else {
      console.warn('[MEMORY] Storage failed (chat still works):', data.reason || 'unknown');
    }
  } catch (e) {
    console.error('[MEMORY] Failed to store conversation:', e.message);
  }
}
