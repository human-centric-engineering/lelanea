/**
 * The lotus at one moment, as a list of flat shapes in paint order.
 *
 * Everything that knows about 3D ends here. The SVG mark and the canvas
 * animation both paint this list and nothing else, so they show the same
 * flower; a third painter (the asset script) bakes the still copies from it.
 *
 * Coordinates are SVG user units (100 per model unit), y down, rounded to two
 * decimals — Node and the browser disagree in the last digits of `Math.pow`,
 * and a server-rendered mark that hydrates must not.
 */

import { mix, type Colour } from '@/components/app/ui/lotus-colour';
import { LOTUS_FRAMES } from '@/components/app/ui/lotus-frames';
import {
  CROWN_MS,
  CROWN_START_MS,
  LOTUS_OPENED_MS,
  LOTUS_PADS,
  LOTUS_RIPPLES,
  LOTUS_SHADOW,
  STAMEN_COUNT,
  VIEW_DIR,
  WATER_MS,
  WATER_START_MS,
  dot,
  faceColour,
  lightAt,
  padOutline,
  petalNormal,
  petalPoint,
  petalPoses,
  project,
  span,
  stamenPath,
  type PetalPose,
  type Vec3,
} from '@/components/app/ui/lotus-model';

const S = 100;
/** Samples along a petal's length, and lengthwise shading bands across it. */
const U_STEPS = 22;
const BANDS = 7;

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface GradientStop {
  readonly offset: number;
  readonly colour: Colour;
}

export type LotusShape =
  /** A lengthwise band of a petal, shaded base → tip from its own normals. */
  | {
      readonly kind: 'band';
      readonly points: readonly number[];
      readonly from: readonly [number, number];
      readonly to: readonly [number, number];
      readonly stops: readonly GradientStop[];
    }
  | {
      readonly kind: 'line';
      readonly points: readonly number[];
      readonly colour: Colour;
      readonly width: number;
      readonly opacity: number;
    }
  | {
      readonly kind: 'fill';
      readonly points: readonly number[];
      readonly colour: Colour;
      readonly opacity: number;
      readonly stroke: Colour;
      readonly strokeWidth: number;
    }
  | {
      readonly kind: 'ring';
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
      readonly colour: Colour;
      readonly width: number;
      readonly opacity: number;
    }
  /** A soft radial glow: `colour` at the centre, fading to nothing at the rim. */
  | {
      readonly kind: 'glow';
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
      readonly colour: Colour;
      readonly opacity: number;
    };

function flat(points: readonly Vec3[]): number[] {
  const out: number[] = [];
  for (const p of points) {
    const s = project(p);
    out.push(r2(s.x * S), r2(s.y * S));
  }
  return out;
}

function at(p: Vec3): [number, number] {
  const s = project(p);
  return [r2(s.x * S), r2(s.y * S)];
}

/** Lit: below 0.5 toward the cool shadow, above toward white. */
function shade(c: Colour, light: number): Colour {
  if (light < 0.5) return mix(c, LOTUS_SHADOW, r2((0.5 - light) * 2 * 0.55));
  return mix(c, 'white', r2((light - 0.5) * 2 * 0.14));
}

function petalBands(pose: PetalPose, count: number): LotusShape[] {
  const edge = (v: number) => {
    const pts: Vec3[] = [];
    for (let i = 0; i <= U_STEPS; i++) pts.push(petalPoint(pose, i / U_STEPS, v));
    return pts;
  };
  const bands: LotusShape[] = [];
  for (let k = 0; k < count; k++) {
    const v0 = -1 + (2 * k) / count;
    const v1 = v0 + 2 / count;
    const vm = (v0 + v1) / 2;
    const stops: GradientStop[] = [];
    for (const u of [0.04, 0.3, 0.55, 0.8, 0.98]) {
      let n = petalNormal(pose, u, vm);
      const underside = dot(n, VIEW_DIR) > 0;
      if (!underside) n = [-n[0], -n[1], -n[2]];
      const ramp = underside ? pose.whorl.colours.outer : pose.whorl.colours.inner;
      stops.push({ offset: u, colour: shade(faceColour(ramp, u), lightAt(n)) });
    }
    bands.push({
      kind: 'band',
      points: [...flat(edge(v0)), ...flat(edge(v1).reverse())],
      from: at(petalPoint(pose, 0, vm)),
      to: at(petalPoint(pose, 1, vm)),
      stops,
    });
  }
  return bands;
}

