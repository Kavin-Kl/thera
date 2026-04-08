import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Onboarding from "./components/Onboarding/Onboarding";
import Home from "./Home/Home";
import Settings from "./components/Settings/Settings";
import CrisisOverlay from "./components/Crisis/CrisisOverlay";

const { ipcRenderer } = window.require ? window.require('electron') : {};

function App() {

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

  // Show nothing while checking settings
  if (checkingSettings) {
    return (
      <div style={{ background: dark ? "#18120a" : "#f5ede0", minHeight: "100vh" }} />
    );
  }

  return (
    <div style={{ background: dark ? "#18120a" : "#f5ede0", minHeight: "100vh" }}>

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
          <Settings dark={dark} onClose={() => setShowSettings(false)} />
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
