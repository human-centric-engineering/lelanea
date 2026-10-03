/**
 * The lotus draw list — the one description of the flower that the animation,
 * the still marks and the baked assets all paint.
 *
 * What is worth asserting is the contract the painters rely on: it is
 * deterministic (a server-rendered frame must hydrate), its coordinates are
 * rounded (Node and the browser disagree in the last digits), it holds still
 * once open, and the frames really contain what they claim to.
 *
 * @see components/app/ui/lotus-draw.ts
 */
import { describe, expect, it } from 'vitest';

import {
  LOTUS_GLYPH_MS,
  drawLotus,
  lotusFrames,
  measureLotusFrames,
  stillLotus,
  type LotusShape,
} from '@/components/app/ui/lotus-draw';
import { LOTUS_OPENED_MS, LOTUS_WHORLS, STAMEN_COUNT } from '@/components/app/ui/lotus-model';

const PETALS = LOTUS_WHORLS.reduce((n, w) => n + w.count, 0);

function numbers(shapes: readonly LotusShape[]): number[] {
  return shapes.flatMap((s) =>
    s.kind === 'ring' || s.kind === 'glow'
      ? [s.cx, s.cy, s.rx, s.ry]
      : s.kind === 'band'
        ? [...s.points, ...s.from, ...s.to]
        : [...s.points]
  );
}

function extent(shapes: readonly LotusShape[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of shapes) {
    if (s.kind !== 'band' && s.kind !== 'line') continue;
    for (let i = 0; i < s.points.length; i += 2) {
      xs.push(s.points[i]);
      ys.push(s.points[i + 1]);
    }
  }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

describe('drawLotus', () => {
  it('is deterministic, so a server-rendered bloom hydrates', () => {
    expect(drawLotus(1234, { water: true })).toEqual(drawLotus(1234, { water: true }));
  });

  it('rounds every coordinate to two decimals', () => {
    const all = numbers(drawLotus(1234, { water: true }));
    expect(all.length).toBeGreaterThan(1000);
    for (const n of all) expect(Math.round(n * 100) / 100).toBe(n);
  });

  it('draws every petal as the same number of bands, and the crown once open', () => {
    const open = drawLotus(LOTUS_OPENED_MS, { water: false });
    const bandCount = open.filter((s) => s.kind === 'band').length;
    expect(bandCount % PETALS).toBe(0);
    expect(bandCount / PETALS).toBeGreaterThan(1);
    expect(open.filter((s) => s.kind === 'line')).toHaveLength(STAMEN_COUNT * 2);

    // The bud has every petal but no crown yet.
    const bud = drawLotus(0, { water: false });
    expect(bud.filter((s) => s.kind === 'band')).toHaveLength(bandCount);
    expect(bud.filter((s) => s.kind === 'line')).toHaveLength(0);
  });

  it('opens: the bud is narrower than the bloom', () => {
    const bud = extent(drawLotus(0, { water: false }));
    const open = extent(drawLotus(LOTUS_OPENED_MS, { water: false }));
    expect(bud.x1 - bud.x0).toBeLessThan((open.x1 - open.x0) / 2);
  });

  it('paints the water first, under the flower', () => {
    const shapes = drawLotus(LOTUS_OPENED_MS, { water: true });
    const firstPetal = shapes.findIndex((s) => s.kind === 'band');
    const lastWater = shapes.findLastIndex((s) => s.kind === 'fill' || s.kind === 'ring');
    expect(lastWater).toBeGreaterThanOrEqual(0);
    expect(lastWater).toBeLessThan(firstPetal);
  });

  it('honours fewer bands for the glyph', () => {
    const two = drawLotus(LOTUS_GLYPH_MS, { water: false, bands: 2 });
    expect(two.filter((s) => s.kind === 'band')).toHaveLength(PETALS * 2);
    expect(stillLotus('glyph', false).filter((s) => s.kind === 'band')).toHaveLength(PETALS * 2);
  });
});

describe('lotusFrames', () => {
  it('is the measured frames — re-run `npm run lotus:assets` if this fails', () => {
    expect(lotusFrames()).toEqual(measureLotusFrames());
  });

  it('holds the flower at every stage of the opening inside the animated frame', () => {
    const [x, y, w, h] = lotusFrames().animated.tight.box;
    for (let ms = 0; ms <= LOTUS_OPENED_MS; ms += 100) {
      const e = extent(drawLotus(ms, { water: false }));
      expect(e.x0, `${ms}ms`).toBeGreaterThanOrEqual(x);
      expect(e.y0, `${ms}ms`).toBeGreaterThanOrEqual(y);
      expect(e.x1, `${ms}ms`).toBeLessThanOrEqual(x + w);
      expect(e.y1, `${ms}ms`).toBeLessThanOrEqual(y + h);
    }
  });

  it('holds the whole of the water — halation included — inside the water frames', () => {
    // A glow overhanging its frame is clipped: a straight edge on a dark
    // ground in the baked mark, and a pop at the canvas-to-SVG hand-over.
    const glow = drawLotus(LOTUS_OPENED_MS, { water: true }).find((s) => s.kind === 'glow');
    if (glow?.kind !== 'glow') throw new Error('no halation drawn');
    for (const frame of [lotusFrames().still.water, lotusFrames().animated.water]) {
      const [x, y, w, h] = frame.box;
      expect(glow.cx - glow.rx).toBeGreaterThanOrEqual(x);
      expect(glow.cx + glow.rx).toBeLessThanOrEqual(x + w);
      expect(glow.cy - glow.ry).toBeGreaterThanOrEqual(y);
      expect(glow.cy + glow.ry).toBeLessThanOrEqual(y + h);
    }
  });

  it('crops the still frame to the open bloom, without the bud’s headroom', () => {
    const still = lotusFrames().still.tight.box;
    const animated = lotusFrames().animated.tight.box;
    expect(still[3]).toBeLessThan(animated[3]);
    const e = extent(drawLotus(LOTUS_OPENED_MS, { water: false }));
    expect(e.y0).toBeGreaterThanOrEqual(still[1]);
  });
});
