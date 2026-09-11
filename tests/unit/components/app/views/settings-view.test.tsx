// @vitest-environment happy-dom

/**
 * Settings — the one view in t-11 where a control does something.
 *
 * The two properties are opposite and both matter: the theme choice must
 * actually survive a reload, and the eleven leanings must NOT look as though
 * they would. A dial that moves and changes nothing is the thing D6 exists to
 * prevent, and it is invisible in a screenshot — a disabled slider and a live
 * one look nearly identical.
 *
 * @see components/app/views/settings-view.tsx
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsView } from '@/components/app/views/settings-view';
import { ThemeProvider, useTheme } from '@/hooks/use-theme';

function renderSettings() {
  return render(
    <ThemeProvider>
      <SettingsView />
    </ThemeProvider>
  );
}

/**
 * A second writer in the same provider — what `ShellTopbar` is on this route.
 *
 * The topbar's sun/moon toggle renders above `Panes`, so it is on screen at the
 * same time as this view and calls the same `setTheme`. Standing it up here is
 * the only way to reach the case where this panel's state and the app's
 * disagree; without it the suite can only ever see one writer.
 */
function Topbar() {
  const { theme, setTheme } = useTheme();
  return (
    <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      Toggle from the topbar
    </button>
  );
}

function renderWithTopbar() {
  return render(
    <ThemeProvider>
      <Topbar />
      <SettingsView />
    </ThemeProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = '';
});

