import { parseColour, rgbaString, type Rgba } from '@/components/app/ui/lotus-colour';
import {
  HEART,
  K,
  POND_Y,
  REST_T,
  TIMELINE,
  beatAt,
  dotAt,
  dotFlower,
  lubdub,
  petalPosesAt,
  petalTips,
  type DotSite,
  type Flower,
} from '@/components/app/ui/dot-lotus-geometry';

/**
 * Paint the dotted lotus onto a canvas: the sprites it is drawn with, the
 * moving light around it, and the loop that runs it.
 *
 * A port of the prism prototype's "DOT LOTUS" painter
 * (`.context/app/planning/design/prism/index.html`), with its geometry taken
 * from the lotus model rather than read off an SVG (`dot-lotus-geometry.ts`).
 * Its numbers are the prototype's, in the prototype's units, converted by `K`
 * where they are distances.
 *
 * NO COLOUR IN THIS FILE: every colour is a `--dot-*` token, read from the
 * flower's own element so a band that sets its own palette — the hero's dusk
 * sky — gets it. A token that is missing falls back to the lotus token it was
 * derived from, then to clear; it never throws.
 */

// ---- Look ----------------------------------------------------------------

/** The eight tones a dot can take, indexed by `DotSite.tone` (7 is a star). */
const TONES = [
  ['--dot-1', '--color-lotus-petal-outer-edge'],
  ['--dot-2', '--color-lotus-petal-outer'],
  ['--dot-3', '--color-lotus-petal-mid'],
  ['--dot-core-1', '--color-lotus-core-light'],
  ['--dot-core-2', '--color-lotus-core'],
  ['--dot-core-3', '--color-lotus-core'],
  ['--dot-water', '--color-lotus-ripple'],
  ['--dot-star', '--color-lotus-glint'],
] as const;

const CLEAR: Rgba = [0, 0, 0, 0];

/**
 * The same colour at zero alpha. A gradient that fades to `transparent` —
 * transparent BLACK — passes through grey, which reads as a shadow on a pale
 * ground; every fade here ends on its own colour instead.
 */
export const clearOf = ([r, g, b]: Rgba): string => rgbaString([r, g, b, 0]);
/** The same colour at a fraction of its alpha. */
export const dimOf = ([r, g, b, a]: Rgba, k: number): string => rgbaString([r, g, b, a * k]);

export interface Sprite {
  readonly image: CanvasImageSource;
}

/** Makes an offscreen canvas for a sprite; null where there is no 2D context. */
export type MakeCanvas = (size: number) => {
  canvas: CanvasImageSource;
  ctx: CanvasRenderingContext2D;
} | null;

export const makeCanvas: MakeCanvas = (size) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
};

export interface DotLook {
  readonly dot: readonly (CanvasImageSource | null)[];
  readonly star: CanvasImageSource | null;
  readonly shine: CanvasImageSource | null;
  readonly fringeA: CanvasImageSource | null;
  readonly fringeB: CanvasImageSource | null;
  readonly glow: Rgba;
  readonly pool: Rgba;
  readonly shadow: Rgba;
  readonly blend: GlobalCompositeOperation;
  readonly halo: number;
  readonly shineBase: number;
  readonly shineSize: number;
  readonly sheen: number;
  readonly fringe: number;
  readonly iridesce: number;
  readonly pond: number;
  readonly pondSize: number;
  readonly dotScale: number;
}

const BLENDS = new Set(['source-over', 'lighter', 'screen', 'plus-lighter']);

/** Every token the look is read from, fallbacks included. */
const TOKEN_NAMES = [
  '--color-lotus-core',
  '--color-lotus-core-light',
  '--color-lotus-glint',
  '--color-lotus-halation',
  '--color-lotus-petal-mid',
  '--color-lotus-petal-outer',
  '--color-lotus-petal-outer-edge',
  '--color-lotus-ripple',
  '--dot-1',
  '--dot-2',
  '--dot-3',
  '--dot-blend',
  '--dot-core-1',
  '--dot-core-2',
  '--dot-core-3',
  '--dot-fringe',
  '--dot-fringe-a',
  '--dot-fringe-b',
  '--dot-glow',
  '--dot-halo',
  '--dot-iridesce',
  '--dot-pond',
  '--dot-pond-size',
  '--dot-pool',
  '--dot-scale',
  '--dot-shadow',
  '--dot-sheen',
  '--dot-shine',
  '--dot-shine-base',
  '--dot-shine-size',
  '--dot-star',
  '--dot-water',
] as const;

