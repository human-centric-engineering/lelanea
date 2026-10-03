/**
 * The lotus, as a 3D model.
 *
 * The owner's choice from t-131's prototypes ("T5", 3 Oct 2026): a water-lily
 * bloom — four broad sepals flat on the water, then four whorls of slender
 * pointed petals rising toward a crown of orange stamens — in the mark's teals,
 * deep outside and light aqua at the heart, on lily pads and sage ripples. It
 * supersedes §6.9's flat three-tier fan.
 *
 * Each petal is a surface: boat-shaped across its width, curling inward along
 * its length, set on a ring and tilted outward by an angle the opening
 * animates from a pointed bud. `lotus-draw.ts` projects it to shapes; the
 * renderers only paint those. One model, so the animation and every still copy
 * of the mark cannot drift.
 *
 * NO COLOUR IN THIS FILE — `Colour` expressions over `--color-lotus-*` tokens
 * only. See `lotus-colour.ts`.
 *
 * World: Y up, X right, Z toward the viewer. Units: the outer petal is ~1 long.
 *
 * @see .context/app/brand-theme.md — the lotus
 */

import { mix, type Colour } from '@/components/app/ui/lotus-colour';

export type Vec3 = readonly [number, number, number];

const rad = (d: number) => (d * Math.PI) / 180;

// ---- Colour --------------------------------------------------------------

const VEIN = '--color-lotus-vein';

/** One face of a petal, base → middle → tip. */
type FaceRamp = readonly [Colour, Colour, Colour];

export interface PetalColours {
  /** The upper face, toward the flower's axis. */
  readonly inner: FaceRamp;
  /** The underside. */
  readonly outer: FaceRamp;
}

/** Pale at the base, deepest at the tip; each whorl a step deeper than the next. */
const OUTER: PetalColours = {
  inner: [VEIN, '--color-lotus-petal-mid', '--color-lotus-petal-outer'],
  outer: ['--color-lotus-petal-mid', '--color-lotus-petal-outer', '--color-lotus-petal-outer-edge'],
};
const MID: PetalColours = {
  inner: [VEIN, '--color-lotus-petal-inner', '--color-lotus-petal-outer'],
  outer: ['--color-lotus-petal-inner', '--color-lotus-petal-mid', '--color-lotus-petal-outer'],
};
const INNER: PetalColours = {
  inner: [VEIN, '--color-lotus-petal-inner', '--color-lotus-petal-mid'],
  outer: [VEIN, '--color-lotus-petal-inner', '--color-lotus-petal-mid'],
};

/** Shadows fall toward this rather than black, so they read cool. */
export const LOTUS_SHADOW: Colour = '--color-lotus-petal-outer';

// ---- Petals --------------------------------------------------------------

export interface PetalWhorl {
  readonly colours: PetalColours;
  readonly count: number;
  /** Length, and half-width at the widest. */
  readonly length: number;
  readonly width: number;
  /** Tilt from vertical in degrees: in the bud, and at rest. */
  readonly tiltBud: number;
  readonly tiltOpen: number;
  /** Azimuth offset so whorls interleave. */
  readonly phase: number;
  /** Radius of the ring the petal bases sit on. */
  readonly ring: number;
  /** Milliseconds into the opening before this whorl starts to move. */
  readonly start: number;
}

/**
 * Outermost first, which is also the order they open in — physically they
 * must, or an inner petal would pass through an outer one. (§6.9's fan opened
 * inner to outer; a flat fan could, a cup cannot.)
 */
export const LOTUS_WHORLS: readonly PetalWhorl[] = [
  {
    colours: OUTER,
    count: 4,
    length: 1.0,
    width: 0.24,
    tiltBud: 14,
    tiltOpen: 97,
    phase: 45,
    ring: 0.14,
    start: 0,
  },
  {
    colours: OUTER,
    count: 8,
    length: 1.02,
    width: 0.18,
    tiltBud: 12,
    tiltOpen: 84,
    phase: 22.5,
    ring: 0.13,
    start: 160,
  },
  {
    colours: MID,
    count: 8,
    length: 0.96,
    width: 0.17,
    tiltBud: 9,
    tiltOpen: 66,
    phase: 0,
    ring: 0.11,
    start: 340,
  },
  {
    colours: INNER,
    count: 8,
    length: 0.86,
    width: 0.16,
    tiltBud: 6,
    tiltOpen: 56,
    phase: 11,
    ring: 0.09,
    start: 500,
  },
  {
    colours: INNER,
    count: 6,
    length: 0.66,
    width: 0.15,
    tiltBud: 4,
    tiltOpen: 42,
    phase: 30,
    ring: 0.07,
    start: 640,
  },
];

/** Width profile: narrow base, widest near the middle, tapering to a point. */
const SHAPE_A = 0.9;
const SHAPE_B = 1.05;
const SHAPE_PEAK =
  Math.pow(SHAPE_A / (SHAPE_A + SHAPE_B), SHAPE_A) *
  Math.pow(SHAPE_B / (SHAPE_A + SHAPE_B), SHAPE_B);

