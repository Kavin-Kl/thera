import { motion, AnimatePresence } from 'framer-motion';

const MONO = "'Space Mono', monospace";
const BRIC = "'Space Grotesk', system-ui, sans-serif";

/**
 * Crisis Mode UI transformation.
 *
 * When the AI (or a heuristic) detects a crisis signal, the chat shrinks
 * away and this full-screen takeover replaces it. Soft, slow, no buttons
 * that look like a "task". Resources, a breathing prompt, and a single
 * "i'm here" exit.
 *
 * Severity:
 *   amber — gentle check-in (low mood streak, vent without escalation)
 *   red   — explicit crisis language detected (ideation, self-harm)
 */
export default function CrisisOverlay({ severity = 'amber', onClose, onConfirmSafe }) {
  const isRed = severity === 'red';

  // Wine-red for red, deep midnight for amber
  const BG       = isRed ? '#1a0a0e' : '#0d0d1a';
  const ACCENT   = isRed ? '#8b2252' : '#c89640';
  const TEXT     = '#f0e6d3';
  const MUTED    = '#a8907c';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.6 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: BG, color: TEXT,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '40px 30px', fontFamily: BRIC,
          backdropFilter: 'blur(20px)',
        }}
      >
        {/* Slow breathing circle */}
        <motion.div
          animate={{ scale: [1, 1.25, 1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            position: 'absolute', top: '20%',
            width: 140, height: 140, borderRadius: '50%',
            background: `radial-gradient(circle, ${ACCENT}55, transparent 70%)`,
            pointerEvents: 'none',
          }}
        />

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.8 }}
          style={{ maxWidth: 460, textAlign: 'center', zIndex: 1 }}
        >
          <p style={{
            fontFamily: MONO, fontSize: 10, color: ACCENT,
            letterSpacing: '3px', textTransform: 'uppercase', margin: '0 0 24px',
          }}>— thera</p>

          <h1 style={{
            fontFamily: BRIC, fontSize: 26, fontWeight: 500,
            color: TEXT, margin: '0 0 18px', lineHeight: 1.3,
            letterSpacing: '-0.5px',
          }}>
            {isRed
              ? "hey. i'm right here. you don't have to do anything."
              : "you've been carrying a lot. let's just sit for a minute."}
          </h1>

          <p style={{
            fontSize: 15, color: MUTED, lineHeight: 1.7, margin: '0 0 30px',
          }}>
            {isRed
              ? "breathe with me. in for four, hold for four, out for six. we'll do it together. and if you want to talk to a human, the numbers below are real and they will pick up."
              : "no fixing, no advice. just here. when you're ready, we can talk — or not. that's also fine."}
          </p>

          {isRed && (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28,
              padding: '18px 20px', borderRadius: 12,
              background: 'rgba(139, 34, 82, 0.15)',
              border: `1px solid ${ACCENT}55`,
              textAlign: 'left',
            }}>
              <p style={{ margin: 0, fontSize: 12, color: ACCENT, fontFamily: MONO, letterSpacing: '1.5px', textTransform: 'uppercase' }}>
                if you need a human now
              </p>
              <a href="tel:988" style={{ color: TEXT, fontSize: 14, textDecoration: 'none' }}>
                <strong>988</strong> — suicide & crisis lifeline (US)
              </a>
              <a href="tel:116123" style={{ color: TEXT, fontSize: 14, textDecoration: 'none' }}>
                <strong>116 123</strong> — samaritans (UK / IE)
              </a>
              <a href="https://findahelpline.com" target="_blank" rel="noreferrer" style={{ color: TEXT, fontSize: 14, textDecoration: 'none' }}>
                <strong>findahelpline.com</strong> — anywhere else
              </a>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={onConfirmSafe}
              style={{
                background: ACCENT, border: 'none', borderRadius: 50,
                padding: '12px 24px', fontFamily: MONO, fontSize: 11,
                letterSpacing: '1.6px', textTransform: 'uppercase',
                color: '#fff', cursor: 'pointer',
              }}
            >i'm okay. let's keep going.</button>
            <button
              onClick={onClose}
              style={{
                background: 'transparent', border: `1px solid ${MUTED}`,
                borderRadius: 50, padding: '12px 24px',
                fontFamily: MONO, fontSize: 11, letterSpacing: '1.6px',
                textTransform: 'uppercase', color: MUTED, cursor: 'pointer',
              }}
            >just sit with me</button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
