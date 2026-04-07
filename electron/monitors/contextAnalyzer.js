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

  if (socialTime >= 0.1) {  // 0.5 min = 30 seconds (TESTING ONLY!)
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
/*  FALLBACK MESSAGE BANKS                                                */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const FALLBACKS = {
  // ── Instagram-specific ─────────────────────────────────────────────
  'doom-scrolling-instagram': {
    sfw: [
      "instagram again? they literally design it to trap you, right?",
      "how many posts have you actually enjoyed in the last 20 minutes?",
      "you're in the explore feed. that's the danger zone.",
      "comparing yourself to strangers online? very healthy. love that for you.",
      "instagram is fine. 40 minutes of it is... a choice.",
      "still scrolling? the algorithm is winning. just so you know.",
      "every reel feels like 30 seconds. it's been 35 minutes. math.",
      "refreshing instagram won't fill the void, but okay.",
      "you opened instagram 'just to check'. that was a while ago.",
      "the reels keep coming. you keep watching. who's in charge here?",
      "genuinely asking: what are you looking for right now?",
      "you've seen enough strangers' lives today. i promise.",
    ],
    nsfw: [
      "instagram again? they literally design this to f*ck with your dopamine.",
      "what the hell are you even looking at anymore.",
      "you've been scrolling instagram for ages. what is wrong with us.",
      "babe the explore page is a trap and you walked right in. again.",
      "comparing yourself to strangers on instagram? jesus christ.",
      "every reel is 30 seconds and yet somehow 40 minutes just disappeared.",
      "still scrolling. absolutely unhinged behavior from someone who said 'just a quick check'.",
    ],
  },

  // ── YouTube-specific ───────────────────────────────────────────────
  'doom-scrolling-youtube': {
    sfw: [
      "are you sure you wanna watch this video for this long?",
      "you opened youtube for one video. now you're in the rabbit hole, aren't you.",
      "that's the 4th autoplay in a row. youtube has you.",
      "you said 'just one more'. that was 45 minutes ago.",
      "your watch history is going to be embarrassing. just a heads up.",
      "the video ended but you're still here. what are we doing.",
      "youtube autoplay is not your friend. it's really not.",
      "you've watched enough for today. the internet will still be here tomorrow.",
      "fascinating how one video becomes a documentary series every time.",
      "did you come here for something specific? because i think you forgot.",
      "hour three of youtube. how's that going for you.",
      "the recommended section is not a to-do list.",
    ],
    nsfw: [
      "are you seriously still watching youtube? what the hell happened to your plans.",
      "you literally said 'just one video'. that was an hour ago. come on.",
      "youtube autoplay is a scam and you fall for it every damn time.",
      "the rabbit hole got you again. unbelievable. (it's very believable.)",
      "bro the recommended section is not a homework assignment, stop watching everything.",
      "your watch history is going to be so embarrassing. just saying.",
    ],
  },


  // ── Generic social scrolling ───────────────────────────────────────
  'doom-scrolling': {
    sfw: [
      "not judging but you've been scrolling for a while...",
      "okay but are you even enjoying this anymore?",
      "your future self is silently judging this.",
      "cool. so we're just... scrolling. no judgment. (some judgment.)",
      "social media was supposed to be a quick check. lol.",
      "the scroll continues. as it always does.",
      "hey. you doing okay in there?",
    ],
    nsfw: [
      "what the hell are you scrolling for at this point.",
      "genuinely: are you okay? because this has been a while.",
      "the scroll never ends and neither will your regret. kidding. mostly.",
    ],
  },

  // ── Stuck editing ─────────────────────────────────────────────────
  'stuck-editing': {
    sfw: [
      "you've been on that for a while. need a fresh pair of eyes?",
      "still editing? perfection is a myth and a time thief.",
      "how many times have you rewritten that intro?",
      "just. send. it.",
      "done is better than perfect. i know you know that.",
      "you're editing the same thing on loop. step away for two minutes.",
      "the document hasn't changed much in 20 minutes. your brain needs a reset.",
    ],
    nsfw: [
      "you've been editing this for how long? just send the damn thing.",
      "done is better than perfect. stop rewriting the intro for the fifth f*cking time.",
      "at what point does editing become procrastination? asking for a friend. (it's now.)",
    ],
  },

  // ── Late night work ───────────────────────────────────────────────
  'late-night-work': {
    sfw: [
      "okay but assignments at 3am? should i be worried?",
      "working late again. this is becoming a pattern.",
      "it's late. this better be worth it.",
      "your sleep schedule is screaming. can you hear it?",
      "the work will still be there after you sleep. the sleep won't wait forever though.",
      "late night productivity is a lie your brain tells you. mostly.",
      "tired + deadline = a special kind of suffering. i see you.",
    ],
    nsfw: [
      "it's 3am and you're still working. what the hell are you doing to yourself.",
      "your sleep schedule is absolutely trashed and you're just okay with that?",
      "tired + deadline is a terrible combination. go to bed. please.",
      "working this late is genuinely not worth it. i'm serious this time.",
    ],
  },
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  SMART NUDGE DECISION ENGINE                                          */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Pick the right fallback bank based on pattern + current site + nsfwMode
 */
function pickFallback(patternType, activity, nsfwMode) {
  const mode = nsfwMode ? 'nsfw' : 'sfw';
  let bank;

  if (patternType === 'doom-scrolling') {
    const detail = (activity.detail || '').toLowerCase();
    if (detail.includes('instagram')) bank = FALLBACKS['doom-scrolling-instagram'];
    else if (detail.includes('youtube')) bank = FALLBACKS['doom-scrolling-youtube'];
    else if (detail.includes('tiktok')) bank = FALLBACKS['doom-scrolling-tiktok'];
    else bank = FALLBACKS['doom-scrolling'];
  } else {
    bank = FALLBACKS[patternType];
  }

  const messages = bank?.[mode] || bank?.sfw || ["hey. take a break maybe?"];
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * Decide if we should nudge + generate the message
 * Returns: { shouldNudge: boolean, message: string, reasoning: string }
 */
async function analyzeAndDecide(currentSession, sessionHistory, screenshot = null, options = {}) {
  const nsfwMode = options.nsfwMode ?? false;
  const activity = detectActivity(currentSession.app_name, currentSession.window_title);
  const patterns = detectPattern(sessionHistory, currentSession);

  console.log('[CONTEXT] Activity:', activity.type, '—', activity.detail);
  console.log('[CONTEXT] NSFW mode:', nsfwMode);
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

  // Figure out the specific site for platform-specific messages
  const detail = activity.detail || '';
  let siteContext = '';
  if (detail.toLowerCase().includes('instagram')) siteContext = 'specifically on Instagram (reels, explore page, posts)';
  else if (detail.toLowerCase().includes('youtube')) siteContext = 'specifically on YouTube (watching videos, autoplaying, rabbit hole)';
  else if (detail.toLowerCase().includes('tiktok')) siteContext = 'specifically on TikTok (for you page, reels)';
  else if (detail.toLowerCase().includes('twitter') || detail.toLowerCase().includes('x.com')) siteContext = 'specifically on Twitter/X (doom-scrolling the feed)';

  const swearRule = nsfwMode
    ? '- you CAN swear occasionally if it feels right (f*ck, hell, damn) — use sparingly, it should feel natural not forced'
    : '- NO swearing at all — keep it clean but still sarcastic';

  let prompt = `you're thera — brutally honest, warm AI companion living on this user's desktop.

you've detected concerning patterns. write a nudge.

current situation:
- time: ${timeContext}
- activity: ${detail}${siteContext ? `\n- site context: ${siteContext}` : ''}
- patterns detected: ${patternSummary}

write ONE short message (max 15 words, lowercase, no quotes).

rules:
- be specific about what you noticed — mention the actual site/app
- fleabag energy: dry, self-aware, caring underneath, sarcastic
- no lectures, no toxic positivity, no "have you tried a walk?"
- if doom-scrolling instagram: call out the explore page / reels / comparison trap specifically
- if doom-scrolling youtube: call out the rabbit hole / autoplay / "just one more video" thing
- if doom-scrolling tiktok: call out the for you page / time theft
- if stuck editing: point out exactly how long they've been at it
- if late-night work: dark humor about the time + the struggle
${swearRule}

respond with ONLY the nudge message, nothing else.`;

  if (screenshot) {
    prompt += '\n\n[screenshot of their screen is attached — use it to understand context better and be more specific]';
  }

  const aiResponse = screenshot
    ? await callGeminiWithImage(prompt, screenshot, 80)
    : await callGemini(prompt, 80);

  console.log('[CONTEXT] AI raw response:', aiResponse);

  // If AI fails, use fallback messages based on pattern type + platform
  let message;
  if (!aiResponse || aiResponse === 'SKIP' || aiResponse.toLowerCase().includes('skip')) {
    console.log('[CONTEXT] AI failed or returned SKIP — using fallback message');
    const patternType = highSeverityPatterns[0]?.type;
    message = pickFallback(patternType, activity, nsfwMode);
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