/**
 * The tokens as they resolve on `element` now, as one string: compare two to
 * tell whether the look needs reading again, without drawing a sprite.
 */
export function dotTokens(element: Element): string {
  const style = getComputedStyle(element);
  return TOKEN_NAMES.map((name) => style.getPropertyValue(name).trim()).join('|');
}

/**
 * Read the flower's tokens where it sits and draw its sprites: each tone as a
 * soft halo with a solid core, the four-pointed star, the white light a dot
 * sits in, and the two-colour prism fringe for pale grounds.
 */
export function readDotLook(element: Element, make: MakeCanvas = makeCanvas): DotLook {
  const style = getComputedStyle(element);
  const raw = (name: string) => style.getPropertyValue(name).trim();
  const colour = (name: string, fallback?: string): Rgba =>
    parseColour(raw(name)) ?? (fallback ? parseColour(raw(fallback)) : null) ?? CLEAR;
  const num = (name: string, d: number) => {
    const v = Number.parseFloat(raw(name));
    return Number.isFinite(v) ? v : d;
  };
  const halo = num('--dot-halo', 0.3);

  const radial = (
    size: number,
    draw: (ctx: CanvasRenderingContext2D, c: number) => void
  ): CanvasImageSource | null => {
    const made = make(size);
    if (!made) return null;
    draw(made.ctx, size / 2);
    return made.canvas;
  };
  const disc = (ctx: CanvasRenderingContext2D, c: number, r: number) => {
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();
  };

  const dot = TONES.map(([name, fallback]) => {
    const rgba = colour(name, fallback);
    const css = rgbaString(rgba);
    return radial(64, (ctx, c) => {
      const halo64 = ctx.createRadialGradient(c, c, 6, c, c, c);
      halo64.addColorStop(0, css);
      halo64.addColorStop(1, clearOf(rgba));
      ctx.globalAlpha = halo;
      ctx.fillStyle = halo64;
      disc(ctx, c, c);
      ctx.globalAlpha = 1;
      ctx.fillStyle = css;
      disc(ctx, c, 8);
    });
  });

  const starRgba = colour('--dot-star', '--color-lotus-glint');
  const star = radial(96, (ctx, c) => {
    const css = rgbaString(starRgba);
    for (const [i, [length, width]] of [
      [96, 2.2],
      [56, 1.2],
    ].entries()) {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(i ? Math.PI / 4 : 0);
      const arm = ctx.createLinearGradient(-length / 2, 0, length / 2, 0);
      arm.addColorStop(0, clearOf(starRgba));
      arm.addColorStop(0.5, css);
      arm.addColorStop(1, clearOf(starRgba));
      ctx.fillStyle = arm;
      ctx.fillRect(-length / 2, -width / 2, length, width);
      ctx.rotate(Math.PI / 2);
      ctx.fillRect(-length / 2, -width / 2, length, width);
      ctx.restore();
    }
    const core = ctx.createRadialGradient(c, c, 0, c, c, 14);
    core.addColorStop(0, css);
    core.addColorStop(1, clearOf(starRgba));
    ctx.fillStyle = core;
    disc(ctx, c, 14);
  });

  const soft = (rgba: Rgba, edge: number) =>
    radial(64, (ctx, c) => {
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, rgbaString(rgba));
      g.addColorStop(0.3, rgbaString(rgba));
      if (edge < 1) g.addColorStop(0.5, dimOf(rgba, 0.35));
      g.addColorStop(edge, clearOf(rgba));
      ctx.fillStyle = g;
      disc(ctx, c, c);
    });

  const blend = raw('--dot-blend');
  return {
    dot,
    star,
    shine: soft(colour('--dot-shine', '--color-lotus-glint'), 1),
    fringeA: soft(colour('--dot-fringe-a'), 0.75),
    fringeB: soft(colour('--dot-fringe-b'), 0.75),
    glow: colour('--dot-glow', '--color-lotus-halation'),
    pool: colour('--dot-pool'),
    shadow: colour('--dot-shadow'),
    blend: (BLENDS.has(blend) ? blend : 'source-over') as GlobalCompositeOperation,
    halo,
    shineBase: num('--dot-shine-base', 0.3),
    shineSize: num('--dot-shine-size', 2.2),
    sheen: num('--dot-sheen', 0.85),
    fringe: num('--dot-fringe', 0),
    iridesce: num('--dot-iridesce', 0),
    pond: num('--dot-pond', 0.3),
    pondSize: num('--dot-pond-size', 1.9),
    dotScale: num('--dot-scale', 1),
  };
}

