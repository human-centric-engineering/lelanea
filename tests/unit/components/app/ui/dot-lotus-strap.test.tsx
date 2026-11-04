// @vitest-environment happy-dom

/**
 * The strapline written on the water (t-184): that it is decoration, that it
 * stands still for reduced motion, and that a click on the flower writes it
 * again with the unfolding.
 *
 * That its words are the caption's, read once, is pinned where both render:
 * `tests/unit/app/public/home-page.test.tsx`.
 *
 * @see components/app/ui/dot-lotus-strap.tsx
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DotLotus } from '@/components/app/ui/dot-lotus';
import {
  stubBox,
  stubCanvas,
  stubFrames,
  stubMotion,
  stubOnScreen,
} from '@/tests/helpers/app/dot-canvas';

const WORDS = 'transcendental coaching, at your own pace';

beforeEach(() => {
  stubMotion(false);
  stubOnScreen();
  stubBox(470, 448);
  stubCanvas();
  stubFrames();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const strap = () => screen.getByTestId('dot-lotus-strap');
const letters = () => [...strap().querySelectorAll('tspan')];

describe('the strapline on the water', () => {
  it('writes the words letter by letter, each after the one before', () => {
    render(<DotLotus strap={WORDS} />);
    expect(
      letters()
        .map((l) => l.textContent?.replace(' ', ' '))
        .join('')
    ).toBe(WORDS);
    expect(letters().map((l) => l.style.getPropertyValue('--i'))).toEqual(
      [...WORDS].map((_, i) => String(i))
    );
  });

  it('is decoration: hidden from assistive technology, and not focusable', () => {
    render(<DotLotus strap={WORDS} />);
    expect(strap()).toHaveAttribute('aria-hidden', 'true');
    expect(strap()).toHaveAttribute('focusable', 'false');
  });

  it('is not written where the flower is given no words', () => {
    render(<DotLotus />);
    expect(screen.queryByTestId('dot-lotus-strap')).toBeNull();
  });

  it('waits for the flower to start before its letters come', () => {
    // The letters' animation runs only under a host the flower has lit.
    render(<DotLotus strap={WORDS} />);
    expect(strap().parentElement).toHaveAttribute('data-lit');
    const css = readFileSync(
      path.join(process.cwd(), 'components/app/ui/dot-lotus-strap.module.css'),
      'utf8'
    );
    expect(css).toMatch(/\.strap tspan \{[^}]*animation-play-state: paused/);
    expect(css).toMatch(/\[data-lit\]\) > \.strap tspan \{\s*animation-play-state: running/);
  });

  it('shows reduced motion the letters settled, with nothing moving', () => {
    stubMotion(true);
    render(<DotLotus strap={WORDS} />);
    expect(strap().getAttribute('class')).toMatch(/still/);
    // `.still` and the media query both settle every letter: no animation, in view.
    const css = readFileSync(
      path.join(process.cwd(), 'components/app/ui/dot-lotus-strap.module.css'),
      'utf8'
    );
    for (const rule of [
      /\.strap\.still tspan \{\s*animation: none;\s*opacity: 1;/,
      /prefers-reduced-motion: reduce\) \{\s*\.strap tspan \{\s*animation: none;\s*opacity: 1;/,
    ]) {
      expect(css).toMatch(rule);
    }
  });

  it('moves for everyone else', () => {
    render(<DotLotus strap={WORDS} />);
    expect(strap().getAttribute('class')).not.toMatch(/still/);
  });

  it('is written again when a click replays the flower', () => {
    render(<DotLotus strap={WORDS} />);
    const first = strap().querySelector('text');
    fireEvent.click(strap().parentElement as HTMLElement);
    const second = strap().querySelector('text');
    // A fresh line, so every letter's animation starts again.
    expect(second).not.toBe(first);
    expect(second?.textContent).toBe(first?.textContent);
  });

  it('is not written again by a click on a flower still waiting to be seen', () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = () => undefined;
        disconnect = () => undefined;
      }
    );
    render(<DotLotus strap={WORDS} startInView />);
    const first = strap().querySelector('text');
    fireEvent.click(strap().parentElement as HTMLElement);
    expect(strap().querySelector('text')).toBe(first);
  });
});
