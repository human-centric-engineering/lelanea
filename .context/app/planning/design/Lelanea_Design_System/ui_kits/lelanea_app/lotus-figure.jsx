/* Animated lotus for the app kit. Geometry mirrors components/Lotus/Lotus.jsx. */

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

const Lotus = ({ size = 140, open: openProp, autoOpen = true, idle = true, water = true, onOpened, delay = 0 }) => {
  const controlled = typeof openProp === 'boolean';
  const [selfOpen, setSelfOpen] = React.useState(false);
  const open = controlled ? openProp : selfOpen;
  const ease = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

  React.useEffect(() => {
    if (controlled || !autoOpen) return;
    const t = setTimeout(() => {
      setSelfOpen(true);
      if (onOpened) setTimeout(onOpened, 2400);
    }, delay);
    return () => clearTimeout(t);
  }, [controlled, autoOpen, delay, onOpened]);

  const f = water ? LOTUS_FRAMES.water : LOTUS_FRAMES.tight;
  const frameW = size / f.bloomFrac;
  const frameH = frameW * f.aspect;

  return (
    <div style={{
      width: frameW, height: frameH, position: 'relative', display: 'inline-block',
      animation: open && idle ? 'lotus-breath 4s ease-in-out infinite' : 'none',
    }}>
      <div style={{
        position: 'absolute', inset: -frameW * 0.16,
        background: 'radial-gradient(ellipse at 50% 62%, rgba(124,192,214,0.20) 0%, rgba(243,240,236,0) 62%)',
        pointerEvents: 'none', opacity: open ? 1 : 0,
        transition: `opacity 1600ms ${ease}`,
      }} />
      <svg width={frameW} height={frameH} viewBox={f.box} style={{ position: 'relative', overflow: 'visible' }}>
        <defs>
          <radialGradient id="lotus-core-anim" cx="50%" cy="42%" r="60%">
            <stop offset="0%" stopColor="#F0A078" />
            <stop offset="55%" stopColor="#C96F43" />
            <stop offset="100%" stopColor="#9C5530" />
          </radialGradient>
        </defs>

        {water && (
          <g fill="none" strokeLinecap="round" style={{
            transformOrigin: `160px ${LOTUS_RIPPLE_CY}px`,
            transform: open ? 'scale(1)' : 'scale(0.55)',
            opacity: open ? 1 : 0,
            transition: `transform 2600ms ${ease} 300ms, opacity 2000ms ${ease} 300ms`,
          }}>
            {LOTUS_RIPPLES.map((r, i) => (
              <ellipse key={i} cx="160" cy={LOTUS_RIPPLE_CY} rx={r.rx} ry={r.ry}
                stroke={r.stroke} strokeOpacity={r.op} strokeWidth={r.w} />
            ))}
          </g>
        )}

        {LOTUS_TIERS.map((tier, ti) => (
          <g key={ti} fill={tier.fill} stroke={tier.stroke} strokeWidth={f.stroke} strokeLinejoin="round">
            {tier.angles.map((a, i) => (
              <path key={`${a}-${i}`} d={tier.d} style={{
                transformOrigin: '160px 175px',
                transform: open ? `rotate(${a}deg) scale(1)` : `rotate(${a * 0.18}deg) scale(0.34)`,
                opacity: open ? 1 : 0,
                transition: `transform 2200ms ${ease} ${tier.base + i * 70}ms, opacity 1500ms ${ease} ${tier.base + i * 70}ms`,
              }} />
            ))}
          </g>
        ))}

        <g stroke="#A8D6E5" strokeWidth="1.2" fill="none"
           style={{ opacity: open ? 0.5 : 0, transition: `opacity 1400ms ${ease} 900ms` }}>
          {LOTUS_VEIN_ANGLES.map((a, i) => (
            <path key={`${a}-${i}`} d={LOTUS_VEIN_D}
              style={{ transformOrigin: '160px 175px', transform: `rotate(${a}deg)` }} />
          ))}
        </g>

        <ellipse cx="160" cy={LOTUS_CORE_CY} rx="8" ry="10" fill="url(#lotus-core-anim)" style={{
          transformOrigin: `160px ${LOTUS_CORE_CY}px`,
          transform: open ? 'scale(1)' : 'scale(0.3)',
          opacity: open ? 1 : 0,
          filter: open ? 'drop-shadow(0 0 12px rgba(201,111,67,0.5))' : 'none',
          transition: `transform 1500ms ${ease} 240ms, opacity 1200ms ${ease} 240ms, filter 1500ms ${ease} 240ms`,
        }} />
        <ellipse cx="160" cy={LOTUS_CORE_CY - 3} rx="2.8" ry="3.4" fill="#F5B896"
          style={{ opacity: open ? 0.85 : 0, transition: `opacity 1200ms ${ease} 600ms` }} />
      </svg>
    </div>
  );
};

if (typeof document !== 'undefined' && !document.getElementById('lotus-keyframes')) {
  const s = document.createElement('style');
  s.id = 'lotus-keyframes';
  s.textContent = '@keyframes lotus-breath{0%,100%{transform:scale(1)}50%{transform:scale(1.015)}}';
  document.head.appendChild(s);
}

window.Lotus = Lotus;
