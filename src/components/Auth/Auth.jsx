import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, supabaseConfigured } from '../../services/supabaseClient';

const { ipcRenderer } = window.require ? window.require('electron') : {};

/* ── Design tokens (matches Thera palette) ────────────────── */
const CORAL  = '#e8603a';
const GOLD   = '#c89640';
const MONO   = "'Space Mono', monospace";
const BRIC   = "'Space Grotesk', system-ui, sans-serif";
const BG     = '#0f0b06';
const SURF   = '#18120a';
const BORDER = '#2e1e0e';
const TEXT   = '#f0e6d2';
const MUTED  = '#8a7256';
const DIM    = '#3a2614';

// Fixed port for Supabase OAuth callback loopback
const AUTH_CALLBACK_PORT = 51235;
const AUTH_CALLBACK_URL  = `http://127.0.0.1:${AUTH_CALLBACK_PORT}/auth/callback`;

export default function Auth({ onAuth }) {
  const [mode, setMode]       = useState('login'); // 'login' | 'signup'
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');

  /* ── Config guard ─────────────────────────────────────────── */
  if (!supabaseConfigured) {
    return (
      <div style={{
        minHeight: '100vh', background: BG, color: TEXT,
        fontFamily: BRIC, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 40,
      }}>
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <p style={{ fontFamily: MONO, fontSize: 11, color: CORAL, letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 16 }}>
            — setup needed
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 16px', letterSpacing: '-0.5px' }}>
            supabase isn't configured yet.
          </h1>
          <p style={{ color: MUTED, lineHeight: 1.7, fontSize: 14, marginBottom: 24 }}>
            add your credentials to <code style={{ color: CORAL }}>.env</code>:
          </p>
          <div style={{
            background: SURF, border: `1px solid ${BORDER}`, borderRadius: 10,
            padding: '16px 20px', textAlign: 'left', fontFamily: MONO, fontSize: 11,
            color: MUTED, lineHeight: 2,
          }}>
            <div><span style={{ color: CORAL }}>VITE_SUPABASE_URL</span>=https://xxxx.supabase.co</div>
            <div><span style={{ color: CORAL }}>VITE_SUPABASE_ANON_KEY</span>=eyJ...</div>
          </div>
          <p style={{ color: DIM, fontSize: 12, marginTop: 16, lineHeight: 1.6 }}>
            create a project at supabase.com → settings → api.<br/>
            enable google oauth under authentication → providers.<br/>
            add <code style={{ color: GOLD }}>{AUTH_CALLBACK_URL}</code> as a redirect URL.
          </p>
        </div>
      </div>
    );
  }

  /* ── Email / password handlers ────────────────────────────── */
  async function handleEmailAuth(e) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) { setError('fill both fields in.'); return; }
    setLoading(true); setError(''); setSuccess('');

    try {
      if (mode === 'login') {
        const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        onAuth(data.user);
      } else {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        if (data.user && !data.user.email_confirmed_at) {
          setSuccess('check your email to confirm your account, then log in.');
        } else {
          onAuth(data.user);
        }
      }
    } catch (err) {
      setError(friendlyError(err.message));
    } finally {
      setLoading(false);
    }
  }

  /* ── Google OAuth handler ─────────────────────────────────── */
  async function handleGoogleAuth() {
    if (!ipcRenderer) {
      setError('google auth requires the desktop app.');
      return;
    }
    setLoading(true); setError(''); setSuccess('');

    try {
      // 1. Generate OAuth URL (Supabase stores PKCE verifier in localStorage)
      const { data, error: urlErr } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          skipBrowserRedirect: true,
          redirectTo: AUTH_CALLBACK_URL,
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      });
      if (urlErr) throw urlErr;
      if (!data?.url) throw new Error('no oauth url returned from supabase');

      // 2. Hand URL to Electron main: it opens browser + captures code
      const result = await ipcRenderer.invoke('auth:google-oauth', data.url);
      if (result.error) throw new Error(result.error);

      // 3. Exchange PKCE code for a session
      const { data: sessionData, error: exchErr } = await supabase.auth.exchangeCodeForSession(result.code);
      if (exchErr) throw exchErr;

      onAuth(sessionData.user);
    } catch (err) {
      setError(friendlyError(err.message));
    } finally {
      setLoading(false);
    }
  }

  /* ── Render ────────────────────────────────────────────────── */
  return (
    <div style={{
      minHeight: '100vh', background: BG, color: TEXT,
      fontFamily: BRIC, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '40px 24px',
      WebkitAppRegion: 'drag',
    }}>
      {/* Window drag region — buttons must opt out */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0, 0, 0.2, 1] }}
        style={{ width: '100%', maxWidth: 380, WebkitAppRegion: 'no-drag' }}
      >
        {/* Logo / intro */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <p style={{
            fontFamily: MONO, fontSize: 10, color: CORAL,
            letterSpacing: '3px', textTransform: 'uppercase', margin: '0 0 12px',
          }}>— thera</p>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.7px', margin: '0 0 10px' }}>
            {mode === 'login' ? 'oh, you\'re back.' : 'starting something new?'}
          </h1>
          <p style={{ color: MUTED, fontSize: 13, margin: 0, lineHeight: 1.6 }}>
            {mode === 'login'
              ? 'your stuff is still here. log in and we\'ll pick up where we left off.'
              : 'sign up. i\'ll remember everything. for better or worse.'}
          </p>
        </div>

        {/* Google button */}
        <button
          onClick={handleGoogleAuth}
          disabled={loading}
          style={btnStyle({ variant: 'google', disabled: loading })}
          onMouseEnter={e => !loading && (e.currentTarget.style.borderColor = CORAL)}
          onMouseLeave={e => !loading && (e.currentTarget.style.borderColor = BORDER)}
        >
          <GoogleIcon />
          <span style={{ marginLeft: 10 }}>continue with google</span>
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
          <div style={{ flex: 1, height: 1, background: BORDER }} />
          <span style={{ fontFamily: MONO, fontSize: 9, color: DIM, letterSpacing: '1.5px', textTransform: 'uppercase' }}>or</span>
          <div style={{ flex: 1, height: 1, background: BORDER }} />
        </div>

        {/* Email form */}
        <form onSubmit={handleEmailAuth} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="email"
            placeholder="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            disabled={loading}
            style={inputStyle}
            onFocus={e => (e.target.style.borderColor = CORAL)}
            onBlur={e => (e.target.style.borderColor = BORDER)}
          />
          <input
            type="password"
            placeholder="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={loading}
            style={inputStyle}
            onFocus={e => (e.target.style.borderColor = CORAL)}
            onBlur={e => (e.target.style.borderColor = BORDER)}
          />

          {/* Error / success */}
          <AnimatePresence mode="wait">
            {error && (
              <motion.p
                key="err"
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                style={{ margin: 0, fontSize: 12, color: '#e87a3a', fontFamily: MONO, letterSpacing: '0.5px' }}
              >{error}</motion.p>
            )}
            {success && (
              <motion.p
                key="ok"
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                style={{ margin: 0, fontSize: 12, color: GOLD, fontFamily: MONO, letterSpacing: '0.5px' }}
              >{success}</motion.p>
            )}
          </AnimatePresence>

          <button
            type="submit"
            disabled={loading}
            style={btnStyle({ variant: 'primary', disabled: loading })}
          >
            {loading ? 'one sec...' : mode === 'login' ? 'log in' : 'create account'}
          </button>
        </form>

        {/* Toggle mode */}
        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: MUTED }}>
          {mode === 'login' ? "don't have an account? " : 'already have one? '}
          <button
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setSuccess(''); }}
            style={{
              background: 'none', border: 'none', color: CORAL, cursor: 'pointer',
              fontSize: 13, fontFamily: BRIC, padding: 0, textDecoration: 'underline',
            }}
          >
            {mode === 'login' ? 'sign up' : 'log in'}
          </button>
        </p>
      </motion.div>
    </div>
  );
}

