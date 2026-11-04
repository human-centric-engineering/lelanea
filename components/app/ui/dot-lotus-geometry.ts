/**
 * The lotus as points of light: where every dot sits, and when.
 *
 * The prism prototype draws its flower in stardust — dots evenly spaced along
 * each petal's outline, a fainter inner echo, a vein, a seed-head heart — and
 * reads the petals from the SVG on its page so it never hand-copies a second
 * flower (`.context/app/planning/design/prism/index.html`, "DOT LOTUS"). The
 * equivalent here is the 3D model in `lotus-model.ts`: every petal dot is a
 * point on a model petal, named by its surface coordinates (`u` along, `v`
 * across), so it is the same flower by construction. It also means the
 * unfolding is the model's own opening — the prototype's flat fan swings each
 * petal up from upright, which a cup seen from above cannot do.
 *
 * Pure, so it is tested directly: jsdom has no canvas.
 *
 * Units are the draw list's (`lotus-draw.ts`): SVG user units, 100 to a model
 * unit, y down. The prototype's numbers are in ITS units, where the flower is
 * 168 wide; `K` converts them, so every distance and speed it tuned carries
 * over at the same proportion to the flower.
 *
 * @see components/app/ui/dot-lotus-paint.ts — the painter
 */

import {
  LOTUS_OPENED_MS,
  LOTUS_WHORLS,
  VIEW_DIR,
  dot,
  petalPoint,
  petalPoses,
  project,
  type PetalPose,
} from '@/components/app/ui/lotus-model';

export type Point = readonly [number, number];

const S = 100;

/** Our units per prototype unit: the open bloom is ~222 here, ~168 there. */
export const K = 1.3;

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
  /** Between one whorl starting and the next. */
  RING_GAP: 0.29,
  /** Between petals within a whorl. */
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

// ---- Spacing -------------------------------------------------------------

export interface Spaced {
  readonly x: number;
  readonly y: number;
  /** Where on the polyline: segment index plus the fraction along it. */
  readonly at: number;
}

/**
 * Points evenly spaced along a polyline, both ends included. The step is the
 * gap rounded so it divides the length exactly — the last dot lands on the
 * last point rather than wherever the remainder falls.
 */
export function spaced(points: readonly Point[], gap: number): Spaced[] {
  if (points.length === 0) return [];
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    lengths.push(l);
    total += l;
  }
  if (total === 0) return [{ x: points[0][0], y: points[0][1], at: 0 }];

  const n = Math.max(1, Math.round(total / gap));
  const step = total / n;
  const out: Spaced[] = [];
  let segment = 0;
  let before = 0;
  for (let k = 0; k <= n; k++) {
    const target = k === n ? total : k * step;
    while (segment < lengths.length - 1 && before + lengths[segment] < target) {
      before += lengths[segment];
      segment++;
    }
    const f = lengths[segment] === 0 ? 0 : Math.min(1, (target - before) / lengths[segment]);
    const [ax, ay] = points[segment];
    const [bx, by] = points[segment + 1];
    out.push({ x: ax + (bx - ax) * f, y: ay + (by - ay) * f, at: segment + f });
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

const flat = (p: readonly [number, number, number]): Point => {
  const s = project(p);
  return [s.x * S, s.y * S];
};

/**
 * The heart: the middle of the stamen crown, where the seed head sits. The
 * crown rises from the petal bases, so this is above the water, not on it.
 */
export const HEART: Point = flat([0, 0.2, 0]);

/** Where the pond's rings are centred: the water line beneath the flower. */
export const POND_Y = 4;

/** A dot inside this radius of the heart is behind the seed head. */
const HEART_COVER = 15.5 * K;

/** The seed head: rings of `count` dots at `radius`, centre outward. */
export const HEART_RINGS: readonly (readonly [radius: number, count: number])[] = [
  [0, 1],
  [3.2 * K, 7],
  [6.4 * K, 13],
  [9.6 * K, 19],
  [12.8 * K, 25],
];

export type DotKind = 'edge' | 'echo' | 'vein' | 'heart';

/** A dot's place and look, independent of time and of any random draw. */
export interface DotSite {
  readonly kind: DotKind;
  /** The petal it sits on, an index into `petalPoses()`; -1 for the heart. */
  readonly petal: number;
  /** On the petal: along (0 base → 1 tip) and across (−1 → 1). */
  readonly u: number;
  readonly v: number;
  /** Where it sits in the open flower. */
  readonly x: number;
  readonly y: number;
  /** Which `--dot-*` tone: 0–2 petal, outer to inner; 3–5 heart; 6 water. */
  readonly tone: number;
  /** Radius, in prototype units (the sprite is sized from it). */
  readonly r: number;
  /** Resting brightness. */
  readonly base: number;
  /** When it starts to arrive, in seconds. */
  readonly delay: number;
  /** For the heart's rings: which ring, from the centre. */
  readonly ring?: number;
}

/** The heart's rings as dots, relative to the heart. */
export function heartDots(): DotSite[] {
  const out: DotSite[] = [];
  HEART_RINGS.forEach(([radius, count], k) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + k * 0.4;
      out.push({
        kind: 'heart',
        petal: -1,
        u: 0,
        v: 0,
        x: HEART[0] + Math.cos(a) * radius,
        y: HEART[1] + Math.sin(a) * radius,
        tone: k < 2 ? 3 : k < 4 ? 4 : 5,
        r: k === HEART_RINGS.length - 1 ? 0.75 : 0.62,
        base: 1,
        delay: TIMELINE.HEART_AT + k * 0.08,
        ring: k,
      });
    }
  });
  return out;
}

