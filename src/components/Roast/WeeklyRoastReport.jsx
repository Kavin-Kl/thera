import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const { ipcRenderer } = window.require ? window.require('electron') : {};

const CORAL = '#e8603a';
const GOLD  = '#c89640';
const MONO  = "'Space Mono', monospace";
const BRIC  = "'Space Grotesk', system-ui, sans-serif";

/**
 * Weekly Roast Report — a Sunday-night summary of the user's week,
 * compiled from local DB (mood + activity) and run through Gemini for the
 * actual roast prose. Generation is best-effort: if Gemini isn't reachable
 * we fall back to a deterministic template so the UI is always testable.
 */
export default function WeeklyRoastReport({ dark = true, onClose }) {
  const T = dark
    ? { BG: '#18120a', SURFACE: '#221808', BORDER: '#3a2614', TEXT: '#f0e6d2', MUTED: '#8a7256' }
    : { BG: '#f5ede0', SURFACE: '#ede0cc', BORDER: '#d4c0a0', TEXT: '#1c1008', MUTED: '#7a6040' };

  const [stats, setStats] = useState(null);
  const [roast, setRoast] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!ipcRenderer) { setLoading(false); return; }
      try {
        const ctx = await ipcRenderer.invoke('roast:context');
        const computed = computeStats(ctx);
        setStats(computed);
        const text = await generateRoast(computed);
        setRoast(text);
      } catch (e) {
        console.error('roast failed:', e);
        setRoast("i tried to write you a roast but my brain glitched. you know what you did.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 150,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 30,
        }}
      >
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 20, opacity: 0 }}
          transition={{ duration: 0.3 }}
          onClick={e => e.stopPropagation()}
          style={{
            background: T.BG, color: T.TEXT, fontFamily: BRIC,
            border: `1px solid ${T.BORDER}`, borderRadius: 16,
            maxWidth: 540, width: '100%', maxHeight: '85vh',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{
            padding: '22px 28px 18px',
            borderBottom: `1px solid ${T.BORDER}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          }}>
            <div>
              <p style={{
                margin: 0, fontFamily: MONO, fontSize: 9, color: GOLD,
                letterSpacing: '2.4px', textTransform: 'uppercase',
              }}>weekly roast — sunday edition</p>
              <h2 style={{
                margin: '6px 0 0', fontSize: 22, fontWeight: 600,
                letterSpacing: '-0.5px', color: T.TEXT,
              }}>your week, summarised. with love. mostly.</h2>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'transparent', border: 'none', color: T.MUTED,
                fontSize: 14, cursor: 'pointer', padding: 4,
              }}
            >✕</button>
          </div>

          {/* Body */}
          <div style={{ padding: '22px 28px', overflowY: 'auto', flex: 1 }}>
            {loading ? (
              <p style={{ color: T.MUTED, fontSize: 13 }}>compiling receipts…</p>
            ) : (
              <>
                {/* Stats grid */}
                {stats && (
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
                    marginBottom: 22,
                  }}>
                    <Stat label="avg mood" value={stats.moodLabel} T={T} />
                    <Stat label="entries logged" value={stats.entries} T={T} />
                    <Stat label="hours tracked" value={stats.hours} T={T} />
                  </div>
                )}

                {/* Top apps */}
                {stats?.topApps?.length > 0 && (
                  <div style={{ marginBottom: 22 }}>
                    <p style={{
                      margin: '0 0 8px', fontFamily: MONO, fontSize: 9, color: T.MUTED,
                      letterSpacing: '2.2px', textTransform: 'uppercase',
                    }}>where your hours went</p>
                    {stats.topApps.map(a => (
                      <div key={a.name} style={{
                        display: 'flex', justifyContent: 'space-between',
                        padding: '6px 0', fontSize: 13, color: T.TEXT,
                        borderBottom: `1px solid ${T.BORDER}`,
                      }}>
                        <span>{a.name}</span>
                        <span style={{ color: T.MUTED }}>{a.hours.toFixed(1)}h</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* The actual roast */}
                <div style={{
                  padding: '18px 20px', borderRadius: 12,
                  background: dark ? 'rgba(232,96,58,0.06)' : 'rgba(232,96,58,0.10)',
                  border: `1px solid ${T.BORDER}`,
                }}>
                  <p style={{
                    margin: '0 0 8px', fontFamily: MONO, fontSize: 9, color: CORAL,
                    letterSpacing: '2.2px', textTransform: 'uppercase',
                  }}>the verdict</p>
                  <p style={{
                    margin: 0, fontSize: 14, lineHeight: 1.7,
                    color: T.TEXT, whiteSpace: 'pre-wrap',
                  }}>{roast}</p>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div style={{
            padding: '14px 28px', borderTop: `1px solid ${T.BORDER}`,
            display: 'flex', justifyContent: 'flex-end',
          }}>
            <button
              onClick={onClose}
              style={{
                background: CORAL, border: 'none', borderRadius: 50,
                padding: '8px 18px', fontFamily: MONO, fontSize: 10,
                letterSpacing: '1.4px', textTransform: 'uppercase',
                color: '#fff', cursor: 'pointer',
              }}
            >ouch. close.</button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function Stat({ label, value, T }) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 10,
      border: `1px solid ${T.BORDER}`, background: T.SURFACE,
    }}>
      <p style={{ margin: 0, fontFamily: MONO, fontSize: 8, color: T.MUTED,
                  letterSpacing: '1.6px', textTransform: 'uppercase' }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 600, color: T.TEXT }}>{value}</p>
    </div>
  );
}

function computeStats({ moodDays = [], moodRecent = [], activity = [] }) {
  // Mood
  const scores = moodDays.map(d => d.avg_score).filter(s => s != null);
  const avg = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null;
  const moodLabel = avg == null ? '—' :
    avg >= 1 ? 'good' : avg >= 0 ? 'meh' : avg >= -1 ? 'rough' : 'low';

  // Activity by app
  const byApp = {};
  let totalSecs = 0;
  for (const a of activity) {
    const secs = a.duration_seconds || 0;
    totalSecs += secs;
    byApp[a.app_name] = (byApp[a.app_name] || 0) + secs;
  }
  const topApps = Object.entries(byApp)
    .map(([name, s]) => ({ name, hours: s / 3600 }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 5);

  return {
    moodLabel,
    moodAvg: avg,
    entries: moodRecent.length,
    hours: (totalSecs / 3600).toFixed(1),
    topApps,
  };
}

async function generateRoast(stats) {
  const apiKey = import.meta?.env?.VITE_GEMINI_API_KEY;
  if (!apiKey) return fallbackRoast(stats);

  const prompt = `You are Thera — a witty, self-aware, fourth-wall-breaking AI companion inspired by Fleabag. Write a short (3-5 sentence) weekly roast for the user based on this data. Be punchy, validating-but-honest, occasionally absurd. No bullet points. No headings. Just talk to them.

DATA:
- average mood this week: ${stats.moodLabel} (${stats.moodAvg?.toFixed(1) ?? 'unknown'} on a -2 to +2 scale)
- mood entries logged: ${stats.entries}
- hours of computer activity tracked: ${stats.hours}
- top apps: ${stats.topApps.map(a => `${a.name} (${a.hours.toFixed(1)}h)`).join(', ') || 'nothing tracked'}

Roast:`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text?.trim() || fallbackRoast(stats);
  } catch (_) {
    return fallbackRoast(stats);
  }
}

function fallbackRoast(stats) {
  const lines = [
    `okay so. ${stats.hours} hours on the screen, mood landed somewhere around "${stats.moodLabel}", and you logged ${stats.entries} feelings about it.`,
    stats.topApps[0]
      ? `${stats.topApps[0].name} clocked ${stats.topApps[0].hours.toFixed(1)} hours. i'm not judging. i'm just naming it.`
      : `not enough activity tracked for me to drag you properly. consider this a free pass.`,
    `next week: try to surprise me. or don't. i'll be here either way.`,
  ];
  return lines.join('\n\n');
}
