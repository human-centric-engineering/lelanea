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
import userEvent from '@testing-library/user-event';
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
  const { theme, choice, setTheme, clearTheme } = useTheme();
  return (
    <>
      <button type="button" data-testid="probe" onClick={() => setTheme('dark')}>
        {theme}
      </button>
      {/* The choice as text, so "following the device" is assertable. */}
      <span data-testid="choice">{choice ?? 'none'}</span>
      <button type="button" data-testid="clear" onClick={clearTheme}>
        follow my device
      </button>
    </>
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
const currentChoice = () => screen.getByTestId('choice').textContent;

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

/**
 * LELAÑEA divergence (row 2), second half: `choice` and `clearTheme`.
 *
 * The first half made the system preference a default rather than a stored
 * choice. That left the app with three states and the hook publishing two, so
 * D4's default was unreachable once anything had been picked — `setTheme` is
 * the platform's only writer and it exclusively persists. §04 t-23 adds the way
 * back, and the thing worth pinning is not the clearing but what happens AFTER
 * it: the OS has to be followed again, or the control has changed a stored
 * value and nothing else.
 */
describe('clearTheme — giving the device back', () => {
  it('reports no choice until one is made, then reports it', async () => {
    installMatchMedia(false);
    renderProvider();
    expect(currentChoice()).toBe('none');

    await userEvent.click(screen.getByTestId('probe'));
    expect(currentChoice()).toBe('dark');
  });

  it('removes the stored value rather than writing a new one', async () => {
    installMatchMedia(false);
    localStorage.setItem('theme', 'dark');
    renderProvider();
    expect(currentTheme()).toBe('dark');
    // The initialiser, which nothing else pins: replacing it with a plain
    // `null` fails only the settings-view suite without this line.
    expect(currentChoice()).toBe('dark');

    await userEvent.click(screen.getByTestId('clear'));

    expect(localStorage.getItem('theme')).toBeNull();
    expect(currentChoice()).toBe('none');
  });

  it('resolves to the device immediately, not on the next reload', async () => {
    // The reader asked to follow their device, and the device may disagree with
    // what is on screen. Leaving `theme` alone would make the control look
    // inert until something else happened to re-render.
    const media = installMatchMedia(true);
    localStorage.setItem('theme', 'light');
    renderProvider();
    expect(currentTheme()).toBe('light');

    await userEvent.click(screen.getByTestId('clear'));
    expect(currentTheme()).toBe('dark');
    expect(media.listenerCount).toBe(1);
  });

  it('follows the OS again afterwards, which is the whole point', async () => {
    // The assertion this describe block exists for. Clearing storage without
    // also clearing the ref that guards the media listener would leave the app
    // permanently on whatever it resolved to at the moment of the click — a
    // control that reports success and changes nothing.
    const media = installMatchMedia(false);
    renderProvider();
    await userEvent.click(screen.getByTestId('probe')); // choose dark
    expect(currentTheme()).toBe('dark');

    // The OS driven AWAY from the choice, not toward it. `switchTo(true)` here
    // asserted 'dark' against a theme that was already dark — it would have
    // passed with the guard deleted entirely, and could not tell "OS ignored"
    // from "OS followed".
    media.switchTo(false);
    expect(currentTheme()).toBe('dark'); // a choice stands, OS ignored

    await userEvent.click(screen.getByTestId('clear'));
    media.switchTo(false);
    expect(currentTheme()).toBe('light');
    media.switchTo(true);
    expect(currentTheme()).toBe('dark');
  });

  it('still follows the device when storage refuses to forget', async () => {
    // `setTheme` swallows a failed write so the choice applies for the session;
    // this is the mirror. A browser that refuses `removeItem` must not leave
    // the reader stuck on a choice they have just asked to drop.
    const media = installMatchMedia(false);
    localStorage.setItem('theme', 'dark');
    renderProvider();

    const removeItem = vi.spyOn(window.localStorage, 'removeItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    try {
      await userEvent.click(screen.getByTestId('clear'));
      expect(currentChoice()).toBe('none');
      media.switchTo(true);
      expect(currentTheme()).toBe('dark');
    } finally {
      removeItem.mockRestore();
    }
  });
});

/**
 * The two cases `/code-review` found in t-23, both about a THIRD source of
 * truth: the OS listener reads `localStorage` directly, so it can disagree with
 * both `sessionIntent` and `choice`.
 *
 * Another tab is the only way to reach either, which is why neither showed up
 * in the single-tab suite above.
 */
describe('when another tab writes the shared key', () => {
  it('stops following the OS once another tab stores a choice, even after this tab cleared', async () => {
    // `'cleared'` must mean "storage lied about the removal", not "ignore
    // storage forever". Clicking the already-pressed chip is a no-op a reader
    // would think nothing of, and it used to latch that state — leaving this
    // tab following the OS over an explicit choice made next door. The pre-t-23
    // boolean was `false` here and storage won.
    //
    // The OS is driven to the OPPOSITE of the current theme on purpose. Sending
    // it where the theme already is would pass whether the guard ran or not —
    // the shape of vacuous assertion this feature has produced four times.
    const media = installMatchMedia(false);
    renderProvider();
    await userEvent.click(screen.getByTestId('clear'));
    expect(currentTheme()).toBe('light');

    localStorage.setItem('theme', 'light'); // another tab picks Light
    media.switchTo(true); // …and the OS goes dark

    expect(currentTheme()).toBe('light');
    expect(currentChoice()).toBe('light');
  });

  it('does not ADOPT the value, which is a separate gap left open on purpose', async () => {
    // Worth pinning because a reader of the test above will reasonably expect
    // adoption, and reaching for it would widen divergence row 2 past the
    // defect `sunrise#756` describes. The hook stops FOLLOWING on a foreign
    // write; it does not repaint to match. Row 2 says so in as many words.
    const media = installMatchMedia(false);
    renderProvider();
    expect(currentTheme()).toBe('light');

    localStorage.setItem('theme', 'dark');
    media.switchTo(true);

    expect(currentTheme()).toBe('light'); // stopped, not adopted
  });

  it('stops reporting a choice once another tab has cleared it', async () => {
    // The mirror. `choice` is this tab's copy of a value another tab can
    // delete, so following the device without reconciling it left the settings
    // panel pressing Dark on an app that was tracking the OS — the exact
    // "reports a choice nobody made" failure the three-chip control exists to
    // prevent.
    const media = installMatchMedia(false);
    localStorage.setItem('theme', 'dark');
    renderProvider();
    expect(currentChoice()).toBe('dark');

    localStorage.removeItem('theme'); // another tab hands the device back
    media.switchTo(true);

    expect(currentTheme()).toBe('dark');
    expect(currentChoice()).toBe('none');
  });
});
