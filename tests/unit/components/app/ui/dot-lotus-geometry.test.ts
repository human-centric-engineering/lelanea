/**
 * Where the dotted lotus's dots sit, and when (t-182).
 *
 * jsdom has no canvas, so everything the flower can be reduced to is a pure
 * function and is tested here directly: the spacing of dots along an outline,
 * the seed head's rings, the occlusion that tucks back petals behind front
 * ones, and the timeline.
 *
 * @see components/app/ui/dot-lotus-geometry.ts
 */
import { describe, expect, it } from 'vitest';

import {
  HEART,
  HEART_RINGS,
  K,
  REST_T,
  TIMELINE,
  UNFURL_RATE,
  beatAt,
  dotAt,
  dotFlower,
  heartDots,
  insidePolygon,
  lubdub,
  petalPosesAt,
  petalTips,
  phaseAt,
  spaced,
  type Point,
} from '@/components/app/ui/dot-lotus-geometry';
import { LOTUS_OPENED_MS } from '@/components/app/ui/lotus-model';

const gaps = (dots: readonly { x: number; y: number }[]) =>
  dots.slice(1).map((d, i) => Math.hypot(d.x - dots[i].x, d.y - dots[i].y));

describe('spaced', () => {
  it('includes both ends of a straight line', () => {
    const dots = spaced(
      [
        [0, 0],
        [10, 0],
      ],
      2
    );
    expect(dots[0]).toMatchObject({ x: 0, y: 0 });
    expect(dots[dots.length - 1]).toMatchObject({ x: 10, y: 0 });
    expect(dots).toHaveLength(6);
  });

  it('spaces dots evenly round corners, by distance along the line', () => {
    // An L: 10 across, then 10 down. 20 long; a gap of 3 rounds to 7 steps.
    const line: Point[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    const dots = spaced(line, 3);
    expect(dots).toHaveLength(8);
    expect(dots[dots.length - 1]).toMatchObject({ x: 10, y: 10 });
    // Distance ALONG the line: every step is 20/7, except the one cutting the
    // corner, which is shorter as the crow flies.
    const along = dots.map((d) => (d.y === 0 ? d.x : 10 + d.y));
    for (let i = 1; i < along.length; i++) expect(along[i] - along[i - 1]).toBeCloseTo(20 / 7, 6);
  });

  it('spaces a densely sampled curve evenly', () => {
    const arc: Point[] = Array.from({ length: 200 }, (_, i) => {
      const a = (i / 199) * Math.PI;
      return [Math.cos(a) * 50, Math.sin(a) * 50];
    });
    const steps = gaps(spaced(arc, 4));
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    expect(mean).toBeGreaterThan(3.5);
    for (const step of steps) expect(Math.abs(step - mean)).toBeLessThan(0.02);
  });

  it('records where on the line each dot fell', () => {
    const dots = spaced(
      [
        [0, 0],
        [4, 0],
        [8, 0],
      ],
      2
    );
    expect(dots.map((d) => d.at)).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it('gives a single dot for a line of no length, and none for no line', () => {
    expect(
      spaced(
        [
          [3, 3],
          [3, 3],
        ],
        2
      )
    ).toEqual([{ x: 3, y: 3, at: 0 }]);
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

describe('the heart', () => {
  it('lays each ring out at its radius, with its count of dots', () => {
    const dots = heartDots();
    expect(dots).toHaveLength(HEART_RINGS.reduce((n, [, count]) => n + count, 0));
    HEART_RINGS.forEach(([radius, count], k) => {
      const ring = dots.filter((d) => d.ring === k);
      expect(ring).toHaveLength(count);
      for (const d of ring) {
        expect(Math.hypot(d.x - HEART[0], d.y - HEART[1])).toBeCloseTo(radius, 6);
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
    const dots = heartDots();
    const delays = HEART_RINGS.map((_, k) => dots.find((d) => d.ring === k)?.delay ?? NaN);
    expect(delays[0]).toBe(TIMELINE.HEART_AT);
    for (let k = 1; k < delays.length; k++) expect(delays[k]).toBeGreaterThan(delays[k - 1]);
  });

  it('sits above the water, in the stamen crown', () => {
    expect(HEART[0]).toBe(0);
    expect(HEART[1]).toBeLessThan(0);
  });
});

describe('dotFlower', () => {
  const flower = dotFlower();

  it('dots every kind of line the prototype draws', () => {
    const kinds = new Set(flower.dots.map((d) => d.kind));
    expect([...kinds].sort()).toEqual(['echo', 'edge', 'heart', 'vein']);
  });

  it('puts each petal dot on its petal, where the open model has it', () => {
    const poses = petalPosesAt(TIMELINE.FLOW_AT);
    for (const d of flower.dots.filter((dot) => dot.kind !== 'heart').slice(0, 200)) {
      const [x, y] = dotAt(poses, d);
      // Exactly: where a dot rests is where the moving model brings it, so
      // nothing jumps when the opening ends.
      expect(x).toBeCloseTo(d.x, 9);
      expect(y).toBeCloseTo(d.y, 9);
    }
  });

  it("spaces the dots along an outline evenly, at the prototype's gap", () => {
    // The petal with the most of its outline showing. Where a petal in front
    // covers it, dots are dropped and leave a longer gap.
    const counts = new Map<number, number>();
    for (const d of flower.dots) {
      if (d.kind === 'edge') counts.set(d.petal, (counts.get(d.petal) ?? 0) + 1);
    }
    const [front] = [...counts].sort((a, b) => b[1] - a[1])[0];
    const edge = flower.dots.filter((d) => d.kind === 'edge' && d.petal === front);
    // Measured along each edge: across the sharp tip, two dots an even step
    // apart round the outline are close as the crow flies.
    const steps = gaps(edge)
      .filter((_, i) => edge[i].v === edge[i + 1].v)
      .sort((a, b) => a - b);
    expect(steps.length).toBeGreaterThan(40);
    const median = steps[Math.floor(steps.length / 2)];
    expect(median).toBeCloseTo(2.5 * K, 0);
    // Never crowded, and even wherever no dot was dropped — which is most of it.
    expect(steps[0]).toBeGreaterThan(median * 0.75);
    expect(steps[Math.floor(steps.length * 0.9)]).toBeLessThan(median * 1.15);
  });

  it('drops a dot wherever a petal painted after it covers it', () => {
    const position = new Map(flower.order.map((petal, i) => [petal, i]));
    const petalDots = flower.dots.filter((d) => d.kind !== 'heart');
    expect(petalDots.length).toBeGreaterThan(500);
    for (const d of petalDots) {
      const at = position.get(d.petal) ?? -1;
      for (let j = at + 1; j < flower.outlines.length; j++) {
        expect(insidePolygon(d.x, d.y, flower.outlines[j])).toBe(false);
      }
    }
  });

  it('keeps the seed head clear of petal dots', () => {
    const near = flower.dots.filter(
      (d) => d.kind !== 'heart' && Math.hypot(d.x - HEART[0], d.y - HEART[1]) < 15
    );
    expect(near).toEqual([]);
  });

  it('lets go of stars only from tips in view, never from part-way down a petal', () => {
    const tips = petalTips(flower);
    expect(tips.length).toBeGreaterThan(10);
    for (const [x, y] of tips) {
      const site = flower.dots.find((d) => d.kind === 'edge' && d.x === x && d.y === y);
      expect(site?.u).toBeGreaterThanOrEqual(0.95);
    }
  });

  it("keeps both ends of the open echo and vein, dropping only the outline's repeat", () => {
    // On the petal most in view, the echo reaches its base on both sides.
    const counts = new Map<number, number>();
    for (const d of flower.dots) {
      if (d.kind === 'echo') counts.set(d.petal, (counts.get(d.petal) ?? 0) + 1);
    }
    const [petal] = [...counts].sort((a, b) => b[1] - a[1])[0];
    const echo = flower.dots.filter((d) => d.kind === 'echo' && d.petal === petal);
    expect(echo.some((d) => d.u < 0.05 && d.v < 0)).toBe(true);
    expect(echo.some((d) => d.u < 0.05 && d.v > 0)).toBe(true);
  });
});

describe('the timeline', () => {
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

  it('runs its phases in order: unfurl, gather, settle, then the beat', () => {
    expect(TIMELINE.HEART_AT).toBeLessThan(TIMELINE.WATER_AT);
    expect(TIMELINE.WATER_AT).toBeLessThan(TIMELINE.FLOW_AT);
  });

  it('brings the petals to rest as the flow begins', () => {
    expect(TIMELINE.FLOW_AT * 1000 * UNFURL_RATE).toBeCloseTo(LOTUS_OPENED_MS, 6);
    // Rest is rest: the poses stop changing.
    expect(petalPosesAt(TIMELINE.FLOW_AT)).toEqual(petalPosesAt(TIMELINE.FLOW_AT + 5));
    expect(petalPosesAt(0)).not.toEqual(petalPosesAt(TIMELINE.FLOW_AT));
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
    const last = Math.max(...dotFlower().dots.map((d) => d.delay));
    expect(REST_T).toBeGreaterThan(last + TIMELINE.PETAL + 1);
  });
});
