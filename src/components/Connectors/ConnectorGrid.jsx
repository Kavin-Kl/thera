import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CONNECTORS, GOOGLE_KEYS } from './connectorRegistry';

const { ipcRenderer } = window.require ? window.require('electron') : {};

const CORAL = '#e8603a';
const GOLD  = '#c89640';
const MONO  = "'Space Mono', monospace";
const BRIC  = "'Space Grotesk', system-ui, sans-serif";

/*
  Shared connector grid used by both onboarding and settings.
  Pure UI for now — connect buttons mark a connector as `connected`
  in the local DB. Real OAuth/extension flows land in later slices.
*/
export default function ConnectorGrid({ dark = true, compact = false }) {
  const BG      = dark ? '#221808' : '#ede0cc';
  const BORDER  = dark ? '#3a2614' : '#d4c0a0';
  const TEXT    = dark ? '#f0e6d2' : '#1c1008';
  const MUTED   = dark ? '#8a7256' : '#7a6040';
  const DIM     = dark ? '#4a3420' : '#c0a878';

  const [statusByKey, setStatusByKey] = useState({});
  const [creds, setCreds] = useState({ google: false, spotify: false, slack: false });
  const [busy, setBusy] = useState(null); // key currently connecting
  const [error, setError] = useState(null);

  const refresh = async () => {
    if (!ipcRenderer) return;
    const list = await ipcRenderer.invoke('connectors:list');
    const map = {};
    list.forEach(r => { map[r.key] = r; });
    // Built-ins always enabled
    ['reminders', 'notes'].forEach(k => {
      if (!map[k]) map[k] = { key: k, enabled: true, status: 'builtin' };
    });
    setStatusByKey(map);
  };

  const refreshCreds = async () => {
    if (!ipcRenderer) return;
    try {
      const c = await ipcRenderer.invoke('connectors:credentials');
      setCreds(c || {});
    } catch (_) {}
  };

  useEffect(() => { refresh(); refreshCreds(); }, []);

  const upsert = async (key, patch) => {
    if (!ipcRenderer) return;
    await ipcRenderer.invoke('connectors:upsert', { key, ...patch });
    refresh();
  };

  const runConnect = async (provider, ipcChannel, fallbackKeys) => {
    if (!ipcRenderer) return;
    setError(null);
    setBusy(provider);
    try {
      if (creds[provider]) {
        const res = await ipcRenderer.invoke(ipcChannel);
        if (!res?.ok) throw new Error(res?.error || 'connect failed');
      } else {
        // No credentials in .env — fall back to stub so the UI flow is testable
        for (const k of fallbackKeys) {
          await upsert(k, { enabled: true, status: 'connected' });
        }
        setError(`${provider} keys missing in .env — stubbed as connected for testing`);
      }
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const connectGoogle = () => runConnect('google', 'connectors:google:connect', GOOGLE_KEYS);
  const disconnectGoogle = async () => {
    if (creds.google) await ipcRenderer.invoke('connectors:google:disconnect');
    else for (const k of GOOGLE_KEYS) await upsert(k, { enabled: false, status: 'disconnected' });
    refresh();
  };

  const connectOAuth = (key) => runConnect(key, `connectors:${key}:connect`, [key]);
  const disconnectOAuth = async (key) => {
    if (creds[key]) await ipcRenderer.invoke(`connectors:${key}:disconnect`);
    else await upsert(key, { enabled: false, status: 'disconnected' });
    refresh();
  };

  const setupExtension = async (key) => {
    // TODO (later slice): open extension setup guide / native messaging.
    await upsert(key, { enabled: true, status: 'pending' });
  };

  const toggleEnabled = async (key) => {
    const current = statusByKey[key];
    await upsert(key, { enabled: !(current?.enabled) });
  };

  const googleConnected = GOOGLE_KEYS.every(k => statusByKey[k]?.status === 'connected');

  // Group connectors for layout
  const google     = CONNECTORS.filter(c => c.group === 'google');
  const oauth      = CONNECTORS.filter(c => c.group === 'oauth');
  const extension  = CONNECTORS.filter(c => c.group === 'extension');
  const builtin    = CONNECTORS.filter(c => c.group === 'builtin');

  const Section = ({ label, children }) => (
    <div style={{ marginBottom: 22 }}>
      <p style={{
        margin: '0 0 10px',
        fontFamily: MONO,
        fontSize: 9,
        color: MUTED,
        letterSpacing: '2.2px',
        textTransform: 'uppercase',
      }}>{label}</p>
      {children}
    </div>
  );

  const Card = ({ c, action }) => {
    const state = statusByKey[c.key];
    const enabled = !!state?.enabled;
    const status = state?.status || 'disconnected';
    const dotColor =
      status === 'connected' ? '#7ec89a' :
      status === 'pending'   ? GOLD :
      status === 'builtin'   ? CORAL :
      DIM;

    return (
      <motion.div
        whileHover={{ y: -2 }}
        style={{
          background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          padding: compact ? '12px 14px' : '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontSize: 16,
            color: enabled ? CORAL : MUTED,
            width: 22, textAlign: 'center',
          }}>{c.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              margin: 0,
              fontFamily: BRIC,
              fontSize: 13,
              fontWeight: 600,
              color: TEXT,
              letterSpacing: '-0.2px',
            }}>{c.name}</p>
            <p style={{
              margin: '2px 0 0',
              fontFamily: BRIC,
              fontSize: 11,
              fontWeight: 300,
              color: MUTED,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>{c.description}</p>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontFamily: MONO, fontSize: 8, letterSpacing: '1.5px',
            textTransform: 'uppercase', color: MUTED,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: dotColor,
              boxShadow: status === 'connected' ? `0 0 6px ${dotColor}88` : 'none',
            }} />
            {status}
          </div>
        </div>
        {action}
      </motion.div>
    );
  };

  const PillButton = ({ onClick, children, primary }) => (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.96 }}
      style={{
        alignSelf: 'flex-start',
        background: primary ? CORAL : 'transparent',
        border: primary ? 'none' : `1px solid ${BORDER}`,
        borderRadius: 50,
        padding: '6px 14px',
        fontFamily: MONO,
        fontSize: 9,
        textTransform: 'uppercase',
        letterSpacing: '1.2px',
        color: primary ? '#fff' : MUTED,
        cursor: 'pointer',
      }}
    >{children}</motion.button>
  );

  return (
    <div style={{ width: '100%' }}>
      {error && (
        <div style={{
          marginBottom: 14, padding: '10px 14px', borderRadius: 8,
          border: `1px solid ${BORDER}`,
          background: dark ? 'rgba(232,96,58,0.08)' : 'rgba(232,96,58,0.12)',
          color: TEXT, fontFamily: BRIC, fontSize: 12,
        }}>{error}</div>
      )}

      {/* Google bundle */}
      <Section label="google — one connection, all services">
        <div style={{ marginBottom: 12 }}>
          {googleConnected ? (
            <PillButton onClick={disconnectGoogle}>disconnect google</PillButton>
          ) : (
            <PillButton onClick={connectGoogle} primary>
              {busy === 'google' ? 'opening browser…' : 'connect google'}
            </PillButton>
          )}
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 10,
        }}>
          {google.map(c => (
            <Card key={c.key} c={c} action={
              statusByKey[c.key]?.status === 'connected' && (
                <PillButton onClick={() => toggleEnabled(c.key)}>
                  {statusByKey[c.key]?.enabled ? 'disable' : 'enable'}
                </PillButton>
              )
            } />
          ))}
        </div>
      </Section>

      {/* OAuth */}
      <Section label="connect">
        <div style={{
          display: 'grid',
          gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 10,
        }}>
          {oauth.map(c => {
            const connected = statusByKey[c.key]?.status === 'connected';
            return (
              <Card key={c.key} c={c} action={
                connected ? (
                  <PillButton onClick={() => disconnectOAuth(c.key)}>disconnect</PillButton>
                ) : (
                  <PillButton onClick={() => connectOAuth(c.key)} primary>connect</PillButton>
                )
              } />
            );
          })}
        </div>
      </Section>

      {/* Extension-based */}
      <Section label="extension required">
        <div style={{
          display: 'grid',
          gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 10,
        }}>
          {extension.map(c => (
            <Card key={c.key} c={c} action={
              <PillButton onClick={() => setupExtension(c.key)}>setup guide</PillButton>
            } />
          ))}
        </div>
      </Section>

      {/* Built-in */}
      <Section label="built-in">
        <div style={{
          display: 'grid',
          gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 10,
        }}>
          {builtin.map(c => <Card key={c.key} c={c} />)}
        </div>
      </Section>
    </div>
  );
}