function halfWidth(u: number, width: number): number {
  if (u <= 0 || u >= 1) return 0;
  return (width * Math.pow(u, SHAPE_A) * Math.pow(1 - u, SHAPE_B)) / SHAPE_PEAK;
}

/** Lengthwise curl and cross-width cup of an open petal. */
const CURL_OPEN = 0.16;
const CUP_BUD = 0.5;
const CUP_OPEN = 0.45;
/** How irregular the flower is; 0 would be a turned bowl. */
const JITTER = 1.6;
/** The petal bases sit this far above the water. */
const BASE_Y = 0.02;

/**
 * The curl that brings a whorl's tips back to the axis in the bud, so it closes
 * to a point. Solves the tip radius (ring + L·sin t − curl·L·cos t) for zero,
 * less a hair so the tips just meet.
 */
function budCurl(w: PetalWhorl): number {
  const t = rad(w.tiltBud);
  return (w.ring / w.length + Math.sin(t)) / Math.cos(t) - 0.03;
}

// ---- Timing --------------------------------------------------------------

/** §6.5's breath easing, `cubic-bezier(0.22, 0.61, 0.36, 1)`, solved for x → y. */
export function breathEase(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bez = (t: number, a: number, b: number) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  let lo = 0;
  let hi = 1;
  let t = x;
  for (let i = 0; i < 30; i++) {
    t = (lo + hi) / 2;
    if (bez(t, 0.22, 0.36) < x) lo = t;
    else hi = t;
  }
  return bez(t, 0.61, 1);
}

/** §6.9's 2200ms, per petal. */
export const PETAL_OPEN_MS = 2200;
export const PETAL_STAGGER_MS = 55;
/** The stamen crown rises from 500ms over 1600ms. */
export const CROWN_START_MS = 500;
export const CROWN_MS = 1600;
/** The water — ripples and pads — from 300ms over 2600ms. */
export const WATER_START_MS = 300;
export const WATER_MS = 2600;

/** Eased progress of a span starting at `start` and lasting `ms`. */
export function span(now: number, start: number, ms: number): number {
  return breathEase(Math.min(1, Math.max(0, (now - start) / ms)));
}

/**
 * When the last thing stops moving. DERIVED, so a whorl gaining a petal cannot
 * reopen the gap where a caller's `onOpened` fired mid-gesture.
 */
export const LOTUS_OPENED_MS = Math.max(
  WATER_START_MS + WATER_MS,
  CROWN_START_MS + CROWN_MS,
  ...LOTUS_WHORLS.map((w) => w.start + (w.count - 1) * PETAL_STAGGER_MS + PETAL_OPEN_MS)
);

// ---- Pose ----------------------------------------------------------------

export interface PetalPose {
  readonly whorl: PetalWhorl;
  readonly azimuth: number;
  readonly tilt: number;
  readonly curl: number;
  readonly cup: number;
  readonly lengthScale: number;
}

export function petalPoses(ms: number): PetalPose[] {
  const poses: PetalPose[] = [];
  for (const whorl of LOTUS_WHORLS) {
    for (let i = 0; i < whorl.count; i++) {
      // Front and back alternately round the ring, not a sweep.
      const order = i % 2 === 0 ? i / 2 : whorl.count - 1 - (i - 1) / 2;
      const p = span(ms, whorl.start + order * PETAL_STAGGER_MS, PETAL_OPEN_MS);
      // Deterministic irregularity — the same on the server and in the browser.
      const j1 = Math.sin((i + 1) * 12.9898 + whorl.phase) * 0.5 * JITTER;
      const j2 = Math.sin((i + 3) * 78.233 + whorl.ring * 100) * 0.5 * JITTER;
      const curlBud = budCurl(whorl);
      poses.push({
        whorl,
        azimuth: whorl.phase + (360 / whorl.count) * i + j1 * 4,
        tilt: whorl.tiltBud + (whorl.tiltOpen + j1 * 5 - whorl.tiltBud) * p,
        curl: curlBud + (CURL_OPEN - curlBud) * p,
        cup: CUP_BUD + (CUP_OPEN - CUP_BUD) * p,
        lengthScale: 1 + j2 * 0.12,
      });
    }
  }
  return poses;
}

