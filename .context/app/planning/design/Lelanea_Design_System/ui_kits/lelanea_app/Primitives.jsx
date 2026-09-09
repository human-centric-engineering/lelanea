/* Shared UI primitives for the Lelanea app kit */

const Eyebrow = ({ children, style = {} }) => (
  <div style={{
    fontSize: 11, letterSpacing: '0.14em', textTransform: 'lowercase',
    color: '#6F7376', fontWeight: 500, ...style,
  }}>{children}</div>
);

// Lotus geometry — keep in sync with assets/lotus-mark.svg, logo-wordmark.svg, thumbnail.html.
// Broad pointed petal rising from (160,175). Wide-angle tiers are short, upright ones long,
// so the bloom reads as a wide fan (measured 134 x 118, aspect 1.14).
const lotusPetal = (L, W) =>
  `M160 175C${(160 + W * 0.58).toFixed(1)} ${(175 - L * 0.29).toFixed(1)},${(160 + W * 0.49).toFixed(1)} ${(175 - L * 0.73).toFixed(1)},160 ${175 - L}` +
  `C${(160 - W * 0.49).toFixed(1)} ${(175 - L * 0.73).toFixed(1)},${(160 - W * 0.58).toFixed(1)} ${(175 - L * 0.29).toFixed(1)},160 175Z`;

const LOTUS_TIERS = [
  { d: lotusPetal(60, 48), fill: '#17718A', stroke: '#0E5064', angles: [-66, 66, -46, 46, -25, 25], base: 340 },
  { d: lotusPetal(78, 50), fill: '#3E96AE', stroke: '#17718A', angles: [-42, 42, -26, 26, -11, 11], base: 180 },
  { d: lotusPetal(98, 52), fill: '#7CC0D6', stroke: '#2E8BA5', angles: [-30, 30, -15, 15, 0], base: 40 },
];

const LOTUS_VEIN_ANGLES = [-30, 30, -15, 15, 0];
const LOTUS_VEIN_D = 'M160 164 160 88';
const LOTUS_CORE_CY = 172;
const LOTUS_RIPPLES = [
  { rx: 50, ry: 6, stroke: '#457B6A', op: 0.55, w: 1.6 },
  { rx: 74, ry: 9, stroke: '#457B6A', op: 0.34, w: 1.4 },
  { rx: 97, ry: 12, stroke: '#6FA88F', op: 0.2, w: 1.2 },
];
const LOTUS_RIPPLE_CY = 188;

// `bloomFrac` is the measured share of the frame width the bloom occupies, so `size`
// means the bloom itself and stays interchangeable between Lotus and LotusMark.
const LOTUS_FRAMES = {
  water: { box: '58 72 204 132', aspect: 132 / 204, bloomFrac: 0.658, stroke: 1.5 },
  tight: { box: '86 74 148 126', aspect: 126 / 148, bloomFrac: 0.95, stroke: 1.9 },
};

const LotusMark = ({ size = 32, water = true, style = {} }) => {
  const f = water ? LOTUS_FRAMES.water : LOTUS_FRAMES.tight;
  const frameW = size / f.bloomFrac;
  const gid = `lmc${Math.round(size)}${water ? 'w' : 't'}`;
  return (
    <svg width={Math.round(frameW)} height={Math.round(frameW * f.aspect)} viewBox={f.box} style={style} aria-hidden="true">
      <defs>
        <radialGradient id={gid} cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor="#F0A078"/>
          <stop offset="55%" stopColor="#C96F43"/>
          <stop offset="100%" stopColor="#9C5530"/>
        </radialGradient>
      </defs>
      {water && (
        <g fill="none" strokeLinecap="round">
          {LOTUS_RIPPLES.map((r, i) => (
            <ellipse key={i} cx="160" cy={LOTUS_RIPPLE_CY} rx={r.rx} ry={r.ry}
              stroke={r.stroke} strokeOpacity={r.op} strokeWidth={r.w}/>
          ))}
        </g>
      )}
      {LOTUS_TIERS.map((t, ti) => (
        <g key={ti} fill={t.fill} stroke={t.stroke} strokeWidth={f.stroke} strokeLinejoin="round">
          {t.angles.map((a, i) => (
            <path key={`${a}-${i}`} d={t.d} transform={`rotate(${a} 160 175)`}/>
          ))}
        </g>
      ))}
      <ellipse cx="160" cy={LOTUS_CORE_CY} rx="8" ry="10" fill={`url(#${gid})`}/>
    </svg>
  );
};