function stamen(i: number, grow: number): LotusShape[] {
  const path = stamenPath(i, grow);
  const tone = i % 3 === 1 ? '--color-lotus-core-light' : '--color-lotus-core';
  return [
    {
      kind: 'line',
      points: flat(path),
      colour: tone,
      width: r2(2.6 - (i / STAMEN_COUNT) * 0.8),
      opacity: 1,
    },
    // The anther: a lit tip.
    {
      kind: 'line',
      points: flat([path[4], path[6]]),
      colour: '--color-lotus-glint',
      width: 1,
      opacity: 0.7,
    },
  ];
}

/** The pads, the halation and the ripples, `waterIn` (0 → 1) of the way in. */
function waterShapes(waterIn: number): LotusShape[] {
  const shapes: LotusShape[] = [];
  for (const pad of LOTUS_PADS) {
    shapes.push({
      kind: 'fill',
      points: flat(padOutline(pad)),
      colour: '--color-lotus-pad',
      opacity: r2(0.85 * waterIn),
      stroke: '--color-lotus-pad-edge',
      strokeWidth: 0.8,
    });
  }
  shapes.push({
    kind: 'glow',
    cx: 0,
    cy: -35,
    rx: 150,
    ry: 95,
    colour: '--color-lotus-halation',
    opacity: r2(waterIn),
  });
  const [, cy] = at([0, 0, 0]);
  const k = 0.55 + 0.45 * waterIn;
  for (const ripple of LOTUS_RIPPLES) {
    shapes.push({
      kind: 'ring',
      cx: 0,
      cy: r2(cy + 4),
      rx: r2(ripple.rx * S * k),
      ry: r2(ripple.ry * S * k),
      colour: ripple.colour,
      width: ripple.width,
      opacity: r2(ripple.opacity * waterIn),
    });
  }
  return shapes;
}

export interface DrawOptions {
  /** The pads, ripples and halation. */
  readonly water: boolean;
  /**
   * Shading bands per petal. Seven model the cup; at glyph size two are
   * indistinguishable from seven and a fraction of the DOM.
   */
  readonly bands?: number;
}

/** The lotus `ms` into its opening — 0 is the bud, `LOTUS_OPENED_MS` at rest. */
export function drawLotus(ms: number, { water, bands = BANDS }: DrawOptions): LotusShape[] {
  const shapes: LotusShape[] = [];
  const waterIn = span(ms, WATER_START_MS, WATER_MS);
  const grow = span(ms, CROWN_START_MS, CROWN_MS);

  if (water) shapes.push(...waterShapes(waterIn));

  // Painter's algorithm over petals, stamens and the heart's glow.
  const items: { depth: number; shapes: LotusShape[] }[] = petalPoses(ms).map((pose) => ({
    depth: dot(petalPoint(pose, 0.5, 0), VIEW_DIR),
    shapes: petalBands(pose, bands),
  }));
  if (grow > 0.001) {
    for (let i = 0; i < STAMEN_COUNT; i++) {
      items.push({ depth: dot(stamenPath(i, grow)[3], VIEW_DIR) + 0.001, shapes: stamen(i, grow) });
    }
    const [cx, cy] = at([0, 0.08, 0]);
    items.push({
      depth: -0.5,
      shapes: [
        {
          kind: 'glow',
          cx,
          cy,
          rx: 22,
          ry: 13,
          colour: '--color-lotus-core-light',
          opacity: r2(0.6 * grow),
        },
      ],
    });
  }
  items.sort((a, b) => a.depth - b.depth);
  for (const item of items) shapes.push(...item.shapes);
  return shapes;
}

// ---- Frames --------------------------------------------------------------

export interface LotusFrame {
  /** SVG `viewBox` as numbers: x, y, width, height. */
  readonly box: readonly [number, number, number, number];
  /** The share of the frame's width the open BLOOM occupies — see `size`. */
  readonly bloomFraction: number;
}

function bounds(shapes: readonly LotusShape[], kinds: readonly LotusShape['kind'][]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of shapes) {
    if (!kinds.includes(s.kind)) continue;
    if (s.kind === 'ring' || s.kind === 'glow') {
      x0 = Math.min(x0, s.cx - s.rx);
      x1 = Math.max(x1, s.cx + s.rx);
      y0 = Math.min(y0, s.cy - s.ry);
      y1 = Math.max(y1, s.cy + s.ry);
      continue;
    }
    for (let i = 0; i < s.points.length; i += 2) {
      x0 = Math.min(x0, s.points[i]);
      x1 = Math.max(x1, s.points[i]);
      y0 = Math.min(y0, s.points[i + 1]);
      y1 = Math.max(y1, s.points[i + 1]);
    }
  }
  return { x0, y0, x1, y1 };
}

/**
 * The small-size mark: the bloom caught part-way open. Fully open the flower is
 * about 2.3 times wider than tall, so at an 18px avatar it is an 8px sliver; at
 * this moment it is a compact cup — the silhouette people read as a lotus.
 */
