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
    // Strip memories about failed actions — they cause the AI to refuse to retry
    const STALE_PATTERNS = [
      /no email.*(found|provided|given)/i,
      /hasn't (provided|given|shared).*(email|address)/i,
      /email address.*not (found|provided|available)/i,
      /failed to (send|draft|find)/i,
    ];
    const filtered = memories.filter(m =>
      !STALE_PATTERNS.some(re => re.test(m.memory))
    );
    const context = filtered.map((m) => m.memory).join('\n');
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
    const formatted = messages
      .map((m) => ({
        role: m.role === 'bot' ? 'assistant' : 'user',
        content: typeof m.text === 'string' ? m.text : String(m.text ?? ''),
      }))
      // Mem0 rejects empty or whitespace-only content
      .filter((m) => m.content.trim().length > 0);

    if (formatted.length === 0) return;

    const res = await fetch(`${MEM0_BASE}/memories/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${MEM0_API_KEY}`,
      },
      body: JSON.stringify({ messages: formatted, user_id: userId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.warn('[MEMORY] Storage failed (chat still works):', res.status, JSON.stringify(data));
    }
  } catch (e) {
    console.error('[MEMORY] Failed to store conversation:', e.message);
  }
}