// ---- Scene ---------------------------------------------------------------

/** Seeded, so the flower twinkles the same way on every load. */
export function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where the flower is on the canvas, in CSS pixels, and how far it may reach. */
export interface DotLayout {
  /** The canvas position of the flower's origin. */
  readonly ox: number;
  readonly oy: number;
  /** CSS pixels per unit. */
  readonly scale: number;
  /** How far drifting light may go, in units: left, right, and up or down. */
  readonly spanL: number;
  readonly spanR: number;
  readonly spanV: number;
  /** Canvas pixels per CSS pixel. */
  readonly dpr: number;
}

/** A dot of the flower with its own twinkle. */
interface Lit extends DotSite {
  readonly jitter: number;
  readonly w: number;
  readonly ph: number;
  readonly fw: number;
  readonly fph: number;
  readonly flare: boolean;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly born: number;
  readonly life: number;
  readonly r: number;
  readonly tone: number;
  readonly w: number;
  readonly ph: number;
  readonly star: boolean;
  readonly curl?: number;
  readonly span?: number;
  readonly bob?: number;
  readonly bph?: number;
}

/** How far a loose dot may stream from the heart, in units. */
const REACH = 118 * K;
const PETAL_REVEAL = TIMELINE.PETAL;

let shared: Flower | null = null;
/** The flower's geometry, built once: it is the same for every mount. */
export function sharedFlower(): Flower {
  shared ??= dotFlower();
  return shared;
}

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (p: number) => 1 - (1 - p) ** 3;

export interface DotScene {
  /** Paint the flower `t` seconds into its timeline. */
  paint(ctx: CanvasRenderingContext2D, look: DotLook, layout: DotLayout, t: number): void;
  /** Forget everything in flight, for a replay. */
  reset(): void;
}

/**
 * The flower and everything that moves around it. Holds the light in flight —
 * the streams, the drift, the pond's rings — so it is one per mount.
 */
