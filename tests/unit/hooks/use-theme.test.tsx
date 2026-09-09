// @vitest-environment happy-dom

/**
 * Unit Tests: `hooks/use-theme.tsx` — the system preference is a DEFAULT, not a choice
 *
 * This file exists because of a carried divergence
 * (`.context/app/divergences.md` row 2). Upstream Sunrise wrote the resolved
 * system preference straight back into `localStorage` on first paint, so from
 * the second visit onward "hasn't chosen yet" and "chose light" were the same
 * stored state — and switching the OS to dark afterwards did nothing, forever.
 *
 * Against Sunrise's near-greyscale pair that is invisible. Against Lelañea's
 * oyster white and near-black charcoal it is the whole first impression, which
 * is why decision D4 says the system preference is the default and only the
 * toggle persists.
 *
 * **The tests that matter here are the ones asserting an ABSENCE** — that
 * nothing was written. Those pass for free if the provider never ran, so each
 * one first establishes that the theme was actually resolved.
 *
 * The no-flash script in `app/layout.tsx` performs the same resolution before
 * React exists; the last test pins the two together, because if they disagree
 * the first paint contradicts the first render.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider, useTheme } from '@/hooks/use-theme';

/** A `matchMedia` we can drive, so an OS theme change is a real event. */
function installMatchMedia(prefersDark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  let matches = prefersDark;

  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      void listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
      void listeners.delete(listener),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  return {
    /** Simulate the user switching their machine's appearance. */
    switchTo(dark: boolean) {
      matches = dark;
      act(() => {
        for (const listener of listeners) {
          listener({ matches: dark } as MediaQueryListEvent);
        }
      });
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

function Probe() {
  const { theme, setTheme } = useTheme();
  return (
    <button type="button" data-testid="probe" onClick={() => setTheme('dark')}>
      {theme}
    </button>
  );
}

function renderProvider() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  );
}

const currentTheme = () => screen.getByTestId('probe').textContent;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});

afterEach(() => {
  localStorage.clear();
});

describe('ThemeProvider', () => {
  describe('with no explicit choice recorded', () => {
    it('follows the system preference', () => {
      installMatchMedia(true);
      renderProvider();
      expect(currentTheme()).toBe('dark');
      expect(document.documentElement).toHaveClass('dark');
    });

    it('does not persist that default', () => {
      // The defect this whole file guards. Note the theme is asserted FIRST:
      // without it, "nothing was stored" would also pass if nothing had run.
      installMatchMedia(true);
      renderProvider();
      expect(currentTheme()).toBe('dark');
      expect(localStorage.getItem('theme')).toBeNull();
    });

    it('follows a later change of the system preference', () => {
      const media = installMatchMedia(false);
      renderProvider();
      expect(currentTheme()).toBe('light');

      media.switchTo(true);

      expect(currentTheme()).toBe('dark');
      expect(document.documentElement).toHaveClass('dark');
      expect(localStorage.getItem('theme')).toBeNull();
    });
  });

  describe('once the toggle has been used', () => {
    it('persists the choice', () => {
      installMatchMedia(false);
      renderProvider();
      expect(currentTheme()).toBe('light');

      act(() => screen.getByTestId('probe').click());

      expect(currentTheme()).toBe('dark');
      expect(localStorage.getItem('theme')).toBe('dark');
    });

    it('honours the stored choice over the system preference', () => {
      localStorage.setItem('theme', 'light');
      installMatchMedia(true);
      renderProvider();
      expect(currentTheme()).toBe('light');
      expect(document.documentElement).toHaveClass('light');
    });

    it('stops following the system once a choice is stored', () => {
      // The listener stays subscribed and re-reads storage on each event, so
      // this also covers a choice made in another tab.
      localStorage.setItem('theme', 'light');
      const media = installMatchMedia(false);
      renderProvider();
      expect(currentTheme()).toBe('light');

      media.switchTo(true);

      expect(currentTheme()).toBe('light');
    });
  });

  it('unsubscribes from the media query on unmount', () => {
    const media = installMatchMedia(false);
    const { unmount } = renderProvider();
    expect(media.listenerCount).toBe(1);
    unmount();
    expect(media.listenerCount).toBe(0);
  });

  it('keeps an explicit choice even when the write fails', () => {
    // Safari's private window has historically thrown on `setItem` while
    // `getItem` keeps working. The choice still applies for the session, so a
    // later OS switch must NOT revert it — the guard cannot rely on reading
    // back what it could not write.
    const media = installMatchMedia(false);
    // Spy on the INSTANCE: happy-dom's localStorage carries its own `setItem`,
    // so replacing Storage.prototype's leaves the real one in place — the
    // storage assertion below is what caught that.
    const write = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    try {
      renderProvider();
      act(() => screen.getByTestId('probe').click());
      expect(currentTheme()).toBe('dark');
      expect(write).toHaveBeenCalledWith('theme', 'dark');
      expect(localStorage.getItem('theme')).toBeNull(); // the write really did fail

      media.switchTo(false); // macOS switches back to light at sunrise

      expect(currentTheme()).toBe('dark'); // the choice survives
    } finally {
      write.mockRestore();
    }
  });

  it('survives an environment with no matchMedia at all', () => {
    // Upstream only reached `matchMedia` when nothing was stored; the OS-follow
    // subscription reaches it on EVERY mount. Without a guard that throws inside
    // render and an effect, taking the tree down through the nearest error
    // boundary — for users with an explicit choice, who never needed this path.
    // Safari < 14 has `matchMedia` but no `addEventListener` on the result.
    // @ts-expect-error — deleting a DOM API is the condition under test.
    delete window.matchMedia;
    localStorage.setItem('theme', 'dark');

    expect(() => renderProvider()).not.toThrow();
    expect(currentTheme()).toBe('dark');
  });

  it('falls back to light when matchMedia is absent and nothing is stored', () => {
    // @ts-expect-error — see above.
    delete window.matchMedia;
    expect(() => renderProvider()).not.toThrow();
    expect(currentTheme()).toBe('light');
  });

  it('ignores a junk value in storage rather than rendering it', () => {
    localStorage.setItem('theme', 'aubergine');
    installMatchMedia(true);
    renderProvider();
    expect(currentTheme()).toBe('dark');
  });

  it('resolves the theme the same way as the no-flash script', () => {
    // Two implementations of one rule: the inline script runs before React and
    // stamps the class, the hook resolves it again on mount. If the script ever
    // regains the `setItem` this file exists to remove, the first visit would
    // silently become an explicit choice again.
    const layout = readFileSync(path.join(process.cwd(), 'app', 'layout.tsx'), 'utf8');
    const script = layout.slice(layout.indexOf('__html:'), layout.indexOf('</head>'));
    expect(script).toContain("localStorage.getItem('theme')");
    expect(script).toContain('prefers-color-scheme: dark');
    expect(script).not.toContain('localStorage.setItem');
  });
});
