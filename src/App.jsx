import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Intro from "./components/Intro/Intro";
import Auth from "./components/Auth/Auth";
import Onboarding from "./components/Onboarding/Onboarding";
import Home from "./Home/Home";
import Settings from "./components/Settings/Settings";
import CrisisOverlay from "./components/Crisis/CrisisOverlay";
import { supabase, supabaseConfigured } from "./services/supabaseClient";

const { ipcRenderer } = window.require ? window.require('electron') : {};

function App() {
  const [introDone,        setIntroDone]        = useState(false);
  const [closing,          setClosing]          = useState(false);
  const [opening,          setOpening]          = useState(false);
  const closingTimer  = useRef(null);
  const openingTimer  = useRef(null);

  const [user,             setUser]             = useState(null);   // Supabase user object
  const [loadingAuth,      setLoadingAuth]      = useState(true);   // checking session

  const [showHome,         setShowHome]         = useState(false);
  const [showSettings,     setShowSettings]     = useState(false);
  const [dark,             setDark]             = useState(true);
  const [checkingSettings, setCheckingSettings] = useState(true);
  const [crisis,           setCrisis]           = useState(null);

  // ── Resume crisis + listen for new ones ───────────────────────
  useEffect(() => {
    if (!ipcRenderer) return;
    (async () => {
      try {
        const active = await ipcRenderer.invoke('crisis:active');
        if (active) setCrisis({ id: active.id, severity: active.severity });
      } catch (_) {}
    })();
    const onCrisis = (_e, payload) => setCrisis(payload);
    ipcRenderer.on?.('crisis:trigger', onCrisis);
    return () => ipcRenderer.removeListener?.('crisis:trigger', onCrisis);
  }, []);

  // ── Window open/close animation signals ───────────────────────
  useEffect(() => {
    if (!ipcRenderer) return;
    const onClose = () => {
      setOpening(false);
      setClosing(true);
      closingTimer.current = setTimeout(() => setClosing(false), 500);
    };
    const onOpen = () => {
      setClosing(false);
      setOpening(true);
      openingTimer.current = setTimeout(() => setOpening(false), 500);
    };
    ipcRenderer.on('start-close-animation', onClose);
    ipcRenderer.on('start-open-animation',  onOpen);
    return () => {
      ipcRenderer.removeListener('start-close-animation', onClose);
      ipcRenderer.removeListener('start-open-animation',  onOpen);
      clearTimeout(closingTimer.current);
      clearTimeout(openingTimer.current);
    };
  }, []);

  // ── Check Supabase session on mount ───────────────────────────
  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      // Supabase not configured — boot with a synthetic local user so the
      // rest of the app works in "unconfigured" mode.
      setUser({ id: 'desktop_user', email: null });
      setLoadingAuth(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        ipcRenderer?.send('auth:set-user', session.user.id);
      }
      setLoadingAuth(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user || null;
      setUser(u);
      ipcRenderer?.send('auth:set-user', u?.id || null);
      if (!u) {
        // Signed out — reset UI
        setShowHome(false);
        setCheckingSettings(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── Check per-user onboarding state after auth ───────────────
  useEffect(() => {
    if (loadingAuth || !user) return;

    const checkOnboarding = async () => {
      try {
        // Onboarding key is namespaced per user to allow different profiles
        const key = `onboardingCompleted_${user.id}`;
        const completed = await ipcRenderer?.invoke('get-setting', key);
        if (completed) {
          setIntroDone(true);
          setShowHome(true);
        }
      } catch (err) {
        console.error('Failed to check onboarding status:', err);
      } finally {
        setCheckingSettings(false);
      }
    };
    checkOnboarding();
  }, [user, loadingAuth]);

  const dismissCrisis = async () => {
    if (crisis?.id && ipcRenderer) {
      try { await ipcRenderer.invoke('crisis:resolve', crisis.id); } catch (_) {}
    }
    setCrisis(null);
  };

  // ── Sign out ───────────────────────────────────────────────────
  const handleSignOut = async () => {
    try {
      if (supabase) await supabase.auth.signOut();
    } catch (_) {}
    ipcRenderer?.send('auth:set-user', null);
    setShowSettings(false);
    setShowHome(false);
    setUser(null);
    setCheckingSettings(true);
  };

  // ── Onboarding complete ────────────────────────────────────────
  const handleOnboardingComplete = (answers) => {
    try {
      const key = `onboardingCompleted_${user?.id || 'desktop_user'}`;
      ipcRenderer?.send('set-setting', key, true);
      ipcRenderer?.send('set-setting', `onboardingData_${user?.id || 'desktop_user'}`, answers);
      if (answers.nsfw_mode) {
        const nsfwEnabled = answers.nsfw_mode.includes('on —');
        ipcRenderer?.send('set-setting', 'nsfwMode', nsfwEnabled);
      }
    } catch (err) {
      console.error('Failed to save onboarding data:', err);
    }
    setShowHome(true);
  };

  /* ── Loading states ─────────────────────────────────────────── */
  const BG = dark ? '#18120a' : '#f5ede0';
  const animClass = closing ? 'fly-out' : opening ? 'fly-in' : '';

  // Show intro first — always
  if (!introDone) {
    return <Intro onFinish={() => setIntroDone(true)} />;
  }

  // Checking auth session
  if (loadingAuth) {
    return <div className={animClass} style={{ background: BG, minHeight: '100vh' }} />;
  }

  // Not authenticated → show auth page
  if (!user) {
    return (
      <div className={animClass} style={{ background: BG, minHeight: '100vh' }}>
        <Auth onAuth={(u) => {
          setUser(u);
          ipcRenderer?.send('auth:set-user', u.id);
        }} />
      </div>
    );
  }

  // Authenticated — checking per-user onboarding setting
  if (checkingSettings) {
    return <div className={animClass} style={{ background: BG, minHeight: '100vh' }} />;
  }

  /* ── Main app ────────────────────────────────────────────────── */
  return (
    <div className={animClass} style={{ background: BG, minHeight: '100vh' }}>
      <AnimatePresence mode="wait">
        {!showHome && (
          <motion.div
            key="onboarding"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1 }}
          >
            <Onboarding onComplete={handleOnboardingComplete} />
          </motion.div>
        )}

        {showHome && (
          <motion.div
            key="home"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1 }}
          >
            <Home
              dark={dark}
              setDark={setDark}
              onOpenSettings={() => setShowSettings(true)}
              userId={user.id}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSettings && (
          <Settings
            dark={dark}
            user={user}
            onClose={() => setShowSettings(false)}
            onSignOut={handleSignOut}
          />
        )}
      </AnimatePresence>

      {crisis && (
        <CrisisOverlay
          severity={crisis.severity}
          onClose={dismissCrisis}
          onConfirmSafe={dismissCrisis}
        />
      )}
    </div>
  );
}

export default App;