export function dotScene(
  flower: Flower = sharedFlower(),
  { reduced = false }: { reduced?: boolean } = {}
): DotScene {
  const draw = rng(20261101);
  const lit: Lit[] = flower.dots.map((d) => ({
    ...d,
    jitter: d.kind === 'heart' ? 0 : draw() * 0.12,
    w: (d.kind === 'heart' ? 1 : 0.6) + draw() * (d.kind === 'heart' ? 2 : 1.8),
    ph: draw() * Math.PI * 2,
    fw: (d.kind === 'heart' ? 0.08 : 0.05) + draw() * (d.kind === 'heart' ? 0.1 : 0.12),
    fph: draw() * Math.PI * 2,
    flare: d.kind === 'edge' ? draw() < 0.35 : d.ring === 0,
  }));
  const anchors = lit.filter((d) => d.kind === 'edge');
  const tips = petalTips(flower).map(([x, y]) => ({
    x,
    y,
    // When, within a beat, its wave reaches this tip.
    at: 0.2 + Math.hypot(x - HEART[0], y - HEART[1]) / (90 * K),
  }));

  let R = rng(99);
  let flows: Mote[] = [];
  let drift: Mote[] = [];
  let ponds: number[] = [];
  let lastT = 0;
  let spawn = 0;
  let driftSpawn = 0;
  let lastBeat = -1;
  let prevBeatT = -1;

  const reset = () => {
    R = rng(99);
    flows = [];
    drift = [];
    ponds = [];
    lastT = 0;
    spawn = 0;
    driftSpawn = 0;
    lastBeat = -1;
    prevBeatT = -1;
  };

  function paint(ctx: CanvasRenderingContext2D, look: DotLook, layout: DotLayout, t: number) {
    const { ox, oy, scale } = layout;
    const dt = Math.min(0.05, Math.max(0, t - lastT));
    lastT = t;
    const [hx, hy] = HEART;

    const put = (
      image: CanvasImageSource | null,
      x: number,
      y: number,
      size: number,
      alpha: number
    ) => {
      if (!image || alpha <= 0.01) return;
      ctx.globalAlpha = alpha > 1 ? 1 : alpha;
      const s = size * K * scale;
      ctx.drawImage(image, ox + x * scale - s / 2, oy + y * scale - s / 2, s, s);
    };
    /** A soft oval of `colour`, fading to clear, behind everything. */
    const oval = (cx: number, cy: number, rx: number, ry: number, rgba: Rgba, mid: number[]) => {
      if (rgba[3] <= 0) return;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.translate(ox + cx * scale, oy + cy * scale);
      ctx.scale(rx * scale, ry * scale);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, rgbaString(rgba));
      for (let i = 0; i < mid.length; i += 2) g.addColorStop(mid[i], dimOf(rgba, mid[i + 1]));
      g.addColorStop(1, clearOf(rgba));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(layout.dpr, 0, 0, layout.dpr, 0, 0);
    ctx.globalCompositeOperation = look.blend;

    const beat = reduced ? beatAt(0) : beatAt(t);
    if (beat.on && beat.n !== lastBeat && beat.t > 0.08) {
      lastBeat = beat.n;
      ponds.push(t);
    }
    ponds = ponds.filter((born) => t - born < TIMELINE.POND_LIFE);
    const prevBT = prevBeatT;
    prevBeatT = beat.on ? beat.t : -1;
    const breath = reduced ? 1 : 1 + 0.006 * Math.sin(t * 0.75);

    // The pool: a feathered oval of calmer colour behind the whole flower, so
    // the page's light streaks do not run through the dots.
    ctx.globalAlpha = clamp((t + 0.4) / 1.2);
    oval(hx, hy - 23 * K, 250 * K, 136 * K, look.pool, [0.45, 1]);
    // A faint shadow at the water line, so the flower sits on something.
    ctx.globalAlpha = clamp((t - TIMELINE.WATER_AT) / 0.6);
    oval(hx, POND_Y - 2 * K, 118 * K, 15 * K, look.shadow, [0.5, 0.45]);

    // The glow lives in the heart: it gathers with it and beats with it.
    const glow =
      easeOut(clamp((t - TIMELINE.HEART_AT + 0.3) / 1.4)) *
      (reduced ? 1 : 0.85 + 0.1 * Math.sin(t * 0.75) + 0.32 * beat.pulse);
    if (glow > 0 && look.glow[3] > 0) {
      const gx = ox + hx * scale;
      const gy = oy + hy * scale;
      const gr = 50 * K * scale * (0.9 + 0.1 * breath);
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      // A bloom, not a disc: strongest at the very heart, on a long soft fall.
      g.addColorStop(0, rgbaString(look.glow));
      g.addColorStop(0.18, dimOf(look.glow, 0.72));
      g.addColorStop(0.42, dimOf(look.glow, 0.32));
      g.addColorStop(0.7, dimOf(look.glow, 0.09));
      g.addColorStop(1, clearOf(look.glow));
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = glow;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(gx, gy, gr, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = look.blend;
    }

    // Loose dots streaming out from the petals and the heart.
    if (!reduced && t > TIMELINE.FLOW_AT) {
      spawn += dt * 16 * 0.4;
      // As each beat's wave reaches a petal tip, the tip lets go a star or two.
      if (beat.on && beat.env > 0.5) {
        const from = prevBT > beat.t ? -1 : prevBT;
        for (const tip of tips) {
          if (tip.at <= from || tip.at > beat.t) continue;
          const n = R() < 0.55 ? 2 : 1;
          for (let q = 0; q < n && flows.length < 360; q++) {
            const dir = Math.atan2(tip.y - hy, tip.x - hx) + (R() * 2 - 1) * 0.35;
            const sp = (12 + R() * 12) * K;
            flows.push({
              x: hx + (tip.x - hx) * breath,
              y: hy + (tip.y - hy) * breath,
              vx: Math.cos(dir) * sp,
              vy: Math.sin(dir) * sp,
              curl: (R() * 2 - 1) * 0.25,
              born: t,
              life: 1.6 + R() * 1.4,
              r: 0.5 + R() * 0.45,
              tone: R() < 0.5 ? 7 : 2,
              w: 2 + R() * 3,
              ph: R() * Math.PI * 2,
              star: R() < 0.6,
            });
          }
        }
      }
      while (spawn >= 1 && flows.length < 340) {
        spawn -= 1;
        const source = R() < 0.3 ? null : anchors[Math.floor(R() * anchors.length)];
        const sx = source ? source.x : hx;
        const sy = source ? source.y : hy;
        const dir = source ? Math.atan2(sy - hy, sx - hx) + (R() * 2 - 1) * 0.5 : R() * Math.PI * 2;
        const sp = (9 + R() * 16) * K;
        flows.push({
          x: sx,
          y: sy,
          vx: Math.cos(dir) * sp,
          vy: Math.sin(dir) * sp,
          curl: (R() * 2 - 1) * 0.35,
          born: t,
          life: 3 + R() * 3,
          r: 0.35 + R() * 0.6,
          tone: R() < 0.18 ? 7 : Math.floor(R() * 3),
          w: 1.5 + R() * 3,
          ph: R() * Math.PI * 2,
          star: R() < 0.06,
        });
      }
    }
    flows = flows.filter((p) => {
      const age = t - p.born;
      if (age > p.life) return false;
      const c = Math.cos((p.curl ?? 0) * dt);
      const s = Math.sin((p.curl ?? 0) * dt);
      const vx = p.vx;
      p.vx = vx * c - p.vy * s;
      p.vy = vx * s + p.vy * c;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const dist = Math.hypot(p.x - hx, p.y - hy);
      const a =
        Math.sin((Math.PI * age) / p.life) *
        clamp(1.15 - dist / REACH) *
        (0.55 + 0.45 * Math.sin(t * p.w + p.ph));
      put(look.dot[p.tone], p.x, p.y, p.r * 4.4, a);
      if (p.star) put(look.star, p.x, p.y, 9 * p.r + 4, a * 0.8);
      return dist < REACH * 1.2;
    });

    // The pond: each heartbeat sends a wide oval of faint dots out across the
    // water from the flower's base, widening and fading as a ring on still
    // water does. Reduced motion holds three, still, part-way out.
    const ages = reduced
      ? [0.25, 0.5, 0.75].map((f) => f * TIMELINE.POND_LIFE)
      : ponds.map((born) => t - born);
    for (const age of ages) {
      const pp = age / TIMELINE.POND_LIFE;
      const rx = 58 + pp * 175;
      const pa = Math.sin(Math.PI * pp) * look.pond;
      if (pa <= 0.01) continue;
      const n = Math.round(rx * 0.95);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const tw = reduced ? 1 : 0.55 + 0.45 * Math.sin(t * (1.3 + (k % 7) * 0.31) + k * 2.4);
        const tone = k % 3 === 0 ? 6 : 1 + (k % 2);
        put(
          look.dot[tone],
          hx + Math.cos(a) * rx * K,
          POND_Y + (Math.sin(a) * rx * K) / 5.8,
          look.pondSize,
          pa * tw
        );
      }
    }

    // Drift: a few dots leave the petals and float slowly out to the edges of
    // the page, rising and falling a little as they go.
    if (!reduced && t > TIMELINE.FLOW_AT) {
      driftSpawn += dt * 1.3;
      while (driftSpawn >= 1 && drift.length < 120) {
        driftSpawn -= 1;
        const from = anchors[Math.floor(R() * anchors.length)];
        const side = from.x === hx ? (R() < 0.5 ? -1 : 1) : Math.sign(from.x - hx);
        const span = side > 0 ? layout.spanR : layout.spanL;
        const speed = (5 + R() * 7) * K;
        const dir = (R() * 2 - 1) * 0.3 - 0.06;
        drift.push({
          x: from.x,
          y: from.y,
          vx: side * Math.cos(dir) * speed,
          vy: Math.sin(dir) * speed,
          born: t,
          life: Math.min(60, (span / speed) * (0.75 + R() * 0.35)),
          span,
          r: 0.35 + R() * 0.45,
          tone: R() < 0.15 ? 7 : Math.floor(R() * 3),
          w: 1 + R() * 2.5,
          ph: R() * Math.PI * 2,
          bob: 0.6 + R() * 1.2,
          bph: R() * Math.PI * 2,
          star: R() < 0.07,
        });
      }
    }
    drift = drift.filter((p) => {
      const age = t - p.born;
      if (age > p.life) return false;
      const span = p.span ?? 1;
      p.x += p.vx * dt;
      p.y += p.vy * dt + Math.sin(t * 0.5 * (p.bob ?? 1) + (p.bph ?? 0)) * dt * 1.6 * K;
      const edge = clamp((span - Math.abs(p.x - hx)) / (span * 0.18));
      const vert = clamp((layout.spanV - Math.abs(p.y - hy)) / (layout.spanV * 0.25));
      const a =
        clamp(age / 1.5) *
        clamp((p.life - age) / (p.life * 0.25)) *
        edge *
        vert *
        0.7 *
        (0.55 + 0.45 * Math.sin(t * p.w + p.ph));
      put(look.dot[p.tone], p.x, p.y, p.r * 4.4, a);
      if (p.star) put(look.star, p.x, p.y, 9 * p.r + 3, a * 0.7);
      return edge > 0;
    });

    // The flower, in two passes: the light each dot sits in, then the dots.
    // The light swells as a slow band of sheen sweeps across the petals, low
    // left to high right, then rests off the flower for as long again.
    const sweep = ((t * 34) % 720) - 180;
    // The petals are moving until the flow begins; after that, at rest.
    const poses = !reduced && t < TIMELINE.FLOW_AT ? petalPosesAt(t) : null;
    const placed: {
      d: Lit;
      x: number;
      y: number;
      a: number;
      f: number;
      band: number;
      b: number;
    }[] = [];
    for (const d of lit) {
      const delay = d.delay + d.jitter;
      const p = clamp((t - delay) / (d.kind === 'heart' ? 0.8 : PETAL_REVEAL));
      if (p <= 0) continue;
      const e = easeOut(p);
      let x: number;
      let y: number;
      if (d.kind === 'heart') {
        // The heart swells on each beat.
        const hs = e * (1 + 0.075 * beat.pulse);
        x = hx + (d.x - hx) * hs;
        y = hy + (d.y - hy) * hs;
      } else {
        [x, y] = poses ? dotAt(poses, d) : [d.x, d.y];
        if (!reduced) {
          x += Math.sin(t * 1.1 * d.w + d.ph) * 0.35 * K;
          y += Math.cos(t * 0.9 * d.w + d.ph) * 0.35 * K;
        }
      }
      x = hx + (x - hx) * breath;
      y = hy + (y - hy) * breath;

      // The beat reaching this dot: it leaves the heart a moment after the
      // lub-dub and travels out, softening as it goes.
      let wave = 0;
      if (beat.on) {
        const dx = x - hx;
        const dy = y - hy;
        const dist = Math.hypot(dx, dy) || 1;
        if (d.kind === 'heart') wave = beat.pulse * 0.65;
        else {
          const B = TIMELINE.BEAT;
          const lt = (((beat.t - 0.14 - dist / (90 * K)) % B) + B) % B;
          wave = lubdub(lt) * beat.env * (0.45 - 0.2 * clamp(dist / (110 * K)));
          x += (dx / dist) * 0.8 * K * wave;
          y += (dy / dist) * 0.8 * K * wave;
        }
      }
      const twinkle = reduced ? 1 : 0.62 + 0.38 * Math.sin(t * d.w * 1.4 + d.ph);
      const flare = d.flare && !reduced ? Math.max(0, Math.sin(t * d.fw + d.fph)) ** 90 : 0;
      const band = reduced ? 0 : Math.exp(-((((x * 0.8 - y * 0.6) / K - sweep) / 16) ** 2));
      const a = d.base * clamp(p * 2.4) * twinkle * (1 + 0.5 * wave);
      put(
        look.shine,
        x,
        y,
        d.r * 4.6 * (look.shineSize + band * 1.6),
        a * (look.shineBase * twinkle + band * look.sheen)
      );
      placed.push({ d, x, y, a, f: flare, band, b: wave });
    }
    for (const { d, x, y, a, f, band, b } of placed) {
      // Refracted light, for pale grounds where added light cannot show: a
      // rose edge and a cyan edge either side of each outline dot.
      if (look.fringe + look.iridesce > 0 && d.kind === 'edge') {
        const fa = a * (look.fringe + band * look.iridesce);
        const fd = 0.95 * (1 + band * 1.2) * K;
        const fs = d.r * 4.6 * look.dotScale * (0.62 + band * 0.3);
        put(look.fringeA, x - 0.8 * fd, y + 0.6 * fd, fs, fa);
        put(look.fringeB, x + 0.8 * fd, y - 0.6 * fd, fs, fa);
      }
      put(
        look.dot[d.tone],
        x,
        y,
        d.r * 4.6 * look.dotScale * (1 + f * 0.8 + band * 0.35 + b * 0.3),
        a + f * 0.5
      );
      if (f > 0.3) {
        put(look.shine, x, y, (11 * f + 3) * 1.2, f * look.shineBase);
        put(look.star, x, y, 11 * f + 3, f * 0.9);
      }
    }
    ctx.globalAlpha = 1;
  }

  return { paint, reset };
}

