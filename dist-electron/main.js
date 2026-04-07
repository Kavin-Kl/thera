//#region \0rolldown/runtime.js
var __commonJSMin = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
//#endregion
//#region electron/settings.js
var require_settings = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* Simple persistent settings for Thera.
	* Stored as JSON next to the .env in the project root.
	*/
	var fs$1 = require("fs");
	var SETTINGS_PATH = require("path").join(process.cwd(), ".thera-settings.json");
	var DEFAULTS = { nsfwMode: false };
	var _settings = { ...DEFAULTS };
	function load() {
		try {
			const raw = fs$1.readFileSync(SETTINGS_PATH, "utf8");
			_settings = {
				...DEFAULTS,
				...JSON.parse(raw)
			};
		} catch (_) {}
	}
	function save() {
		try {
			fs$1.writeFileSync(SETTINGS_PATH, JSON.stringify(_settings, null, 2));
		} catch (e) {
			console.error("[SETTINGS] Failed to save:", e.message);
		}
	}
	function get(key) {
		return key ? _settings[key] : { ..._settings };
	}
	function set(key, value) {
		_settings[key] = value;
		save();
		console.log(`[SETTINGS] ${key} = ${value}`);
	}
	load();
	module.exports = {
		get,
		set
	};
}));
//#endregion
//#region electron/db/localDb.js
var require_localDb = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Database = require("better-sqlite3");
	var path$2 = require("path");
	var { app: app$1 } = require("electron");
	var dbPath = path$2.join(app$1.getPath("userData"), "thera.db");
	var db = new Database(dbPath);
	db.exec(`
  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'desktop_user',
    app_name TEXT NOT NULL,
    window_title TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    duration_seconds INTEGER,
    category TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS nudge_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'desktop_user',
    nudge_type TEXT NOT NULL,
    message TEXT NOT NULL,
    sent_at INTEGER DEFAULT (strftime('%s', 'now')),
    was_dismissed INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_activity_started ON activity_logs(started_at);
  CREATE INDEX IF NOT EXISTS idx_activity_app ON activity_logs(app_name);
  CREATE INDEX IF NOT EXISTS idx_nudge_sent ON nudge_history(sent_at);
`);
	console.log("[DB] Database initialized at:", dbPath);
	module.exports = {
		db,
		activityOps: {
			startSession(appName, windowTitle, category) {
				const stmt = db.prepare(`
      INSERT INTO activity_logs (app_name, window_title, started_at, category)
      VALUES (?, ?, ?, ?)
    `);
				const now = Date.now();
				return stmt.run(appName, windowTitle, now, category).lastInsertRowid;
			},
			endSession(id) {
				const stmt = db.prepare(`
      UPDATE activity_logs
      SET ended_at = ?, duration_seconds = (? - started_at) / 1000
      WHERE id = ?
    `);
				const now = Date.now();
				stmt.run(now, now, id);
			},
			getRecentActivity(hours = 24) {
				const stmt = db.prepare(`
      SELECT * FROM activity_logs
      WHERE started_at > ?
      ORDER BY started_at DESC
      LIMIT 100
    `);
				const since = Date.now() - hours * 60 * 60 * 1e3;
				return stmt.all(since);
			},
			getCurrentAppDuration(appName) {
				const stmt = db.prepare(`
      SELECT SUM(duration_seconds) as total
      FROM activity_logs
      WHERE app_name = ? AND started_at > ?
    `);
				const since = Date.now() - 1440 * 60 * 1e3;
				return stmt.get(appName, since)?.total || 0;
			},
			getCategoryDuration(category, hours = 24) {
				const stmt = db.prepare(`
      SELECT SUM(duration_seconds) as total
      FROM activity_logs
      WHERE category = ? AND started_at > ?
    `);
				const since = Date.now() - hours * 60 * 60 * 1e3;
				return stmt.get(category, since)?.total || 0;
			}
		},
		nudgeOps: {
			recordNudge(type, message) {
				return db.prepare(`
      INSERT INTO nudge_history (nudge_type, message)
      VALUES (?, ?)
    `).run(type, message).lastInsertRowid;
			},
			getLastNudge(type) {
				return db.prepare(`
      SELECT * FROM nudge_history
      WHERE nudge_type = ?
      ORDER BY sent_at DESC
      LIMIT 1
    `).get(type);
			},
			shouldNudge(type, cooldownMinutes) {
				const lastNudge = this.getLastNudge(type);
				if (!lastNudge) return true;
				const cooldownMs = cooldownMinutes * 60 * 1e3;
				return Date.now() - lastNudge.sent_at * 1e3 > cooldownMs;
			}
		}
	};
}));
//#endregion
//#region electron/monitors/contextAnalyzer.js
var require_contextAnalyzer = /* @__PURE__ */ __commonJSMin(((exports, module) => {
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
	var fs = require("fs");
	var path$1 = require("path");
	function readEnvVar(key) {
		try {
			const envPath = path$1.join(process.cwd(), ".env");
			const match = fs.readFileSync(envPath, "utf8").match(new RegExp(`^${key}=(.+)$`, "m"));
			return match ? match[1].trim() : "";
		} catch (e) {
			console.error("[CONTEXT] Error reading .env:", e.message);
			return "";
		}
	}
	var GEMINI_API_KEY = readEnvVar("VITE_GEMINI_API_KEY") || readEnvVar("GEMINI_API_KEY");
	console.log("[CONTEXT] Gemini API key loaded:", GEMINI_API_KEY ? "YES" : "NO");
	async function callGemini(prompt, maxTokens = 60) {
		if (!GEMINI_API_KEY) {
			console.error("[CONTEXT] No Gemini API key found");
			return null;
		}
		try {
			const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
					generationConfig: {
						maxOutputTokens: maxTokens,
						temperature: .9
					}
				})
			});
			const data = await response.json();
			if (!response.ok) {
				console.error("[CONTEXT] Gemini API error:", response.status, data);
				return null;
			}
			const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
			console.log("[CONTEXT] Gemini returned:", result ? `"${result.substring(0, 50)}..."` : "null");
			return result;
		} catch (e) {
			console.error("[CONTEXT] Gemini call failed:", e.message, e.stack);
			return null;
		}
	}
	async function callGeminiWithImage(prompt, base64Image, maxTokens = 80) {
		if (!GEMINI_API_KEY) return null;
		try {
			return (await (await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }, { inline_data: {
						mime_type: "image/png",
						data: base64Image
					} }] }],
					generationConfig: {
						maxOutputTokens: maxTokens,
						temperature: .9
					}
				})
			})).json()).candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
		} catch (e) {
			console.error("[CONTEXT] Gemini vision call failed:", e.message);
			return null;
		}
	}
	/**
	* Detect specific activity patterns from window title + app
	*/
	function detectActivity(appName, windowTitle) {
		const app = appName.toLowerCase();
		const title = (windowTitle || "").toLowerCase();
		if (title.includes("gmail")) {
			if (title.includes("compose") || title.includes("draft")) return {
				type: "email-composing",
				confidence: "high",
				detail: "composing email"
			};
			if (title.includes("inbox") || title.includes("mail")) return {
				type: "email-reading",
				confidence: "medium",
				detail: "reading emails"
			};
			return {
				type: "email-general",
				confidence: "low",
				detail: "in gmail"
			};
		}
		if (title.includes("youtube")) {
			const cleanTitle = title.replace(/[-|–]\s*youtube\s*$/i, "").trim();
			if (cleanTitle.includes("tutorial") || cleanTitle.includes("learn") || cleanTitle.includes("course")) return {
				type: "learning",
				confidence: "high",
				detail: `learning: ${cleanTitle}`
			};
			return {
				type: "video-watching",
				confidence: "medium",
				detail: cleanTitle
			};
		}
		if (title.includes("instagram") || title.includes("tiktok") || title.includes("twitter") || title.includes("x.com")) return {
			type: "social-scrolling",
			confidence: "high",
			detail: "scrolling social media"
		};
		if (title.includes("google docs") || title.includes("google sheets")) return {
			type: "document-editing",
			confidence: "high",
			detail: `editing: ${title.split("-")[0]?.trim() || "document"}`
		};
		if (app.includes("code") || app.includes("cursor") || app.includes("vim") || app.includes("sublime")) return {
			type: "coding",
			confidence: "high",
			detail: windowTitle
		};
		if (app.includes("slack") || app.includes("discord") || app.includes("teams")) return {
			type: "chatting",
			confidence: "medium",
			detail: "in team chat"
		};
		if (title.includes("netflix") || title.includes("prime video") || title.includes("disney")) return {
			type: "entertainment",
			confidence: "high",
			detail: "watching show"
		};
		return {
			type: "unknown",
			confidence: "low",
			detail: windowTitle
		};
	}
	/**
	* Detect behavioral patterns that warrant nudging
	*/
	function detectPattern(sessionHistory, currentSession) {
		const now = /* @__PURE__ */ new Date();
		const hour = now.getHours();
		const patterns = [];
		if (hour >= 23 || hour <= 5) {
			const activity = detectActivity(currentSession.app_name, currentSession.window_title);
			if (activity.type === "coding" || activity.type === "document-editing" || activity.type === "email-composing") patterns.push({
				type: "late-night-work",
				severity: "high",
				detail: `working on ${activity.detail} at ${hour}:${now.getMinutes().toString().padStart(2, "0")}`,
				shouldNudge: true
			});
		}
		if (currentSession.duration_minutes >= .5) {
			const activity = detectActivity(currentSession.app_name, currentSession.window_title);
			if (activity.type === "email-composing" || activity.type === "document-editing") patterns.push({
				type: "stuck-editing",
				severity: "medium",
				detail: `${activity.detail} for ${Math.floor(currentSession.duration_minutes)} min`,
				shouldNudge: true
			});
		}
		const socialTime = sessionHistory.filter((s) => {
			return detectActivity(s.app_name, s.window_title).type === "social-scrolling" && s.started_at > Date.now() - 3600 * 1e3;
		}).reduce((sum, s) => sum + (s.duration_seconds || 0), 0) / 60;
		if (socialTime >= .1) patterns.push({
			type: "doom-scrolling",
			severity: "medium",
			detail: `${Math.floor(socialTime)} min on social media`,
			shouldNudge: true
		});
		const recentApps = new Set(sessionHistory.filter((s) => s.started_at > Date.now() - 600 * 1e3).map((s) => s.app_name));
		if (recentApps.size >= 5) patterns.push({
			type: "distracted",
			severity: "low",
			detail: `switched between ${recentApps.size} different apps`,
			shouldNudge: false
		});
		return patterns;
	}
	var FALLBACKS = {
		"doom-scrolling-instagram": {
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
				"you've seen enough strangers' lives today. i promise."
			],
			nsfw: [
				"instagram again? they literally design this to f*ck with your dopamine.",
				"what the hell are you even looking at anymore.",
				"you've been scrolling instagram for ages. what is wrong with us.",
				"babe the explore page is a trap and you walked right in. again.",
				"comparing yourself to strangers on instagram? jesus christ.",
				"every reel is 30 seconds and yet somehow 40 minutes just disappeared.",
				"still scrolling. absolutely unhinged behavior from someone who said 'just a quick check'."
			]
		},
		"doom-scrolling-youtube": {
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
				"the recommended section is not a to-do list."
			],
			nsfw: [
				"are you seriously still watching youtube? what the hell happened to your plans.",
				"you literally said 'just one video'. that was an hour ago. come on.",
				"youtube autoplay is a scam and you fall for it every damn time.",
				"the rabbit hole got you again. unbelievable. (it's very believable.)",
				"bro the recommended section is not a homework assignment, stop watching everything.",
				"your watch history is going to be so embarrassing. just saying."
			]
		},
		"doom-scrolling": {
			sfw: [
				"not judging but you've been scrolling for a while...",
				"okay but are you even enjoying this anymore?",
				"your future self is silently judging this.",
				"cool. so we're just... scrolling. no judgment. (some judgment.)",
				"social media was supposed to be a quick check. lol.",
				"the scroll continues. as it always does.",
				"hey. you doing okay in there?"
			],
			nsfw: [
				"what the hell are you scrolling for at this point.",
				"genuinely: are you okay? because this has been a while.",
				"the scroll never ends and neither will your regret. kidding. mostly."
			]
		},
		"stuck-editing": {
			sfw: [
				"you've been on that for a while. need a fresh pair of eyes?",
				"still editing? perfection is a myth and a time thief.",
				"how many times have you rewritten that intro?",
				"just. send. it.",
				"done is better than perfect. i know you know that.",
				"you're editing the same thing on loop. step away for two minutes.",
				"the document hasn't changed much in 20 minutes. your brain needs a reset."
			],
			nsfw: [
				"you've been editing this for how long? just send the damn thing.",
				"done is better than perfect. stop rewriting the intro for the fifth f*cking time.",
				"at what point does editing become procrastination? asking for a friend. (it's now.)"
			]
		},
		"late-night-work": {
			sfw: [
				"okay but assignments at 3am? should i be worried?",
				"working late again. this is becoming a pattern.",
				"it's late. this better be worth it.",
				"your sleep schedule is screaming. can you hear it?",
				"the work will still be there after you sleep. the sleep won't wait forever though.",
				"late night productivity is a lie your brain tells you. mostly.",
				"tired + deadline = a special kind of suffering. i see you."
			],
			nsfw: [
				"it's 3am and you're still working. what the hell are you doing to yourself.",
				"your sleep schedule is absolutely trashed and you're just okay with that?",
				"tired + deadline is a terrible combination. go to bed. please.",
				"working this late is genuinely not worth it. i'm serious this time."
			]
		}
	};
	/**
	* Pick the right fallback bank based on pattern + current site + nsfwMode
	*/
	function pickFallback(patternType, activity, nsfwMode) {
		const mode = nsfwMode ? "nsfw" : "sfw";
		let bank;
		if (patternType === "doom-scrolling") {
			const detail = (activity.detail || "").toLowerCase();
			if (detail.includes("instagram")) bank = FALLBACKS["doom-scrolling-instagram"];
			else if (detail.includes("youtube")) bank = FALLBACKS["doom-scrolling-youtube"];
			else if (detail.includes("tiktok")) bank = FALLBACKS["doom-scrolling-tiktok"];
			else bank = FALLBACKS["doom-scrolling"];
		} else bank = FALLBACKS[patternType];
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
		console.log("[CONTEXT] Activity:", activity.type, "—", activity.detail);
		console.log("[CONTEXT] NSFW mode:", nsfwMode);
		if (patterns.length > 0) console.log("[CONTEXT] Patterns:", patterns.map((p) => p.type).join(", "));
		if ([
			"coding",
			"email-reading",
			"chatting",
			"entertainment"
		].includes(activity.type) && patterns.length === 0) return {
			shouldNudge: false,
			reasoning: "user is focused, no concerning patterns"
		};
		const highSeverityPatterns = patterns.filter((p) => p.shouldNudge);
		if (highSeverityPatterns.length === 0) return {
			shouldNudge: false,
			reasoning: "no concerning patterns warrant interruption"
		};
		const now = /* @__PURE__ */ new Date();
		const timeContext = `${now.getHours()}:${now.getMinutes().toString().padStart(2, "0")}`;
		const patternSummary = highSeverityPatterns.map((p) => `${p.type}: ${p.detail}`).join("; ");
		const detail = activity.detail || "";
		let siteContext = "";
		if (detail.toLowerCase().includes("instagram")) siteContext = "specifically on Instagram (reels, explore page, posts)";
		else if (detail.toLowerCase().includes("youtube")) siteContext = "specifically on YouTube (watching videos, autoplaying, rabbit hole)";
		else if (detail.toLowerCase().includes("tiktok")) siteContext = "specifically on TikTok (for you page, reels)";
		else if (detail.toLowerCase().includes("twitter") || detail.toLowerCase().includes("x.com")) siteContext = "specifically on Twitter/X (doom-scrolling the feed)";
		const swearRule = nsfwMode ? "- you CAN swear occasionally if it feels right (f*ck, hell, damn) — use sparingly, it should feel natural not forced" : "- NO swearing at all — keep it clean but still sarcastic";
		let prompt = `you're thera — brutally honest, warm AI companion living on this user's desktop.

you've detected concerning patterns. write a nudge.

current situation:
- time: ${timeContext}
- activity: ${detail}${siteContext ? `\n- site context: ${siteContext}` : ""}
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
		if (screenshot) prompt += "\n\n[screenshot of their screen is attached — use it to understand context better and be more specific]";
		const aiResponse = screenshot ? await callGeminiWithImage(prompt, screenshot, 80) : await callGemini(prompt, 80);
		console.log("[CONTEXT] AI raw response:", aiResponse);
		let message;
		if (!aiResponse || aiResponse === "SKIP" || aiResponse.toLowerCase().includes("skip")) {
			console.log("[CONTEXT] AI failed or returned SKIP — using fallback message");
			const patternType = highSeverityPatterns[0]?.type;
			message = pickFallback(patternType, activity, nsfwMode);
		} else message = aiResponse.replace(/^["']|["']$/g, "").trim();
		console.log("[CONTEXT] Final nudge message:", message);
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
	module.exports = {
		detectActivity,
		detectPattern,
		analyzeAndDecide,
		callGemini,
		callGeminiWithImage
	};
}));
//#endregion
//#region electron/monitors/screenCapture.js
var require_screenCapture = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	* TIER 3 — SCREEN VISION (on-demand, expensive)
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	*
	* Use Electron's desktopCapturer to screenshot the active window and send
	* to Gemini Vision for deep context understanding.
	*
	* Rate limits:
	* - Max once every 5 minutes (for testing: 1 minute)
	* - Only when patterns indicate we need deeper understanding
	*
	* Triggers:
	* - Unrecognized app for 15+ min
	* - Late night work sessions (to understand what they're working on)
	* - User stuck on same task 20+ min
	* - Rapid context switching (might be frustrated)
	*
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	*/
	var { desktopCapturer } = require("electron");
	var lastScreenshotTime = 0;
	var SCREENSHOT_COOLDOWN_MS = 60 * 1e3;
	/**
	* Capture screenshot of the primary screen
	* Returns: base64 encoded PNG string (without data:image/png;base64, prefix)
	*/
	async function captureScreen() {
		const now = Date.now();
		if (now - lastScreenshotTime < SCREENSHOT_COOLDOWN_MS) {
			console.log("[SCREENSHOT] Rate limited — cooldown not expired");
			return null;
		}
		try {
			const sources = await desktopCapturer.getSources({
				types: ["screen"],
				thumbnailSize: {
					width: 1280,
					height: 720
				}
			});
			if (sources.length === 0) {
				console.error("[SCREENSHOT] No screen sources available");
				return null;
			}
			const base64Image = sources[0].thumbnail.toPNG().toString("base64");
			lastScreenshotTime = now;
			console.log("[SCREENSHOT] Captured screen:", base64Image.length, "bytes");
			return base64Image;
		} catch (e) {
			console.error("[SCREENSHOT] Failed to capture:", e.message);
			return null;
		}
	}
	/**
	* Decide if we should take a screenshot for this session
	*/
	function shouldCapture(currentSession, patterns, activity) {
		if (Date.now() - lastScreenshotTime < SCREENSHOT_COOLDOWN_MS) return false;
		if (activity.type === "unknown" && currentSession.duration_minutes >= 15) {
			console.log("[SCREENSHOT] Trigger: unrecognized app 15+ min");
			return true;
		}
		const hour = (/* @__PURE__ */ new Date()).getHours();
		if ((hour >= 23 || hour <= 5) && currentSession.duration_minutes >= 10) {
			if ([
				"coding",
				"document-editing",
				"email-composing"
			].includes(activity.type)) {
				console.log("[SCREENSHOT] Trigger: late night work session");
				return true;
			}
		}
		if (currentSession.duration_minutes >= 20) {
			if ([
				"email-composing",
				"document-editing",
				"coding"
			].includes(activity.type)) {
				console.log("[SCREENSHOT] Trigger: stuck 20+ min on", activity.type);
				return true;
			}
		}
		if (patterns.filter((p) => p.type === "distracted" || p.type === "stuck-editing").length >= 2) {
			console.log("[SCREENSHOT] Trigger: multiple frustration signals");
			return true;
		}
		return false;
	}
	/**
	* Reset cooldown timer (for testing)
	*/
	function resetCooldown() {
		lastScreenshotTime = 0;
		console.log("[SCREENSHOT] Cooldown reset");
	}
	module.exports = {
		captureScreen,
		shouldCapture,
		resetCooldown
	};
}));
//#endregion
//#region electron/monitors/activityMonitor.js
var require_activityMonitor = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	* INTELLIGENT ACTIVITY MONITOR v2
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	*
	* Knows EXACTLY what you're doing and nudges contextually.
	*
	* For testing: Fast nudge checks (every 60s) with immediate pattern detection
	* For production: Slower checks (every 10s) with longer thresholds
	*
	* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	*/
	var { activityOps, nudgeOps } = require_localDb();
	var { BrowserWindow: BrowserWindow$1 } = require("electron");
	var { detectActivity, detectPattern, analyzeAndDecide } = require_contextAnalyzer();
	var { captureScreen, shouldCapture } = require_screenCapture();
	var settings = require_settings();
	var _activeWin = null;
	async function getActiveWindow() {
		if (!_activeWin) try {
			const mod = await import("active-win");
			_activeWin = mod.default ?? mod;
			console.log("[ACTIVITY] active-win loaded OK");
		} catch (e) {
			console.error("[ACTIVITY] Failed to load active-win:", e.message);
			return null;
		}
		try {
			return await _activeWin();
		} catch (e) {
			console.error("[ACTIVITY] active-win() threw:", e.message);
			return null;
		}
	}
	var currentSession = null;
	var sessionHistory = [];
	var monitorInterval = null;
	var nudgeCheckInterval = null;
	var POLL_INTERVAL_MS = 5e3;
	var NUDGE_CHECK_INTERVAL_MS = 6e4;
	function categorizeApp(appName, windowTitle) {
		const a = appName.toLowerCase();
		const t = (windowTitle || "").toLowerCase();
		if (a.includes("discord") || a.includes("slack") || a.includes("whatsapp") || t.includes("twitter") || t.includes("instagram") || t.includes("tiktok")) return "social";
		if (a.includes("code") || a.includes("cursor") || a.includes("terminal") || a.includes("vim") || a.includes("intellij") || a.includes("pycharm")) return "coding";
		if (a.includes("excel") || a.includes("word") || a.includes("outlook") || a.includes("teams") || a.includes("zoom") || a.includes("notion")) return "work";
		if (a.includes("spotify") || a.includes("netflix") || a.includes("steam") || t.includes("youtube") || t.includes("netflix") || t.includes("twitch")) return "entertainment";
		if (a.includes("chrome") || a.includes("firefox") || a.includes("safari") || a.includes("edge") || a.includes("brave")) return "browsing";
		return "other";
	}
	function sendNudge(type, message, metadata = {}) {
		console.log(`[NUDGE] ${type}: "${message}"`);
		if (metadata.reasoning) console.log(`[NUDGE] Reasoning: ${metadata.reasoning}`);
		nudgeOps.recordNudge(type, message);
		const widget = BrowserWindow$1.getAllWindows().find((w) => w.isAlwaysOnTop() && !w.frame);
		if (widget) widget.webContents.send("show-nudge", message);
		else console.warn("[NUDGE] No widget window found");
	}
	async function checkIntelligentNudges() {
		if (!currentSession) return;
		currentSession.duration_minutes = (Date.now() - currentSession.started_at) / 6e4;
		const activity = detectActivity(currentSession.app_name, currentSession.window_title);
		const patterns = detectPattern(sessionHistory, currentSession);
		console.log("[CONTEXT] Activity:", activity.type, "—", activity.detail);
		if (patterns.length > 0) console.log("[CONTEXT] Patterns detected:", patterns.map((p) => `${p.type} (${p.severity})`).join(", "));
		let screenshot = null;
		if (shouldCapture(currentSession, patterns, activity)) {
			screenshot = await captureScreen();
			if (screenshot) console.log("[CONTEXT] Using screenshot for deeper analysis");
		}
		const decision = await analyzeAndDecide(currentSession, sessionHistory, screenshot, { nsfwMode: settings.get("nsfwMode") });
		if (decision.shouldNudge) sendNudge("intelligent", decision.message, {
			reasoning: decision.reasoning,
			...decision.metadata
		});
		else console.log("[CONTEXT] No nudge —", decision.reasoning);
	}
	async function pollActiveWindow() {
		try {
			const win = await getActiveWindow();
			if (!win) {
				console.log("[ACTIVITY] active-win returned null");
				if (currentSession) {
					activityOps.endSession(currentSession.id);
					const duration_seconds = (Date.now() - currentSession.started_at) / 1e3;
					sessionHistory.push({
						...currentSession,
						duration_seconds
					});
					if (sessionHistory.length > 50) sessionHistory.shift();
					currentSession = null;
				}
				return;
			}
			const appName = win.owner?.name || "Unknown";
			const windowTitle = win.title || "";
			const category = categorizeApp(appName, windowTitle);
			if (!currentSession || currentSession.app_name !== appName || currentSession.window_title !== windowTitle) {
				if (currentSession) {
					activityOps.endSession(currentSession.id);
					const duration_seconds = (Date.now() - currentSession.started_at) / 1e3;
					sessionHistory.push({
						...currentSession,
						duration_seconds
					});
					if (sessionHistory.length > 50) sessionHistory.shift();
					console.log(`[ACTIVITY] Ended: "${currentSession.app_name}" (${Math.floor(duration_seconds)}s)`);
				}
				currentSession = {
					id: activityOps.startSession(appName, windowTitle, category),
					app_name: appName,
					window_title: windowTitle,
					category,
					started_at: Date.now(),
					duration_minutes: 0
				};
				console.log(`[ACTIVITY] Started: "${appName}" [${category}] — "${windowTitle.slice(0, 80)}"`);
			}
		} catch (e) {
			console.error("[ACTIVITY] Poll error:", e.message);
		}
	}
	function startMonitoring() {
		console.log("[ACTIVITY] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
		console.log("[ACTIVITY] Intelligent Activity Monitor v2 — TESTING MODE");
		console.log("[ACTIVITY] Window polling: every", POLL_INTERVAL_MS / 1e3, "seconds");
		console.log("[ACTIVITY] Nudge checks: every", NUDGE_CHECK_INTERVAL_MS / 1e3, "seconds");
		console.log("[ACTIVITY] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
		sessionHistory = activityOps.getRecentActivity(1).map((row) => ({
			...row,
			duration_minutes: row.duration_seconds / 60
		}));
		console.log("[ACTIVITY] Loaded", sessionHistory.length, "recent sessions from DB");
		pollActiveWindow();
		monitorInterval = setInterval(pollActiveWindow, POLL_INTERVAL_MS);
		nudgeCheckInterval = setInterval(checkIntelligentNudges, NUDGE_CHECK_INTERVAL_MS);
		setTimeout(checkIntelligentNudges, 3e4);
	}
	function stopMonitoring() {
		if (monitorInterval) {
			clearInterval(monitorInterval);
			clearInterval(nudgeCheckInterval);
			if (currentSession) activityOps.endSession(currentSession.id);
			console.log("[ACTIVITY] Monitor stopped");
		}
	}
	startMonitoring();
	process.on("exit", stopMonitoring);
	module.exports = {
		startMonitoring,
		stopMonitoring
	};
}));
//#endregion
//#region electron/main.js
var { app, BrowserWindow, ipcMain, Tray, Menu } = require("electron");
var path = require("path");
var settings = require_settings();
var mainWindow;
var widgetWindow;
var tray;
function createWindow() {
	mainWindow = new BrowserWindow({
		width: 400,
		height: 600,
		minWidth: 350,
		minHeight: 500,
		frame: false,
		backgroundColor: "#18120a",
		skipTaskbar: false,
		alwaysOnTop: false,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false
		}
	});
	if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
	else mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
	mainWindow.on("close", (event) => {
		if (!app.isQuitting) {
			event.preventDefault();
			mainWindow.hide();
		}
	});
	mainWindow.on("show", () => {
		if (process.platform === "darwin" && tray.setHighlightMode) tray.setHighlightMode("always");
	});
	mainWindow.on("blur", () => {
		setTimeout(() => {
			if (!mainWindow.isFocused() && mainWindow.isVisible()) mainWindow.hide();
		}, 200);
	});
}
function createWidgetWindow() {
	const { screen } = require("electron");
	const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
	const W = 400, H = 110;
	const savedPosition = {
		x: Math.floor((screenWidth - W) / 2),
		y: 0
	};
	widgetWindow = new BrowserWindow({
		width: W,
		height: H,
		x: savedPosition.x,
		y: savedPosition.y,
		frame: false,
		transparent: true,
		alwaysOnTop: true,
		skipTaskbar: true,
		resizable: false,
		hasShadow: false,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false
		}
	});
	if (process.env.VITE_DEV_SERVER_URL) {
		const baseURL = process.env.VITE_DEV_SERVER_URL.replace(/\/$/, "");
		widgetWindow.loadURL(`${baseURL}/widget.html`);
	} else widgetWindow.loadFile(path.join(__dirname, "../dist/widget.html"));
	console.log("[WIDGET] Widget window created at position:", savedPosition);
	if (process.platform === "win32") widgetWindow.setIgnoreMouseEvents(true, { forward: true });
	else widgetWindow.setIgnoreMouseEvents(false);
	widgetWindow.on("closed", () => {
		console.log("[WIDGET] Widget window closed");
	});
	widgetWindow.on("hide", () => {
		console.log("[WIDGET] Widget window hidden");
	});
	widgetWindow.on("show", () => {
		console.log("[WIDGET] Widget window shown");
	});
	widgetWindow.webContents.on("did-finish-load", () => {
		console.log("[WIDGET] Widget finished loading");
	});
	widgetWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
		console.error("[WIDGET] Widget failed to load:", errorCode, errorDescription);
	});
}
function createTray() {
	const { nativeImage } = require("electron");
	nativeImage.createEmpty();
	tray = new Tray(nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABOSURBVDiNY/z//z8DJYCRUgNgYBgF+MDu3bv/M1AJmDZtGvUMuHjx4n8GKgHLly+nngFoYBTgY8C1a9f+M1AJWLhwIfUMgIFRAFYBANJ4Cul0TKhpAAAAAElFTkSuQmCC"));
	const contextMenu = Menu.buildFromTemplate([
		{
			label: "Show Thera",
			click: () => {
				mainWindow.show();
				mainWindow.focus();
			}
		},
		{
			label: "Hide Thera",
			click: () => {
				mainWindow.hide();
			}
		},
		{ type: "separator" },
		{
			label: "Quit",
			click: () => {
				app.isQuitting = true;
				app.quit();
			}
		}
	]);
	tray.setToolTip("Thera - Your desktop companion");
	tray.setContextMenu(contextMenu);
	tray.on("click", () => {
		if (mainWindow.isVisible()) mainWindow.hide();
		else {
			mainWindow.show();
			mainWindow.focus();
		}
	});
}
ipcMain.on("minimize-window", () => {
	if (mainWindow) mainWindow.minimize();
});
ipcMain.on("close-window", () => {
	if (mainWindow) mainWindow.hide();
});
ipcMain.on("toggle-always-on-top", (event, alwaysOnTop) => {
	if (mainWindow) mainWindow.setAlwaysOnTop(alwaysOnTop);
});
ipcMain.on("widget-clicked", () => {
	if (widgetWindow) widgetWindow.webContents.send("dismiss-nudge");
});
ipcMain.on("widget-long-press", () => {
	if (mainWindow) {
		mainWindow.show();
		mainWindow.focus();
	}
});
ipcMain.on("move-widget", (_e, { x, y }) => {
	if (widgetWindow) widgetWindow.setPosition(Math.round(x), Math.round(y));
});
ipcMain.on("widget-resize", (_e, { height }) => {
	if (widgetWindow) {
		const [w] = widgetWindow.getSize();
		widgetWindow.setSize(w, height);
	}
});
ipcMain.handle("get-setting", (_e, key) => settings.get(key));
ipcMain.on("set-setting", (_e, key, value) => settings.set(key, value));
app.whenReady().then(() => {
	createWindow();
	createWidgetWindow();
	createTray();
	require_activityMonitor();
});
app.on("window-all-closed", (e) => {
	e.preventDefault();
});
app.on("before-quit", () => {
	app.isQuitting = true;
});
app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
	else mainWindow.show();
});
//#endregion
