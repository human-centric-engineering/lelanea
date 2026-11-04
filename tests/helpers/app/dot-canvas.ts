/**
 * Stand-ins for what the dotted lotus needs from a browser and happy-dom does
 * not give: a 2D context that accepts every call, and animation frames that
 * run only when a test says so. Each records what was asked of it.
 *
 * `tests/unit/components/app/ui/dot-lotus.test.tsx` carries its own copy, from
 * before there was a second user.
 */
import { act } from '@testing-library/react';
import { vi } from 'vitest';

const noop = () => undefined;

/** A 2D context for every canvas: any call is accepted and does nothing. */
export function stubCanvas() {
  const gradient = { addColorStop: noop };
  const calls: string[] = [];
  const target = {
    canvas: { width: 0, height: 0 },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };
  const ctx = new Proxy(target, {
    get: (object, key) => {
      if (key in object) return object[key as keyof typeof object];
      return () => {
        calls.push(String(key));
      };
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D
  );
  return {
    /** How many frames have been painted: each one starts by clearing. */
    paints: () => calls.filter((call) => call === 'clearRect').length,
  };
}

/** Animation frames that wait to be run. */
export function stubFrames() {
  const frames: FrameRequestCallback[] = [];
  const request = vi.fn((callback: FrameRequestCallback) => frames.push(callback));
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(request);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(noop);
  return {
    request,
    /** Run the frame that is waiting, as the browser would. */
    run: () => act(() => frames.shift()?.(performance.now())),
  };
}

/** `matchMedia`, answering the reduced-motion query as told. Undo with `vi.unstubAllGlobals()`. */
export function stubMotion(reduced: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduced : false,
    media: query,
    addEventListener: noop,
    removeEventListener: noop,
    addListener: noop,
    removeListener: noop,
    dispatchEvent: () => false,
  }));
}

/**
 * An `IntersectionObserver` that reports everything it watches as wholly on
 * screen the moment it starts watching. Undo with `vi.unstubAllGlobals()`.
 */
export function stubOnScreen() {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe = (target: Element) =>
        this.callback(
          [{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver
        );
      unobserve = noop;
      disconnect = noop;
    }
  );
}

/** Give every element a box, so there is somewhere to paint. */
export function stubBox(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: noop,
  });
}