// ---- Loop ----------------------------------------------------------------

export interface LoopHost {
  readonly now: () => number;
  readonly request: (callback: (now: number) => void) => number;
  readonly cancel: (handle: number) => void;
}

export interface DotLoop {
  /** Run, if reduced motion allows and the flower can be seen. */
  play(): void;
  pause(): void;
  /** Start the timeline again from the bud. */
  replay(): void;
  /** Paint the current moment once, without scheduling another. */
  still(): void;
  readonly running: boolean;
}

/**
 * The clock. A reader who asked for less motion gets the open flower, still:
 * one frame at `REST_T` and nothing scheduled after it. Otherwise it repaints
 * every animation frame while it is playing, and nothing at all while paused —
 * and time spent paused does not count.
 */
export function dotLoop(
  paint: (t: number) => void,
  { reduced, host }: { reduced: boolean; host: LoopHost }
): DotLoop {
  // The timeline only advances while it runs: a flower that was hidden, or
  // scrolled away mid-opening, picks up where it was, so an opening that
  // began unseen — a page opened in a background tab — is not skipped.
  let banked = 0;
  let since = 0;
  let handle = 0;
  let running = false;

  const at = (now: number) => {
    if (reduced) return REST_T;
    return banked + (running ? (now - since) / 1000 : 0);
  };
  const tick = (now: number) => {
    if (!running) return;
    paint(at(now));
    handle = host.request(tick);
  };

  return {
    play() {
      if (running) return;
      if (reduced) {
        paint(REST_T);
        return;
      }
      since = host.now();
      running = true;
      handle = host.request(tick);
    },
    pause() {
      if (running) banked = at(host.now());
      running = false;
      host.cancel(handle);
    },
    replay() {
      banked = 0;
      since = host.now();
      if (!running) paint(at(since));
    },
    still() {
      paint(at(host.now()));
    },
    get running() {
      return running;
    },
  };
}
