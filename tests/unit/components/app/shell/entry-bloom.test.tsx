// @vitest-environment happy-dom

/**
 * The entry bloom's session gate — the part of it that is ours.
 *
 * `Lotus` already owns the animation and is covered by its own suite. What is
 * new here is the once-per-session rule, and it needs its own test for a
 * specific reason: **the prototype has no `sessionStorage` at all.** It blooms
 * on every render of its `#app` view, so the screenshot comparison in this
 * task's done-when cannot sign this behaviour off — there is nothing on the
 * other side to compare against.
 *
 * The failure it guards is also silent in the direction that matters. A gate
 * that never writes its flag looks perfect on a first visit and wrong only on
 * the second, which is the visit nobody screenshots.
 *
 * @see components/app/shell/entry-bloom.tsx
 */

import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntryBloom } from '@/components/app/shell/entry-bloom';
import { LOTUS_OPENED_MS } from '@/components/app/ui/lotus';

beforeEach(() => {
  window.sessionStorage.clear();
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

describe('EntryBloom — once per session', () => {
  it('blooms on the first view of a session', () => {
    render(<EntryBloom />);
    expect(screen.queryByTestId('entry-bloom')).not.toBeNull();
  });

  it('does not bloom on the second view of the same session', () => {
    const first = render(<EntryBloom />);
    expect(screen.queryByTestId('entry-bloom')).not.toBeNull();
    first.unmount();

    render(<EntryBloom />);
    expect(screen.queryByTestId('entry-bloom')).toBeNull();
  });

  it('records the flag rather than relying on a module-level variable', () => {
    // A module flag would pass the case above and fail on a full page load,
    // which is the real second visit. Assert the durable record directly.
    render(<EntryBloom />);
    expect(window.sessionStorage.getItem('lelanea.bloom.seen')).toBe('1');
  });

  it('blooms again once the session ends', () => {
    const first = render(<EntryBloom />);
    first.unmount();
    window.sessionStorage.clear(); // a new tab, or a new visit

    render(<EntryBloom />);
    expect(screen.queryByTestId('entry-bloom')).not.toBeNull();
  });

  it('renders nothing rather than an empty overlay once seen', () => {
    // A returning visitor must not get a fixed, full-screen element over the
    // shell — even a transparent one, which would eat every click.
    const first = render(<EntryBloom />);
    first.unmount();

    const { container } = render(<EntryBloom />);
    expect(container.firstChild).toBeNull();
  });

  it('still blooms when sessionStorage throws', () => {
    // Private mode, or storage disabled by policy. Showing the opening gesture
    // twice is a far smaller cost than throwing on mount and taking the shell
    // down with it.
    const denied = () => {
      throw new Error('storage disabled');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied);

    expect(() => render(<EntryBloom />)).not.toThrow();
    expect(screen.queryByTestId('entry-bloom')).not.toBeNull();
    vi.restoreAllMocks();
  });

  it('fades out and unmounts once the last petal settles', async () => {
    // The overlay is `fixed inset-0` over the whole shell. If the leave path
    // never completes it is not a cosmetic bug: the shell is covered and,
    // without `pointer-events-none`, would be unusable for the session.
    vi.useFakeTimers();
    try {
      render(<EntryBloom />);
      expect(screen.queryByTestId('entry-bloom')).not.toBeNull();

      // `Lotus` calls `onOpened` when it settles; drive its timer, then ours.
      await act(async () => {
        vi.advanceTimersByTime(LOTUS_OPENED_MS + 50);
      });
      expect(screen.getByTestId('entry-bloom').className).toContain('opacity-0');

      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.queryByTestId('entry-bloom')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('still blooms under StrictMode, which is how development runs it', () => {
    // `next.config.js` sets `reactStrictMode: true`, so React mounts, tears
    // down and remounts the same instance in development. With the flag written
    // and read in the same effect, the first run wrote `'1'` and the second read
    // it back and concluded the bloom had already been seen — so the opening
    // gesture never appeared in development at ALL, the only environment anyone
    // would be checking it in. Fast Refresh remounts did the same.
    //
    // This case has to render under `StrictMode` explicitly: Testing Library
    // does not, so every other case in this file passes with or without the
    // guard and none of them can see this.
    render(
      <StrictMode>
        <EntryBloom />
      </StrictMode>
    );
    expect(screen.queryByTestId('entry-bloom')).not.toBeNull();
  });

  it('still blooms only once per session under StrictMode', () => {
    // The guard must not have bought the first bloom by breaking the rule.
    const first = render(
      <StrictMode>
        <EntryBloom />
      </StrictMode>
    );
    expect(screen.queryByTestId('entry-bloom')).not.toBeNull();
    first.unmount();

    render(
      <StrictMode>
        <EntryBloom />
      </StrictMode>
    );
    expect(screen.queryByTestId('entry-bloom')).toBeNull();
  });

  it('blocks clicks while it is opaque, and releases them for the fade', async () => {
    // This case previously asserted `pointer-events-none` THROUGHOUT, which was
    // the defect rather than the requirement: the cover is `bg-background`, so
    // for the ~2.9s the bloom takes to settle a click went through to a nav item
    // or the theme toggle nobody could see. Worst on a deep link, where what is
    // under the cursor is not what the last page had there.
    //
    // Solid while opaque; released as it fades, so the shell is live when it
    // appears rather than 420ms later.
    vi.useFakeTimers();
    try {
      render(<EntryBloom />);
      expect(screen.getByTestId('entry-bloom').className).toContain('pointer-events-auto');

      await act(async () => {
        vi.advanceTimersByTime(LOTUS_OPENED_MS + 50);
      });
      expect(screen.getByTestId('entry-bloom').className).toContain('pointer-events-none');
    } finally {
      vi.useRealTimers();
    }
  });

  it('is hidden from assistive technology', () => {
    // It is decorative, briefly covers everything, and cannot be dismissed.
    render(<EntryBloom />);
    expect(screen.getByTestId('entry-bloom').getAttribute('aria-hidden')).toBe('true');
  });
});
