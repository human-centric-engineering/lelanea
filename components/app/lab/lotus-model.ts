/**
 * A lotus as a 3D model, renderer-agnostic.
 *
 * t-131 prototype. Each petal is a cupped surface — boat-shaped across its
 * width, curling inward along its length — set on a ring around a flat-topped
 * seed pod, tilted outward by an angle that opening animates. The SVG
 * prototype projects this to paths; the Three.js prototype meshes it. One
 * model, so the static mark and the animation cannot drift.
 *
 * World: Y up, X right, Z toward the viewer. Units: the outer petal is ~1 long.
 */

export type Vec3 = readonly [number, number, number];

export interface PetalTier {
  readonly name: string;
  /** Which colouring this tier's petals take — a key of `FACES`. */
  readonly face: FaceKind;
  readonly count: number;
  /** Petal length. */
  readonly length: number;
  /** Petal half-width at its widest. */
  readonly width: number;
  /** Tilt from vertical, degrees: closed bud → open rest. */
  readonly tiltBud: number;
  readonly tiltOpen: number;
  /** Azimuth offset in degrees so tiers interleave. */
  readonly phase: number;
  /** Radius of the ring the petal bases sit on. */
  readonly ring: number;
  /** Milliseconds before this tier starts opening. */
  readonly start: number;
}

/** Outer opens first — physically it has to, or inner petals pass through it. */
const DEFAULT_TIERS: readonly PetalTier[] = [
  {
    name: 'outer',
    face: 'teal-outer',
    count: 8,
    length: 1.0,
    width: 0.4,
    tiltBud: 16,
    tiltOpen: 80,
    phase: 22.5,
    ring: 0.16,
    start: 0,
  },
  {
    name: 'mid',
    face: 'teal-mid',
    count: 8,
    length: 0.98,
    width: 0.4,
    tiltBud: 12,
    tiltOpen: 68,
    phase: 0,
    ring: 0.13,
    start: 260,
  },
  {
    name: 'inner',
    face: 'teal-inner',
    count: 6,
    length: 0.64,
    width: 0.34,
    tiltBud: 6,
    tiltOpen: 60,
    phase: 30,
    ring: 0.1,
    start: 520,
  },
];

/** Everything a variation can change about the flower and the view of it. */
export interface LotusConfig {
  readonly tiers: readonly PetalTier[];
  /** Width-profile exponents: base swell (A) and tip taper (B; > 1 = pointed). */
  readonly shapeA: number;
  readonly shapeB: number;
  /** Multiplies every tier's width. */
  readonly widthScale: number;
  /** Camera elevation in degrees above the water. */
  readonly elevation: number;
  /** Lengthwise curl of an open petal. */
  readonly curlOpen: number;
  /** pod: the lotus seed head. stamens: a water lily's crown of orange stamens. */
  readonly centre: 'pod' | 'stamens';
  /** Lily pads on the water. */
  readonly pads: boolean;
  /** Per-petal irregularity, 0 = turned bowl. */
  readonly jitter: number;
  /** Cross-width cupping of an open petal. */
  readonly cupOpen: number;
  /** Light intensity multiplier — white petals want less than teal ones. */
  readonly exposure: number;
  /** The token shadows fall toward (and the 3D sky's ground colour). */
  readonly shadowTone: string;
}

export const DEFAULT_CONFIG: LotusConfig = {
  tiers: DEFAULT_TIERS,
  shapeA: 0.72,
  shapeB: 1.15,
  widthScale: 1,
  elevation: 38,
  curlOpen: 0.26,
  centre: 'pod',
  pads: false,
  jitter: 1,
  cupOpen: 0.38,
  exposure: 1,
  shadowTone: '--color-lotus-petal-outer',
};

/** Build a config from overrides; `tierOverrides` patch tiers by name. */
export function lotusConfig(
  over: Partial<LotusConfig> & {
    tierOverrides?: Partial<Record<string, Partial<PetalTier>>>;
  } = {}
): LotusConfig {
  const { tierOverrides, tiers, ...rest } = over;
  return {
    ...DEFAULT_CONFIG,
    ...rest,
    tiers: (tiers ?? DEFAULT_TIERS).map((t) => ({ ...t, ...(tierOverrides?.[t.name] ?? {}) })),
  };
}

export const TIERS = DEFAULT_TIERS;

export const PETAL_STAGGER = 55;
export const PETAL_OPEN_MS = 2200;

/** Seed pod: a short frustum with a flat top. */
export const POD = { top: 0.24, bottom: 0.02, radiusTop: 0.23, radiusBottom: 0.13 } as const;
export const STAMEN_COUNT = 40;

