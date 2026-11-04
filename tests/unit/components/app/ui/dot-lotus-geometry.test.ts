/**
 * Where the dotted lotus's dots sit, and when (t-182).
 *
 * jsdom has no canvas, so everything the flower can be reduced to is a pure
 * function and is tested here directly: the spacing of dots along an outline,
 * the seed head's rings, the occlusion that tucks back petals behind front
 * ones, the unfurling, and the timeline.
 *
 * @see components/app/ui/dot-lotus-geometry.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  HEART,
  HEART_RINGS,
  MARK_VIEW,
  OPENED_AT,
  PETALS,
  REST_T,
  TIMELINE,
  beatAt,
  dotFlower,
  insidePolygon,
  lubdub,
  outline,
  petalTips,
  phaseAt,
  restingAt,
  spaced,
  unfurledAt,
  type Point,
} from '@/components/app/ui/dot-lotus-geometry';

const gaps = (dots: readonly Point[]) =>
  dots.slice(1).map((d, i) => Math.hypot(d[0] - dots[i][0], d[1] - dots[i][1]));

describe('spaced', () => {
  it('steps a gap at a time from the first point, leaving the remainder', () => {
    const dots = spaced(
      [
        [0, 0],
        [10, 0],
      ],
      3
    );
    expect(dots).toEqual([
      [0, 0],
      [3, 0],
      [6, 0],
      [9, 0],
    ]);
  });

  it('carries the remainder round a corner, so the step along the line is even', () => {
    const dots = spaced(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      4
    );
    const along = dots.map(([x, y]) => (y === 0 ? x : 10 + y));
    expect(along).toEqual([0, 4, 8, 12, 16]);
  });

  it('gives nothing for no line', () => {
    expect(spaced([], 2)).toEqual([]);
  });
});

describe('insidePolygon', () => {
  const square: Point[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];

  it('tells inside from outside', () => {
    expect(insidePolygon(5, 5, square)).toBe(true);
    expect(insidePolygon(15, 5, square)).toBe(false);
    expect(insidePolygon(-1, -1, square)).toBe(false);
  });
});

describe('the petals', () => {
  it("are the prototype's flat lotus, path for path and angle for angle", () => {
    // public/dot-lotus.svg is the prototype's SVG; the dots must trace it.
    const svg = readFileSync(path.join(process.cwd(), 'public/dot-lotus.svg'), 'utf8');
    const drawn = [...svg.matchAll(/<path d="(M0,0[^"]+)"(?: transform="rotate\(([-\d.]+)\)")?/g)];
    expect(drawn).toHaveLength(PETALS.length);
    drawn.forEach(([, d, degrees], i) => {
      expect(outline(PETALS[i].d)).toEqual(outline(d));
      expect(PETALS[i].angle).toBeCloseTo((Number(degrees ?? 0) * Math.PI) / 180, 9);
    });
  });

  it("are the small mark's petals too, cropped close and without the water (t-183)", () => {
    const svg = readFileSync(path.join(process.cwd(), 'public/dot-lotus-mark.svg'), 'utf8');
    const box = MARK_VIEW;
    expect(svg).toContain(`viewBox="${box.x} ${box.y} ${box.width} ${box.height}"`);
    const drawn = [...svg.matchAll(/<path d="(M0,0[^"]+)"(?: transform="rotate\(([-\d.]+)\)")?/g)];
    expect(drawn).toHaveLength(PETALS.length);
    drawn.forEach(([, d, degrees], i) => {
      expect(outline(PETALS[i].d)).toEqual(outline(d));
      expect(PETALS[i].angle).toBeCloseTo((Number(degrees ?? 0) * Math.PI) / 180, 9);
    });
    // The home flower's water lines are the only stroked paths; the mark has none.
    expect(svg).not.toContain('stroke=');
  });

  it('come in three rings, outer to inner, each opening in its own order', () => {
    expect(PETALS.map((p) => p.ring)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2,
    ]);
    expect(PETALS.filter((p) => p.ring === 1).map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('trace a closed outline from the base, round the tip and back', () => {
    const line = outline(PETALS[0].d);
    expect(line).toHaveLength(160);
    expect(line[line.length - 1][0]).toBeCloseTo(0, 9);
    expect(line[line.length - 1][1]).toBeCloseTo(0, 9);
    expect(Math.min(...line.map(([, y]) => y))).toBeCloseTo(-99, 6);
  });
});

describe('the heart', () => {
  const dots = dotFlower().filter((d) => d.kind === 'heart');

  it('lays each ring out at its radius, with its count of dots', () => {
    expect(dots).toHaveLength(HEART_RINGS.reduce((n, [, count]) => n + count, 0));
    HEART_RINGS.forEach(([radius, count], k) => {
      const ring = dots.filter((d) => d.ring === k);
      expect(ring).toHaveLength(count);
      for (const d of ring) {
        const [x, y] = restingAt(d);
        expect(Math.hypot(x - HEART[0], y - HEART[1])).toBeCloseTo(radius, 6);
      }
    });
  });

  it('starts as a single seed at the centre and widens outward', () => {
    expect(HEART_RINGS[0]).toEqual([0, 1]);
    for (let k = 1; k < HEART_RINGS.length; k++) {
      expect(HEART_RINGS[k][0]).toBeGreaterThan(HEART_RINGS[k - 1][0]);
      expect(HEART_RINGS[k][1]).toBeGreaterThan(HEART_RINGS[k - 1][1]);
    }
  });

  it('gathers ring by ring, from the centre, once the petals are under way', () => {
    const delays = HEART_RINGS.map((_, k) => dots.find((d) => d.ring === k)?.delay ?? NaN);
    expect(delays[0]).toBe(TIMELINE.HEART_AT);
    for (let k = 1; k < delays.length; k++) expect(delays[k]).toBeGreaterThan(delays[k - 1]);
  });
});

describe('dotFlower', () => {
  const flower = dotFlower();

  it('dots every kind of line the prototype draws', () => {
    const kinds = new Set(flower.map((d) => d.kind));
    expect([...kinds].sort()).toEqual(['echo', 'edge', 'heart', 'vein']);
  });

  it('is laid out the same on every build', () => {
    expect(dotFlower()).toEqual(flower);
  });

  it("spaces the outline dots at the prototype's gap, dropping only hidden ones", () => {
    PETALS.forEach((p, i) => {
      const along = spaced(outline(p.d), 2.5);
      const steps = gaps(along).sort((x, y) => x - y);
      // Measured as the crow flies, so a step round the curve is a little short.
      expect(steps[Math.floor(steps.length / 2)]).toBeCloseTo(2.5, 1);
      expect(steps[steps.length - 1]).toBeLessThanOrEqual(2.5 + 1e-9);
      // Every outline dot drawn is one of those, at its place on the petal.
      const shown = flower.filter((d) => d.kind === 'edge' && d.petal === i);
      expect(shown.length).toBeLessThanOrEqual(along.length);
      for (const d of shown) expect(along).toContainEqual([d.lx, d.ly]);
    });
  });

  it('drops a dot wherever a petal painted after it covers it', () => {
    const petalDots = flower.filter((d) => d.kind !== 'heart');
    expect(petalDots.length).toBeGreaterThan(500);
    const outlines = PETALS.map((p) => outline(p.d));
    for (const d of petalDots) {
      const [x, y] = restingAt(d);
      for (let j = d.petal + 1; j < PETALS.length; j++) {
        const a = -PETALS[j].angle;
        const px = x * Math.cos(a) - y * Math.sin(a);
        const py = x * Math.sin(a) + y * Math.cos(a);
        expect(insidePolygon(px, py, outlines[j])).toBe(false);
      }
    }
  });

  it('keeps the seed head clear of petal dots', () => {
    const near = flower.filter((d) => {
      const [x, y] = restingAt(d);
      return d.kind !== 'heart' && Math.hypot(x - HEART[0], y - HEART[1]) < 15.5;
    });
    expect(near).toEqual([]);
  });

  it('lets go of stars from the highest outline dot of each petal in view', () => {
    const tips = petalTips(flower);
    const shown = new Set(flower.filter((d) => d.kind === 'edge').map((d) => d.petal));
    expect(tips).toHaveLength(shown.size);
    // The top outer petal's tip is its own, at the top of the flower.
    expect(Math.min(...tips.map(([, y]) => y))).toBeCloseTo(-99, 0);
  });
});

describe('unfurling', () => {
  const flower = dotFlower();
  const dot = flower.find((d) => d.kind === 'edge' && d.angle > 0.5);
  if (!dot) throw new Error('no turned petal');

  it('starts a quarter size, upright, a little off its place', () => {
    const [x, y] = unfurledAt(dot, dot.delay);
    expect(x).toBeCloseTo(dot.lx * 0.24 + dot.jx, 9);
    expect(y).toBeCloseTo(dot.ly * 0.24 + dot.jy, 9);
  });

  it('comes to rest where the open flower has it', () => {
    const [x, y] = unfurledAt(dot, dot.delay + TIMELINE.PETAL);
    const [rx, ry] = restingAt(dot);
    expect(x).toBeCloseTo(rx, 9);
    expect(y).toBeCloseTo(ry, 9);
  });

  it('opens the outer ring first', () => {
    const first = (ring: number) =>
      Math.min(...flower.filter((d) => d.kind !== 'heart' && d.tone === ring).map((d) => d.delay));
    expect(first(0)).toBeLessThan(first(1));
    expect(first(1)).toBeLessThan(first(2));
  });
});

describe('the timeline', () => {
  it('is open once the last dot of the flower has arrived, and not before (t-183)', () => {
    // What the entry bloom hands over on: lifting before it would cut the
    // opening short; long after it, the reader waits on a flower already open.
    const arrived = (d: ReturnType<typeof dotFlower>[number]) =>
      d.delay + (d.kind === 'heart' ? 0.8 : TIMELINE.PETAL);
    const last = Math.max(...dotFlower().map(arrived));
    expect(OPENED_AT).toBeGreaterThanOrEqual(last);
    expect(OPENED_AT - last).toBeLessThan(0.1);
  });

  it.each([
    [0, 'unfurl'],
    [TIMELINE.HEART_AT - 0.01, 'unfurl'],
    [TIMELINE.HEART_AT, 'gather'],
    [TIMELINE.WATER_AT - 0.01, 'gather'],
    [TIMELINE.WATER_AT, 'settle'],
    [TIMELINE.FLOW_AT - 0.01, 'settle'],
    [TIMELINE.FLOW_AT, 'beat'],
    [REST_T, 'beat'],
    [600, 'beat'],
  ])('at %ss is in its %s phase', (t, phase) => {
    expect(phaseAt(t)).toBe(phase);
  });

  it('does not beat before the flow begins', () => {
    expect(beatAt(0)).toEqual({ on: false, t: 0, n: -1, env: 0, pulse: 0 });
    expect(beatAt(TIMELINE.FLOW_AT).on).toBe(false);
  });

  it('counts its beats and grows into them', () => {
    const second = beatAt(TIMELINE.FLOW_AT + TIMELINE.BEAT + 0.06);
    expect(second.n).toBe(1);
    expect(second.t).toBeCloseTo(0.06, 6);
    expect(second.env).toBe(1);
    expect(beatAt(TIMELINE.FLOW_AT + 0.5).env).toBeCloseTo(0.2, 6);
  });

  it('beats lub-dub: a strong lub, a softer dub, then rest', () => {
    const lub = lubdub(0.06);
    const dub = lubdub(0.34);
    expect(lub).toBeCloseTo(1, 2);
    expect(dub).toBeLessThan(lub);
    expect(dub).toBeGreaterThan(0.5);
    expect(lubdub(0.2)).toBeLessThan(dub);
    expect(lubdub(2)).toBeLessThan(0.001);
  });

  it('holds its still frame long after everything has arrived', () => {
    const last = Math.max(...dotFlower().map((d) => d.delay));
    expect(REST_T).toBeGreaterThan(last + TIMELINE.PETAL + 1);
  });
});
