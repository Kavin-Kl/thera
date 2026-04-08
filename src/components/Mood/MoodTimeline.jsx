import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const { ipcRenderer } = window.require ? window.require('electron') : {};

const CORAL = '#e8603a';
const MONO  = "'Space Mono', monospace";
const BRIC  = "'Space Grotesk', system-ui, sans-serif";

const SCORE_COLORS = {
  '-2': '#5a2030',  // low
  '-1': '#7a3a3a',
  '0':  '#4a3420',  // flat
  '1':  '#8a6a30',
  '2':  '#c89640',  // good
};

function bucketColor(avg, dim) {
  if (avg == null) return dim;
  const rounded = Math.round(avg);
  return SCORE_COLORS[String(rounded)] || dim;
}

/**
 * 30-day mood heatmap. Each cell is one day; intensity = avg score.
 * Empty days show as the dim base color.
 */
export default function MoodTimeline({ dark = true, days = 30 }) {
  const T = dark
    ? { TEXT: '#f0e6d2', MUTED: '#8a7256', DIM: '#2a1c10', BORDER: '#3a2614' }
    : { TEXT: '#1c1008', MUTED: '#7a6040', DIM: '#e0d0b8', BORDER: '#d4c0a0' };

  const [data, setData] = useState([]);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    (async () => {
      if (!ipcRenderer) return;
      const rows = await ipcRenderer.invoke('mood:daily', days);
      setData(rows || []);
    })();
  }, [days]);

  // Build a dense day-by-day array spanning the last `days` days
  const today = new Date();
  const cells = [];
  const byDay = Object.fromEntries(data.map(d => [d.day, d]));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const row = byDay[key];
    cells.push({
      day: key,
      label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      avg: row?.avg_score ?? null,
      count: row?.count ?? 0,
    });
  }

  const recent7 = cells.slice(-7).filter(c => c.avg != null);
  const weekAvg = recent7.length ? recent7.reduce((s, c) => s + c.avg, 0) / recent7.length : null;

  return (
    <div style={{ width: '100%', fontFamily: BRIC, color: T.TEXT }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: 14,
      }}>
        <p style={{
          margin: 0, fontFamily: MONO, fontSize: 9, letterSpacing: '2.2px',
          textTransform: 'uppercase', color: T.MUTED,
        }}>mood — last {days} days</p>
        <p style={{ margin: 0, fontSize: 11, color: T.MUTED }}>
          {weekAvg == null ? 'no data this week' :
            `7-day avg: ${weekAvg > 0.5 ? 'good' : weekAvg < -0.5 ? 'rough' : 'meh'}`}
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(15, days)}, 1fr)`,
        gap: 4,
      }}>
        {cells.map(c => (
          <motion.div
            key={c.day}
            whileHover={{ scale: 1.15 }}
            onMouseEnter={() => setHover(c)}
            onMouseLeave={() => setHover(null)}
            style={{
              aspectRatio: '1 / 1',
              borderRadius: 4,
              background: bucketColor(c.avg, T.DIM),
              border: `1px solid ${T.BORDER}`,
              cursor: c.avg != null ? 'pointer' : 'default',
              boxShadow: c.avg != null && c.avg >= 1
                ? `0 0 8px ${bucketColor(c.avg, T.DIM)}66`
                : 'none',
            }}
          />
        ))}
      </div>

      <div style={{
        marginTop: 14, minHeight: 18, fontSize: 11, color: T.MUTED,
      }}>
        {hover ? (
          <span>
            <strong style={{ color: T.TEXT }}>{hover.label}</strong>
            {hover.avg != null
              ? ` — ${hover.count} entr${hover.count === 1 ? 'y' : 'ies'}, avg ${hover.avg.toFixed(1)}`
              : ' — no data'}
          </span>
        ) : (
          <span>hover a cell. each one is a day. brighter = better.</span>
        )}
      </div>

      {/* Legend */}
      <div style={{
        marginTop: 18, display: 'flex', gap: 8, alignItems: 'center',
        fontSize: 10, color: T.MUTED, fontFamily: MONO, letterSpacing: '1.4px',
        textTransform: 'uppercase',
      }}>
        rough
        {[-2, -1, 0, 1, 2].map(s => (
          <div key={s} style={{
            width: 14, height: 14, borderRadius: 3,
            background: SCORE_COLORS[String(s)],
            border: `1px solid ${T.BORDER}`,
          }} />
        ))}
        good
      </div>
    </div>
  );
}