describe('the theme choice', () => {
  it('persists the choice, which is what makes it survive a reload', async () => {
    renderSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    // The reload itself cannot be tested here; what a reload READS can be, and
    // `use-theme.tsx` resolves a stored choice ahead of the system preference.
    expect(window.localStorage.getItem('theme')).toBe('dark');
  });

  it('applies the choice immediately as well as storing it', async () => {
    renderSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('shows a stored choice as chosen', async () => {
    window.localStorage.setItem('theme', 'dark');
    renderSettings();
    // Not asserted before the click: the pressed state is deliberately withheld
    // until mount, because `useTheme` resolves from APIs the server does not
    // have. `findBy` waits for that pass rather than racing it.
    expect(await screen.findByRole('button', { name: 'Dark', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe(
      'false'
    );
  });

  it('presses "Follow my device" when no choice has been made', async () => {
    // D4's third state, and its DEFAULT. Two chips could not express it, so
    // `theme` alone would have pressed Light — reporting a choice nobody made
    // to a reader on macOS auto-appearance, who would then find it dark at
    // sunset.
    renderSettings();
    expect(
      await screen.findByRole('button', { name: 'Follow my device', pressed: true })
    ).toBeTruthy();
    for (const name of ['Light', 'Dark']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('gives the device back after a choice has been made', async () => {
    // The one-way door this task exists to close. Nothing cleared the stored
    // value before, so following the device again meant clearing site data.
    window.localStorage.setItem('theme', 'dark');
    renderSettings();
    await screen.findByRole('button', { name: 'Dark', pressed: true });

    await userEvent.click(screen.getByRole('button', { name: 'Follow my device' }));

    expect(window.localStorage.getItem('theme')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Follow my device' }).getAttribute('aria-pressed')
    ).toBe('true');
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('names the theme the device is actually showing', async () => {
    // Both directions, because the line is only honest if it follows. Asserting
    // the light case alone would pass against a hardcoded word — which is what
    // it would be if someone simplified the ternary away.
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('dark'),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList
    );
    try {
      renderSettings();
      expect(await screen.findByText(/showing the dark theme/)).toBeTruthy();
    } finally {
      matchMedia.mockRestore();
    }
  });

  it('stops naming the device once a choice is made, and names it again after', async () => {
    renderSettings();
    await screen.findByText(/Following your device/);

    await userEvent.click(screen.getByRole('button', { name: 'Light' }));
    expect(screen.queryByText(/Following your device/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Follow my device' }));
    expect(screen.getByText(/Following your device/)).toBeTruthy();
  });

  it('survives storage that throws rather than taking the page down', async () => {
    // A Safari private window throws on read as well as write. The hook already
    // treats that as "no choice recorded"; if this view let the throw escape it
    // would take the whole settings route out through the error boundary, on a
    // browser where the only consequence should be an unremembered preference.
    // Spied on the INSTANCE, not on `Storage.prototype`. happy-dom defines the
    // accessor on the object itself, so a prototype spy is never consulted —
    // and the test passed anyway, because "nothing chosen" is also what an
    // empty store says. That is the shape this whole file is written against:
    // an assertion that cannot tell the case it names from the default.
    const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    try {
      renderSettings();
      expect(await screen.findByText(/Following your device/)).toBeTruthy();
    } finally {
      getItem.mockRestore();
    }
  });

  it('follows a choice made somewhere else in the frame', async () => {
    // The topbar toggle writes the same storage this panel reads. A one-shot
    // read on mount left the panel asserting the opposite of what the app was
    // doing — the device line still on screen after a choice had been
    // stored one click earlier.
    renderWithTopbar();
    await screen.findByText(/Following your device/);

    await userEvent.click(screen.getByRole('button', { name: 'Toggle from the topbar' }));

    expect(screen.queryByText(/Following your device/)).toBeNull();
    expect(await screen.findByRole('button', { name: 'Dark', pressed: true })).toBeTruthy();
  });

  it('moves its pressed chip when the other writer flips back', async () => {
    window.localStorage.setItem('theme', 'dark');
    renderWithTopbar();
    await screen.findByRole('button', { name: 'Dark', pressed: true });

    await userEvent.click(screen.getByRole('button', { name: 'Toggle from the topbar' }));

    expect(await screen.findByRole('button', { name: 'Light', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the choice pressed when storage refuses the write', async () => {
    // `setTheme` swallows a `setItem` throw on purpose, so the choice still
    // applies for the session. Re-reading storage after that finds nothing —
    // so without a session-level guard the chip un-pressed one frame after the
    // click and the device line came back, on an app that was explicitly
    // dark. Exactly the contradiction the re-key was meant to close, arriving
    // from the other side.
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    try {
      renderSettings();
      await screen.findByText(/Following your device/);
      await userEvent.click(screen.getByRole('button', { name: 'Dark' }));

      expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe(
        'true'
      );
      expect(screen.queryByText(/Following your device/)).toBeNull();
    } finally {
      setItem.mockRestore();
    }
  });

  it('still shows the choice after a reload', async () => {
    // This used to be about the KEY: t-11 read storage in the view, so the
    // hook's private key lived in two places and only this test held them
    // together. `useTheme` publishes `choice` now and the duplication is gone,
    // so what it pins is the thing a reader cares about — a choice survives the
    // page going away and coming back.
    const first = renderSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    first.unmount();

    renderSettings();
    expect(await screen.findByRole('button', { name: 'Dark', pressed: true })).toBeTruthy();
  });

  it('moves the pressed state when the other is chosen', async () => {
    window.localStorage.setItem('theme', 'light');
    renderSettings();
    await screen.findByRole('button', { name: 'Light', pressed: true });
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe(
      'false'
    );
  });
});

describe('the eleven leanings', () => {
  it('shows all eleven', () => {
    renderSettings();
    expect(screen.getAllByRole('slider')).toHaveLength(11);
  });

  it('renders every one of them disabled', () => {
    // The strong form on purpose: "the first one is disabled" would pass a
    // change that wired ten of them.
    renderSettings();
    for (const slider of screen.getAllByRole('slider')) {
      expect((slider as HTMLInputElement).disabled).toBe(true);
    }
  });

  it('says on the page why they do not move', () => {
    renderSettings();
    expect(screen.getByText(/not yet settable/)).toBeTruthy();
  });

  it('points every slider at that explanation', () => {
    // Disabled controls are skipped by most keyboard readers, so the reason has
    // to be reachable from the control itself rather than only visible above it.
    renderSettings();
    const noteId = screen.getByText(/not yet settable/).getAttribute('id');
    expect(noteId).toBeTruthy();
    for (const slider of screen.getAllByRole('slider')) {
      expect(slider.getAttribute('aria-describedby')).toBe(noteId);
    }
  });

  it('names each slider by both of its ends', () => {
    // "Gentle" alone says nothing about which way the handle means, and the
    // left-hand word is what a `for`/`id` pairing would give on its own.
    renderSettings();
    expect(
      screen.getByRole('slider', { name: 'Gentle Direct, and further, challenging' })
    ).toBeTruthy();
  });
});

describe('both panels have an edge in both themes', () => {
  it('carries the resting shadow, because the border is transparent in light', () => {
    // `--color-card-border` is fully transparent in light mode and 8% in dark.
    // Without a shadow the panel's only separation from the surface in light
    // mode is a 1.06:1 fill difference, while dark gets a visible border — the
    // two themes differing structurally rather than chromatically.
    renderSettings();
    for (const name of ['Light and dark', 'Her leanings']) {
      const panel = screen.getByRole('heading', { name }).closest('section');
      expect(panel?.className, name).toContain('shadow-[var(--shadow-rest)]');
    }
  });
});

describe('the theme panel and the leanings are separate things', () => {
  it('keeps the theme control out of the leanings', () => {
    renderSettings();
    const leanings = screen.getByRole('heading', { name: 'Her leanings' }).closest('section');
    expect(leanings).toBeTruthy();
    expect(within(leanings as HTMLElement).queryByRole('button', { name: 'Dark' })).toBeNull();
  });
});
