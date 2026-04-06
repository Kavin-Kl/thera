import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Typewriter from "typewriter-effect";

const BRIC  = "'Space Grotesk', system-ui, sans-serif";
const MONO  = "'Space Mono', monospace";
const E_OUT = [0.0, 0.0, 0.2, 1.0];
const CORAL = "#e8603a";
const GOLD  = "#c89640";

const bootLines = [
  { text: "waking up...",        delay: 0    },
  { text: "loading memories",    delay: 320  },
  { text: "grabbing coffee  ☕", delay: 650  },
  { text: "hi.",                 delay: 980  },
];

export default function Intro({ onFinish }) {
  const [step,   setStep]   = useState(0);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    const timers = bootLines.map((line, i) => setTimeout(() => setStep(i + 1), line.delay + 60));
    const t = setTimeout(() => setBooted(true), 1420);
    return () => { timers.forEach(clearTimeout); clearTimeout(t); };
  }, []);

  return (
    <motion.div
      style={{
        height: "100vh", width: "100%",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "#18120a",
        borderTop: `1.5px solid ${CORAL}`,
        position: "relative", overflow: "hidden",
        fontFamily: BRIC,
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: E_OUT }}
    >
      {/* Subtle warm radial background */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse 60% 50% at 20% 30%, rgba(232,96,58,0.06) 0%, transparent 70%), radial-gradient(ellipse 50% 60% at 80% 70%, rgba(200,150,64,0.05) 0%, transparent 70%)"
      }} />

      <div style={{ width: "100%", maxWidth: 480, padding: "0 44px", position: "relative", zIndex: 1 }}>

        {/* Boot lines */}
        <AnimatePresence>
          {!booted && (
            <motion.div key="boot" style={{ display: "flex", flexDirection: "column", gap: 10 }}
              exit={{ opacity: 0, y: -10, transition: { duration: 0.2, ease: [0.4,0,1,1] } }}
            >
              {bootLines.slice(0, step).map((line, i) => {
                const cur = i === step - 1;
                return (
                  <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.28, ease: E_OUT }}
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <span style={{ fontFamily: MONO, fontSize: 11, color: cur ? CORAL : "transparent", flexShrink: 0 }}>›</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "1.5px", color: cur ? "#a06848" : "#3a2418" }}>{line.text}</span>
                    {cur && (
                      <motion.span style={{ fontFamily: MONO, fontSize: 11, color: CORAL }}
                        animate={{ opacity: [1,0,1] }} transition={{ duration: 0.85, repeat: Infinity, ease: "linear" }}
                      >█</motion.span>
                    )}
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Typewriter */}
        <AnimatePresence>
          {booted && (
            <motion.div key="tw" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: E_OUT }}>
              <p style={{ margin: "0 0 20px", fontFamily: MONO, fontSize: 10, color: "#4a3420", letterSpacing: "3px", textTransform: "uppercase" }}>
                — thera
              </p>
              <div style={{ fontFamily: BRIC, fontWeight: 300, color: "#f0e6d2", lineHeight: 1.9, fontSize: "clamp(19px, 2.8vw, 28px)" }}>
                <Typewriter
                  options={{ delay: 30, cursor: "▋" }}
                  onInit={tw => {
                    tw
                      .typeString("hi.")
                      .pauseFor(750)
                      .typeString("<br/><br/>i'm thera.")
                      .pauseFor(850)
                      .typeString("<br/><br/>i've heard it all.")
                      .pauseFor(500)
                      .typeString("<br/>nothing surprises me.")
                      .pauseFor(900)
                      .typeString("<br/><br/>your turn.")
                      .pauseFor(580)
                      .callFunction(() => setTimeout(onFinish, 420))
                      .start();
                  }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </motion.div>
  );
}
