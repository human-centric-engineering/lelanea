// @vitest-environment happy-dom

/**
 * The dotted lotus's painter (t-182): its sprites, read from the tokens where
 * the flower is mounted; the scene that paints it; and the clock that runs it.
 * A recording context stands in for the browser's, as in
 * `lotus-canvas.test.ts`.
 *
 * @see components/app/ui/dot-lotus-paint.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { REST_T, TIMELINE } from '@/components/app/ui/dot-lotus-geometry';
import {
  clearOf,
  dimOf,
  dotLoop,
  dotScene,
  readDotLook,
  sharedFlower,
  sharedMark,
  type DotLayout,
  type MakeCanvas,
} from '@/components/app/ui/dot-lotus-paint';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A context that records what it was asked to paint, and with what. */
function recordingContext() {
  const stops: [number, string][] = [];
  const fills: unknown[] = [];
  let drawn = 0;
  const gradient = {
    addColorStop: (offset: number, colour: string) => stops.push([offset, colour]),
  };
  const target = {
    canvas: { width: 800, height: 600 },
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    drawImage: () => {
      drawn++;
    },
    set fillStyle(value: unknown) {
      fills.push(value);
    },
  };
  const noop = () => undefined;
  const ctx = new Proxy(target, {
    get: (t, key) => (key in t ? t[key as keyof typeof t] : noop),
    set: (t, key, value) => {
      if (key === 'fillStyle') t.fillStyle = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, stops, fills, drawn: () => drawn };
}

/** Offscreen canvases for the sprites, each with its own recording context. */
function recordingCanvases() {
  const made: ReturnType<typeof recordingContext>[] = [];
  const make: MakeCanvas = () => {
    const recording = recordingContext();
    made.push(recording);
    return { canvas: {} as CanvasImageSource, ctx: recording.ctx };
  };
  return { make, made };
}

/** Computed style that answers from a table, and records where it was read. */
function styleFrom(tokens: Record<string, string>) {
  return vi.spyOn(window, 'getComputedStyle').mockImplementation(
    () =>
      ({
        getPropertyValue: (name: string) => tokens[name] ?? '',
      }) as CSSStyleDeclaration
  );
}

const LAYOUT: DotLayout = {
  ox: 400,
  oy: 300,
  scale: 1.5,
  spanL: 260,
  spanR: 260,
  spanV: 200,
  dpr: 1,
};

describe('readDotLook', () => {
  it('reads the tokens from the element the flower is mounted on', () => {
    const style = styleFrom({ '--dot-1': '#112233', '--dot-star': '#ffeedd' });
    const host = document.createElement('div');
    const { make, made } = recordingCanvases();

    readDotLook(host, make);

    expect(style).toHaveBeenCalledWith(host);
    // The first sprite is tone 0, `--dot-1`: a halo fading from the colour to
    // the same colour at zero alpha, then a solid core.
    expect(made[0].stops).toEqual([
      [0, '#112233'],
      [1, 'rgba(17, 34, 51, 0)'],
    ]);
    expect(made[0].fills).toContain('#112233');
    // The star is drawn in its own token.
    const star = made[TONE_COUNT];
    expect(star.stops).toContainEqual([0.5, '#ffeedd']);
  });

  it('takes the numbers and the blend from tokens too', () => {
    styleFrom({ '--dot-halo': '0.42', '--dot-blend': 'lighter', '--dot-pond': '0.32' });
    const look = readDotLook(document.createElement('div'), recordingCanvases().make);
    expect(look.halo).toBe(0.42);
    expect(look.blend).toBe('lighter');
    expect(look.pond).toBe(0.32);
  });

  it('falls back to the lotus token a missing dot token was derived from', () => {
    styleFrom({ '--color-lotus-petal-outer-edge': '#3d4789' });
    const { make, made } = recordingCanvases();
    readDotLook(document.createElement('div'), make);
    expect(made[0].stops[0]).toEqual([0, '#3d4789']);
  });

  it('survives every token missing, without throwing', () => {
    styleFrom({});
    const { make, made } = recordingCanvases();
    const look = readDotLook(document.createElement('div'), make);
    // Clear rather than a guessed colour, and the defaults for the numbers.
    expect(made[0].stops[0]).toEqual([0, 'rgba(0, 0, 0, 0)']);
    expect(look.glow).toEqual([0, 0, 0, 0]);
    expect(look.halo).toBe(0.3);
    expect(look.dotScale).toBe(1);
    expect(look.blend).toBe('source-over');
  });

  it('refuses a blend it does not know, rather than passing it to the canvas', () => {
    styleFrom({ '--dot-blend': 'multiply; color: red' });
    expect(readDotLook(document.createElement('div'), recordingCanvases().make).blend).toBe(
      'source-over'
    );
  });

  it('has no sprites, and does not throw, where there is no 2D context', () => {
    styleFrom({ '--dot-1': '#112233' });
    const look = readDotLook(document.createElement('div'), () => null);
    expect(look.dot.every((sprite) => sprite === null)).toBe(true);
    expect(look.star).toBeNull();
    const { ctx, drawn } = recordingContext();
    expect(() => dotScene(sharedFlower()).paint(ctx, look, LAYOUT, REST_T)).not.toThrow();
    expect(drawn()).toBe(0);
  });
});

/** The eight tones' sprites are made first; the star is next. */
const TONE_COUNT = 8;

describe('the colour helpers', () => {
  it('fade a colour to itself at zero alpha, never to transparent black', () => {
    expect(clearOf([236, 162, 108, 0.24])).toBe('rgba(236, 162, 108, 0)');
    expect(dimOf([236, 162, 108, 0.5], 0.5)).toBe('rgba(236, 162, 108, 0.25)');
  });
});

describe('dotScene', () => {
  function look() {
    styleFrom({
      '--dot-1': '#8e98d6',
      '--dot-2': '#aeb5ea',
      '--dot-3': '#d8dcf7',
      '--dot-core-1': '#ffd2ac',
      '--dot-core-2': '#eba06a',
      '--dot-core-3': '#c8784a',
      '--dot-water': '#a99bc0',
      '--dot-star': '#ffe8cc',
      '--dot-glow': 'rgba(236, 162, 108, 0.24)',
      '--dot-pond': '0.32',
      '--dot-pool': 'rgba(18, 12, 10, 0.38)',
    });
    return readDotLook(document.createElement('div'), recordingCanvases().make);
  }

  it('paints nothing of the flower before its first dots arrive', () => {
    const { ctx, drawn } = recordingContext();
    dotScene().paint(ctx, look(), LAYOUT, 0);
    expect(drawn()).toBe(0);
  });

  it('paints the whole flower once it is open', () => {
    const { ctx, drawn } = recordingContext();
    dotScene(sharedFlower(), { reduced: true }).paint(ctx, look(), LAYOUT, REST_T);
    // Every dot, plus the pond's three still rings.
    expect(drawn()).toBeGreaterThan(sharedFlower().length);
  });

  it('sends a ring across the pond on each beat, and lets go of light', () => {
    const scene = dotScene();
    const sprites = look();
    const counts: number[] = [];
    for (const t of [TIMELINE.FLOW_AT - 0.1, TIMELINE.FLOW_AT + 6]) {
      const { ctx, drawn } = recordingContext();
      // Run up to `t` a frame at a time, as the loop would.
      for (let s = Math.max(0, t - 4); s < t; s += 1 / 30) scene.paint(ctx, sprites, LAYOUT, s);
      const before = drawn();
      scene.paint(ctx, sprites, LAYOUT, t);
      counts.push(drawn() - before);
    }
    expect(counts[1]).toBeGreaterThan(counts[0] + 100);
  });

  it('keeps the pool inside the canvas, so it feathers out rather than ending on an edge', () => {
    const scales: [number, number][] = [];
    const { ctx } = recordingContext();
    const recorded = new Proxy(ctx, {
      get: (target, key) =>
        key === 'scale'
          ? (x: number, y: number) => scales.push([x, y])
          : (target as unknown as Record<string | symbol, unknown>)[key],
      set: (target, key, value) => Reflect.set(target, key, value),
    });
    const short = { ...LAYOUT, spanV: 90 };
    dotScene(sharedFlower(), { reduced: true }).paint(recorded, look(), short, REST_T);
    // The first oval is the pool: its vertical radius, in pixels, stops short
    // of the nearer canvas edge as seen from the heart.
    const [, ry] = scales[0];
    expect(ry).toBeGreaterThan(0);
    expect(ry).toBeLessThanOrEqual(short.spanV * short.scale);
  });

  describe('as the small mark (t-183)', () => {
    /** How many sprites one frame at `t` puts down, run up to it as the loop would. */
    function drawnAt(scene: ReturnType<typeof dotScene>, t: number) {
      const sprites = look();
      const { ctx, drawn } = recordingContext();
      for (let s = Math.max(0, t - 4); s < t; s += 1 / 30) scene.paint(ctx, sprites, LAYOUT, s);
      const before = drawn();
      scene.paint(ctx, sprites, LAYOUT, t);
      return drawn() - before;
    }

    it("draws none of the petals: they are the SVG's own", () => {
      // At rest and still, all that is left to draw is a flaring dot or two.
      // The full flower at the same moment draws every dot.
      const mark = drawnAt(dotScene(sharedMark(), { reduced: true, mark: true }), REST_T);
      expect(mark).toBeLessThan(sharedMark().length);
      expect(drawnAt(dotScene(sharedFlower(), { reduced: true }), REST_T)).toBeGreaterThan(
        sharedFlower().length
      );
    });

    it('still glows at the heart', () => {
      const { ctx, stops } = recordingContext();
      dotScene(sharedMark(), { reduced: true, mark: true }).paint(ctx, look(), LAYOUT, REST_T);
      expect(stops.some(([, colour]) => colour.startsWith('rgba(236, 162, 108'))).toBe(true);
    });

    it('lets go of light once it beats, and sends no ring across a pond', () => {
      const scene = dotScene(sharedMark(), { mark: true });
      const quiet = drawnAt(scene, TIMELINE.FLOW_AT - 0.1);
      const beating = drawnAt(dotScene(sharedMark(), { mark: true }), TIMELINE.FLOW_AT + 6);
      expect(beating).toBeGreaterThan(quiet);
      // The full flower's pond alone draws a hundred-odd dots a ring.
      expect(beating).toBeLessThan(100);
    });

    it('is dotted far more sparsely than the full flower', () => {
      expect(sharedMark().length).toBeLessThan(sharedFlower().length / 4);
      expect(sharedMark().some((d) => d.kind === 'echo' || d.kind === 'vein')).toBe(false);
      expect(sharedMark().filter((d) => d.kind === 'heart')).toHaveLength(7);
    });
  });

  it('forgets the light in flight on reset', () => {
    const scene = dotScene();
    const sprites = look();
    const { ctx } = recordingContext();
    for (let s = 0; s < TIMELINE.FLOW_AT + 6; s += 1 / 30) scene.paint(ctx, sprites, LAYOUT, s);
    scene.reset();
    const fresh = recordingContext();
    scene.paint(fresh.ctx, sprites, LAYOUT, 0);
    expect(fresh.drawn()).toBe(0);
  });
});

describe('dotLoop', () => {
  function host() {
    let now = 1000;
    const pending: ((now: number) => void)[] = [];
    return {
      host: {
        now: () => now,
        request: vi.fn((callback: (now: number) => void) => pending.push(callback)),
        cancel: vi.fn(),
      },
      /** Advance the clock and run the frame that was waiting. */
      frame(ms: number) {
        now += ms;
        pending.shift()?.(now);
      },
      pending,
    };
  }

  it('shows reduced motion the final frame, with no loop scheduled', () => {
    const clock = host();
    const paint = vi.fn();
    const loop = dotLoop(paint, { reduced: true, host: clock.host });

    loop.play();

    expect(paint).toHaveBeenCalledTimes(1);
    expect(paint).toHaveBeenCalledWith(REST_T);
    expect(clock.host.request).not.toHaveBeenCalled();
    expect(loop.running).toBe(false);
  });

  it('holds reduced motion on the final frame whatever the clock says', () => {
    const clock = host();
    const paint = vi.fn();
    const loop = dotLoop(paint, { reduced: true, host: clock.host });
    clock.frame(5000);
    loop.still();
    loop.replay();
    expect(paint.mock.calls).toEqual([[REST_T], [REST_T]]);
  });

  it('paints every frame while it plays, in seconds since it began', () => {
    const clock = host();
    const paint = vi.fn();
    const loop = dotLoop(paint, { reduced: false, host: clock.host });

    loop.play();
    clock.frame(500);
    clock.frame(500);

    expect(paint.mock.calls).toEqual([[0.5], [1]]);
    expect(clock.pending).toHaveLength(1);
    expect(loop.running).toBe(true);
  });

  it('schedules nothing more once paused', () => {
    const clock = host();
    const paint = vi.fn();
    const loop = dotLoop(paint, { reduced: false, host: clock.host });

    loop.play();
    loop.pause();
    clock.frame(16);

    expect(clock.host.cancel).toHaveBeenCalled();
    expect(paint).not.toHaveBeenCalled();
    expect(clock.pending).toHaveLength(0);
    expect(loop.running).toBe(false);
  });

  it('does not run twice when told to play twice', () => {
    const clock = host();
    const loop = dotLoop(vi.fn(), { reduced: false, host: clock.host });
    loop.play();
    loop.play();
    expect(clock.host.request).toHaveBeenCalledTimes(1);
  });

  it('does not count time spent paused, so an unseen opening is not skipped', () => {
    const clock = host();
    const paint = vi.fn();
    const loop = dotLoop(paint, { reduced: false, host: clock.host });

    // Twenty seconds in a background tab before it is first seen.
    clock.frame(20_000);
    loop.play();
    clock.frame(500);
    expect(paint).toHaveBeenLastCalledWith(0.5);

    // Hidden again mid-opening, for ten seconds, then back.
    loop.pause();
    clock.frame(10_000);
    loop.still();
    expect(paint).toHaveBeenLastCalledWith(0.5);
    loop.play();
    clock.frame(500);
    expect(paint).toHaveBeenLastCalledWith(1);
  });

  it('never steps backwards when a frame began a moment before it resumed', () => {
    const clock = host();
    const paint = vi.fn();
    const loop = dotLoop(paint, { reduced: false, host: clock.host });
    loop.play();
    clock.frame(1000);
    loop.pause();
    loop.play();
    // The browser hands the next frame a timestamp from before `play()`.
    clock.pending.shift()?.(clock.host.now() - 8);
    expect(paint).toHaveBeenLastCalledWith(1);
  });

  it('starts the timeline again on replay', () => {
    const clock = host();
    const paint = vi.fn();
    const loop = dotLoop(paint, { reduced: false, host: clock.host });
    clock.frame(4000);
    // Paused: the replay paints its first moment at once.
    loop.replay();
    expect(paint).toHaveBeenLastCalledWith(0);
    loop.play();
    clock.frame(250);
    expect(paint).toHaveBeenLastCalledWith(0.25);
  });
});
