/**
 * The lotus as points of light: where every dot sits, and when.
 *
 * A port of the prism prototype's "DOT LOTUS" geometry
 * (`.context/app/planning/design/prism/index.html`). The prototype reads its
 * petals off the flat, front-on lotus SVG on its page — three rings of petals,
 * each one path rotated about the base — and traces them in stardust: dots
 * evenly spaced along each outline, a fainter inner echo, a vein, and a
 * seed-head heart. `PETALS` is that SVG's petals, verbatim, and
 * `public/dot-lotus.svg` is the SVG itself, so the dots trace the very flower
 * the image shows.
 *
 * Pure, so it is tested directly: jsdom has no canvas.
 *
 * Units are the prototype's SVG user units: the flower's view box is `VIEW`,
 * y down, its base at the origin.
 *
 * @see components/app/ui/dot-lotus-paint.ts — the painter
 */

export type Point = readonly [number, number];

/** The SVG's view box: the open flower and its water. */
export const VIEW = { x: -84, y: -106, width: 168, height: 160 } as const;

// ---- Timeline ------------------------------------------------------------

/**
 * The prototype's timeline, in seconds. The petals unfurl outer ring first,
 * the heart gathers, the water settles, and then the flow begins: the heart
 * beats lub-dub every `BEAT`, each beat sending a ring of dots across the
 * pond, and loose dots stream from the petals and drift away.
 */
export const TIMELINE = {
  /** How long one petal's dots take to arrive. */
  PETAL: 1.65,
  /** Between one ring starting and the next. */
  RING_GAP: 0.29,
  /** Between petals within a ring. */
  PETAL_GAP: 0.088,
  HEART_AT: 1.7,
  WATER_AT: 2.05,
  FLOW_AT: 2.4,
  BEAT: 3.4,
  /** How long a pond ring takes to cross the water and fade. */
  POND_LIFE: 9,
} as const;

/**
 * The still frame reduced motion is shown: long enough that everything has
 * arrived, and nothing after it moves.
 */
export const REST_T = 30;

export type Phase = 'unfurl' | 'gather' | 'settle' | 'beat';

/** Which part of the timeline is playing `t` seconds in. */
export function phaseAt(t: number): Phase {
  if (t < TIMELINE.HEART_AT) return 'unfurl';
  if (t < TIMELINE.WATER_AT) return 'gather';
  if (t < TIMELINE.FLOW_AT) return 'settle';
  return 'beat';
}

/** One heartbeat's shape over `s` seconds into it: a lub, then a softer dub. */
export function lubdub(s: number): number {
  return Math.exp(-(((s - 0.06) / 0.065) ** 2)) + 0.62 * Math.exp(-(((s - 0.34) / 0.075) ** 2));
}

export const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const easeOut = (p: number): number => 1 - (1 - p) ** 3;

export interface Beat {
  readonly on: boolean;
  /** Seconds into the current beat. */
  readonly t: number;
  /** Which beat this is, from 0; -1 before the first. */
  readonly n: number;
  /** How far the beat has grown in, 0 → 1 over its first seconds. */
  readonly env: number;
  /** The heart's own pulse now: `lubdub`, scaled by `env`. */
  readonly pulse: number;
}

export function beatAt(t: number): Beat {
  const since = t - TIMELINE.FLOW_AT;
  if (since <= 0) return { on: false, t: 0, n: -1, env: 0, pulse: 0 };
  const env = clamp(since / 2.5);
  const into = since % TIMELINE.BEAT;
  return {
    on: true,
    t: into,
    n: Math.floor(since / TIMELINE.BEAT),
    env,
    pulse: lubdub(into) * env,
  };
}

/** Seeded, so the flower is laid out and twinkles the same way on every load. */
export function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Spacing -------------------------------------------------------------

/**
 * Points evenly spaced along a polyline, from its first point, carrying the
 * remainder round each corner — the prototype's own spacing, so the dots fall
 * where its dots fall. The last point is included only where a step lands on
 * it, which on a closed outline is where the first dot already is.
 */
export function spaced(points: readonly Point[], gap: number): Point[] {
  const out: Point[] = [];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const len = Math.hypot(bx - ax, by - ay);
    let at = carry;
    while (at < len) {
      const t = at / len;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      at += gap;
    }
    carry = at - len;
  }
  return out;
}

