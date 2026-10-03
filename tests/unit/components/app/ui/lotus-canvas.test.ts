// @vitest-environment happy-dom

/**
 * The canvas painter: the animation's half of "two painters, one flower".
 * A recording context stands in for the browser's — what matters is that it
 * paints every shape, in order, with the tokens resolved to literal colours.
 *
 * @see components/app/ui/lotus-canvas.ts
 */
import { describe, expect, it, vi } from 'vitest';

import { lotusPainter, tokenReader } from '@/components/app/ui/lotus-canvas';
import { drawLotus, lotusFrames } from '@/components/app/ui/lotus-draw';
import { LOTUS_OPENED_MS } from '@/components/app/ui/lotus-model';
import type { Rgba } from '@/components/app/ui/lotus-colour';

function recordingContext() {
  const stops: string[] = [];
  const styles: string[] = [];
  const gradient = { addColorStop: (_: number, c: string) => stops.push(c) };
  const ctx = {
    canvas: { width: 400, height: 300 },
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    ellipse: vi.fn(),
    arc: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    createRadialGradient: vi.fn(() => gradient),
    set fillStyle(v: unknown) {
      if (typeof v === 'string') styles.push(v);
    },
    set strokeStyle(v: unknown) {
      if (typeof v === 'string') styles.push(v);
    },
    globalAlpha: 1,
    lineWidth: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, raw: ctx, stops, styles };
}

describe('lotusPainter', () => {
  const token = vi.fn((): Rgba => [23, 113, 138, 1]);

  it('paints every band with a gradient of literal colours', () => {
    const { ctx, raw, stops } = recordingContext();
    const shapes = drawLotus(LOTUS_OPENED_MS, { water: true });
    lotusPainter(token)(ctx, shapes, lotusFrames().animated.water, 400);

    const bands = shapes.filter((s) => s.kind === 'band').length;
    expect(raw.createLinearGradient).toHaveBeenCalledTimes(bands);
    expect(stops.length).toBeGreaterThanOrEqual(bands * 5);
    for (const c of stops) expect(c).toMatch(/^(#[0-9a-f]{6}|rgba\()/);
    expect(stops.join()).not.toContain('var(');
  });

  it('clears and scales the canvas to the frame before painting', () => {
    const { ctx, raw } = recordingContext();
    const frame = lotusFrames().animated.water;
    lotusPainter(token)(ctx, drawLotus(0, { water: true }), frame, 400);

    expect(raw.clearRect).toHaveBeenCalledWith(0, 0, 400, 300);
    const k = 400 / frame.box[2];
    expect(raw.setTransform).toHaveBeenLastCalledWith(
      k,
      0,
      0,
      k,
      -frame.box[0] * k,
      -frame.box[1] * k
    );
  });

  it('memoises colours across frames: a repaint reads no tokens', () => {
    // ~1,200 gradient stops a frame; resolving each from computed style every
    // frame is the cost this memo exists to avoid.
    const reads = vi.fn((): Rgba => [23, 113, 138, 1]);
    const paint = lotusPainter(reads);
    const shapes = drawLotus(2000, { water: true });
    paint(recordingContext().ctx, shapes, lotusFrames().animated.water, 400);
    const first = reads.mock.calls.length;
    expect(first).toBeGreaterThan(0);

    paint(recordingContext().ctx, shapes, lotusFrames().animated.water, 400);
    expect(reads.mock.calls.length).toBe(first);
  });
});

describe('tokenReader', () => {
  it('reads each token from computed style once, and parses it', () => {
    const getPropertyValue = vi.fn((name: string) => (name === '--a' ? ' #17718a ' : ''));
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue,
    } as unknown as CSSStyleDeclaration);
    const read = tokenReader(document.createElement('div'));

    expect(read('--a')).toEqual([23, 113, 138, 1]);
    expect(read('--a')).toEqual([23, 113, 138, 1]);
    expect(getPropertyValue).toHaveBeenCalledTimes(1);
  });

  it('reads a missing token as transparent rather than throwing mid-animation', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '',
    } as unknown as CSSStyleDeclaration);
    expect(tokenReader(document.createElement('div'))('--missing')).toEqual([0, 0, 0, 0]);
  });
});