// Small stroke icons (Lucide-style, 1.5px)
const Icon = ({ name, size = 22, color = 'currentColor' }) => {
  const s = { width: size, height: size, fill: 'none', stroke: color, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    home: <><path d="M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V9.5z"/></>,
    sit:  <><circle cx="12" cy="12" r="9"/><path d="M8 12a4 4 0 0 1 8 0"/><circle cx="12" cy="12" r="1.2" fill={color}/></>,
    journal: <><path d="M5 4h11l3 3v13H5z"/><path d="M8 9h8M8 13h8M8 17h5"/></>,
    practice: <><path d="M12 2c3 3 3 7 0 10-3-3-3-7 0-10z"/><path d="M5 12c3-1 6 1 7 4-3 1-6-1-7-4z"/><path d="M19 12c-3-1-6 1-7 4 3 1 6-1 7-4z"/></>,
    you: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    up: <><path d="M12 19V5M6 11l6-6 6 6"/></>,
    close: <><path d="M6 6l12 12M18 6L6 18"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    check: <><path d="M5 12l5 5 9-10"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    sparkle: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/></>,
    chevron: <><path d="M9 6l6 6-6 6"/></>,
  };
  return <svg style={s} viewBox="0 0 24 24">{paths[name]}</svg>;
};

const Pill = ({ children, active, onClick, style = {} }) => (
  <button onClick={onClick} style={{
    border: active ? 'none' : '1px solid rgba(111,115,118,0.24)',
    background: active ? '#17718A' : '#EBE6DF',
    color: active ? '#F3F0EC' : '#11181A',
    padding: '8px 14px', borderRadius: 999, fontSize: 13,
    fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
    cursor: 'pointer', lineHeight: 1, ...style,
  }}>{children}</button>
);

const TabBar = ({ active, onChange }) => {
  const items = [
    { k: 'home', label: 'home' },
    { k: 'sit', label: 'sit' },
    { k: 'journal', label: 'journal' },
    { k: 'practice', label: 'practices' },
    { k: 'you', label: 'you' },
  ];
  return (
    <div style={{
      position: 'absolute', bottom: 36, left: 0, right: 0,
      display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 40,
    }}>
      <div style={{
        pointerEvents: 'auto',
        background: 'rgba(235,230,223,0.92)',
        backdropFilter: 'blur(16px) saturate(140%)',
        WebkitBackdropFilter: 'blur(16px) saturate(140%)',
        padding: 6, borderRadius: 999, display: 'flex', gap: 2,
        boxShadow: '0 8px 24px rgba(17,24,26,0.08), 0 2px 8px rgba(17,24,26,0.04)',
      }}>
        {items.map(it => {
          const on = active === it.k;
          return (
            <button key={it.k} onClick={() => onChange(it.k)} style={{
              background: on ? '#F3F0EC' : 'transparent',
              color: on ? '#17718A' : '#6F7376',
              border: 'none', padding: '8px 12px', borderRadius: 999,
              display: 'flex', alignItems: 'center', gap: 6,
              fontFamily: "'Hanken Grotesk', system-ui", fontSize: 12,
              fontWeight: on ? 500 : 400, cursor: 'pointer',
            }}>
              <Icon name={it.k} size={18} color={on ? '#17718A' : '#6F7376'} />
              {on && <span>{it.label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
};

Object.assign(window, { Eyebrow, LotusMark, Icon, Pill, TabBar });