/** Even–odd point-in-polygon. */
export function insidePolygon(x: number, y: number, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---- The flower ----------------------------------------------------------

/** A petal of the SVG: its path, drawn upright, and how far it is turned. */
export interface Petal {
  readonly d: string;
  /** Radians, clockwise from upright. */
  readonly angle: number;
  /** 0 the outer ring, 2 the inner. */
  readonly ring: number;
  /** Its place within its ring, in paint order. */
  readonly index: number;
}

const petal = (length: number, ...c: number[]) =>
  `M0,0 C${c[0]},${-c[1]} ${c[2]},${-c[3]} ${c[4]},${-c[5]} ` +
  `C${c[4]},${-c[6]} ${c[7]},${-c[8]} 0,${-length} ` +
  `C${-c[7]},${-c[8]} ${-c[4]},${-c[6]} ${-c[4]},${-c[5]} ` +
  `C${-c[2]},${-c[3]} ${-c[0]},${-c[1]} 0,0 Z`;

/** Each petal shape of the SVG, by ring: [length, control points…]. */
const SHAPES = {
  outerTop: petal(99, 11.3, 11.9, 18.6, 30.7, 18.8, 55.4, 79.2, 9.8, 92.1),
  outer25: petal(90.4, 10.3, 10.8, 17.0, 28.0, 17.2, 50.6, 72.3, 8.9, 84.0),
  outer48: petal(77.8, 8.9, 9.3, 14.6, 24.1, 14.8, 43.6, 62.3, 7.7, 72.4),
  outer68: petal(70.7, 8.1, 8.5, 13.3, 21.9, 13.4, 39.6, 56.5, 7.0, 65.7),
  mid13: petal(77, 9.5, 9.2, 15.6, 23.9, 15.8, 43.1, 61.6, 8.2, 71.7),
  mid37: petal(66.8, 8.2, 8.0, 13.6, 20.7, 13.7, 37.4, 53.4, 7.1, 62.1),
  mid60: petal(58.4, 7.2, 7.0, 11.9, 18.1, 12.0, 32.7, 46.7, 6.2, 54.3),
  innerTop: petal(59.4, 8.2, 7.1, 13.5, 18.4, 13.7, 33.3, 47.5, 7.1, 55.2),
  inner24: petal(54.6, 7.5, 6.5, 12.4, 16.9, 12.5, 30.6, 43.6, 6.5, 50.7),
  inner48: petal(46.7, 6.4, 5.6, 10.6, 14.5, 10.7, 26.1, 37.4, 5.6, 43.4),
};

const DEG = Math.PI / 180;

/** The SVG's petals in its paint order: outer ring, then middle, then inner. */
export const PETALS: readonly Petal[] = (
  [
    [SHAPES.outerTop, 0, 0],
    [SHAPES.outer25, 25, 0],
    [SHAPES.outer25, -25, 0],
    [SHAPES.outer48, 48, 0],
    [SHAPES.outer48, -48, 0],
    [SHAPES.outer68, 68, 0],
    [SHAPES.outer68, -68, 0],
    [SHAPES.mid13, 13, 1],
    [SHAPES.mid13, -13, 1],
    [SHAPES.mid37, 37, 1],
    [SHAPES.mid37, -37, 1],
    [SHAPES.mid60, 60, 1],
    [SHAPES.mid60, -60, 1],
    [SHAPES.innerTop, 0, 2],
    [SHAPES.inner24, 24, 2],
    [SHAPES.inner24, -24, 2],
    [SHAPES.inner48, 48, 2],
    [SHAPES.inner48, -48, 2],
  ] as const
).map(([d, degrees, ring], i, all) => ({
  d,
  angle: degrees * DEG,
  ring,
  index: all.slice(0, i).filter((p) => p[2] === ring).length,
}));

/** The heart's centre: the seed head sits a little above the petal bases. */
export const HEART: Point = [0, -5];
/** Where the pond's rings are centred: the water line beneath the flower. */
export const POND_Y = 14;
/** A dot inside this radius of the heart is behind the seed head. */
const HEART_COVER = 15.5;

/** The seed head: rings of `count` dots at `radius`, centre outward. */
export const HEART_RINGS: readonly (readonly [radius: number, count: number])[] = [
  [0, 1],
  [3.2, 7],
  [6.4, 13],
  [9.6, 19],
  [12.8, 25],
];

const bezier = (a: number, b: number, c: number, d: number, t: number) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};

/** A petal's outline as a dense polyline, 40 samples to each cubic segment. */
export function outline(d: string): Point[] {
  const n = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const out: Point[] = [];
  let x = n[0];
  let y = n[1];
  for (let i = 2; i + 5 < n.length; i += 6) {
    for (let k = 1; k <= 40; k++) {
      const t = k / 40;
      out.push([
        bezier(x, n[i], n[i + 2], n[i + 4], t),
        bezier(y, n[i + 1], n[i + 3], n[i + 5], t),
      ]);
    }
    x = n[i + 4];
    y = n[i + 5];
  }
  return out;
}

const turn = ([x, y]: Point, angle: number): Point => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c];
};

export type DotKind = 'edge' | 'echo' | 'vein' | 'heart';

/** A dot of the flower: where it sits, how it looks, when it arrives. */
export interface Dot {
  readonly kind: DotKind;
  /** The petal it sits on, an index into `PETALS`; -1 for the heart. */
  readonly petal: number;
  /**
   * Where it sits on its petal drawn upright (for the heart, from the heart's
   * centre). The petal turns to `angle` as it opens.
   */
  readonly lx: number;
  readonly ly: number;
  readonly angle: number;
  /** Which `--dot-*` tone: 0–2 petal, outer ring to inner; 3–5 heart. */
  readonly tone: number;
  /** Radius, in units (the sprite is sized from it). */
  readonly r: number;
  /** Resting brightness. */
  readonly base: number;
  /** When it starts to arrive, in seconds. */
  readonly delay: number;
  /** Where it starts from, off its place, as it arrives. */
  readonly jx: number;
  readonly jy: number;
  /** Its twinkle's rate and phase, and its flare's. */
  readonly w: number;
  readonly ph: number;
  readonly fw: number;
  readonly fph: number;
  /** Whether it ever flares into a star. */
  readonly flare: boolean;
  /** For the heart's rings: which ring, from the centre. */
  readonly ring?: number;
}

