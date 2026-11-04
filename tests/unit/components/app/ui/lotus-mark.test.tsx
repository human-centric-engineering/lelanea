// @vitest-environment happy-dom

/**
 * The small mark drawn in light (t-183): what assistive technology is given,
 * what remains where no canvas paints, and that its light only moves for a
 * reader who has not asked for less motion, while it can be seen.
 *
 * @see components/app/ui/lotus-mark.tsx
 */
import { act, fireEvent, render } from '@testing-library/react';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The scene, watched: the moment of the timeline each frame paints, and each
 * time it is told to forget what is in flight. That is what "still" and "plays
 * again" mean, and happy-dom cannot show either on a canvas.
 */
const painted: number[] = [];
let resets = 0;
vi.mock('@/components/app/ui/dot-lotus-paint', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/app/ui/dot-lotus-paint')>();
  return {
    ...actual,
    dotScene: (...args: Parameters<typeof actual.dotScene>) => {
      const scene = actual.dotScene(...args);
      return {
        paint: (...paintArgs: Parameters<typeof scene.paint>) => {
          painted.push(paintArgs[3]);
          scene.paint(...paintArgs);
        },
        reset: () => {
          resets += 1;
          scene.reset();
        },
      };
    },
  };
});

import { LotusMark } from '@/components/app/ui/lotus-mark';
import { REST_T } from '@/components/app/ui/dot-lotus-geometry';
import { stubCanvas, stubFrames, stubMotion, stubOnScreen } from '@/tests/helpers/app/dot-canvas';

beforeEach(() => {
  painted.length = 0;
  resets = 0;
  stubMotion(false);
  stubOnScreen();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

const flower = () => document.querySelector('img');

describe('LotusMark — what it is', () => {
  it('is the flat lotus, sized by its width', () => {
    render(<LotusMark size={30} />);
    expect(flower()).toHaveAttribute('src', '/dot-lotus-mark.svg');
    // 139 × 116 in its own units, so 30 wide is 25 tall.
    expect(flower()).toHaveAttribute('width', '30');
    expect(flower()).toHaveAttribute('height', '25');
    expect(existsSync(path.join(process.cwd(), 'public', 'dot-lotus-mark.svg'))).toBe(true);
  });

  it('is decoration, flower and light alike', () => {
    render(<LotusMark />);
    expect(flower()).toHaveAttribute('alt', '');
    expect(flower()).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');
  });

  it('adds nothing to the name of the link it sits in', () => {
    const { getByRole } = render(
      <a href="#home" aria-label="Lelañea, home">
        <LotusMark />
      </a>
    );
    expect(getByRole('link').textContent).toBe('');
    expect(getByRole('link', { name: 'Lelañea, home' })).toBeTruthy();
  });

  it('is the flat flower alone where it is asked for no light', () => {
    const canvas = stubCanvas();
    render(<LotusMark light={false} />);
    expect(document.querySelector('canvas')).toBeNull();
    expect(canvas.paints()).toBe(0);
  });
});

describe('LotusMark — its light', () => {
  it('runs while it can be seen', () => {
    const canvas = stubCanvas();
    const frames = stubFrames();
    render(<LotusMark />);
    expect(frames.request).toHaveBeenCalled();
    frames.run();
    expect(canvas.paints()).toBe(1);
    // And asks for the next one: it keeps running.
    expect(frames.request).toHaveBeenCalledTimes(2);
  });

  it('stops while the tab is hidden', () => {
    stubCanvas();
    const frames = stubFrames();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    render(<LotusMark />);
    expect(frames.request).not.toHaveBeenCalled();
  });

  it('is still for reduced motion: the open flower, nothing scheduled', () => {
    stubMotion(true);
    stubCanvas();
    const frames = stubFrames();
    render(
      <a href="#home">
        <LotusMark />
      </a>
    );
    // Not even pointing at it starts anything.
    fireEvent.pointerEnter(document.querySelector('a') as HTMLAnchorElement);
    expect(painted.length).toBeGreaterThan(0);
    expect(new Set(painted)).toEqual(new Set([REST_T]));
    expect(resets).toBe(0);
    expect(frames.request).not.toHaveBeenCalled();
  });

  it('plays the unfolding again when the link it sits in is pointed at', () => {
    stubCanvas();
    const frames = stubFrames();
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    render(
      <a href="#home">
        <LotusMark />
      </a>
    );
    now.mockReturnValue(10_000);
    frames.run();
    expect(painted.at(-1)).toBeCloseTo(10, 5);

    act(() => {
      fireEvent.pointerEnter(document.querySelector('a') as HTMLAnchorElement);
    });
    frames.run();
    // From the bud, with nothing left in flight.
    expect(resets).toBe(1);
    expect(painted.at(-1)).toBeCloseTo(0, 5);
  });

  it('runs where there is no way to ask whether it can be seen', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    stubCanvas();
    const frames = stubFrames();
    render(<LotusMark />);
    expect(frames.request).toHaveBeenCalled();
  });

  it('picks up again when its tab comes back', () => {
    stubCanvas();
    const frames = stubFrames();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    render(<LotusMark />);
    expect(frames.request).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(frames.request).toHaveBeenCalled();
  });

  it('repaints its still frame in the new colours when the theme changes', async () => {
    stubMotion(true);
    const canvas = stubCanvas();
    stubFrames();
    render(<LotusMark />);
    const before = canvas.paints();
    // Set on the mark itself: happy-dom does not inherit custom properties.
    const host = flower()?.parentElement as HTMLElement;
    const flip = async () => {
      document.documentElement.toggleAttribute('data-theme');
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
    // A theme change that leaves its colours alone paints nothing new…
    await flip();
    expect(canvas.paints()).toBe(before);
    // …and one that moves them repaints the still flower.
    host.style.setProperty('--color-lotus-core', '#123456');
    await flip();
    document.documentElement.removeAttribute('data-theme');
    expect(canvas.paints()).toBeGreaterThan(before);
  });

  it('lets go of everything when it unmounts', () => {
    stubCanvas();
    const frames = stubFrames();
    const cancel = vi.mocked(window.cancelAnimationFrame);
    const { unmount } = render(<LotusMark />);
    expect(frames.request).toHaveBeenCalled();
    unmount();
    expect(cancel).toHaveBeenCalled();
  });
});