/**
 * Width profile: narrow base, widest a little below the middle, tapering
 * to a pointed tip (ovate–acuminate, as a real lotus petal). `B` > 1 makes the
 * flanks run concave into the point rather than rounding over it.
 */
export function petalHalfWidth(
  u: number,
  width: number,
  cfg: LotusConfig = DEFAULT_CONFIG
): number {
  if (u <= 0 || u >= 1) return 0;
  const A = cfg.shapeA;
  const B = cfg.shapeB;
  const peak = Math.pow(A / (A + B), A) * Math.pow(B / (A + B), B);
  return (cfg.widthScale * width * Math.pow(u, A) * Math.pow(1 - u, B)) / peak;
}

/** §6.5's breath easing, solved for x → y. */
export function breathEase(x: number): number {
  return cubicBezier(0.22, 0.61, 0.36, 1, x);
}

function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bez = (t: number, a: number, b: number) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  let lo = 0;
  let hi = 1;
  let t = x;
  for (let i = 0; i < 30; i++) {
    t = (lo + hi) / 2;
    if (bez(t, x1, x2) < x) lo = t;
    else hi = t;
  }
  return bez(t, y1, y2);
}

/** How open one petal is (0 bud → 1 rest) at `ms` into the opening. */
export function petalProgress(tier: PetalTier, index: number, ms: number): number {
  const local = (ms - tier.start - index * PETAL_STAGGER) / PETAL_OPEN_MS;
  return breathEase(Math.min(1, Math.max(0, local)));
}

/** The last petal settles here. */
export function openedMs(cfg: LotusConfig = DEFAULT_CONFIG): number {
  return Math.max(...cfg.tiers.map((t) => t.start + (t.count - 1) * PETAL_STAGGER + PETAL_OPEN_MS));
}
export const OPENED_MS = openedMs();

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * The curl that brings a tier's tips back to the axis in the bud, so the bud
 * closes to a point instead of a cut-off cylinder. Solves the tip's radius
 * (ring + L·sin t − curl·L·cos t) for zero, less a hair so tips just meet.
 */
function budCurl(tier: PetalTier): number {
  const t = rad(tier.tiltBud);
  return (tier.ring / tier.length + Math.sin(t)) / Math.cos(t) - 0.03;
}

export interface PetalPose {
  readonly cfg: LotusConfig;
  readonly tier: PetalTier;
  readonly index: number;
  readonly azimuth: number;
  readonly tilt: number;
  /** Lengthwise inward curl; relaxes a little as the petal opens. */
  readonly curl: number;
  /** Cross-width cupping. */
  readonly cup: number;
  /** Per-petal length variation. */
  readonly lengthScale: number;
  readonly progress: number;
}

export function petalPoses(ms: number, cfg: LotusConfig = DEFAULT_CONFIG): PetalPose[] {
  const poses: PetalPose[] = [];
  for (const tier of cfg.tiers) {
    for (let i = 0; i < tier.count; i++) {
      // Open front-to-back alternately round the ring, not in a sweep.
      const order = i % 2 === 0 ? i / 2 : tier.count - 1 - (i - 1) / 2;
      const p = petalProgress(tier, order, ms);
      // Slight per-petal irregularity: a real flower is not a turned bowl.
      const jitter = Math.sin((i + 1) * 12.9898 + tier.phase) * 0.5 * cfg.jitter;
      const jitter2 = Math.sin((i + 3) * 78.233 + tier.ring * 100) * 0.5 * cfg.jitter;
      poses.push({
        cfg,
        tier,
        index: i,
        azimuth: tier.phase + (360 / tier.count) * i + jitter * 4,
        tilt: tier.tiltBud + (tier.tiltOpen + jitter * 5 - tier.tiltBud) * p,
        curl: budCurl(tier) + (cfg.curlOpen - budCurl(tier)) * p,
        cup: 0.5 + (cfg.cupOpen - 0.5) * p,
        lengthScale: 1 + jitter2 * 0.12,
        progress: p,
      });
    }
  }
  return poses;
}

