/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * INTELLIGENT CONTEXT ANALYZER
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Knows EXACTLY what the user is doing and decides when to nudge.
 *
 * Philosophy:
 * - Be helpful, not annoying
 * - Speak only when you have something worth saying
 * - Understand context deeply before interrupting
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

const fs = require('fs');
const path = require('path');

/* ── Read API key from .env ─────────────────────────────────────────── */
function readEnvVar(key) {
  try {
    // Use process.cwd() which always points to project root where package.json is
    const envPath = path.join(process.cwd(), '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return match ? match[1].trim() : '';
  } catch (e) {
    console.error('[CONTEXT] Error reading .env:', e.message);
    return '';
  }
}

const GEMINI_API_KEY = readEnvVar('VITE_GEMINI_API_KEY') || readEnvVar('GEMINI_API_KEY');
console.log('[CONTEXT] Gemini API key loaded:', GEMINI_API_KEY ? 'YES' : 'NO');

/* ── Gemini API call ────────────────────────────────────────────────── */
async function callGemini(prompt, maxTokens = 60) {
  if (!GEMINI_API_KEY) {
    console.error('[CONTEXT] No Gemini API key found');
    return null;
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: 0.9
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('[CONTEXT] Gemini API error:', response.status, data);
      return null;
    }

    const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    console.log('[CONTEXT] Gemini returned:', result ? `"${result.substring(0, 50)}..."` : 'null');
    return result;
  } catch (e) {
    console.error('[CONTEXT] Gemini call failed:', e.message, e.stack);
    return null;
  }
}