/* ── Shared styles ────────────────────────────────────────── */
const inputStyle = {
  background: SURF, border: `1px solid ${BORDER}`, borderRadius: 10,
  padding: '12px 14px', color: TEXT, fontFamily: BRIC, fontSize: 14,
  outline: 'none', transition: 'border-color 0.2s', width: '100%',
  boxSizing: 'border-box',
};

function btnStyle({ variant, disabled }) {
  const base = {
    width: '100%', border: '1px solid', borderRadius: 10,
    padding: '12px 16px', fontSize: 14, fontFamily: BRIC,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    transition: 'border-color 0.2s, opacity 0.2s',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxSizing: 'border-box',
  };
  if (variant === 'primary') {
    return { ...base, background: CORAL, borderColor: CORAL, color: '#fff', fontWeight: 600 };
  }
  return { ...base, background: SURF, borderColor: BORDER, color: TEXT };
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function friendlyError(msg) {
  if (!msg) return 'something went wrong.';
  if (msg.includes('Invalid login credentials')) return 'wrong email or password.';
  if (msg.includes('Email not confirmed'))        return 'check your email and confirm your account first.';
  if (msg.includes('User already registered'))    return 'that email already has an account. try logging in.';
  if (msg.includes('Password should be'))         return 'password must be at least 6 characters.';
  if (msg.includes('timed out'))                  return 'google sign-in timed out. try again.';
  if (msg.includes('cancelled'))                  return 'sign-in was cancelled.';
  return msg.toLowerCase();
}