/** Samples along a petal's length when tracing it. */
const DENSE = 32;

interface Sample {
  readonly u: number;
  readonly v: number;
  readonly p: Point;
}

type Path = readonly (readonly [u: number, v: number])[];

/** A path over the petal's surface, projected. */
function trace(pose: PetalPose, path: Path): Sample[] {
  return path.map(([u, v]) => ({ u, v, p: flat(petalPoint(pose, u, v)) }));
}

/**
 * Evenly spaced along a traced path, each dot then set on the petal's surface
 * at its (u, v) — so where it rests is exactly where the moving model brings
 * it, and nothing jumps when the opening ends.
 */
function spacedOn(pose: PetalPose, samples: readonly Sample[], gap: number) {
  return spaced(
    samples.map((s) => s.p),
    gap
  ).map((d) => {
    const i = Math.min(samples.length - 2, Math.floor(d.at));
    const f = d.at - i;
    const a = samples[i];
    const b = samples[i + 1];
    const u = a.u + (b.u - a.u) * f;
    const v = a.v + (b.v - a.v) * f;
    const [x, y] = flat(petalPoint(pose, u, v));
    return { x, y, u, v };
  });
}

const steps = (from: number, to: number, v: number): Path =>
  Array.from({ length: DENSE + 1 }, (_, k) => [from + ((to - from) * k) / DENSE, v] as const);
const across = (u: number, from: number, to: number): Path =>
  Array.from(
    { length: DENSE / 4 + 1 },
    (_, k) => [u, from + ((to - from) * k * 4) / DENSE] as const
  );

/**
 * Round a petal: base up the left edge to the tip, back down the right. Each
 * edge is sampled on its own, so a dot is never placed by blending one edge
 * with the other. The loop ends where it began, at the base.
 */
const OUTLINE: Path = [...steps(0, 1, -1), ...steps(1, 0, 1)];
/** The inner echo: the outline again, smaller, from the base. */
const ECHO: Path = [
  ...steps(0.04, 0.66, -0.62),
  ...across(0.66, -0.62, 0.62),
  ...steps(0.66, 0.04, 0.62),
];
/** The vein, from just above the base to just short of the tip. */
const VEIN: Path = steps(0.12, 0.9, 0);

/** How near the tip, along the petal, a dot must be to count as its tip. */
const TIP_U = 0.95;

export interface Flower {
  /** Every dot of the open flower, petals in paint order, then the heart. */
  readonly dots: readonly DotSite[];
  /** Each petal's outline in the open flower, in paint order. */
  readonly outlines: readonly (readonly Point[])[];
  /** The petal index (into `petalPoses()`) painted at each position. */
  readonly order: readonly number[];
}

