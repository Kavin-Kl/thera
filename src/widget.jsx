import { createRoot } from 'react-dom/client';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { sendMessageToAI } from './services/aiService';
import { processAIResponse } from './services/actionExecutor';

const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron?.ipcRenderer;

/* ── Design tokens ────────────────────────────────────────── */
const CORAL  = "#e8603a";
const BRIC   = "'Space Grotesk', system-ui, sans-serif";
const MONO   = "'Space Mono', monospace";

/* ── Spring physics ───────────────────────────────────────── */
const SPRING      = { type: "spring", stiffness: 420, damping: 38, mass: 0.55 };
const SOFT_SPRING = { type: "spring", stiffness: 260, damping: 30, mass: 0.7 };

/* ── Typing dots (same as Home.jsx) ──────────────────────── */
function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '2px 0' }}>
      {[CORAL, 'rgba(255,255,255,0.5)', CORAL].map((c, i) => (
        <motion.span key={i}
          style={{ width: 4, height: 4, borderRadius: '50%', background: c, display: 'block' }}
          animate={{ y: [0, -5, 0], opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 0.85, repeat: Infinity, delay: i * 0.17, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

/* ── Border-draw overlay (SVG stroke-dashoffset trick) ───── */
// pathLength="1" normalises the path so dasharray/offset are 0–1 fractions —
// no need to compute the actual perimeter in JS.
function BorderProgress({ dims, holdMs }) {
  const pad = 2;
  const r   = Math.min(dims.height / 2, 50); // matches CSS borderRadius:50
  return (
    <svg
      style={{
        position: 'absolute',
        left: -pad, top: -pad,
        width:  dims.width  + pad * 2,
        height: dims.height + pad * 2,
        pointerEvents: 'none',
        zIndex: 2,
        overflow: 'visible',
      }}
    >
      <rect
        x={pad} y={pad}
        width={dims.width}
        height={dims.height}
        rx={r} ry={r}
        fill="none"
        stroke="#e8603a"
        strokeWidth="1.5"
        strokeLinecap="round"
        pathLength={1}
        style={{
          strokeDasharray:  1,
          strokeDashoffset: 1,        // start fully hidden
          animationName:    'borderDraw',
          animationDuration: `${holdMs}ms`,
          animationTimingFunction: 'linear',
          animationFillMode: 'forwards',
        }}
      />
    </svg>
  );
}

/* ── Mini chat system prompt (ultra-brief) ────────────────── */
const MINI_PROMPT = `you're thera. same skull as the fleabag woman. lowercase always.

this is the quick chat widget on their desktop. they're busy.

rules:
- EVERY response: maximum 2 sentences. absolutely no more.
- lowercase. always.
- dry + warm. "yeah that's rough." not "i hear you're struggling."
- no fluff, no explaining, no elaborating after you've made the point
- one-word asides when it fits: "ugh." "right." "fuck." "knew it."
- specific not generic. "stuck on that email?" not "how can i help today"
- if they say something heavy: hold it. don't rush to fix. "that's a lot. okay."
- if they're spiralling: one grounding thing. not a list. "what's the one next thing."

shape: honest observation → one real thing or question. done.

respond in 2 sentences max. trust they got it.

---

ACTIONS. you can actually DO stuff on their desktop. when they ask for something you can do, do it — emit an action tag at the very end of your reply, on its own line, like:

<action>{"type":"gmail.draft","params":{"to":"alex","subject":"friday","body":"hey — friday works."}}</action>

available types (exactly these, no others):
- gmail.draft { to, subject, body }   ← always draft first for emails. never send without explicit go-ahead.
- gmail.send  { to, subject, body }   ← only after they say send/go/yes on a draft you already showed.
- gmail.search { query, max? }
- gcal.create { summary, start, end, description?, attendees? }   ← ISO 8601
- gcal.list   { max?, timeMin?, timeMax? }
- gcontacts.search { query }
- gdrive.search { query, max? }
- gdocs.create { title, content? }
- gsheets.read { spreadsheetId, range }
- spotify.play { query? }  ← plays immediately. if query given, searches and plays that track.
- spotify.pause {}  /  spotify.next {}  /  spotify.previous {}
- spotify.queue { uri }  /  spotify.search { query, type? }
- slack.send { channel, text }   ← draft/confirm pattern applies.
- slack.search { query }
- reminders.create { text, when? }
- notes.create { text }
- browser.open { url, newTab? }
- browser.search { query, engine? }   ← engine: google/youtube/maps/amazon/zomato/bookmyshow
- browser.whatsapp.dm { to, message }
- browser.instagram.dm { to, message }

rules:
- your prose reply comes first, then the tag(s), nothing after.
- never show the raw json or the word "action" in your prose. the tag is invisible infrastructure.
- if you don't have enough info (no recipient, no time), ask in voice — don't emit a half-filled tag.
- if the thing isn't in the list, say so briefly. don't fake it.
- when a result comes back next turn as "[action result] ...", react naturally — "drafted. send?" — don't dump the raw result.`;

function Widget() {
  const [nudgeText,      setNudgeText]      = useState(null);
  const [miniChat,       setMiniChat]       = useState(false);
  const [input,          setInput]          = useState('');
  const [reply,          setReply]          = useState(null);
  const [typing,         setTyping]         = useState(false);
  const [mounted,        setMounted]        = useState(false);
  const [pressing,       setPressing]       = useState(false);
  const [pillDims,       setPillDims]       = useState(null);
  const [nsfwMode,       setNsfwMode]       = useState(false);
  const [dragging,       setDragging]       = useState(false);
  const [nowPlaying,     setNowPlaying]     = useState(null); // { track, artist, isPlaying }
  const [spotifyLoading, setSpotifyLoading] = useState(null); // 'prev'|'toggle'|'next'

  const nowPlayingPollRef = useRef(null);

  const dismissTimer   = useRef(null);
  const pressTimer     = useRef(null);
  const pillRef        = useRef(null);
  const dragState      = useRef(null); // { startMouseX, startMouseY, startWinX, startWinY }
  const isDragging     = useRef(false);
  const pressStartTime = useRef(0);
  const inputRef       = useRef(null);
  const miniHistory    = useRef([]);   // lightweight per-session history

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 120);

    try {
      if (!ipcRenderer) throw new Error('no ipcRenderer');

      ipcRenderer.on('show-nudge', (_e, msg) => {
        if (dismissTimer.current) clearTimeout(dismissTimer.current);
        setNudgeText(msg);
        dismissTimer.current = setTimeout(() => setNudgeText(null), 8000);
      });
      ipcRenderer.on('dismiss-nudge', () => {
        if (dismissTimer.current) clearTimeout(dismissTimer.current);
        setNudgeText(null);
      });

      // Load initial NSFW setting
      ipcRenderer.invoke('get-setting', 'nsfwMode').then(val => {
        if (val !== undefined) setNsfwMode(!!val);
      }).catch(() => {});

      return () => {
        clearTimeout(t);
        clearTimeout(dismissTimer.current);
        clearTimeout(pressTimer.current);
        ipcRenderer.removeAllListeners('show-nudge');
        ipcRenderer.removeAllListeners('dismiss-nudge');
      };
    } catch (e) {
      return () => clearTimeout(t);
    }
  }, []);

  /* ── Spotify now-playing poller ─────────────────────────── */
  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await ipcRenderer?.invoke('widget:spotify:get-current');
        if (alive) setNowPlaying(res?.ok && res.isPlaying ? res : null);
      } catch (_) {
        if (alive) setNowPlaying(null);
      }
    }
    poll();
    nowPlayingPollRef.current = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(nowPlayingPollRef.current); };
  }, []);

  /* ── Window resize when mini chat or spotify bar changes ── */
  useEffect(() => {
    try {
      const base = miniChat ? 310 : 100;
      const extra = nowPlaying ? 56 : 0;
      ipcRenderer?.send('widget-resize', { height: base + extra });
      if (miniChat) setTimeout(() => inputRef.current?.focus(), 200);
    } catch (_) {}
  }, [miniChat, nowPlaying]);

  /* ── Drag + click + long-press on the pill ──────────────── */
  const HOLD_MS = 650;

  const handleMouseDown = async (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    // Get actual window position from main process to avoid drift
    let winPos;
    try {
      winPos = await ipcRenderer?.invoke('get-widget-position');
    } catch (_) {
      winPos = { x: window.screenX, y: window.screenY };
    }

    dragState.current = {
      startMouseX: e.screenX,
      startMouseY: e.screenY,
      startWinX:   winPos.x,
      startWinY:   winPos.y,
    };
    isDragging.current     = false;
    pressStartTime.current = Date.now();

    // Snapshot pill dimensions for the SVG border overlay
    if (pillRef.current) {
      const { width, height } = pillRef.current.getBoundingClientRect();
      setPillDims({ width, height });
    }
    setPressing(true);

    // Fire long press after HOLD_MS if no drag happened
    pressTimer.current = setTimeout(() => {
      if (!isDragging.current) {
        setPressing(false);
        setPillDims(null);
        setMiniChat(c => !c);
      }
    }, HOLD_MS);

    const onMove = (moveEvt) => {
      if (!dragState.current) return;

      const dx = moveEvt.screenX - dragState.current.startMouseX;
      const dy = moveEvt.screenY - dragState.current.startMouseY;

      // Start dragging if moved more than threshold
      if (!isDragging.current && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        isDragging.current = true;
        setDragging(true);
        clearTimeout(pressTimer.current);
        setPressing(false);
        setPillDims(null);
      }

      // Only send position updates when actually dragging
      if (isDragging.current) {
        const newX = dragState.current.startWinX + dx;
        const newY = dragState.current.startWinY + dy;

        try {
          ipcRenderer?.send('move-widget', { x: newX, y: newY });
        } catch (_) {}
      }
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      clearTimeout(pressTimer.current);
      setPressing(false);
      setPillDims(null);

      const elapsed = Date.now() - pressStartTime.current;

      // Quick click opens main window (not long press)
      if (!isDragging.current && elapsed < 280 && !miniChat) {
        try { ipcRenderer?.send('widget-long-press'); } catch (_) {}
      }

      dragState.current  = null;
      isDragging.current = false;
      setDragging(false);
    };

    document.addEventListener('mousemove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp, { passive: false });
  };

  /* ── Mini chat send ──────────────────────────────────────── */
  const sendMessage = async () => {
    const text = input.trim();
    if (!text || typing) return;
    setInput('');
    setTyping(true);
    setReply(null);

    miniHistory.current = [
      ...miniHistory.current,
      { role: 'user', parts: [{ text }] },
    ];

    try {
      // Use a trimmed history (last 6 turns) with mini system prompt
      const trimmed = miniHistory.current.slice(-6);
      const rawBotText = await sendMessageToAI(trimmed, '', MINI_PROMPT);

      // Strip + execute any <action>...</action> tags the AI emitted.
      const { displayText, results, resultSummary } = await processAIResponse(rawBotText);
      const visibleText = results.length > 0
        ? `${displayText}${displayText ? '\n' : ''}${results.map(r => `— ${r.summary}`).join('\n')}`
        : displayText;

      miniHistory.current = [
        ...miniHistory.current,
        { role: 'model', parts: [{ text: rawBotText }] },
      ];
      if (resultSummary) {
        miniHistory.current.push({
          role: 'user',
          parts: [{ text: resultSummary }],
        });
      }
      setReply(visibleText);
    } catch {
      setReply("ugh, something broke. try again?");
    } finally {
      setTyping(false);
    }
  };

  /* ── Spotify controls ───────────────────────────────────── */
  const spotifyControl = async (action) => {
    setSpotifyLoading(action);
    try {
      const res = await ipcRenderer?.invoke(`widget:spotify:${action}`);
      if (res?.track) setNowPlaying({ ...nowPlaying, track: res.track, artist: res.artist, isPlaying: true });
      if (action === 'toggle') setNowPlaying(p => p ? { ...p, isPlaying: !p.isPlaying } : p);
    } catch (_) {}
    setSpotifyLoading(null);
  };

  const dismissNudge = (e) => {
    e.stopPropagation();
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    try { ipcRenderer?.send('widget-clicked'); } catch (_) {}
    setNudgeText(null);
  };

  const toggleNsfw = (e) => {
    e.stopPropagation();
    const next = !nsfwMode;
    setNsfwMode(next);
    try { ipcRenderer?.send('set-setting', 'nsfwMode', next); } catch (_) {}
  };

  const hasNudge = nudgeText !== null;

  return (
    <div
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}
      onMouseEnter={() => {
        try { ipcRenderer?.send('set-widget-interactive', true); } catch (_) {}
      }}
      onMouseLeave={() => {
        if (!miniChat) {
          try { ipcRenderer?.send('set-widget-interactive', false); } catch (_) {}
        }
      }}
    >

      <AnimatePresence>
        {mounted && (
          <motion.div
            key="pill-wrapper"
            initial={{ y: -36, opacity: 0, scale: 0.88 }}
            animate={{ y: 0,   opacity: 1, scale: 1    }}
            exit={{   y: -36, opacity: 0, scale: 0.88  }}
            transition={SPRING}
            style={{ pointerEvents: 'auto', position: 'relative' }}
          >
            {/* ── BORDER DRAW — SVG overlay that fills on long press ── */}
            {pressing && pillDims && (
              <BorderProgress dims={pillDims} holdMs={HOLD_MS} />
            )}

            {/* ── THE PILL ──────────────────────────────────── */}
            <motion.div
              ref={pillRef}
              layout={!dragging}
              transition={SPRING}
              onMouseDown={handleMouseDown}
              animate={{
                boxShadow: pressing
                  ? `0 2px 8px rgba(0,0,0,0.5), 0 0 18px rgba(232,96,58,0.18)`
                  : hasNudge
                  ? '0 6px 36px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.05)'
                  : '0 4px 20px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.04)',
              }}
              transition={SPRING}
              style={{
                borderRadius: 50,
                background: hasNudge ? 'rgba(16,14,12,0.97)' : 'rgba(16,14,12,0.92)',
                backdropFilter: 'blur(40px) saturate(180%)',
                WebkitBackdropFilter: 'blur(40px) saturate(180%)',
                border: `0.5px solid ${pressing ? `rgba(232,96,58,0.35)` : hasNudge ? 'rgba(232,96,58,0.2)' : 'rgba(255,255,255,0.07)'}`,
                cursor: dragging ? 'grabbing' : 'grab',
                overflow: 'hidden',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitUserDrag: 'none',
                position: 'relative',
                zIndex: 1,
              }}
            >

              {/* popLayout: exiting element is removed from flow instantly so the
                  pill springs to the new size, then incoming content fades in */}
              <AnimatePresence mode="popLayout">

                {/* ── Idle ────────────────────────────────── */}
                {!hasNudge && (
                  <motion.div
                    key="idle"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{   opacity: 0 }}
                    transition={{ duration: 0.12 }}
                    style={{
                      display: 'flex', alignItems: 'center',
                      gap: 7, padding: '7px 14px 7px 11px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <motion.div
                      animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.3, 1] }}
                      transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                      style={{
                        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                        background: CORAL, boxShadow: `0 0 8px ${CORAL}99`,
                      }}
                    />
                    <span style={{
                      fontFamily: BRIC, fontSize: 12, fontWeight: 600,
                      letterSpacing: '-0.3px',
                      color: pressing ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.55)',
                      transition: 'color 0.15s',
                    }}>
                      thera<span style={{ color: CORAL }}>.</span>
                    </span>
                    <span style={{
                      fontFamily: MONO, fontSize: 8,
                      color: 'rgba(255,255,255,0.18)',
                      letterSpacing: '0.5px',
                    }}>
                      hold for chat
                    </span>
                  </motion.div>
                )}

                {/* ── Nudge — single horizontal row, pill just gets wider ── */}
                {hasNudge && (
                  <motion.div
                    key="nudge"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{   opacity: 0 }}
                    transition={{ duration: 0.15, delay: 0.08 }}
                    style={{
                      display: 'flex', alignItems: 'center',
                      gap: 9, padding: '7px 12px 7px 11px',
                      maxWidth: 420,
                    }}
                  >
                    {/* dot + label */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                      <motion.div
                        animate={{ opacity: [0.5, 1, 0.5] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                          background: CORAL, boxShadow: `0 0 5px ${CORAL}` }}
                      />
                      <span style={{ fontFamily: MONO, fontSize: 8.5, color: CORAL,
                        letterSpacing: '1.5px', textTransform: 'uppercase' }}>
                        thera
                      </span>
                    </div>

                    {/* divider */}
                    <div style={{ width: 1, height: 10, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />

                    {/* message — wraps if needed */}
                    <span style={{
                      fontFamily: BRIC, fontSize: 12.5, fontWeight: 300,
                      color: 'rgba(255,255,255,0.88)',
                      flex: 1, lineHeight: 1.4,
                    }}>
                      {nudgeText}
                    </span>

                    {/* dismiss */}
                    <motion.button
                      onClick={dismissNudge}
                      onMouseDown={e => e.stopPropagation()}
                      whileHover={{ scale: 1.2 }} whileTap={{ scale: 0.85 }}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'rgba(255,255,255,0.22)', fontFamily: MONO,
                        fontSize: 10, padding: '2px 2px', lineHeight: 1, flexShrink: 0,
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.6)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.22)'}
                    >✕</motion.button>
                  </motion.div>
                )}

              </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── SPOTIFY BAR ──────────────────────────────────── */}
      <AnimatePresence>
        {nowPlaying && (
          <motion.div
            key="spotify-bar"
            initial={{ opacity: 0, y: -8, scaleY: 0.9 }}
            animate={{ opacity: 1, y: 0,  scaleY: 1    }}
            exit={{   opacity: 0, y: -6,  scaleY: 0.9  }}
            transition={SOFT_SPRING}
            onMouseEnter={() => { try { ipcRenderer?.send('set-widget-interactive', true); } catch (_) {} }}
            onMouseLeave={() => { if (!miniChat) { try { ipcRenderer?.send('set-widget-interactive', false); } catch (_) {} } }}
            style={{
              pointerEvents: 'auto',
              marginTop: 5,
              width: 260,
              background: 'rgba(16,14,12,0.94)',
              backdropFilter: 'blur(40px) saturate(180%)',
              WebkitBackdropFilter: 'blur(40px) saturate(180%)',
              border: '0.5px solid rgba(255,255,255,0.07)',
              borderRadius: 14,
              boxShadow: '0 4px 20px rgba(0,0,0,0.45)',
              display: 'flex', alignItems: 'center',
              gap: 8, padding: '8px 12px',
              transformOrigin: 'top center',
            }}
          >
            {/* Spotify dot */}
            <motion.div
              animate={{ opacity: nowPlaying.isPlaying ? [0.5,1,0.5] : 0.3 }}
              transition={{ duration: 1.8, repeat: nowPlaying.isPlaying ? Infinity : 0 }}
              style={{ width: 5, height: 5, borderRadius: '50%', background: '#1DB954', flexShrink: 0 }}
            />

            {/* Track info */}
            <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
              <div style={{
                fontFamily: BRIC, fontSize: 11, fontWeight: 500,
                color: 'rgba(255,255,255,0.85)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{nowPlaying.track}</div>
              <div style={{
                fontFamily: MONO, fontSize: 8.5,
                color: 'rgba(255,255,255,0.32)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{nowPlaying.artist}</div>
            </div>

            {/* Controls */}
            {['previous', 'toggle', 'next'].map(action => (
              <motion.button
                key={action}
                onMouseDown={e => e.stopPropagation()}
                onClick={() => spotifyControl(action)}
                whileHover={{ scale: 1.2 }} whileTap={{ scale: 0.85 }}
                disabled={spotifyLoading === action}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: spotifyLoading === action ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.55)',
                  padding: '2px 3px', fontSize: 10, lineHeight: 1, flexShrink: 0,
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => { if (spotifyLoading !== action) e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={e => e.currentTarget.style.color = spotifyLoading === action ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.55)'}
              >
                {action === 'previous' ? '⏮' : action === 'toggle' ? (nowPlaying.isPlaying ? '⏸' : '▶') : '⏭'}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── MINI CHAT ─────────────────────────────────────── */}
      <AnimatePresence>
        {miniChat && (
          <motion.div
            key="mini-chat"
            initial={{ opacity: 0, y: -12, scaleY: 0.92 }}
            animate={{ opacity: 1, y: 0,   scaleY: 1     }}
            exit={{   opacity: 0, y: -8,   scaleY: 0.94  }}
            transition={SOFT_SPRING}
            onMouseEnter={() => {
              try { ipcRenderer?.send('set-widget-interactive', true); } catch (_) {}
            }}
            onMouseLeave={() => {
              try { ipcRenderer?.send('set-widget-interactive', false); } catch (_) {}
            }}
            style={{
              pointerEvents: 'auto',
              marginTop: 6,
              width: 300,
              background: 'rgba(16, 14, 12, 0.95)',
              backdropFilter: 'blur(40px) saturate(180%)',
              WebkitBackdropFilter: 'blur(40px) saturate(180%)',
              border: '0.5px solid rgba(255,255,255,0.08)',
              borderRadius: 18,
              boxShadow: '0 8px 40px rgba(0,0,0,0.55)',
              overflow: 'hidden',
              transformOrigin: 'top center',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px 8px',
              borderBottom: '0.5px solid rgba(255,255,255,0.07)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <motion.div
                  animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.3, 1] }}
                  transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                  style={{ width: 5, height: 5, borderRadius: '50%', background: CORAL, boxShadow: `0 0 6px ${CORAL}88` }}
                />
                <span style={{ fontFamily: BRIC, fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)', letterSpacing: '-0.2px' }}>
                  thera<span style={{ color: CORAL }}>.</span>
                </span>
                <span style={{ fontFamily: MONO, fontSize: 8, color: 'rgba(255,255,255,0.2)', letterSpacing: '1px' }}>
                  quick chat
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* NSFW toggle */}
                <motion.button
                  onClick={toggleNsfw}
                  onMouseDown={e => e.stopPropagation()}
                  whileTap={{ scale: 0.88 }}
                  title={nsfwMode ? 'NSFW on — Thera can swear. click to turn off.' : 'SFW mode — Thera stays clean. click to unleash her.'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    background: nsfwMode ? 'rgba(232,96,58,0.12)' : 'rgba(255,255,255,0.04)',
                    border: `0.5px solid ${nsfwMode ? 'rgba(232,96,58,0.35)' : 'rgba(255,255,255,0.1)'}`,
                    borderRadius: 20, padding: '2px 7px 2px 5px',
                    cursor: 'pointer', transition: 'all 0.2s',
                  }}
                >
                  {/* pill indicator */}
                  <div style={{
                    width: 14, height: 8, borderRadius: 10,
                    background: nsfwMode ? CORAL : 'rgba(255,255,255,0.12)',
                    position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                  }}>
                    <motion.div
                      animate={{ x: nsfwMode ? 6 : 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      style={{
                        position: 'absolute', top: 1, left: 1,
                        width: 6, height: 6, borderRadius: '50%',
                        background: '#fff',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                      }}
                    />
                  </div>
                  <span style={{
                    fontFamily: MONO, fontSize: 7.5, letterSpacing: '0.8px',
                    color: nsfwMode ? CORAL : 'rgba(255,255,255,0.25)',
                    transition: 'color 0.2s', textTransform: 'uppercase',
                  }}>
                    {nsfwMode ? 'nsfw' : 'sfw'}
                  </span>
                </motion.button>

                <motion.button
                  onClick={() => setMiniChat(false)}
                  onMouseDown={e => e.stopPropagation()}
                  whileHover={{ scale: 1.15 }} whileTap={{ scale: 0.85 }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'rgba(255,255,255,0.25)', fontFamily: MONO, fontSize: 10,
                    padding: '2px 4px', lineHeight: 1,
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.6)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.25)'}
                >✕</motion.button>
              </div>
            </div>

            {/* Response area */}
            <div style={{ padding: '10px 14px', minHeight: 56 }}>
              <AnimatePresence mode="wait">
                {typing ? (
                  <motion.div
                    key="dots"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <TypingDots />
                  </motion.div>
                ) : reply ? (
                  <motion.p
                    key="reply"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    style={{
                      margin: 0, fontFamily: BRIC, fontSize: 12.5, fontWeight: 300,
                      color: 'rgba(255,255,255,0.82)', lineHeight: 1.6,
                    }}
                  >
                    {reply}
                  </motion.p>
                ) : (
                  <motion.p
                    key="empty"
                    initial={{ opacity: 0 }} animate={{ opacity: 0.35 }} exit={{ opacity: 0 }}
                    style={{
                      margin: 0, fontFamily: MONO, fontSize: 9,
                      color: 'rgba(255,255,255,0.35)', letterSpacing: '0.5px',
                    }}
                  >
                    what's on your mind?
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            {/* Input */}
            <div style={{
              padding: '8px 14px 12px',
              borderTop: '0.5px solid rgba(255,255,255,0.07)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <motion.span
                animate={{ color: input ? CORAL : 'rgba(255,255,255,0.2)' }}
                transition={{ duration: 0.2 }}
                style={{ fontFamily: MONO, fontSize: 13, flexShrink: 0, lineHeight: 1 }}
              >›</motion.span>

              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sendMessage(); e.stopPropagation(); }}
                onMouseDown={e => e.stopPropagation()}
                placeholder="say something..."
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none',
                  fontFamily: BRIC, fontSize: 12.5, fontWeight: 300,
                  color: 'rgba(255,255,255,0.85)',
                  caretColor: CORAL,
                }}
              />

              <AnimatePresence>
                {input.trim() && (
                  <motion.button
                    initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6 }}
                    transition={SOFT_SPRING}
                    onClick={sendMessage}
                    onMouseDown={e => e.stopPropagation()}
                    whileHover={{ x: 2 }} whileTap={{ scale: 0.9 }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontFamily: MONO, fontSize: 10, color: CORAL,
                      padding: '2px 0', flexShrink: 0, letterSpacing: '0.3px',
                    }}
                  >
                    send →
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<Widget />);
