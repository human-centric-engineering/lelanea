// @vitest-environment happy-dom

/**
 * The lotus — the app's opening gesture (§6.9, redrawn in t-134 as the owner's
 * T5 water lily), and what happens when someone has asked their machine to stop
 * things moving.
 *
 * Three properties are worth a test here; the geometry itself is the draw
 * list's, tested in `lotus-draw.test.ts`:
 *
 *   1. **The resting state is the default.** Every path that skips the animation
 *      — reduced motion, no JavaScript, a hydration gap — has to leave a correct
 *      lotus on the page rather than a bud that never opens. That is a claim
 *      about what is painted when nothing runs, so it is asserted on the closed
 *      render as well as the open one.
 *
 *   2. **Reduced motion is honoured, and `onOpened` still fires.** A caller
 *      sequencing something behind the bloom would otherwise be stranded for the
 *      whole session by an accessibility preference — the quiet way a
 *      reduced-motion path breaks a product.
 *
 *   3. **`size` means the bloom, not the frame.** §6.6 promises `Lotus` and
 *      `LotusMark` are interchangeable at the same size, and the two frames
 *      differ by half again in width. Nothing but a test notices when that
 *      stops being true.
 *
 * The `matchMedia` fake is the one from `tests/unit/hooks/use-theme.test.tsx`,
 * for the same reason: the preference has to be something the test can CHANGE,
 * not just something it can set once.
 *
 * @see components/app/ui/lotus.tsx
 */

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { existsSync } from 'node:fs';
import path from 'node:path';

import { LOTUS_OPENED_MS, Lotus } from '@/components/app/ui/lotus';
import { LotusMark } from '@/components/app/ui/lotus-mark';
import { LOTUS_GLYPH_BELOW, drawLotus, lotusFrames } from '@/components/app/ui/lotus-draw';
import { LOTUS_WHORLS, STAMEN_COUNT } from '@/components/app/ui/lotus-model';

/** Every petal in every whorl. */
const PETAL_COUNT = LOTUS_WHORLS.reduce((total, whorl) => total + whorl.count, 0);

type Listener = (event: MediaQueryListEvent) => void;

let listeners: Listener[] = [];
let prefersReduced = false;

function setPreference(reduced: boolean) {
  prefersReduced = reduced;
  for (const listener of listeners) {
    listener({ matches: reduced } as MediaQueryListEvent);
  }
}

beforeEach(() => {
  listeners = [];
  prefersReduced = false;
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? prefersReduced : false,
    media: query,
    addEventListener: (_: string, listener: Listener) => listeners.push(listener),
    removeEventListener: (_: string, listener: Listener) => {
      listeners = listeners.filter((entry) => entry !== listener);
    },
    addListener: (listener: Listener) => listeners.push(listener),
    removeListener: (listener: Listener) => {
      listeners = listeners.filter((entry) => entry !== listener);
    },
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.useRealTimers();
});

/** The wrapper carrying the open state and the breath, not the `<svg>`. */
function bloom(): HTMLElement {
  const element = document.querySelector('[data-open]');
  if (!(element instanceof HTMLElement)) throw new Error('no lotus rendered');
  return element;
}

function svg(): SVGSVGElement {
  const element = document.querySelector('svg');
  if (!element) throw new Error('no lotus svg rendered');
  return element;
}

/** Petal bands: every petal is drawn as lengthwise bands, each its own gradient. */
function bands(): Element[] {
  return [...document.querySelectorAll('svg path[fill^="url(#"]')];
}

/** Stamen strokes: a filament and its lit tip each. */
function stamenStrokes(): Element[] {
  return [...document.querySelectorAll('svg path[fill="none"]')];
}

/**
 * happy-dom has no 2D context. Stand one in that records repaints — every
 * frame starts with `clearRect` — and answers every other call harmlessly.
 */
