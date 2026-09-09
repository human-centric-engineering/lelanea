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

/** Static lotus glyph for avatars, favicons and inline marks. `water={false}` crops tight to the bloom. */
export function LotusMark({ size = 32, water = true, style }) {
  const uid = React.useId ? React.useId().replace(/:/g, '') : 'lm';
  const f = water ? LOTUS_FRAMES.water : LOTUS_FRAMES.tight;
  const frameW = size / f.bloomFrac;
  return (
    <svg width={Math.round(frameW)} height={Math.round(frameW * f.aspect)} viewBox={f.box} style={style} aria-hidden="true">
      <defs>
        <radialGradient id={`lm-${uid}`} cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor="#F0A078" />
          <stop offset="55%" stopColor="#C96F43" />
          <stop offset="100%" stopColor="#9C5530" />
        </radialGradient>
      </defs>
      {water && (
        <g fill="none" strokeLinecap="round">
          {LOTUS_RIPPLES.map((r, i) => (
            <ellipse key={i} cx="160" cy={LOTUS_RIPPLE_CY} rx={r.rx} ry={r.ry}
              stroke={r.stroke} strokeOpacity={r.op} strokeWidth={r.w} />
          ))}
        </g>
      )}
      {LOTUS_TIERS.map((t, ti) => (
        <g key={ti} fill={t.fill} stroke={t.stroke} strokeWidth={f.stroke} strokeLinejoin="round">
          {t.angles.map((a, i) => (
            <path key={`${a}-${i}`} d={t.d} transform={`rotate(${a} 160 175)`} />
          ))}
        </g>
      ))}
      <ellipse cx="160" cy={LOTUS_CORE_CY} rx="8" ry="10" fill={`url(#lm-${uid})`} />
    </svg>
  );
}
