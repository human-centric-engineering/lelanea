// @vitest-environment happy-dom

/**
 * The dotted lotus as mounted (t-182): what assistive technology is given,
 * what remains where no canvas paints, and that the loop only runs while the
 * flower can be seen.
 *
 * happy-dom has no 2D context, no IntersectionObserver worth the name and no
 * animation frames of its own, so each is stood in for, recording what was
 * asked of it.
 *
 * @see components/app/ui/dot-lotus.tsx
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DotLotus } from '@/components/app/ui/dot-lotus';

let prefersReduced = false;
let observed: {
  callback: IntersectionObserverCallback;
  disconnect: ReturnType<typeof vi.fn>;
}[] = [];
let frames: ((now: number) => void)[] = [];
let request: ReturnType<typeof vi.fn<(callback: FrameRequestCallback) => number>>;
let cancel: ReturnType<typeof vi.fn<(handle: number) => void>>;
let clearRect: ReturnType<typeof vi.fn>;

const noop = () => undefined;
function stubCanvas() {
  clearRect = vi.fn();
  const gradient = { addColorStop: noop };
  const ctx = new Proxy(
    {
      canvas: { width: 0, height: 0 },
      clearRect,
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient,
    },
    { get: (target, key) => (key in target ? target[key as keyof typeof target] : noop) }
  );
  return vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
}

beforeEach(() => {
  prefersReduced = false;
  observed = [];
  frames = [];
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? prefersReduced : false,
    media: query,
    addEventListener: noop,
    removeEventListener: noop,
    addListener: noop,
    removeListener: noop,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      disconnect = vi.fn();
      constructor(callback: IntersectionObserverCallback) {
        observed.push({ callback, disconnect: this.disconnect });
      }
      observe = noop;
      unobserve = noop;
    }
  );
  request = vi.fn((callback: FrameRequestCallback) => frames.push(callback));
  cancel = vi.fn<(handle: number) => void>();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(request);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(cancel);
  // A box with a size, so there is a layout to paint into.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    top: 0,
    width: 440,
    height: 260,
    right: 540,
    bottom: 260,
    x: 100,
    y: 0,
    toJSON: noop,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

/**
 * Tell the flower how much of it is on screen — through the observers still
 * connected, as the browser would. (The reduced-motion preference arrives in
 * an effect, so the first observer is disconnected as soon as it lands.)
 */