let clearRect = vi.fn();
const noop = () => undefined;
function stubCanvas() {
  clearRect = vi.fn();
  const gradient = { addColorStop: vi.fn() };
  const ctx = new Proxy(
    { clearRect, createLinearGradient: () => gradient, createRadialGradient: () => gradient },
    // One shared no-op, not a `vi.fn()` per access: a full opening is ~190
    // frames of thousands of calls, and a mock each ran the worker out of memory.
    { get: (target, key) => (key in target ? target[key as keyof typeof target] : noop) }
  );
  return vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
}
const clearRectCalls = () => clearRect.mock.calls.length;

describe('Lotus', () => {
  describe('the flower', () => {
    it('is the bud while closed: every petal folded, no stamens yet', () => {
      render(<Lotus autoOpen={false} />);

      // Every petal is drawn — folded, not absent — and the bands divide evenly
      // among them. The crown has not risen.
      expect(bands().length).toBeGreaterThan(0);
      expect(bands().length % PETAL_COUNT).toBe(0);
      expect(stamenStrokes()).toHaveLength(0);
    });

    it('is the full bloom once open: petals, and the stamen crown', () => {
      render(<Lotus open />);

      expect(bands().length % PETAL_COUNT).toBe(0);
      expect(stamenStrokes()).toHaveLength(STAMEN_COUNT * 2);
    });

    it('sits on water — pads, ripples, halation — and drops it on request', () => {
      const { unmount } = render(<Lotus open />);
      const pads = document.querySelectorAll(
        'svg path[stroke]:not([fill="none"]):not([fill^="url"])'
      );
      expect(pads).toHaveLength(3);
      // Three ripple rings and the halation glow.
      expect(document.querySelectorAll('svg ellipse[fill="none"]')).toHaveLength(3);
      unmount();

      render(<Lotus open water={false} />);
      expect(document.querySelectorAll('svg ellipse[fill="none"]')).toHaveLength(0);
      expect(svg()).toHaveAttribute('viewBox', lotusFrames().animated.tight.box.join(' '));
    });

    it('gives each bloom its own gradient ids', () => {
      // Two blooms sharing ids means the second paints with the first's
      // gradients — an easy bug to introduce by hoisting `<defs>`.
      render(
        <>
          <Lotus autoOpen={false} />
          <Lotus autoOpen={false} />
        </>
      );
      const ids = [...document.querySelectorAll('linearGradient')].map((node) => node.id);

      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('is decorative — it never announces itself', () => {
      render(<Lotus autoOpen={false} />);
      expect(svg()).toHaveAttribute('aria-hidden', 'true');
    });

    it('renders the bloom at `size`, whatever frame is around it', () => {
      // §6.6's interchangeability promise. The water frame is wider than the
      // bloom, so what has to equal `size` is the bloom inside it.
      const size = 120;
      render(<Lotus autoOpen={false} size={size} />);
      const frameWidth = Number.parseFloat(bloom().style.width);

      expect(frameWidth * lotusFrames().animated.water.bloomFraction).toBeCloseTo(size, 5);
    });

    it('matches LotusMark at the same size', () => {
      render(
        <>
          <Lotus autoOpen={false} size={64} />
          <LotusMark size={64} />
        </>
      );
      const animated = Number.parseFloat(svg().getAttribute('width') ?? '0');
      const still = Number(document.querySelector('img')?.getAttribute('width'));

      // The same bloom width in both; the frames differ only in height (the
      // animated one has room for the bud).
      expect(Math.round(animated)).toBe(still);
    });
  });

  describe('opening', () => {
    it('starts closed and settles after its delay', () => {
      vi.useFakeTimers();
      render(<Lotus delay={500} />);

      expect(bloom()).toHaveAttribute('data-open', 'false');

      act(() => void vi.advanceTimersByTime(500));
      expect(bloom()).toHaveAttribute('data-open', 'true');
    });

    it('tells the caller once the last petal has arrived', () => {
      vi.useFakeTimers();
      const onOpened = vi.fn();
      render(<Lotus onOpened={onOpened} />);

      act(() => void vi.advanceTimersByTime(0));
      expect(onOpened).not.toHaveBeenCalled();

      act(() => void vi.advanceTimersByTime(LOTUS_OPENED_MS - 1));
      expect(onOpened).not.toHaveBeenCalled();

      act(() => void vi.advanceTimersByTime(1));
      expect(onOpened).toHaveBeenCalledTimes(1);
    });

    it('waits for the bloom to STOP: nothing moves after LOTUS_OPENED_MS', () => {
      // The bug this guards: `onOpened` once fired ~490ms before the last petal
      // settled, and a screen transition sequenced behind it cut the gesture
      // off mid-flight. Asserted on the DRAWING, not on the constants, so a
      // part added later with a longer tail fails here.
      const at = (ms: number) => JSON.stringify(drawLotus(ms, { water: true }));

      expect(at(LOTUS_OPENED_MS)).toBe(at(LOTUS_OPENED_MS + 5_000));
      expect(at(LOTUS_OPENED_MS - 50)).not.toBe(at(LOTUS_OPENED_MS));
    });

    it('fires an inline callback however often the parent re-renders', () => {
      // `onOpened={() => …}` is a new function every render. As an effect
      // dependency it cleared the pending timer on each render, and a parent
      // re-rendering faster than the gesture starved the callback for good.
      // Renders are committed BETWEEN advances, which is what exposes it.
      vi.useFakeTimers();
      const opened = vi.fn();
      const { rerender } = render(<Lotus onOpened={() => opened()} />);

      for (let elapsed = 0; elapsed < LOTUS_OPENED_MS + 1_000; elapsed += 100) {
        act(() => void vi.advanceTimersByTime(100));
        rerender(<Lotus onOpened={() => opened()} />);
      }

      expect(opened).toHaveBeenCalledTimes(1);
    });

    it('tells a caller who drives it, which is the shape the prop doc recommends', () => {
      vi.useFakeTimers();
      const onOpened = vi.fn();
      const { rerender } = render(<Lotus open={false} onOpened={onOpened} />);

      act(() => void vi.advanceTimersByTime(10_000));
      expect(onOpened).not.toHaveBeenCalled();

      rerender(<Lotus open onOpened={onOpened} />);
      act(() => void vi.advanceTimersByTime(LOTUS_OPENED_MS - 1));
      expect(onOpened).not.toHaveBeenCalled();

      act(() => void vi.advanceTimersByTime(1));
      expect(onOpened).toHaveBeenCalledTimes(1);

      // Once per opening, not once per render while open.
      rerender(<Lotus open onOpened={onOpened} />);
      act(() => void vi.advanceTimersByTime(10_000));
      expect(onOpened).toHaveBeenCalledTimes(1);
    });

    it('tells a caller again if the bloom is closed and reopened', () => {
      vi.useFakeTimers();
      const onOpened = vi.fn();
      const { rerender } = render(<Lotus open onOpened={onOpened} />);
      act(() => void vi.advanceTimersByTime(LOTUS_OPENED_MS));
      expect(onOpened).toHaveBeenCalledTimes(1);

      rerender(<Lotus open={false} onOpened={onOpened} />);
      rerender(<Lotus open onOpened={onOpened} />);
      act(() => void vi.advanceTimersByTime(LOTUS_OPENED_MS));

      expect(onOpened).toHaveBeenCalledTimes(2);
    });

    it('does not open on its own when told not to', () => {
      vi.useFakeTimers();
      render(<Lotus autoOpen={false} />);

      act(() => void vi.advanceTimersByTime(10_000));
      expect(bloom()).toHaveAttribute('data-open', 'false');
    });

    it('lets a caller drive it, ignoring autoOpen entirely', () => {
      vi.useFakeTimers();
      const { rerender } = render(<Lotus open={false} />);

      act(() => void vi.advanceTimersByTime(10_000));
      expect(bloom()).toHaveAttribute('data-open', 'false');

      rerender(<Lotus open />);
      expect(bloom()).toHaveAttribute('data-open', 'true');
    });

    it('plays on a canvas while the petals move, then leaves the open SVG', () => {
      // The canvas is up exactly while the bloom moves, and comes down on the
      // same clock as `onOpened`. The SVG stays in the DOM throughout — hidden,
      // not removed — so what remains is the identical open picture.
      vi.useFakeTimers();
      const getContext = stubCanvas();
      render(<Lotus />);
      act(() => void vi.advanceTimersByTime(0));

      expect(bloom()).toHaveAttribute('data-playing', 'true');
      expect(document.querySelector('canvas')).not.toBeNull();
      expect(svg().style.visibility).toBe('hidden');

      act(() => void vi.advanceTimersByTime(LOTUS_OPENED_MS));
      expect(bloom()).not.toHaveAttribute('data-playing');
      expect(document.querySelector('canvas')).toBeNull();
      expect(svg().style.visibility).toBe('visible');
      expect(stamenStrokes()).toHaveLength(STAMEN_COUNT * 2);
      getContext.mockRestore();
    });

    it('shows the open SVG when there is no canvas to paint on', () => {
      // A lost or unavailable 2D context must not leave a hidden SVG over an
      // empty canvas for the whole opening.
      vi.useFakeTimers();
      render(<Lotus />);
      act(() => void vi.advanceTimersByTime(0));

      expect(bloom()).toHaveAttribute('data-open', 'true');
      expect(bloom()).not.toHaveAttribute('data-playing');
      expect(svg().style.visibility).toBe('visible');
    });

    it('paints frames onto the canvas while it plays', () => {
      // The loop must paint the bud at once and keep painting as time passes.
      vi.useFakeTimers();
      const getContext = stubCanvas();
      render(<Lotus />);
      act(() => void vi.advanceTimersByTime(0));
      const first = clearRectCalls();
      expect(first).toBeGreaterThan(0);

      act(() => void vi.advanceTimersByTime(500));
      expect(clearRectCalls()).toBeGreaterThan(first);
      getContext.mockRestore();
    });

    it('breathes once open, and only when asked to', () => {
      const { rerender } = render(<Lotus open idle />);
      const breathing = bloom().className;

      rerender(<Lotus open idle={false} />);
      expect(bloom().className).not.toBe(breathing);
      expect(bloom().className.split(/\s+/)).toEqual(['relative', 'inline-block']);
    });

    it('does not breathe while the opening is still playing', () => {
      vi.useFakeTimers();
      const getContext = stubCanvas();
      render(<Lotus idle />);
      act(() => void vi.advanceTimersByTime(0));

      expect(bloom().className.split(/\s+/)).toEqual(['relative', 'inline-block']);
      act(() => void vi.advanceTimersByTime(LOTUS_OPENED_MS));
      expect(bloom().className.split(/\s+/)).not.toEqual(['relative', 'inline-block']);
      getContext.mockRestore();
    });
  });

  describe('reduced motion', () => {
    it('shows the bloom at rest immediately, with no canvas', () => {
      prefersReduced = true;
      render(<Lotus />);

      expect(bloom()).toHaveAttribute('data-open', 'true');
      expect(bloom()).toHaveAttribute('data-reduced-motion', 'true');
      expect(bloom()).not.toHaveAttribute('data-playing');
      expect(document.querySelector('canvas')).toBeNull();
      expect(stamenStrokes()).toHaveLength(STAMEN_COUNT * 2);
    });

    it('does not breathe, even with idle on', () => {
      prefersReduced = true;
      render(<Lotus idle />);

      expect(bloom().className.split(/\s+/)).toEqual(['relative', 'inline-block']);
    });

    it('still tells the caller, on the same tick', () => {
      // Otherwise a caller gating a screen behind `onOpened` would wait forever
      // for an animation that was never going to run.
      prefersReduced = true;
      const onOpened = vi.fn();
      render(<Lotus onOpened={onOpened} delay={5_000} />);

      expect(onOpened).toHaveBeenCalledTimes(1);
    });

    it('does not open a bloom the caller is holding closed', () => {
      // Skipping an animation is the promise a motion preference makes;
      // choosing the state it was going to arrive at is not.
      prefersReduced = true;
      render(<Lotus open={false} />);

      expect(bloom()).toHaveAttribute('data-open', 'false');
      expect(bloom()).toHaveAttribute('data-reduced-motion', 'true');
      expect(stamenStrokes()).toHaveLength(0);
    });

    it('tells a controlled caller on the same tick, too', () => {
      prefersReduced = true;
      const onOpened = vi.fn();
      render(<Lotus open onOpened={onOpened} />);

      expect(onOpened).toHaveBeenCalledTimes(1);
    });

    it('settles a bloom that was already opening when the preference changed', () => {
      vi.useFakeTimers();
      render(<Lotus delay={5_000} />);
      expect(bloom()).toHaveAttribute('data-open', 'false');

      act(() => setPreference(true));

      expect(bloom()).toHaveAttribute('data-open', 'true');
      expect(document.querySelector('canvas')).toBeNull();
      // And the pending timer was cleared rather than left to fire.
      act(() => void vi.advanceTimersByTime(10_000));
      expect(bloom()).toHaveAttribute('data-open', 'true');
    });

    it('animates for everyone else', () => {
      // The negative control: every case above would pass for free if the hook
      // returned `true` unconditionally.
      vi.useFakeTimers();
      const getContext = stubCanvas();
      render(<Lotus />);
      act(() => void vi.advanceTimersByTime(0));

      expect(bloom()).not.toHaveAttribute('data-reduced-motion');
      expect(document.querySelector('canvas')).not.toBeNull();
      getContext.mockRestore();
    });

    it('survives an environment with no matchMedia at all', () => {
      // @ts-expect-error — deleting a DOM global is the point of the case.
      delete window.matchMedia;
      expect(() => render(<Lotus open />)).not.toThrow();
      expect(bloom()).toHaveAttribute('data-open', 'true');
    });
  });
});

describe('LotusMark', () => {
  function img(): HTMLImageElement {
    const element = document.querySelector('img');
    if (!element) throw new Error('no mark rendered');
    return element;
  }

  it('is the baked bloom on water by default', () => {
    render(<LotusMark />);
    expect(img()).toHaveAttribute('src', '/lotus-mark.svg');
    // A still image: nothing here can move.
    expect(document.querySelector('[data-open]')).toBeNull();
  });

  it('is the half-open glyph without water below the glyph threshold', () => {
    // The open flower is ~2.3× wider than tall; at avatar size it would be a
    // sliver, so small marks show the bloom part-way open.
    render(<LotusMark size={LOTUS_GLYPH_BELOW - 1} water={false} />);
    expect(img()).toHaveAttribute('src', '/lotus-glyph.svg');
  });

  it('is the open bloom without water at and above the threshold', () => {
    render(<LotusMark size={LOTUS_GLYPH_BELOW} water={false} />);
    expect(img()).toHaveAttribute('src', '/lotus-bloom.svg');
  });

  it('sizes the BLOOM, whichever frame is around it', () => {
    const frames = lotusFrames().still;
    for (const [props, frame] of [
      [{ size: 120 }, frames.water],
      [{ size: 120, water: false }, frames.tight],
      [{ size: 24, water: false }, frames.glyph],
    ] as const) {
      const { unmount } = render(<LotusMark {...props} />);
      expect(Number(img().getAttribute('width'))).toBe(
        Math.round(props.size / frame.bloomFraction)
      );
      unmount();
    }
  });

  it('points only at files that exist', () => {
    for (const file of ['lotus-mark.svg', 'lotus-bloom.svg', 'lotus-glyph.svg']) {
      expect(existsSync(path.join(process.cwd(), 'public', file)), file).toBe(true);
    }
  });

  it('is hidden from assistive technology', () => {
    render(<LotusMark />);
    expect(img()).toHaveAttribute('alt', '');
    expect(img()).toHaveAttribute('aria-hidden', 'true');
  });
});