/** A point on a petal: u along its length (0 base → 1 tip), v across (−1 → 1). */
export function petalPoint(pose: PetalPose, u: number, v: number): Vec3 {
  const { tier } = pose;
  const L = tier.length * pose.lengthScale;
  const w = petalHalfWidth(u, tier.width, pose.cfg);
  // Local: spine up +Y, outer face toward +Z, inner face toward the axis (−Z).
  const x = w * v;
  const y = L * u;
  const z = -L * pose.curl * u * u - pose.cup * w * v * v;
  // Tilt outward about X (toward +Z).
  const t = rad(pose.tilt);
  const y1 = y * Math.cos(t) - z * Math.sin(t);
  const z1 = y * Math.sin(t) + z * Math.cos(t) + tier.ring;
  // Round the ring about Y.
  const a = rad(pose.azimuth);
  const x2 = x * Math.cos(a) + z1 * Math.sin(a);
  const z2 = -x * Math.sin(a) + z1 * Math.cos(a);
  return [x2, y1 + POD.bottom, z2];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Outward (outer-face) normal at a point on the petal. */
export function petalNormal(pose: PetalPose, u: number, v: number): Vec3 {
  const e = 0.01;
  const du = sub(petalPoint(pose, u + e, v), petalPoint(pose, u - e, v));
  const dv = sub(petalPoint(pose, u, v + e), petalPoint(pose, u, v - e));
  // du × dv points along +Z (outer face) for an untilted front petal.
  return normalize(cross(dv, du));
}

/**
 * A colour as tokens: `a`, optionally mixed toward `b` by `t` (0 = all a).
 * 'white' and 'black' are allowed as well as `--color-*` token names. Each
 * renderer turns it into its own form — CSS `color-mix()` for SVG, a lerped
 * `THREE.Color` for WebGL — so neither needs a literal.
 */
export interface Mix {
  readonly a: string;
  readonly b?: string;
  readonly t?: number;
}

export interface FaceColours {
  /** Inner (upper) face: base, middle, tip. */
  readonly inner: readonly [Mix, Mix, Mix];
  /** Outer (under) face: base, middle, tip. */
  readonly outer: readonly [Mix, Mix, Mix];
  readonly edge: string;
}

const tok = (a: string, b?: string, t?: number): Mix => ({ a, b, t });
const VEIN = '--color-lotus-vein';

/**
 * Petal colours by face kind. The teal kinds are pale at the base and deepest
 * at the tip. `white` is the reference photo's water-lily petal: white, cool in
 * shadow, warmed at the base by the stamens. `sepal` is its broad outer leaf,
 * pale inside and warm brown-teal beneath.
 */
export const FACES: Record<string, FaceColours> = {
  'teal-outer': {
    inner: [tok(VEIN), tok('--color-lotus-petal-mid'), tok('--color-lotus-petal-outer')],
    outer: [
      tok('--color-lotus-petal-mid'),
      tok('--color-lotus-petal-outer'),
      tok('--color-lotus-petal-outer-edge'),
    ],
    edge: '--color-lotus-petal-outer-edge',
  },
  'teal-mid': {
    inner: [tok(VEIN), tok('--color-lotus-petal-inner'), tok('--color-lotus-petal-outer')],
    outer: [
      tok('--color-lotus-petal-inner'),
      tok('--color-lotus-petal-mid'),
      tok('--color-lotus-petal-outer'),
    ],
    edge: '--color-lotus-petal-mid-edge',
  },
  'teal-inner': {
    inner: [tok(VEIN), tok('--color-lotus-petal-inner'), tok('--color-lotus-petal-mid')],
    outer: [tok(VEIN), tok('--color-lotus-petal-inner'), tok('--color-lotus-petal-mid')],
    edge: '--color-lotus-petal-inner-edge',
  },
  white: {
    inner: [
      tok('--color-lotus-core-light', 'white', 0.55),
      tok('white', VEIN, 0.12),
      tok('white', VEIN, 0.06),
    ],
    outer: [tok(VEIN, 'white', 0.3), tok('white', VEIN, 0.35), tok('white', VEIN, 0.22)],
    edge: VEIN,
  },
  'white-tipped': {
    inner: [
      tok('--color-lotus-core-light', 'white', 0.55),
      tok('white', VEIN, 0.15),
      tok('--color-lotus-petal-inner', 'white', 0.2),
    ],
    outer: [
      tok(VEIN, 'white', 0.3),
      tok('white', VEIN, 0.4),
      tok('--color-lotus-petal-mid', 'white', 0.2),
    ],
    edge: VEIN,
  },
  sepal: {
    inner: [tok(VEIN, 'white', 0.4), tok('white', VEIN, 0.3), tok('white', VEIN, 0.2)],
    outer: [
      tok('--color-lotus-petal-outer'),
      tok('--color-lotus-petal-outer', '--color-lotus-core-deep', 0.55),
      tok('--color-lotus-core', '--color-lotus-core-deep', 0.4),
    ],
    edge: '--color-lotus-petal-outer-edge',
  },
};

/**
 * Blends of the teal mark and the white water lily (owner: "T1 and R1 look
 * good — a blend of both"), one per tier tone. `X` is the tier's teal.
 *   tip   — white body warmed at the base, the tier's teal at the tip.
 *   under — white upper face, the tier's teal underneath.
 *   half  — a pastel: white and the tier's teal half and half.
 */
const TONES = {
  outer: '--color-lotus-petal-outer',
  mid: '--color-lotus-petal-mid',
  inner: '--color-lotus-petal-inner',
} as const;
const WARM = tok('--color-lotus-core-light', 'white', 0.55);
for (const [tone, X] of Object.entries(TONES)) {
  const teal = FACES[`teal-${tone}`];
  FACES[`tip-${tone}`] = {
    inner: [WARM, tok('white', VEIN, 0.15), tok(X, 'white', 0.15)],
    outer: [tok(VEIN, 'white', 0.3), tok('white', X, 0.45), tok(X)],
    edge: teal.edge,
  };
  FACES[`under-${tone}`] = {
    inner: [WARM, tok('white', VEIN, 0.12), tok('white', VEIN, 0.06)],
    outer: teal.outer,
    edge: teal.edge,
  };
  FACES[`half-${tone}`] = {
    inner: [WARM, tok(X, 'white', 0.6), tok(X, 'white', 0.35)],
    outer: [tok(X, 'white', 0.45), tok(X, 'white', 0.25), tok(X)],
    edge: teal.edge,
  };
}

export type FaceKind = string;

/** Shadows go toward this rather than black: cool, as in the reference. */
export const SHADOW_TOKEN = '--color-lotus-petal-outer-edge';

/**
 * One stamen as a polyline from its base to its tip, at `grow` (0 → 1).
 * Rises from a small disc, leans outward more the further out it starts, and
 * curls back inward at the tip — the water lily's crown.
 */
export const STAMEN_CROWN = 54;
export function stamenPath(i: number, grow: number, steps = 6): Vec3[] {
  const golden = 2.399963;
  const f = (i + 0.5) / STAMEN_CROWN; // 0 centre → 1 edge
  const r0 = 0.02 + 0.13 * Math.sqrt(f);
  const a = i * golden;
  const lean = rad(4 + 30 * f);
  const len = (0.3 + 0.22 * f + 0.05 * Math.sin(i * 7.1)) * grow;
  const out: Vec3[] = [];
  for (let k = 0; k <= steps; k++) {
    const s = k / steps;
    // Outward lean, then a hook back toward the axis near the tip.
    const radial = r0 + Math.sin(lean) * len * s - 0.05 * f * grow * s ** 3;
    const y = POD.bottom + 0.03 + Math.cos(lean) * len * s;
    out.push([radial * Math.cos(a), y, radial * Math.sin(a)]);
  }
  return out;
}

/** A lily pad: a flat disc on the water with its notch, as an outline. */
export const PADS = [
  { x: -1.0, z: -0.85, r: 0.42, notch: 2.2 },
  { x: 1.05, z: -0.7, r: 0.38, notch: 3.6 },
  { x: 0.25, z: -1.3, r: 0.36, notch: 1.2 },
] as const;
export function padOutline(pad: (typeof PADS)[number], steps = 48): Vec3[] {
  const out: Vec3[] = [[pad.x, -0.01, pad.z]];
  const gap = 0.32;
  for (let k = 0; k <= steps; k++) {
    const a = pad.notch + gap / 2 + ((Math.PI * 2 - gap) * k) / steps;
    out.push([pad.x + pad.r * Math.cos(a), -0.01, pad.z + pad.r * Math.sin(a)]);
  }
  return out;
}

/** Back-compat for the earlier variants. */
export const FACE = FACES;

/** The camera: orthographic, looking down by `elevation` degrees. */
export function viewDir(cfg: LotusConfig = DEFAULT_CONFIG): Vec3 {
  return normalize([0, Math.sin(rad(cfg.elevation)), Math.cos(rad(cfg.elevation))]);
}
export const VIEW_DIR: Vec3 = viewDir();
export const LIGHT_DIR: Vec3 = normalize([-0.45, 0.85, 0.5]);

/** Screen coordinates (x right, y DOWN) and depth (bigger = nearer). */
export function project(
  p: Vec3,
  cfg: LotusConfig = DEFAULT_CONFIG
): { x: number; y: number; depth: number } {
  const e = rad(cfg.elevation);
  const up = p[1] * Math.cos(e) - p[2] * Math.sin(e);
  return { x: p[0], y: -up, depth: dot(p, viewDir(cfg)) };
}
