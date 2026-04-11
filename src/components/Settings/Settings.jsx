import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ConnectorGrid from '../Connectors/ConnectorGrid';
import MoodTimeline from '../Mood/MoodTimeline';
import WeeklyRoastReport from '../Roast/WeeklyRoastReport';

const { ipcRenderer } = window.require ? window.require('electron') : {};

const CORAL = '#e8603a';
const MONO  = "'Space Mono', monospace";
const BRIC  = "'Space Grotesk', system-ui, sans-serif";

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

const TABS = [
  { id: 'connectors', label: 'connectors' },
  { id: 'mood',       label: 'mood' },
  { id: 'general',    label: 'general' },
  { id: 'account',    label: 'account' },
  { id: 'about',      label: 'about' },
];

export default function Settings({ dark, onClose, onSignOut, user }) {
  const T = dark ? DARK : LIGHT;
  const [tab, setTab] = useState('connectors');
  const [nsfwMode, setNsfwMode] = useState(false);
  const [showRoast, setShowRoast] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    (async () => {
      if (!ipcRenderer) return;
      const v = await ipcRenderer.invoke('get-setting', 'nsfwMode');
      setNsfwMode(!!v);
    })();
  }, []);

  const setSetting = (key, value) => {
    if (ipcRenderer) ipcRenderer.send('set-setting', key, value);
  };

  const handleReset = () => {
    // Clear per-user onboarding only
    const uid = user?.id || 'desktop_user';
    setSetting(`onboardingCompleted_${uid}`, false);
    setSetting(`onboardingData_${uid}`, null);
    if (onSignOut) onSignOut();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: T.BG, color: T.TEXT, fontFamily: BRIC,
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 30px', height: 52, flexShrink: 0,
        borderBottom: `1px solid ${T.BORDER}`,
        WebkitAppRegion: 'drag',
      }}>
        <p style={{
          margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: '-0.5px',
          color: T.TEXT, WebkitAppRegion: 'no-drag',
        }}>
          settings
        </p>
        <button
          onClick={onClose}
          style={{
            background: 'transparent', border: 'none', color: T.MUTED,
            fontSize: 14, cursor: 'pointer',
            WebkitAppRegion: 'no-drag',
          }}
          onMouseEnter={e => e.currentTarget.style.color = CORAL}
          onMouseLeave={e => e.currentTarget.style.color = T.MUTED}
        >close ✕</button>
      </header>

      {/* Tabs */}
      <nav style={{
        display: 'flex', gap: 0, padding: '0 30px',
        borderBottom: `1px solid ${T.BORDER}`, flexShrink: 0,
        overflowX: 'auto',
      }}>
        {TABS.map(t => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontFamily: MONO, fontSize: 10, letterSpacing: '1.6px',
                textTransform: 'uppercase', whiteSpace: 'nowrap',
                color: active ? CORAL : T.MUTED,
                padding: '14px 18px',
                borderBottom: active ? `2px solid ${CORAL}` : '2px solid transparent',
                marginBottom: -1,
                transition: 'color 0.2s',
              }}
            >{t.label}</button>
          );
        })}
      </nav>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 30px 40px' }}>
        <AnimatePresence mode="wait">
          {tab === 'connectors' && (
            <motion.div key="connectors"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <p style={{
                margin: '0 0 20px', fontFamily: BRIC, fontSize: 13,
                color: T.MUTED, maxWidth: 600, lineHeight: 1.6,
              }}>
                connect your tools so thera can actually be useful. she can send emails, schedule things, queue songs, send whatsapps — but only if you let her in.
              </p>
              <ConnectorGrid dark={dark} />
            </motion.div>
          )}

          {tab === 'mood' && (
            <motion.div key="mood"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ maxWidth: 640 }}
            >
              <p style={{
                margin: '0 0 22px', fontFamily: BRIC, fontSize: 13,
                color: T.MUTED, lineHeight: 1.6,
              }}>
                a quiet record of how you've been. nothing to fix. just here in case
                you ever want to look back and see the shape of it.
              </p>
              <MoodTimeline dark={dark} days={30} />

              <div style={{ marginTop: 32, display: 'flex', gap: 10 }}>
                <button
                  onClick={() => setShowRoast(true)}
                  style={{
                    background: CORAL, border: 'none', borderRadius: 50,
                    padding: '10px 18px', fontFamily: MONO, fontSize: 10,
                    letterSpacing: '1.4px', textTransform: 'uppercase',
                    color: '#fff', cursor: 'pointer',
                  }}
                >open weekly roast</button>
              </div>
            </motion.div>
          )}

          {tab === 'general' && (
            <motion.div key="general"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ maxWidth: 540 }}
            >
              <Row T={T}>
                <div>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.TEXT }}>nsfw mode</p>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: T.MUTED }}>
                    let thera speak freely. swearing, dark humour, the lot.
                  </p>
                </div>
                <Toggle
                  on={nsfwMode}
                  onClick={() => { const next = !nsfwMode; setNsfwMode(next); setSetting('nsfwMode', next); }}
                  T={T}
                />
              </Row>

              <Row T={T}>
                <div>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.TEXT }}>reset onboarding</p>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: T.MUTED }}>
                    re-runs the setup flow. your account stays, your data stays.
                  </p>
                </div>
                {confirmReset ? (
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <SmallBtn label="yes, reset" onClick={handleReset} color={CORAL} T={T} />
                    <SmallBtn label="cancel" onClick={() => setConfirmReset(false)} T={T} />
                  </div>
                ) : (
                  <SmallBtn label="reset" onClick={() => setConfirmReset(true)} T={T} />
                )}
              </Row>
            </motion.div>
          )}

          {tab === 'account' && (
            <motion.div key="account"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ maxWidth: 540 }}
            >
              {/* Profile card */}
              <div style={{
                background: T.SURFACE, border: `1px solid ${T.BORDER}`, borderRadius: 12,
                padding: '18px 20px', marginBottom: 24,
                display: 'flex', alignItems: 'center', gap: 16,
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: '50%',
                  background: `${CORAL}33`, border: `2px solid ${CORAL}44`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: MONO, fontSize: 16, color: CORAL, flexShrink: 0,
                }}>
                  {user?.email?.[0]?.toUpperCase() || '?'}
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.TEXT, wordBreak: 'break-all' }}>
                    {user?.email || 'local session'}
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: T.MUTED, fontFamily: MONO, letterSpacing: '0.5px' }}>
                    {user?.app_metadata?.provider || 'email'} · {user?.id?.slice(0, 8) || 'local'}
                  </p>
                </div>
              </div>

              {/* Sign out */}
              <Row T={T}>
                <div>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.TEXT }}>sign out</p>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: T.MUTED }}>
                    your data stays. you'll need to log back in.
                  </p>
                </div>
                {confirmSignOut ? (
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <SmallBtn label="yes, sign out" onClick={onSignOut} color="#e87a3a" T={T} />
                    <SmallBtn label="cancel" onClick={() => setConfirmSignOut(false)} T={T} />
                  </div>
                ) : (
                  <SmallBtn label="sign out" onClick={() => setConfirmSignOut(true)} T={T} />
                )}
              </Row>
            </motion.div>
          )}

          {tab === 'about' && (
            <motion.div key="about"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ maxWidth: 540 }}
            >
              <p style={{ fontFamily: MONO, fontSize: 11, color: T.MUTED, letterSpacing: '1.5px', textTransform: 'uppercase', margin: '0 0 14px' }}>
                — thera
              </p>
              <p style={{ fontSize: 14, color: T.TEXT, lineHeight: 1.7, margin: 0 }}>
                a desktop companion who lives in your tray and actually pays attention.<br/>
                version 0.1.0 — early build.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showRoast && <WeeklyRoastReport dark={dark} onClose={() => setShowRoast(false)} />}
      </AnimatePresence>
    </motion.div>
  );
}

