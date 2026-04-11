import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Intro from "./components/Intro/Intro";
import Onboarding from "./components/Onboarding/Onboarding";
import Home from "./Home/Home";
import Settings from "./components/Settings/Settings";
import CrisisOverlay from "./components/Crisis/CrisisOverlay";

const { ipcRenderer } = window.require ? window.require('electron') : {};

function App() {

  const [introDone, setIntroDone] = useState(false);
  const [closing, setClosing] = useState(false);
  const [opening, setOpening] = useState(false);
  const closingTimer = useRef(null);
  const openingTimer = useRef(null);
  const [showHome, setShowHome] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [dark, setDark] = useState(true);
  const [checkingSettings, setCheckingSettings] = useState(true);
  const [crisis, setCrisis] = useState(null); // null | { id, severity }

  // Resume any unresolved crisis on launch + listen for new ones
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

  // Window physically flies to widget — fade content out while it moves
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

  const dismissCrisis = async () => {
    if (crisis?.id && ipcRenderer) {
      try { await ipcRenderer.invoke('crisis:resolve', crisis.id); } catch (_) {}
    }
    setCrisis(null);
  };

  // Check if onboarding has been completed
  useEffect(() => {
    const checkOnboarding = async () => {
      try {
        const completed = await ipcRenderer?.invoke('get-setting', 'onboardingCompleted');
        if (completed) {
          setIntroDone(true); // skip intro animation on subsequent opens
          setShowHome(true);
        }
      } catch (err) {
        console.error('Failed to check onboarding status:', err);
      } finally {
        setCheckingSettings(false);
      }
    };
    checkOnboarding();
  }, []);

  // Show nothing while checking settings (but after intro)
  if (!introDone) {
    return (
      <Intro onFinish={() => setIntroDone(true)} />
    );
  }

  if (checkingSettings) {
    return (
      <div className={closing ? 'fly-out' : opening ? 'fly-in' : ''} style={{ background: dark ? "#18120a" : "#f5ede0", minHeight: "100vh" }} />
    );
  }

  return (
    <div
      className={closing ? 'fly-out' : opening ? 'fly-in' : ''}
      style={{ background: dark ? "#18120a" : "#f5ede0", minHeight: "100vh" }}
    >

      <AnimatePresence mode="wait">

        {!showHome && (
          <motion.div
            key="onboarding"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1 }}
          >
            <Onboarding onComplete={(answers) => {
              // Save onboarding answers
              try {
                ipcRenderer?.send('set-setting', 'onboardingData', answers);
                ipcRenderer?.send('set-setting', 'onboardingCompleted', true);

                // Save NSFW mode setting
                if (answers.nsfw_mode) {
                  const nsfwEnabled = answers.nsfw_mode.includes('on —');
                  ipcRenderer?.send('set-setting', 'nsfwMode', nsfwEnabled);
                }
              } catch (err) {
                console.error('Failed to save onboarding data:', err);
              }
              setShowHome(true);
            }} />
          </motion.div>
        )}

        {showHome && (
          <motion.div
            key="home"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1 }}
          >
            <Home dark={dark} setDark={setDark} onOpenSettings={() => setShowSettings(true)} />

          </motion.div>
        )}

      </AnimatePresence>

      <AnimatePresence>
        {showSettings && (
          <Settings dark={dark} onClose={() => setShowSettings(false)} onSignOut={async () => {
            ipcRenderer?.send('set-setting', 'onboardingCompleted', false);
            ipcRenderer?.send('set-setting', 'onboardingData', null);
            setShowSettings(false);
            setShowHome(false);
            setIntroDone(false);
          }} />
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