/** Where a dot sits in the open flower. */
export function restingAt(d: Dot): Point {
  if (d.kind === 'heart') return [HEART[0] + d.lx, HEART[1] + d.ly];
  return turn([d.lx, d.ly], d.angle);
}

/**
 * The dotted flower, open. Painter's order is kept the way the SVG paints it:
 * a dot is dropped where a petal painted after it, or the seed head, covers
 * it, so back petals tuck behind front ones. The random draws are taken in
 * the prototype's order, from its seed, so every dot lands, twinkles and
 * flares as the prototype's does.
 */
export function dotFlower(): Dot[] {
  const R = rng(20261101);
  const outlines = PETALS.map((p) => outline(p.d));
  const dots: Dot[] = [];

  const hidden = (from: number, x: number, y: number) => {
    if (Math.hypot(x - HEART[0], y - HEART[1]) < HEART_COVER) return true;
    for (let j = from + 1; j < PETALS.length; j++) {
      const [px, py] = turn([x, y], -PETALS[j].angle);
      if (insidePolygon(px, py, outlines[j])) return true;
    }
    return false;
  };

  PETALS.forEach((p, i) => {
    const add = ([lx, ly]: Point, kind: DotKind, r: number, base: number) => {
      const [x, y] = turn([lx, ly], p.angle);
      if (hidden(i, x, y)) return;
      dots.push({
        kind,
        petal: i,
        lx,
        ly,
        angle: p.angle,
        tone: p.ring,
        delay: p.ring * TIMELINE.RING_GAP + p.index * TIMELINE.PETAL_GAP + R() * 0.12,
        jx: (R() * 2 - 1) * 4,
        jy: (R() * 2 - 1) * 4,
        r,
        base,
        w: 0.6 + R() * 1.8,
        ph: R() * Math.PI * 2,
        fw: 0.05 + R() * 0.12,
        fph: R() * Math.PI * 2,
        flare: kind === 'edge' && R() < 0.35,
      });
    };
    const line = outlines[i];
    for (const pt of spaced(line, 2.5)) add(pt, 'edge', 0.9, 1);
    // The inner echo: the outline drawn again at 62%, from the base.
    const echo = line.map(([x, y]): Point => [x * 0.62, y * 0.62 - 4]);
    for (const pt of spaced(echo, 4.2)) add(pt, 'echo', 0.6, 0.45);
    // The vein, from the base to just short of the tip.
    const tip = line.reduce((a, q) => (q[1] < a[1] ? q : a), [0, 0] as Point);
    for (let v = 0.12; v < 0.9; v += 3.6 / Math.abs(tip[1]))
      add([0, tip[1] * v], 'vein', 0.56, 0.55);
  });

  HEART_RINGS.forEach(([radius, count], k) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + k * 0.4;
      dots.push({
        kind: 'heart',
        petal: -1,
        lx: Math.cos(a) * radius,
        ly: Math.sin(a) * radius,
        angle: 0,
        tone: k < 2 ? 3 : k < 4 ? 4 : 5,
        delay: TIMELINE.HEART_AT + k * 0.08,
        jx: 0,
        jy: 0,
        r: k === HEART_RINGS.length - 1 ? 0.75 : 0.62,
        base: 1,
        w: 1 + R() * 2,
        ph: R() * Math.PI * 2,
        fw: 0.08 + R() * 0.1,
        fph: R() * Math.PI * 2,
        flare: k === 0,
        ring: k,
      });
    }
  });

  return dots;
}

/**
 * Each petal's tip in the open flower, where the beat lets go of a star: the
 * highest outline dot of each petal that has any in view.
 */
export function petalTips(dots: readonly Dot[]): Point[] {
  const tips = new Map<number, Dot>();
  for (const d of dots) {
    if (d.kind !== 'edge') continue;
    const best = tips.get(d.petal);
    if (!best || d.ly < best.ly) tips.set(d.petal, d);
  }
  return [...tips.values()].map(restingAt);
}

/**
 * Where a petal dot is `t` seconds in, before the flower's breath and beat:
 * it grows from a quarter size and swings from upright to its petal's angle,
 * settling from a little off its place, as the SVG bloom unfurls.
 */
export function unfurledAt(d: Dot, t: number): Point {
  const e = easeOut(clamp((t - d.delay) / TIMELINE.PETAL));
  const scale = 0.24 + 0.76 * e;
  return turn([d.lx * scale + d.jx * (1 - e), d.ly * scale + d.jy * (1 - e)], d.angle * e);
}
