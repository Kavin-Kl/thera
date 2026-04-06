import { createRoot } from 'react-dom/client';
import { useState, useEffect, useRef } from 'react';

// For Electron APIs in renderer with nodeIntegration
const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron?.ipcRenderer;

// Thera's color palette
const WINE_RED = '#8b2252';
const GOLD = '#c9a84c';
const MIDNIGHT = '#0d0d1a';
const CREAM = '#f0e6d3';

console.log('[WIDGET] widget.jsx loaded');

function Widget() {
  const [nudgeText, setNudgeText] = useState(null);
  const [isPressing, setIsPressing] = useState(false);
  const pressTimer = useRef(null);

  useEffect(() => {
    console.log('[WIDGET] Widget component mounted');

    try {
      if (!ipcRenderer) throw new Error('ipcRenderer not available');
      console.log('[WIDGET] IPC listeners registered');

      // Listen for nudges
      ipcRenderer.on('show-nudge', (event, message) => {
        console.log('[WIDGET] Received nudge:', message);
        setNudgeText(message);
        // Auto-dismiss after 8 seconds
        setTimeout(() => setNudgeText(null), 8000);
      });

      // Listen for dismiss command
      ipcRenderer.on('dismiss-nudge', () => {
        console.log('[WIDGET] Nudge dismissed');
        setNudgeText(null);
      });

      return () => {
        ipcRenderer.removeAllListeners('show-nudge');
        ipcRenderer.removeAllListeners('dismiss-nudge');
      };
    } catch (e) {
      console.error('[WIDGET] Error in Electron environment:', e);
    }
  }, []);

  const handleMouseDown = () => {
    console.log('[WIDGET] Mouse down');
    setIsPressing(true);
    pressTimer.current = setTimeout(() => {
      // Long press detected
      console.log('[WIDGET] Long press detected! Opening main window...');
      try {
        if (!ipcRenderer) throw new Error('ipcRenderer not available');
        ipcRenderer.send('widget-long-press');
        console.log('[WIDGET] Sent widget-long-press IPC message');
      } catch (e) {
        console.error('[WIDGET] Error sending long-press:', e);
      }
    }, 500); // 500ms for long press
  };

  const handleMouseUp = () => {
    clearTimeout(pressTimer.current);
    if (isPressing) {
      // Short click - dismiss nudge
      if (nudgeText) {
        try {
          if (ipcRenderer) {
            ipcRenderer.send('widget-clicked');
          }
        } catch (e) {
          console.log('Not in Electron');
        }
      }
    }
    setIsPressing(false);
  };

  const hasNudge = nudgeText !== null;

  console.log('[WIDGET] Rendering widget, hasNudge:', hasNudge, 'nudgeText:', nudgeText);

  return (
    <div
      className="widget-container"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        className="widget-bar"
        style={{
          width: hasNudge ? 'auto' : 300,
          height: hasNudge ? 44 : 32,
          minWidth: 300,
          maxWidth: hasNudge ? 500 : 300,
          borderRadius: '0 0 6px 6px',
          background: hasNudge
            ? `rgba(13, 13, 26, 0.85)`
            : `rgba(13, 13, 26, 0.75)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: hasNudge ? 'center' : 'center',
          cursor: isPressing ? 'grabbing' : 'grab',
          boxShadow: hasNudge
            ? `0 4px 24px rgba(139, 34, 82, 0.4), 0 0 1px rgba(201, 164, 76, 0.6)`
            : `0 2px 12px rgba(139, 34, 82, 0.2), 0 0 1px rgba(201, 164, 76, 0.4)`,
          border: `1px solid rgba(201, 164, 76, 0.3)`,
          padding: hasNudge ? '0 20px' : '0 16px',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          overflow: 'hidden',
          transform: isPressing ? 'scale(0.98)' : 'scale(1)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          clearTimeout(pressTimer.current);
          setIsPressing(false);
        }}
      >
        {hasNudge ? (
          // Nudge text
          <div
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: CREAM,
              fontFamily: "'Space Mono', monospace",
              textAlign: 'center',
              letterSpacing: '-0.2px',
              lineHeight: 1.3,
              whiteSpace: 'normal',
              wordBreak: 'break-word',
            }}
          >
            {nudgeText}
          </div>
        ) : (
          // Idle state - "thera" with accent
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <div
              style={{
                width: 4,
                height: 4,
                borderRadius: '50%',
                background: WINE_RED,
                boxShadow: `0 0 6px ${WINE_RED}`,
                animation: 'pulse 2s ease-in-out infinite',
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: CREAM,
                fontFamily: "'Space Mono', monospace",
                letterSpacing: '1px',
                textTransform: 'lowercase',
              }}
            >
              thera
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// Render
const container = document.getElementById('root');
const root = createRoot(container);
root.render(<Widget />);