/**
 * The dotted flower, open. Painter's order is kept the way the prototype keeps
 * it: a dot is dropped where a petal painted after it, or the seed head, would
 * cover it, so back petals tuck behind front ones.
 */
export function dotFlower(): Flower {
  const poses = petalPoses(LOTUS_OPENED_MS);
  const whorlOf: number[] = [];
  const orderInWhorl: number[] = [];
  LOTUS_WHORLS.forEach((w, wi) => {
    for (let i = 0; i < w.count; i++) {
      whorlOf.push(wi);
      // The model's own front-and-back alternation, so dots arrive in the
      // same order the petals open.
      orderInWhorl.push(i % 2 === 0 ? i / 2 : w.count - 1 - (i - 1) / 2);
    }
  });

  const order = poses
    .map((pose, i) => ({ i, depth: dot(petalPoint(pose, 0.5, 0), VIEW_DIR) }))
    .sort((a, b) => a.depth - b.depth)
    .map((entry) => entry.i);
  const outlines = order.map((i) =>
    trace(poses[i], OUTLINE)
      .slice(0, -1)
      .map((s) => s.p)
  );

  // Each outline's bounding box, so most petals are ruled out with four
  // comparisons rather than a walk round every edge: built cold, the full
  // test took ~470ms on the main thread at hydration (code review, t-182).
  const boxes = outlines.map((outline) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of outline) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return [x0, y0, x1, y1] as const;
  });
  const covered = (position: number, x: number, y: number) => {
    if (Math.hypot(x - HEART[0], y - HEART[1]) < HEART_COVER) return true;
    for (let j = position + 1; j < outlines.length; j++) {
      const [x0, y0, x1, y1] = boxes[j];
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (insidePolygon(x, y, outlines[j])) return true;
    }
    return false;
  };

  const dots: DotSite[] = [];
  order.forEach((petal, position) => {
    const pose = poses[petal];
    const whorl = whorlOf[petal];
    // Outer whorls in the deepest tone, the inner ones lighter.
    const tone = Math.min(2, Math.floor((whorl * 3) / LOTUS_WHORLS.length));
    const delay = whorl * TIMELINE.RING_GAP + orderInWhorl[petal] * TIMELINE.PETAL_GAP;
    const add = (kind: DotKind, gap: number, path: Path, r: number, base: number) => {
      const points = spacedOn(pose, trace(pose, path), gap);
      // The outline is a closed loop, so its last dot is its first. The echo
      // and the vein are open: both their ends are real dots.
      if (kind === 'edge') points.pop();
      for (const d of points) {
        if (covered(position, d.x, d.y)) continue;
        dots.push({ kind, petal, u: d.u, v: d.v, x: d.x, y: d.y, tone, r, base, delay });
      }
    };
    add('edge', 2.5 * K, OUTLINE, 0.9, 1);
    add('echo', 4.2 * K, ECHO, 0.6, 0.45);
    add('vein', 3.6 * K, VEIN, 0.56, 0.55);
  });

  return { dots: [...dots, ...heartDots()], outlines, order };
}

/**
 * Each petal's tip in the open flower, where the beat lets go of a star — for
 * the petals whose tips are in view. A tip tucked behind a petal in front lets
 * nothing go, rather than its highest visible dot part-way down the petal.
 */
export function petalTips(flower: Flower): Point[] {
  const tips = new Map<number, DotSite>();
  for (const d of flower.dots) {
    if (d.kind !== 'edge' || d.u < TIP_U) continue;
    const best = tips.get(d.petal);
    if (!best || d.u > best.u) tips.set(d.petal, d);
  }
  return [...tips.values()].map((d) => [d.x, d.y]);
}

/**
 * Where a petal dot is `t` seconds in. The petals open as the model opens them,
 * run at the rate that brings them to rest as the flow begins.
 */
export const UNFURL_RATE = LOTUS_OPENED_MS / (TIMELINE.FLOW_AT * 1000);

export function petalPosesAt(t: number): PetalPose[] {
  return petalPoses(Math.min(LOTUS_OPENED_MS, t * 1000 * UNFURL_RATE));
}

export function dotAt(poses: readonly PetalPose[], site: DotSite): Point {
  return flat(petalPoint(poses[site.petal], site.u, site.v));
}
