import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { sendMessageToAI } from "../services/aiService";
import { processAIResponse } from "../services/actionExecutor";
import { fetchMemoryContext, storeConversation } from "../services/memoryService";

const { ipcRenderer } = window.require ? window.require('electron') : {};

/* ── Tokens ───────────────────────────────────────────────── */
const BRIC  = "'Space Grotesk', system-ui, sans-serif";
const MONO  = "'Space Mono', monospace";
const CORAL = "#e8603a";
const GOLD  = "#c89640";

const DARK = {
  BG:      "#18120a",
  SURFACE: "#221808",
  BORDER:  "#3a2614",
  TEXT:    "#f0e6d2",
  MUTED:   "#8a7256",
  DIM:     "#4a3420",
};

const LIGHT = {
  BG:      "#f5ede0",
  SURFACE: "#ede0cc",
  BORDER:  "#d4c0a0",
  TEXT:    "#1c1008",
  MUTED:   "#7a6040",
  DIM:     "#c0a878",
};

/* ── Easing ───────────────────────────────────────────────── */
const E_OUT = [0.0, 0.0, 0.2, 1.0];
const E_STD = [0.2, 0.0, 0.0, 1.0];
const reveal = (d = 0) => ({ duration: 0.46, ease: E_OUT, delay: d });
const soft   = (d = 0) => ({ type: "spring", stiffness: 200, damping: 28, mass: 0.9, delay: d });

/* ── Data ─────────────────────────────────────────────────── */
const prompts = [
  "tell me everything.",
  "vent. i'll handle it.",
  "what's actually bothering you?",
];

