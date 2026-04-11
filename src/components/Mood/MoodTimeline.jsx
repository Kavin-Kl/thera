import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const { ipcRenderer } = window.require ? window.require('electron') : {};

const CORAL = '#e8603a';
const MONO  = "'Space Mono', monospace";
const BRIC  = "'Space Grotesk', system-ui, sans-serif";

/* ── Big mood face (same SVG geometry as widget, just scaled up) ── */
function BigMoodFace({ emotion = 'neutral', size = 80 }) {
  const eye   = 'rgba(255,255,255,0.82)';
  const mouth = 'rgba(255,255,255,0.68)';
  const brow  = 'rgba(255,255,255,0.42)';
  const sw = 1.6;

  const faces = {
    neutral: <>
      <line x1="6.5" y1="9" x2="9.5" y2="9"   stroke={eye}   strokeWidth={sw} strokeLinecap="round"/>
      <line x1="12.5" y1="9" x2="15.5" y2="9"  stroke={eye}   strokeWidth={sw} strokeLinecap="round"/>
      <line x1="8"   y1="14.5" x2="14" y2="14.5" stroke={mouth} strokeWidth={sw} strokeLinecap="round"/>
    </>,
    content: <>
      <circle cx="8"  cy="9" r="1.15" fill={eye}/>
      <circle cx="14" cy="9" r="1.15" fill={eye}/>
      <path d="M8.5 13.5 Q11 15.8 13.5 13.5" stroke={mouth} strokeWidth={sw} strokeLinecap="round" fill="none"/>
    </>,
    happy: <>
      <path d="M6.5 9.5 Q8 11.2 9.5 9.5"   stroke={eye}   strokeWidth={sw} strokeLinecap="round" fill="none"/>
      <path d="M12.5 9.5 Q14 11.2 15.5 9.5" stroke={eye}   strokeWidth={sw} strokeLinecap="round" fill="none"/>
      <path d="M7.5 13 Q11 17.2 14.5 13"    stroke={mouth} strokeWidth={sw} strokeLinecap="round" fill="none"/>
    </>,
    excited: <>
      <path d="M6.5 10 Q8 7.5 9.5 10"    stroke={eye}   strokeWidth={sw} strokeLinecap="round" fill="none"/>
      <path d="M12.5 10 Q14 7.5 15.5 10" stroke={eye}   strokeWidth={sw} strokeLinecap="round" fill="none"/>
      <path d="M7 13 Q11 17.8 15 13"     stroke={mouth} strokeWidth="1.8" strokeLinecap="round" fill="none"/>
    </>,
    concerned: <>
      <circle cx="8"  cy="9" r="1.15" fill={eye}/>
      <circle cx="14" cy="9" r="1.15" fill={eye}/>
      <path d="M8.5 15 Q11 13.2 13.5 15" stroke={mouth} strokeWidth={sw} strokeLinecap="round" fill="none"/>
    </>,
    sad: <>
      <circle cx="8"  cy="9.5" r="1.15" fill={eye}/>
      <circle cx="14" cy="9.5" r="1.15" fill={eye}/>
      <line x1="6.5" y1="7.8" x2="9.5" y2="6.8"  stroke={brow} strokeWidth="1.1" strokeLinecap="round"/>
      <line x1="12.5" y1="6.8" x2="15.5" y2="7.8" stroke={brow} strokeWidth="1.1" strokeLinecap="round"/>
      <path d="M8.5 15.8 Q11 13.2 13.5 15.8" stroke={mouth} strokeWidth={sw} strokeLinecap="round" fill="none"/>
    </>,
    stressed: <>
      <line x1="6.5" y1="7.5" x2="9.5" y2="10.5" stroke={eye} strokeWidth={sw} strokeLinecap="round"/>
      <line x1="9.5" y1="7.5" x2="6.5" y2="10.5" stroke={eye} strokeWidth={sw} strokeLinecap="round"/>
      <line x1="12.5" y1="7.5" x2="15.5" y2="10.5" stroke={eye} strokeWidth={sw} strokeLinecap="round"/>
      <line x1="15.5" y1="7.5" x2="12.5" y2="10.5" stroke={eye} strokeWidth={sw} strokeLinecap="round"/>
      <path d="M8 14.5 Q9.5 13 11 14.5 Q12.5 16 14 14.5" stroke={mouth} strokeWidth="1.3" strokeLinecap="round" fill="none"/>
    </>,
    nervous: <>
      <circle cx="8"  cy="9" r="1.15" fill={eye}/>
      <circle cx="14" cy="9" r="1.15" fill={eye}/>
      <path d="M7.5 14.5 Q9 13 10.5 14.5 Q12 16 13.5 14.5 Q14.5 13.5 15 14" stroke={mouth} strokeWidth="1.3" strokeLinecap="round" fill="none"/>
    </>,
  };

  return (
    <svg
      width={size} height={size}
      viewBox="0 0 22 22"
      fill="none"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {faces[emotion] ?? faces.neutral}
    </svg>
  );
}