/* ── Gemini API call WITH screenshot ────────────────────────────────── */
async function callGeminiWithImage(prompt, base64Image, maxTokens = 80) {
  if (!GEMINI_API_KEY) return null;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: 'image/png',
                  data: base64Image
                }
              }
            ]
          }],
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: 0.9
          }
        })
      }
    );

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (e) {
    console.error('[CONTEXT] Gemini vision call failed:', e.message);
    return null;
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  CONTEXT DETECTION RULES                                              */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Detect specific activity patterns from window title + app
 */
function detectActivity(appName, windowTitle) {
  const app = appName.toLowerCase();
  const title = (windowTitle || '').toLowerCase();

  // ── Gmail patterns ─────────────────────────────────────────────────
  if (title.includes('gmail')) {
    if (title.includes('compose') || title.includes('draft')) {
      return { type: 'email-composing', confidence: 'high', detail: 'composing email' };
    }
    if (title.includes('inbox') || title.includes('mail')) {
      return { type: 'email-reading', confidence: 'medium', detail: 'reading emails' };
    }
    return { type: 'email-general', confidence: 'low', detail: 'in gmail' };
  }

  // ── YouTube patterns ───────────────────────────────────────────────
  if (title.includes('youtube')) {
    const cleanTitle = title.replace(/[-|–]\s*youtube\s*$/i, '').trim();
    if (cleanTitle.includes('tutorial') || cleanTitle.includes('learn') || cleanTitle.includes('course')) {
      return { type: 'learning', confidence: 'high', detail: `learning: ${cleanTitle}` };
    }
    return { type: 'video-watching', confidence: 'medium', detail: cleanTitle };
  }

  // ── Instagram / TikTok / Twitter ───────────────────────────────────
  if (title.includes('instagram') || title.includes('tiktok') || title.includes('twitter') || title.includes('x.com')) {
    return { type: 'social-scrolling', confidence: 'high', detail: 'scrolling social media' };
  }

  // ── Google Docs / Sheets ───────────────────────────────────────────
  if (title.includes('google docs') || title.includes('google sheets')) {
    const docName = title.split('-')[0]?.trim() || 'document';
    return { type: 'document-editing', confidence: 'high', detail: `editing: ${docName}` };
  }

  // ── Code editors ───────────────────────────────────────────────────
  if (app.includes('code') || app.includes('cursor') || app.includes('vim') || app.includes('sublime')) {
    return { type: 'coding', confidence: 'high', detail: windowTitle };
  }

  // ── Slack / Discord / Teams ────────────────────────────────────────
  if (app.includes('slack') || app.includes('discord') || app.includes('teams')) {
    return { type: 'chatting', confidence: 'medium', detail: 'in team chat' };
  }

  // ── Netflix / Streaming ────────────────────────────────────────────
  if (title.includes('netflix') || title.includes('prime video') || title.includes('disney')) {
    return { type: 'entertainment', confidence: 'high', detail: 'watching show' };
  }

  // ── Unrecognized ───────────────────────────────────────────────────
  return { type: 'unknown', confidence: 'low', detail: windowTitle };
}

/**
 * Detect behavioral patterns that warrant nudging
 */
function detectPattern(sessionHistory, currentSession) {
  const now = new Date();
  const hour = now.getHours();
  const patterns = [];

  // ── Late night work (11pm - 5am) ───────────────────────────────────
  if (hour >= 23 || hour <= 5) {
    const activity = detectActivity(currentSession.app_name, currentSession.window_title);
    if (activity.type === 'coding' || activity.type === 'document-editing' || activity.type === 'email-composing') {
      patterns.push({
        type: 'late-night-work',
        severity: 'high',
        detail: `working on ${activity.detail} at ${hour}:${now.getMinutes().toString().padStart(2, '0')}`,
        shouldNudge: true
      });
    }
  }

  // ── Stuck on same thing (TESTING: 30s, PROD: 15+ min) ─────────────────────
  if (currentSession.duration_minutes >= 0.5) {  // 0.5 min = 30 seconds (TESTING ONLY!)
    const activity = detectActivity(currentSession.app_name, currentSession.window_title);
    if (activity.type === 'email-composing' || activity.type === 'document-editing') {
      patterns.push({
        type: 'stuck-editing',
        severity: 'medium',
        detail: `${activity.detail} for ${Math.floor(currentSession.duration_minutes)} min`,
        shouldNudge: true
      });
    }
  }

  // ── Social media doom-scrolling (TESTING: 30s, PROD: 20+ min) ───────────────
  const socialTime = sessionHistory
    .filter(s => {
      const act = detectActivity(s.app_name, s.window_title);
      return act.type === 'social-scrolling' && s.started_at > Date.now() - 60 * 60 * 1000;
    })
    .reduce((sum, s) => sum + (s.duration_seconds || 0), 0) / 60;

  if (socialTime >= 0.5) {  // 0.5 min = 30 seconds (TESTING ONLY!)
    patterns.push({
      type: 'doom-scrolling',
      severity: 'medium',
      detail: `${Math.floor(socialTime)} min on social media`,
      shouldNudge: true
    });
  }

  // ── Rapid context switching (5+ apps in 10 min) ────────────────────
  const recentApps = new Set(
    sessionHistory
      .filter(s => s.started_at > Date.now() - 10 * 60 * 1000)
      .map(s => s.app_name)
  );

  if (recentApps.size >= 5) {
    patterns.push({
      type: 'distracted',
      severity: 'low',
      detail: `switched between ${recentApps.size} different apps`,
      shouldNudge: false // Don't nudge yet, might be intentional
    });
  }

  return patterns;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  SMART NUDGE DECISION ENGINE                                          */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Decide if we should nudge + generate the message
 * Returns: { shouldNudge: boolean, message: string, reasoning: string }
 */
async function analyzeAndDecide(currentSession, sessionHistory, screenshot = null) {
  const activity = detectActivity(currentSession.app_name, currentSession.window_title);
  const patterns = detectPattern(sessionHistory, currentSession);

  console.log('[CONTEXT] Activity:', activity.type, '—', activity.detail);
  if (patterns.length > 0) {
    console.log('[CONTEXT] Patterns:', patterns.map(p => p.type).join(', '));
  }

  // ── Quick bailout: don't interrupt deep work ──────────────────────
  const quietActivities = ['coding', 'email-reading', 'chatting', 'entertainment'];
  if (quietActivities.includes(activity.type) && patterns.length === 0) {
    return { shouldNudge: false, reasoning: 'user is focused, no concerning patterns' };
  }

  // ── If patterns detected, ask AI to decide ────────────────────────
  const highSeverityPatterns = patterns.filter(p => p.shouldNudge);
  if (highSeverityPatterns.length === 0) {
    return { shouldNudge: false, reasoning: 'no concerning patterns warrant interruption' };
  }

  // ── Build context for AI ──────────────────────────────────────────
  const now = new Date();
  const timeContext = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
  const patternSummary = highSeverityPatterns.map(p => `${p.type}: ${p.detail}`).join('; ');

  let prompt = `you're thera — brutally honest, warm AI companion living on this user's desktop.

you've detected concerning patterns. write a nudge.

current situation:
- time: ${timeContext}
- activity: ${activity.detail}
- patterns detected: ${patternSummary}

write ONE short message (max 12 words, lowercase, no quotes).

rules:
- be specific about what you noticed
- fleabag energy: dry, caring underneath, sarcastic
- no lectures, no toxic positivity
- if doom-scrolling: gentle sarcasm about the site/activity
- if late-night work on assignments: acknowledge the struggle with dark humor
- if stuck editing: point out how long they've been at it

respond with ONLY the nudge message, nothing else.`;

  if (screenshot) {
    prompt += '\n\n[screenshot of their screen is attached — use it to understand context better]';
  }

  const aiResponse = screenshot
    ? await callGeminiWithImage(prompt, screenshot, 80)
    : await callGemini(prompt, 80);

  console.log('[CONTEXT] AI raw response:', aiResponse);

  // If AI fails, use fallback messages based on pattern type
  let message;
  if (!aiResponse || aiResponse === 'SKIP' || aiResponse.toLowerCase().includes('skip')) {
    console.log('[CONTEXT] AI failed or returned SKIP — using fallback message');

    // Fallback Fleabag-style messages for each pattern
    const fallbacks = {
      'doom-scrolling': [
        "not judging but you've been scrolling for a while...",
        "okay but are you even enjoying this anymore?",
        "your future self is begging you to stop",
        "cool. so we're just... scrolling. no judgment."
      ],
      'stuck-editing': [
        "you've been on that for a while. need a fresh pair of eyes?",
        "still editing? you know perfection is a myth right?",
        "okay but how many times have you rewritten that intro?",
        "just. send. it."
      ],
      'late-night-work': [
        "okay but assignments at 3am? should i be worried?",
        "working late again. this is becoming a pattern.",
        "it's 2am. this better be worth it.",
        "your sleep schedule is screaming. can you hear it?"
      ]
    };

    const patternType = highSeverityPatterns[0]?.type;
    const messages = fallbacks[patternType] || ["hey. take a break maybe?"];
    message = messages[Math.floor(Math.random() * messages.length)];
  } else {
    message = aiResponse.replace(/^["']|["']$/g, '').trim();
  }

  console.log('[CONTEXT] Final nudge message:', message);

  return {
    shouldNudge: true,
    message,
    reasoning: patternSummary,
    metadata: {
      patterns: highSeverityPatterns,
      activity: activity.type,
      usedScreenshot: !!screenshot
    }
  };
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  EXPORTS                                                               */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

module.exports = {
  detectActivity,
  detectPattern,
  analyzeAndDecide,
  callGemini,
  callGeminiWithImage
};