function Row({ children, T }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 20, padding: '16px 0',
      borderBottom: `1px solid ${T.BORDER}`,
    }}>{children}</div>
  );
}

function SmallBtn({ label, onClick, color, T }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: 'transparent',
        border: `1px solid ${hov && color ? color : T.BORDER}`,
        borderRadius: 50, padding: '8px 16px',
        fontFamily: MONO, fontSize: 10, letterSpacing: '1.4px',
        textTransform: 'uppercase',
        color: hov && color ? color : T.MUTED,
        cursor: 'pointer', flexShrink: 0,
        transition: 'border-color 0.2s, color 0.2s',
      }}
    >{label}</button>
  );
}

function Toggle({ on, onClick, T }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: 'relative', width: 40, height: 22, borderRadius: 11,
        border: `1px solid ${T.BORDER}`,
        background: on ? CORAL : T.DIM,
        cursor: 'pointer', padding: 0, flexShrink: 0,
        transition: 'background 0.25s',
      }}
    >
      <motion.div
        animate={{ x: on ? 20 : 2 }}
        transition={{ type: 'spring', stiffness: 400, damping: 28 }}
        style={{
          position: 'absolute', top: 2, width: 16, height: 16,
          borderRadius: '50%', background: '#f0e6d2',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }}
      />
    </button>
  );
}