/* ── Typing dots ──────────────────────────────────────────── */
function TypingDots() {
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center", padding: "4px 0" }}>
      {[CORAL, GOLD, CORAL].map((c, i) => (
        <motion.span key={i}
          style={{ width: 5, height: 5, borderRadius: "50%", background: c, display: "block" }}
          animate={{ y: [0, -6, 0], opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
export default function Home({ dark, setDark, onOpenSettings }) {
  const { BG, SURFACE, BORDER, TEXT, MUTED, DIM } = dark ? DARK : LIGHT;

  const [input,      setInput]      = useState("");
  const [messages,   setMessages]   = useState([]);
  const [sessions,   setSessions]   = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [drawer,     setDrawer]     = useState(false);
  const [focused,    setFocused]    = useState(false);
  const [typing,     setTyping]     = useState(false);
  const bottomRef = useRef(null);
  const conversationRef = useRef([]);
  const conversationIdRef = useRef(null);

  // Temporary userId until we add proper auth
  const userId = 'desktop_user';

  // ── Session loading ────────────────────────────────────────
  const refreshSessions = async () => {
    if (!ipcRenderer) return [];
    const list = await ipcRenderer.invoke('sessions:list');
    setSessions(list);
    return list;
  };

  useEffect(() => {
    (async () => {
      const list = await refreshSessions();
      if (list.length > 0) {
        // Resume most recent session
        await loadSession(list[0].id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSession = async (id) => {
    if (!ipcRenderer) return;
    const rows = await ipcRenderer.invoke('sessions:messages', { id });
    const loaded = rows.map(r => ({ id: r.id, role: r.role, text: r.text }));
    setMessages(loaded);
    setActiveChat(id);
    conversationIdRef.current = id;
    conversationRef.current = loaded.map(m => ({
      role: m.role === 'bot' ? 'model' : 'user',
      parts: [{ text: m.text }],
    }));
  };

  const startNewSession = async () => {
    setMessages([]);
    setActiveChat(null);
    conversationIdRef.current = null;
    conversationRef.current = [];
    setDrawer(false);
  };

  const deleteSession = async (id, e) => {
    e?.stopPropagation();
    if (!ipcRenderer) return;
    await ipcRenderer.invoke('sessions:delete', { id });
    if (id === activeChat) await startNewSession();
    refreshSessions();
  };

  const send = async () => {
    const text = input.trim();
    if (!text || typing) return;

    setInput("");

    // Create session on first message of a new chat
    let isFirstMessage = false;
    if (!conversationIdRef.current) {
      const sid = `thera_${userId}_${Date.now()}`;
      const title = text.length > 40 ? text.slice(0, 40) + '…' : text;
      if (ipcRenderer) {
        await ipcRenderer.invoke('sessions:create', { id: sid, title });
      }
      conversationIdRef.current = sid;
      setActiveChat(sid);
      isFirstMessage = true;
    }

    const newMessages = [...messages, { id: Date.now(), role: "user", text }];
    setMessages(newMessages);
    setTyping(true);

    // Persist user message
    if (ipcRenderer) {
      ipcRenderer.invoke('sessions:add-message', {
        sessionId: conversationIdRef.current, role: 'user', text,
      });
    }

    // Add user message to conversation history
    conversationRef.current = [
      ...conversationRef.current,
      { role: 'user', parts: [{ text }] }
    ];

    try {
      // Fetch memory context before sending to AI
      const memoryContext = await fetchMemoryContext(userId, text);

      // Call Gemini API with memory context
      const rawBotText = await sendMessageToAI(conversationRef.current, memoryContext);

      // Parse + execute any <action>...</action> blocks the AI emitted.
      // This strips the tags from what the user sees and dispatches each
      // action (gmail.draft, gmail.send, slack.send, spotify.queue, etc.)
      // via IPC to the main process.
      const { displayText, results, resultSummary } = await processAIResponse(rawBotText);

      // What the user actually sees: prose + compact result line(s).
      const visibleText = results.length > 0
        ? `${displayText}${displayText ? '\n\n' : ''}${results.map(r => `— ${r.summary}`).join('\n')}`
        : displayText;

      // What the model sees next turn: its own raw reply (WITH tags so it
      // remembers what it committed to) followed by a system-style result
      // line so it can react naturally ("right. drafted. want me to send?")
      conversationRef.current = [
        ...conversationRef.current,
        { role: 'model', parts: [{ text: rawBotText }] },
      ];
      if (resultSummary) {
        // Must alternate roles — add result as user turn then a model ack,
        // otherwise two consecutive user messages confuse the model into
        // thinking the next request is already fulfilled.
        conversationRef.current.push({ role: 'user', parts: [{ text: resultSummary }] });
        conversationRef.current.push({ role: 'model', parts: [{ text: 'got it.' }] });
      }

      const updatedMessages = [...newMessages, {
        id: Date.now() + 1,
        role: "bot",
        text: visibleText,
      }];

      setMessages(updatedMessages);

      // Persist bot message (the user-visible version)
      if (ipcRenderer) {
        ipcRenderer.invoke('sessions:add-message', {
          sessionId: conversationIdRef.current, role: 'bot', text: visibleText,
        });
      }
      if (isFirstMessage) refreshSessions();
      else refreshSessions(); // touch updated_at ordering

      // Store conversation in memory (async, don't wait)
      storeConversation(userId, conversationIdRef.current, updatedMessages);

    } catch (error) {
      console.error('Send error:', error);
      setMessages(m => [...m, {
        id: Date.now() + 1,
        role: "bot",
        text: "ugh, something broke. try again?",
      }]);
    } finally {
      setTyping(false);
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  return (
    <motion.div
      style={{
        height: "100vh", overflow: "hidden", color: TEXT, fontFamily: BRIC,
        background: dark
          ? `radial-gradient(ellipse 80% 60% at 25% 35%, #221408 0%, ${BG} 65%)`
          : `radial-gradient(ellipse 80% 60% at 25% 35%, #ede0cc 0%, ${BG} 65%)`,
        position: "relative",
        transition: "background 0.4s ease, color 0.4s ease",
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.55, ease: E_OUT }}
    >

      {/* ── Drawer backdrop ─────────────────────────────── */}
      <AnimatePresence>
        {drawer && (
          <motion.div
            key="bd"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={() => setDrawer(false)}
            style={{ position: "fixed", inset: 0, background: dark ? "rgba(6,4,2,0.82)" : "rgba(200,180,150,0.6)", backdropFilter: "blur(8px)", zIndex: 40 }}
          />
        )}
      </AnimatePresence>

      {/* ── Drawer ──────────────────────────────────────── */}
      <AnimatePresence>
        {drawer && (
          <motion.aside
            key="drawer"
            initial={{ x: -290, opacity: 0 }}
            animate={{ x: 0,    opacity: 1 }}
            exit={{   x: -290, opacity: 0 }}
            transition={{ duration: 0.34, ease: E_OUT }}
            style={{ position: "fixed", top: 0, left: 0, height: "100%", width: 268,
              background: SURFACE, borderRight: `1px solid ${BORDER}`,
              zIndex: 50, display: "flex", flexDirection: "column", padding: "28px 20px" }}
          >
            {/* Brand */}
            <div style={{ marginBottom: 28 }}>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: TEXT, letterSpacing: "-0.8px" }}>
                thera<span style={{ color: CORAL }}>.</span>
              </p>
              <p style={{ margin: "5px 0 0", fontFamily: MONO, fontSize: 9, color: DIM, letterSpacing: "2.5px", textTransform: "uppercase" }}>
                always here
              </p>
            </div>

            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={startNewSession}
              style={{ width: "100%", textAlign: "left", fontFamily: BRIC, fontSize: 13, fontWeight: 400, color: MUTED, padding: "9px 13px", marginBottom: 24, background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 8, cursor: "pointer", transition: "all 0.2s" }}
              onMouseEnter={e => { e.currentTarget.style.color = TEXT; e.currentTarget.style.borderColor = CORAL + "44"; }}
              onMouseLeave={e => { e.currentTarget.style.color = MUTED; e.currentTarget.style.borderColor = BORDER; }}
            >
              + new session
            </motion.button>

            <p style={{ margin: "0 0 10px", fontFamily: MONO, fontSize: 9, color: DIM, letterSpacing: "2.5px", textTransform: "uppercase" }}>
              recent
            </p>

            <div style={{ flex: 1, overflowY: "auto" }}>
              {sessions.length === 0 && (
                <p style={{ fontFamily: BRIC, fontSize: 12, color: DIM, fontStyle: 'italic', padding: '8px 0' }}>
                  no chats yet. say something.
                </p>
              )}
              {sessions.map((c, i) => {
                const active = c.id === activeChat;
                return (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={reveal(i * 0.04)}
                    style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${BORDER}` }}
                  >
                    <button
                      onClick={() => { loadSession(c.id); setDrawer(false); }}
                      style={{ flex: 1, textAlign: "left", fontFamily: BRIC, fontSize: 13.5, fontWeight: active ? 600 : 300, color: active ? CORAL : MUTED, background: "transparent", border: "none", padding: "10px 0", cursor: "pointer", transition: "color 0.18s", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.color = TEXT; }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.color = MUTED; }}
                    >
                      {c.title}
                    </button>
                    <button
                      onClick={(e) => deleteSession(c.id, e)}
                      title="delete"
                      style={{ background: 'transparent', border: 'none', color: DIM, fontSize: 11, cursor: 'pointer', padding: '4px 6px' }}
                      onMouseEnter={e => e.currentTarget.style.color = CORAL}
                      onMouseLeave={e => e.currentTarget.style.color = DIM}
                    >✕</button>
                  </motion.div>
                );
              })}
            </div>

            <div style={{ paddingTop: 18, borderTop: `1px solid ${BORDER}` }}>
              <button
                onClick={() => { setDrawer(false); onOpenSettings?.(); }}
                style={{ fontFamily: BRIC, fontSize: 12, color: DIM, background: "transparent", border: "none", cursor: "pointer", transition: "color 0.18s" }}
                onMouseEnter={e => e.currentTarget.style.color = MUTED}
                onMouseLeave={e => e.currentTarget.style.color = DIM}
              >settings</button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ── Main ────────────────────────────────────────── */}
      <div style={{ height: "100%", display: "flex", flexDirection: "column", position: "relative", zIndex: 1 }}>

        {/* Header */}
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 30px", height: 52, flexShrink: 0, borderBottom: `1px solid ${BORDER}`, WebkitAppRegion: "drag" }}>

          <motion.p
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={reveal(0.08)}
            style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: "-0.5px", color: TEXT, WebkitAppRegion: "no-drag", cursor: "default" }}
          >
            thera<span style={{ color: CORAL }}>.</span>
          </motion.p>

          <div style={{ display: "flex", alignItems: "center", gap: 20, WebkitAppRegion: "no-drag" }}>
            {/* Status */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 9, color: DIM, letterSpacing: "1.8px", textTransform: "uppercase" }}>
              <motion.div
                style={{ width: 5, height: 5, borderRadius: "50%", background: "#7ec89a", boxShadow: "0 0 6px rgba(126,200,154,0.6)" }}
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
              />
              here for you
            </div>

            {/* Theme toggle */}
            <motion.button
              onClick={() => setDark(d => !d)}
              whileTap={{ scale: 0.92 }}
              style={{ position: "relative", width: 40, height: 22, borderRadius: 11, border: `1px solid ${BORDER}`, background: dark ? DIM : BORDER, cursor: "pointer", padding: 0, flexShrink: 0, transition: "background 0.3s" }}
            >
              <motion.div
                animate={{ x: dark ? 2 : 20 }}
                transition={{ type: "spring", stiffness: 400, damping: 28 }}
                style={{ position: "absolute", top: 2, width: 16, height: 16, borderRadius: "50%", background: dark ? CORAL : "#f5ede0", boxShadow: dark ? `0 0 6px ${CORAL}88` : "0 1px 3px rgba(0,0,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <span style={{ fontSize: 8, lineHeight: 1 }}>{dark ? "☽" : "☀"}</span>
              </motion.div>
            </motion.button>

            {/* Menu — two offset lines */}
            <motion.button
              onClick={() => setDrawer(d => !d)}
              whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.88 }}
              style={{ display: "flex", flexDirection: "column", gap: 5, background: "transparent", border: "none", cursor: "pointer", padding: "4px 0" }}
            >
              <motion.span style={{ display: "block", height: 1.5, background: DIM, borderRadius: 2 }} animate={{ width: drawer ? 12 : 18 }} transition={{ duration: 0.2 }} />
              <motion.span style={{ display: "block", height: 1.5, background: DIM, borderRadius: 2 }} animate={{ width: drawer ? 18 : 12, marginLeft: drawer ? 0 : 6 }} transition={{ duration: 0.2 }} />
            </motion.button>

            {["—", "✕"].map((l, i) => (
              <motion.button key={i} whileTap={{ scale: 0.88 }}
                onClick={() => {
                  try {
                    const { ipcRenderer } = require('electron');
                    if (i === 0) {
                      // Minimize window
                      ipcRenderer.send('minimize-window');
                    } else {
                      // Close window
                      ipcRenderer.send('close-window');
                    }
                  } catch (e) {
                    console.log('Not in Electron environment');
                  }
                }}
                style={{ fontSize: 12, color: DIM, background: "transparent", border: "none", cursor: "pointer", transition: "color 0.18s" }}
                onMouseEnter={e => e.currentTarget.style.color = MUTED}
                onMouseLeave={e => e.currentTarget.style.color = DIM}
              >{l}</motion.button>
            ))}
          </div>
        </header>

        {/* ── Conversation ─────────────────────────────── */}
        <div style={{ flex: 1, position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, overflowY: "auto", padding: "0 30px 16px" }}>
            <AnimatePresence mode="wait">

              {/* Welcome */}
              {messages.length === 0 && (
                <motion.div
                  key="welcome"
                  style={{ minHeight: "100%", display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 540 }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.18 } }}
                >
                  <motion.p
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={reveal(0.06)}
                    style={{ margin: "0 0 18px", fontFamily: MONO, fontSize: 9.5, color: DIM, letterSpacing: "3px", textTransform: "uppercase" }}
                  >
                    — thera
                  </motion.p>

                  <motion.h1
                    initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={reveal(0.11)}
                    style={{ margin: "0 0 18px", fontFamily: BRIC, fontSize: "clamp(44px, 6.5vw, 74px)", fontWeight: 800, letterSpacing: "-2.5px", lineHeight: 1.0, color: TEXT }}
                  >
                    what's on
                    <br />
                    <span style={{ color: CORAL, fontWeight: 700 }}>your mind?</span>
                  </motion.h1>

                  <motion.p
                    initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={reveal(0.19)}
                    style={{ margin: "0 0 42px", fontSize: 14, fontWeight: 300, color: MUTED, lineHeight: 1.72, maxWidth: 240 }}
                  >
                    say it. i'm not going anywhere.
                  </motion.p>

                  {/* Prompts */}
                  <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={reveal(0.26)}
                  >
                    {prompts.map((p, i) => (
                      <motion.button key={p}
                        initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={reveal(0.28 + i * 0.07)}
                        whileHover={{ x: 8 }} whileTap={{ scale: 0.98 }}
                        onClick={() => setInput(p)}
                        style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", background: "transparent", border: "none", borderBottom: `1px solid ${BORDER}`, cursor: "pointer", fontFamily: BRIC, fontSize: 14, fontWeight: 300, color: MUTED, padding: "13px 0", textAlign: "left", transition: "color 0.2s" }}
                        onMouseEnter={e => e.currentTarget.style.color = TEXT}
                        onMouseLeave={e => e.currentTarget.style.color = MUTED}
                      >
                        <span style={{ fontFamily: MONO, fontSize: 10, color: GOLD, flexShrink: 0 }}>→</span>
                        {p}
                      </motion.button>
                    ))}
                  </motion.div>
                </motion.div>
              )}

              {/* Messages */}
              {messages.length > 0 && (
                <motion.div
                  key="msgs"
                  style={{ display: "flex", flexDirection: "column", gap: 30, paddingTop: 36 }}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.28, ease: E_OUT }}
                >
                  {messages.map(msg => (
                    <motion.div key={msg.id}
                      initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={soft()}
                      style={{ maxWidth: "64%", alignSelf: msg.role === "user" ? "flex-end" : "flex-start", paddingLeft: msg.role === "bot" ? 14 : 0, borderLeft: msg.role === "bot" ? `2px solid ${CORAL}44` : "none" }}
                    >
                      {msg.role === "bot" && (
                        <p style={{ margin: "0 0 6px", fontFamily: MONO, fontSize: 9, color: CORAL, letterSpacing: "2px", textTransform: "uppercase", opacity: 0.7 }}>
                          thera
                        </p>
                      )}
                      <p style={{ margin: 0, fontFamily: msg.role === "bot" ? BRIC : MONO, fontSize: msg.role === "bot" ? 15 : 13, fontWeight: 300, color: msg.role === "bot" ? TEXT : MUTED, lineHeight: 1.82, textAlign: msg.role === "user" ? "right" : "left" }}>
                        {msg.text}
                      </p>
                    </motion.div>
                  ))}

                  <AnimatePresence>
                    {typing && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                        transition={{ duration: 0.2 }}
                        style={{ alignSelf: "flex-start", paddingLeft: 14, borderLeft: `2px solid ${CORAL}44` }}
                      >
                        <p style={{ margin: "0 0 6px", fontFamily: MONO, fontSize: 9, color: CORAL, letterSpacing: "2px", textTransform: "uppercase", opacity: 0.7 }}>thera</p>
                        <TypingDots />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div ref={bottomRef} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── Input ───────────────────────────────────────── */}
        <div style={{ flexShrink: 0, padding: "12px 30px 30px", borderTop: `1px solid ${BORDER}` }}>

          <AnimatePresence>
            {focused && (
              <motion.p
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.18 }}
                style={{ margin: "0 0 8px", fontFamily: MONO, fontSize: 9, color: DIM, letterSpacing: "1.5px" }}
              >
                enter ↵ to send
              </motion.p>
            )}
          </AnimatePresence>

          <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
            <motion.span
              animate={{ color: focused ? CORAL : DIM, opacity: focused ? 1 : 0.4 }}
              transition={{ duration: 0.22 }}
              style={{ fontFamily: MONO, fontSize: 15, flexShrink: 0, paddingBottom: 10, lineHeight: 1 }}
            >›</motion.span>

            <div style={{ flex: 1, position: "relative" }}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && send()}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                autoFocus
                placeholder="talk to me..."
                style={{ width: "100%", background: "transparent", border: "none", borderBottom: `1px solid ${focused ? CORAL + "88" : BORDER}`, outline: "none", fontSize: 15, fontWeight: 300, color: TEXT, fontFamily: BRIC, padding: "8px 0", caretColor: CORAL, transition: "border-color 0.25s" }}
              />
              <motion.div
                animate={{ scaleX: focused ? 1 : 0, opacity: focused ? 1 : 0 }}
                transition={{ duration: 0.3, ease: E_OUT }}
                style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, ${CORAL}, ${GOLD})`, transformOrigin: "left", boxShadow: `0 0 10px ${CORAL}55` }}
              />
            </div>

            <AnimatePresence>
              {input.trim() && (
                <motion.button
                  initial={{ opacity: 0, x: 10, scale: 0.85 }}
                  animate={{ opacity: 1, x: 0,  scale: 1    }}
                  exit={{   opacity: 0, x: 10, scale: 0.85  }}
                  transition={soft()}
                  whileHover={{ x: 2 }} whileTap={{ scale: 0.92 }}
                  onClick={send}
                  style={{ fontFamily: MONO, fontSize: 11, color: CORAL, background: "transparent", border: "none", cursor: "pointer", paddingBottom: 10, letterSpacing: "0.5px", flexShrink: 0 }}
                >
                  send →
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>

      </div>
    </motion.div>
  );
}
