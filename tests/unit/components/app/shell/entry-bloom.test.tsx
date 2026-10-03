// @vitest-environment happy-dom

/**
 * The entry bloom — when it plays, and that it always gets out of the way.
 *
 * `Lotus` owns the animation and has its own suite. What is ours here is the
 * owner's rule from t-132 — **the lotus unfolds on every full page load**, a
 * refresh and a return included, and NOT on moving around inside the app — and
 * the three ways the cover must come off: the bloom settling, the reader
 * skipping it, and (if scripts never run) a CSS fail-safe.
 *
 * The cover is server-rendered now, so a cover that never lifts would sit over
 * the whole app. Every exit has a case.
 *
 * @see components/app/shell/entry-bloom.tsx
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOTUS_OPENED_MS } from '@/components/app/ui/lotus';

/**
 * A fresh module per test: whether this document has bloomed is module state,
 * and a fresh module is exactly what a refresh or a new visit is.
 */
let EntryBloom: (typeof import('@/components/app/shell/entry-bloom'))['EntryBloom'];
async function newDocument() {
  vi.resetModules();
  ({ EntryBloom } = await import('@/components/app/shell/entry-bloom'));
}

const FAILSAFE_MS = LOTUS_OPENED_MS + 600;
/** The cover's fade-out. */
const FADE_MS = 900;

beforeEach(async () => {
  await newDocument();
  // The bloom is decorative and would otherwise animate for real in every case.
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Run the bloom to the end of its opening and its fade. */
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(LOTUS_OPENED_MS + 50);
  });
  await act(async () => {
    vi.advanceTimersByTime(FADE_MS + 50);
  });
}

describe('EntryBloom — on every full page load', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is in the server HTML, so the shell never shows before it', () => {
    const html = renderToString(<EntryBloom />);
    expect(html).toContain('data-testid="entry-bloom"');
  });

  it('plays again on the next load — a refresh is a new document', async () => {
    vi.useFakeTimers();
    const first = render(<EntryBloom />);
    await settle();
    expect(screen.queryByTestId('entry-bloom')).toBeNull();
    first.unmount();

    // The browser refreshed: a new document, a fresh module, a new mount.
    await newDocument();
    render(<EntryBloom />);
    expect(screen.queryByTestId('entry-bloom')).not.toBeNull();
  });

  it('does not replay on a link back into the app — the same document', async () => {
    // From Profile or Settings back to /app remounts the layout, but in a
    // document that has already bloomed: moving around, not a visit.
    vi.useFakeTimers();
    const first = render(<EntryBloom />);
    await settle();
    first.unmount();

    render(<EntryBloom />);
    expect(screen.queryByTestId('entry-bloom')).toBeNull();
  });

  it('remembers nothing between loads', () => {
    // The once-per-session flag is gone, not merely unread.
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<EntryBloom />);
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('does not replay while the layout stays mounted — moving around the app', async () => {
    // Client-side navigation re-renders the layout's children, not the layout:
    // the same EntryBloom instance stays mounted, done.
    vi.useFakeTimers();
    const { rerender } = render(<EntryBloom />);
    await settle();
    rerender(<EntryBloom />);
    expect(screen.queryByTestId('entry-bloom')).toBeNull();
  });

  it('fades out and unmounts once the last petal settles', async () => {
    vi.useFakeTimers();
    render(<EntryBloom />);
    await act(async () => {
      vi.advanceTimersByTime(LOTUS_OPENED_MS + 50);
    });
    expect(screen.getByTestId('entry-bloom').className).toContain('opacity-0');

    await act(async () => {
      vi.advanceTimersByTime(FADE_MS + 50);
    });
    expect(screen.queryByTestId('entry-bloom')).toBeNull();
  });

  it('blooms under StrictMode, which is how development runs it — and still lifts', async () => {
    // StrictMode remounts the same instance; the once-per-document flag must
    // not read its own write and skip the bloom, nor strand the cover.
    vi.useFakeTimers();
    render(
      <StrictMode>
        <EntryBloom />
      </StrictMode>
    );
    expect(screen.queryByTestId('entry-bloom')).not.toBeNull();
    await settle();
    expect(screen.queryByTestId('entry-bloom')).toBeNull();
  });
});