/** A point on a petal: `u` along it (0 base → 1 tip), `v` across (−1 → 1). */
export function petalPoint(pose: PetalPose, u: number, v: number): Vec3 {
  const { whorl } = pose;
  const L = whorl.length * pose.lengthScale;
  const w = halfWidth(u, whorl.width);
  // Local: spine up +Y, underside toward +Z, upper face toward the axis.
  const x = w * v;
  const y = L * u;
  const z = -L * pose.curl * u * u - pose.cup * w * v * v;
  const t = rad(pose.tilt);
  const y1 = y * Math.cos(t) - z * Math.sin(t);
  const z1 = y * Math.sin(t) + z * Math.cos(t) + whorl.ring;
  const a = rad(pose.azimuth);
  return [x * Math.cos(a) + z1 * Math.sin(a), y1 + BASE_Y, -x * Math.sin(a) + z1 * Math.cos(a)];
}

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** The underside's normal at a point on the petal. */
export function petalNormal(pose: PetalPose, u: number, v: number): Vec3 {
  const e = 0.01;
  const p0 = petalPoint(pose, u - e, v);
  const p1 = petalPoint(pose, u + e, v);
  const q0 = petalPoint(pose, u, v - e);
  const q1 = petalPoint(pose, u, v + e);
  const du: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const dv: Vec3 = [q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]];
  return normalize([
    dv[1] * du[2] - dv[2] * du[1],
    dv[2] * du[0] - dv[0] * du[2],
    dv[0] * du[1] - dv[1] * du[0],
  ]);
}

/** The face colour a petal shows at `u`, blending its ramp. */
export function faceColour(ramp: FaceRamp, u: number): Colour {
  return u <= 0.5 ? mix(ramp[0], ramp[1], u * 2) : mix(ramp[1], ramp[2], (u - 0.5) * 2);
}

// ---- Light and camera ----------------------------------------------------

/** Orthographic, looking down at the water by this many degrees. */
export const ELEVATION = 30;
export const VIEW_DIR: Vec3 = normalize([0, Math.sin(rad(ELEVATION)), Math.cos(rad(ELEVATION))]);
export const LIGHT_DIR: Vec3 = normalize([-0.45, 0.85, 0.5]);

/** Lambert plus a sky term, so faces turned up read brighter. 0.5 is neutral. */
export function lightAt(n: Vec3): number {
  return 0.25 + 0.42 * Math.max(0, dot(n, LIGHT_DIR)) + 0.33 * (0.5 + 0.5 * n[1]);
}

/** Projected: x right, y DOWN, in model units; depth grows toward the viewer. */
export function project(p: Vec3): { x: number; y: number; depth: number } {
  const e = rad(ELEVATION);
  return { x: p[0], y: -(p[1] * Math.cos(e) - p[2] * Math.sin(e)), depth: dot(p, VIEW_DIR) };
}

// ---- Stamens, pads, ripples ---------------------------------------------

export const STAMEN_COUNT = 54;

/**
 * One stamen as a polyline, base to tip, at `grow` (0 → 1): rising from the
 * heart, leaning outward the further out it starts, hooking inward at the tip.
 */
export function stamenPath(i: number, grow: number, steps = 6): Vec3[] {
  const f = (i + 0.5) / STAMEN_COUNT;
  const r0 = 0.02 + 0.13 * Math.sqrt(f);
  const a = i * 2.399963; // the golden angle, so they never line up
  const lean = rad(4 + 30 * f);
  const len = (0.3 + 0.22 * f + 0.05 * Math.sin(i * 7.1)) * grow;
  const out: Vec3[] = [];
  for (let k = 0; k <= steps; k++) {
    const s = k / steps;
    const radial = r0 + Math.sin(lean) * len * s - 0.05 * f * grow * s ** 3;
    const y = BASE_Y + 0.03 + Math.cos(lean) * len * s;
    out.push([radial * Math.cos(a), y, radial * Math.sin(a)]);
  }
  return out;
}

/** Lily pads on the water behind the flower: centre, radius, notch angle. */
export const LOTUS_PADS = [
  { x: -1.0, z: -0.85, r: 0.42, notch: 2.2 },
  { x: 1.05, z: -0.7, r: 0.38, notch: 3.6 },
  { x: 0.25, z: -1.3, r: 0.36, notch: 1.2 },
] as const;

export function padOutline(pad: (typeof LOTUS_PADS)[number], steps = 40): Vec3[] {
  const gap = 0.32;
  const out: Vec3[] = [[pad.x, -0.01, pad.z]];
  for (let k = 0; k <= steps; k++) {
    const a = pad.notch + gap / 2 + ((Math.PI * 2 - gap) * k) / steps;
    out.push([pad.x + pad.r * Math.cos(a), -0.01, pad.z + pad.r * Math.sin(a)]);
  }
  return out;
}

/** Three sage rings reading as stillness on water — kept from §6.9. */
export const LOTUS_RIPPLES = [
  { rx: 0.7, ry: 0.12, opacity: 0.55, width: 1.4, colour: '--color-lotus-ripple' },
  { rx: 1.04, ry: 0.18, opacity: 0.34, width: 1.2, colour: '--color-lotus-ripple' },
  { rx: 1.36, ry: 0.24, opacity: 0.2, width: 1.0, colour: '--color-lotus-ripple-far' },
] as const;