export const LOTUS_GLYPH_MS = 850;

/** Below this bloom width a tight mark is the glyph (§6.6's ~40px threshold). */
export const LOTUS_GLYPH_BELOW = 48;
const GLYPH_BANDS = 2;

type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * The flower's extent at `ms` from geometry alone — petal edges and stamens,
 * no shading. Measuring by drawing cost ~100ms, and `LotusMark` renders in
 * client components, so this runs in the browser at hydration.
 */
function flowerBounds(ms: number): Box {
  const pts: Vec3[] = [];
  for (const pose of petalPoses(ms)) {
    for (let i = 0; i <= U_STEPS; i++) {
      pts.push(petalPoint(pose, i / U_STEPS, -1), petalPoint(pose, i / U_STEPS, 1));
    }
  }
  const grow = span(ms, CROWN_START_MS, CROWN_MS);
  if (grow > 0.001) for (let i = 0; i < STAMEN_COUNT; i++) pts.push(...stamenPath(i, grow));
  return bounds(
    [{ kind: 'line', points: flat(pts), colour: 'white', width: 0, opacity: 0 }],
    ['line']
  );
}

const union = (a: Box, b: Box): Box => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
});

/** A frame around `box`, sized so `bloomWidth` is what `size` measures. */
function frameAround(box: Box, bloomWidth: number): LotusFrame {
  const pad = 3;
  const w = box.x1 - box.x0 + pad * 2;
  return {
    box: [r2(box.x0 - pad), r2(box.y0 - pad), r2(w), r2(box.y1 - box.y0 + pad * 2)],
    bloomFraction: bloomWidth / w,
  };
}

export interface LotusFrames {
  /** The animated `Lotus`: tall enough for the bud as well as the bloom. */
  readonly animated: { readonly water: LotusFrame; readonly tight: LotusFrame };
  /** `LotusMark`: just the bloom at rest, and the half-open glyph. */
  readonly still: {
    readonly water: LotusFrame;
    readonly tight: LotusFrame;
    readonly glyph: LotusFrame;
  };
}
/**
 * The frames, MEASURED from the model rather than typed in, so a change to a
 * whorl cannot leave a petal outside its frame. In every frame `size` measures
 * the width of the open bloom (the glyph's, for the glyph) — §6.6's promise
 * that a mark and an animated bloom at the same size match.
 *
 * Measuring walks the whole opening (~100–300ms), so it is not done at
 * runtime: `npm run lotus:assets` writes the result to `lotus-frames.ts`, which
 * `lotusFrames()` returns, and a unit test re-measures and compares.
 */
export function measureLotusFrames(): LotusFrames {
  const bloom = flowerBounds(LOTUS_OPENED_MS);
  const bloomWidth = bloom.x1 - bloom.x0;
  let every = bloom;
  for (let ms = 0; ms < LOTUS_OPENED_MS; ms += 250) every = union(every, flowerBounds(ms));
  const water = bounds(waterShapes(1), ['fill', 'ring']);
  const glyph = flowerBounds(LOTUS_GLYPH_MS);
  return {
    animated: {
      tight: frameAround(every, bloomWidth),
      water: frameAround(union(every, water), bloomWidth),
    },
    still: {
      tight: frameAround(bloom, bloomWidth),
      water: frameAround(union(bloom, water), bloomWidth),
      glyph: frameAround(glyph, glyph.x1 - glyph.x0),
    },
  };
}

/** The measured frames, as baked into `lotus-frames.ts`. */
export function lotusFrames(): LotusFrames {
  return LOTUS_FRAMES;
}

/** Frame pixel dimensions for a requested bloom width. */
export function lotusFrameSize(size: number, frame: LotusFrame): { width: number; height: number } {
  const width = size / frame.bloomFraction;
  return { width, height: (width * frame.box[3]) / frame.box[2] };
}

const still = new Map<string, LotusShape[]>();

/**
 * The still states, computed once per process: the bud, the small-size glyph,
 * and the bloom at rest. Every `LotusMark` and every un-animated `Lotus` paints
 * one of these.
 */
export function stillLotus(state: 'bud' | 'glyph' | 'open', water: boolean): readonly LotusShape[] {
  const key = `${state}:${water}`;
  let shapes = still.get(key);
  if (!shapes) {
    const ms = state === 'bud' ? 0 : state === 'glyph' ? LOTUS_GLYPH_MS : LOTUS_OPENED_MS;
    shapes = drawLotus(ms, { water, bands: state === 'glyph' ? GLYPH_BANDS : BANDS });
    still.set(key, shapes);
  }
  return shapes;
}