function intersect(ratio: number) {
  act(() => {
    for (const { callback } of observed.filter(({ disconnect }) => !disconnect.mock.calls.length)) {
      callback(
        [{ isIntersecting: ratio > 0, intersectionRatio: ratio } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    }
  });
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Run the frame that is waiting, as the browser would. */
function runFrame() {
  act(() => frames.shift()?.(performance.now()));
}

const host = () => document.querySelector('canvas')?.parentElement as HTMLElement;

describe('DotLotus', () => {
  describe('what assistive technology is given', () => {
    it('keeps a labelled flower in the accessibility tree once the canvas paints', () => {
      stubCanvas();
      render(<DotLotus label="Lelañea" />);
      expect(host().dataset.lit).toBe('true');
      const image = screen.getByRole('img', { name: 'Lelañea' });
      expect(image).toHaveAttribute('src', '/lotus-bloom.svg');
      // Transparent, not removed: still in the tree, still named.
      expect(image).not.toHaveAttribute('aria-hidden');
    });

    it('hides the canvas from assistive technology', () => {
      stubCanvas();
      render(<DotLotus label="Lelañea" />);
      expect(document.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');
    });

    it('is decoration where it is given no label', () => {
      stubCanvas();
      render(<DotLotus />);
      expect(screen.queryByRole('img')).toBeNull();
      expect(document.querySelector('img')).toHaveAttribute('alt', '');
    });
  });

  it('keeps the baked flower while its box has no width to paint into', () => {
    stubCanvas();
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: noop,
    });
    render(<DotLotus />);
    expect(host().dataset.lit).toBeUndefined();
  });

  it('leaves the baked flower as the picture where there is no 2D context', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<DotLotus />);
    expect(host().dataset.lit).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });

  describe('the loop', () => {
    it('runs while the flower is on screen', () => {
      stubCanvas();
      render(<DotLotus />);
      intersect(1);
      expect(request).toHaveBeenCalledTimes(1);
      runFrame();
      expect(request).toHaveBeenCalledTimes(2);
      expect(clearRect).toHaveBeenCalled();
    });

    it('stops when the flower goes off-screen, and starts again when it returns', () => {
      stubCanvas();
      render(<DotLotus />);
      intersect(1);
      runFrame();
      const scheduled = request.mock.calls.length;

      intersect(0);
      expect(cancel).toHaveBeenCalled();
      // The frame that was already waiting finds the loop stopped and asks
      // for no other.
      runFrame();
      expect(request).toHaveBeenCalledTimes(scheduled);

      intersect(1);
      expect(request).toHaveBeenCalledTimes(scheduled + 1);
    });

    it('stops while the tab is hidden, and starts again when it is shown', () => {
      stubCanvas();
      render(<DotLotus />);
      intersect(1);
      const scheduled = request.mock.calls.length;

      setHidden(true);
      expect(cancel).toHaveBeenCalled();
      runFrame();
      expect(request).toHaveBeenCalledTimes(scheduled);

      setHidden(false);
      expect(request).toHaveBeenCalledTimes(scheduled + 1);
    });

    it('does not start in a hidden tab even when on screen', () => {
      stubCanvas();
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      render(<DotLotus />);
      intersect(1);
      expect(request).not.toHaveBeenCalled();
    });

    it('never schedules a frame for reduced motion, even before the preference is read', () => {
      // The hook says `false` on the first run; the flower asks for itself.
      prefersReduced = true;
      stubCanvas();
      render(<DotLotus />);
      expect(request).not.toHaveBeenCalled();
      expect(clearRect).toHaveBeenCalled();
    });

    it('shows reduced motion the open flower, still, with no loop', () => {
      prefersReduced = true;
      stubCanvas();
      render(<DotLotus />);
      intersect(1);
      expect(clearRect).toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    });

    it('stops and lets go of its observers when it unmounts', () => {
      stubCanvas();
      const { unmount } = render(<DotLotus />);
      intersect(1);
      unmount();
      expect(cancel).toHaveBeenCalled();
      expect(observed.every(({ disconnect }) => disconnect.mock.calls.length > 0)).toBe(true);
    });
  });

  describe('waiting to be seen', () => {
    it('does not unfold until half of it is in view', () => {
      stubCanvas();
      render(<DotLotus startInView />);
      intersect(0.2);
      expect(request).not.toHaveBeenCalled();
      intersect(0.5);
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('unfolds again on each return once it has left the screen entirely', () => {
      stubCanvas();
      render(<DotLotus startInView />);
      intersect(0.6);
      intersect(0);
      // Back, but not yet half in view: it waits again rather than resuming.
      intersect(0.2);
      expect(request).toHaveBeenCalledTimes(1);
      intersect(0.6);
      expect(request).toHaveBeenCalledTimes(2);
    });
  });

  describe('keeping up with the page', () => {
    it('repaints a paused flower when its box changes size', () => {
      let resized: (() => void) | undefined;
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback: () => void) {
            resized = callback;
          }
          observe = noop;
          disconnect = noop;
        }
      );
      stubCanvas();
      render(<DotLotus />);
      const paints = clearRect.mock.calls.length;
      act(() => resized?.());
      expect(clearRect.mock.calls.length).toBe(paints + 1);
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
      expect(clearRect.mock.calls.length).toBe(paints + 2);
    });

    /** Computed style answering `--dot-1` from a value the test can change. */
    function tokenStyle() {
      const tokens = { '--dot-1': '#3d4789' };
      vi.spyOn(window, 'getComputedStyle').mockImplementation(
        () =>
          ({
            getPropertyValue: (name: string) => (name === '--dot-1' ? tokens['--dot-1'] : ''),
          }) as CSSStyleDeclaration
      );
      return tokens;
    }

    /** Flip a watched attribute on <html>; the observer delivers on a microtask. */
    async function mutate(attribute: string) {
      await act(async () => {
        document.documentElement.setAttribute(attribute, String(Math.random()));
        await Promise.resolve();
      });
      document.documentElement.removeAttribute(attribute);
    }

    it('rebuilds its sprites when a token changes with the theme or the surface', async () => {
      const getContext = stubCanvas();
      const tokens = tokenStyle();
      render(<DotLotus />);
      const built = getContext.mock.calls.length;

      tokens['--dot-1'] = '#8e98d6';
      await mutate('data-surface');

      expect(getContext.mock.calls.length).toBeGreaterThan(built);
    });

    it('leaves its sprites alone when nothing it reads has changed', async () => {
      const getContext = stubCanvas();
      tokenStyle();
      render(<DotLotus />);
      const built = getContext.mock.calls.length;

      await mutate('class');

      expect(getContext.mock.calls.length).toBe(built);
    });

    it('does not paint a flower still waiting to be seen when the page resizes', () => {
      stubCanvas();
      render(<DotLotus startInView />);
      intersect(0.3);
      const paints = clearRect.mock.calls.length;
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
      expect(clearRect.mock.calls.length).toBe(paints);
    });
  });

  it('folds back to nothing once it has left the screen, not leaving its last open frame', () => {
    stubCanvas();
    render(<DotLotus startInView />);
    intersect(0.6);
    const paints = clearRect.mock.calls.length;
    intersect(0);
    // The replay paints its first moment at once — before any light arrives.
    expect(clearRect.mock.calls.length).toBe(paints + 1);
  });

  it('ignores a click on a flower still waiting to be seen', () => {
    stubCanvas();
    render(<DotLotus startInView />);
    intersect(0.3);
    const paints = clearRect.mock.calls.length;
    fireEvent.click(host());
    expect(clearRect.mock.calls.length).toBe(paints);
  });

  it('plays the unfolding again on a click', () => {
    stubCanvas();
    render(<DotLotus />);
    const paints = clearRect.mock.calls.length;
    // Paused (never seen), so the replay paints its first moment at once.
    fireEvent.click(host());
    expect(clearRect.mock.calls.length).toBe(paints + 1);
  });
});