describe('EntryBloom — the lotus rises as it opens', () => {
  it('is large, and fades in and drifts up for the whole opening and fade', () => {
    render(<EntryBloom />);
    const rise = screen.getByTestId('entry-bloom-rise');
    expect(rise.className).toMatch(/rise/);
    expect(rise.style.animationDuration).toBe(`1000ms, ${LOTUS_OPENED_MS + FADE_MS}ms`);
    // Far bigger than the old 168px bloom: a fluid lotus up to 680px wide.
    expect(rise.className).toContain('w-[min(86vw,680px)]');
    expect(rise.querySelector('[data-open]')).toHaveStyle({ width: '100%' });
  });

  it('holds the rise until the bloom starts, so they move together', () => {
    // On the server — before JavaScript — the rise is paused at its start.
    expect(renderToString(<EntryBloom />)).toMatch(/animation-play-state:paused/);
    render(<EntryBloom />);
    expect(screen.getByTestId('entry-bloom-rise').style.animationPlayState).toBe('running');
  });

  it('does not breathe — it is leaving, not resting', async () => {
    vi.useFakeTimers();
    render(<EntryBloom />);
    await act(async () => {
      vi.advanceTimersByTime(LOTUS_OPENED_MS + 50);
    });
    const bloom = screen.getByTestId('entry-bloom-rise').querySelector('[data-open]');
    expect(bloom?.className.split(/\s+/)).toEqual(['relative', 'inline-block']);
    vi.useRealTimers();
  });
});

describe('EntryBloom — always gets out of the way', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lets a click or tap skip it', async () => {
    vi.useFakeTimers();
    render(<EntryBloom />);
    fireEvent.click(screen.getByTestId('entry-bloom'));
    expect(screen.getByTestId('entry-bloom').className).toContain('opacity-0');
    await act(async () => {
      vi.advanceTimersByTime(FADE_MS + 50);
    });
    expect(screen.queryByTestId('entry-bloom')).toBeNull();
  });

  it('lets Escape skip it', async () => {
    vi.useFakeTimers();
    render(<EntryBloom />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('entry-bloom').className).toContain('opacity-0');
    await act(async () => {
      vi.advanceTimersByTime(FADE_MS + 50);
    });
    expect(screen.queryByTestId('entry-bloom')).toBeNull();
  });

  it('lets Tab skip it, rather than move through controls nobody can see', () => {
    render(<EntryBloom />);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByTestId('entry-bloom').className).toContain('opacity-0');
  });

  it('ignores other keys', () => {
    render(<EntryBloom />);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.getByTestId('entry-bloom').className).toContain('opacity-100');
  });

  it('carries a CSS fail-safe until JavaScript is alive, then drops it', () => {
    // If the scripts never run, the server-rendered cover must lift by itself.
    // The server HTML carries the fail-safe class and its delay …
    const html = renderToString(<EntryBloom />);
    expect(html).toMatch(/class="[^"]*failsafe/);
    expect(html).toContain(`animation-delay:${LOTUS_OPENED_MS + 600}ms`);

    // … and once mounted the component's own clock takes over, so a slow-
    // hydrating device still gets the whole opening.
    render(<EntryBloom />);
    const cover = screen.getByTestId('entry-bloom');
    expect(cover).toHaveAttribute('data-hydrated', 'true');
    expect(cover.className).not.toMatch(/failsafe/);
  });

  it('does not bring the cover back if the fail-safe already lifted it', () => {
    // A phone that hydrates after the fail-safe has run: the reader is already
    // using the app. Dropping the fail-safe class would snap the cover back
    // over it for another whole opening.
    const getAnimations = vi.spyOn(HTMLElement.prototype, 'getAnimations').mockReturnValue([
      {
        animationName: 'entry-bloom-module__lift',
        currentTime: FAILSAFE_MS + 1,
      } as unknown as Animation,
    ]);
    render(<EntryBloom />);
    expect(screen.queryByTestId('entry-bloom')).toBeNull();
    getAnimations.mockRestore();
  });

  it('keeps the cover when the fail-safe has not started — hydration in time', () => {
    const getAnimations = vi
      .spyOn(HTMLElement.prototype, 'getAnimations')
      .mockReturnValue([
        { animationName: 'entry-bloom-module__lift', currentTime: 200 } as unknown as Animation,
      ]);
    render(<EntryBloom />);
    expect(screen.queryByTestId('entry-bloom')).not.toBeNull();
    getAnimations.mockRestore();
  });

  it('blocks clicks while it is opaque, and releases them for the fade', async () => {
    // Solid while opaque, so a click cannot land on a nav item nobody can see;
    // released as it fades, so the shell is live when it appears.
    vi.useFakeTimers();
    render(<EntryBloom />);
    expect(screen.getByTestId('entry-bloom').className).toContain('pointer-events-auto');

    await act(async () => {
      vi.advanceTimersByTime(LOTUS_OPENED_MS + 50);
    });
    expect(screen.getByTestId('entry-bloom').className).toContain('pointer-events-none');
  });

  it('is hidden from assistive technology', () => {
    render(<EntryBloom />);
    expect(screen.getByTestId('entry-bloom').getAttribute('aria-hidden')).toBe('true');
  });
});