/* ── Dynamic emotion + description from weekly avg ── */
function getWeekEmotion(weekAvg) {
  // Hardcoded for now — swap the return value once mood data is live
  // if (weekAvg == null)  return 'neutral';
  // if (weekAvg >= 1.3)   return 'excited';
  // if (weekAvg >= 0.6)   return 'happy';
  // if (weekAvg >= 0.0)   return 'content';
  // if (weekAvg >= -0.6)  return 'neutral';
  // if (weekAvg >= -1.2)  return 'concerned';
  // if (weekAvg >= -1.7)  return 'sad';
  // return 'stressed';
  return 'excited'; // ← hardcoded grin until real data flows in
}

function getWeekDescription(emotion) {
  const map = {
    excited:  "okay i'm not going to make this weird but you genuinely had a great week. don't ruin it by overthinking it.",
    happy:    "more good days than bad. that's not luck, that's you. i'm not saying i'm proud, but i'm not not saying it.",
    content:  "nothing exploded. you were fine. i know 'fine' sounds boring but honestly? fine is underrated.",
    neutral:  "you had a week. some of it was okay. some of it wasn't. very human of you.",
    concerned:"rough patches this week. you're still here which is something. not everything, but something.",
    sad:      "it's been hard. i've been watching the data and i'm not going to pretend otherwise. you're allowed to feel it.",
    stressed: "you've been white-knuckling it all week. i can see it in the numbers. put something down. anything.",
    nervous:  "all over the place. up, down, sideways. i genuinely couldn't predict you this week. neither could you, could you.",
  };
  // Hardcoded description to match the hardcoded 'excited' face above
  return "okay i'm not going to make this weird but you genuinely had a great week. don't ruin it by overthinking it.";
  // ↑ swap back to: return map[emotion] ?? map.neutral;
}

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

  const weekEmotion    = getWeekEmotion(weekAvg);
  const weekDescription = getWeekDescription(weekEmotion);

  return (
    <div style={{ width: '100%', fontFamily: BRIC, color: T.TEXT }}>

      {/* ── Weekly summary card ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 22,
        padding: '18px 22px',
        background: T.DIM,
        borderRadius: 18,
        border: `1px solid ${T.BORDER}`,
        marginBottom: 28,
      }}>
        <BigMoodFace emotion={weekEmotion} size={78} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            margin: '0 0 8px',
            fontFamily: MONO, fontSize: 9,
            letterSpacing: '2.2px', textTransform: 'uppercase',
            color: T.MUTED,
          }}>
            weekly summary
          </p>
          <p style={{
            margin: 0,
            fontFamily: BRIC, fontSize: 13.5, fontWeight: 400,
            color: T.TEXT, lineHeight: 1.55,
          }}>
            {weekDescription}
          </p>
        </div>
      </div>

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
