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

  it('presses NEITHER chip when no choice has been made', async () => {
    // D4's third state. `useTheme` publishes the RESOLVED theme and keeps
    // "nothing chosen" out of its shape, so pressing on that value would report
    // a choice nobody made — a reader on macOS auto-appearance would see Light
    // marked as theirs at midday and find it dark at sunset, one line under
    // copy saying their choice stands.
    renderSettings();
    expect(await screen.findByText(/Nothing chosen yet/)).toBeTruthy();
    for (const name of ['Light', 'Dark']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('false');
    }
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

  it('stops saying nothing is chosen once something is', async () => {
    renderSettings();
    await screen.findByText(/Nothing chosen yet/);
    await userEvent.click(screen.getByRole('button', { name: 'Light' }));
    expect(screen.queryByText(/Nothing chosen yet/)).toBeNull();
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
      expect(await screen.findByText(/Nothing chosen yet/)).toBeTruthy();
    } finally {
      getItem.mockRestore();
    }
  });

  it('follows a choice made somewhere else in the frame', async () => {
    // The topbar toggle writes the same storage this panel reads. A one-shot
    // read on mount left the panel asserting the opposite of what the app was
    // doing — "Nothing chosen yet" still on screen after a choice had been
    // stored one click earlier.
    renderWithTopbar();
    await screen.findByText(/Nothing chosen yet/);

    await userEvent.click(screen.getByRole('button', { name: 'Toggle from the topbar' }));

    expect(screen.queryByText(/Nothing chosen yet/)).toBeNull();
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

  it('still shows the choice after a reload', async () => {
    // The real point of this one is the KEY. The view reads storage directly,
    // because the hook keeps its key private and the divergence row pins its
    // public shape as untouched — so nothing but this test stops the two
    // drifting apart. Click, unmount, mount again: if the hook ever wrote
    // somewhere this does not read, the chip comes back unpressed here.
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

describe('the theme panel and the leanings are separate things', () => {
  it('keeps the theme control out of the leanings', () => {
    renderSettings();
    const leanings = screen.getByRole('heading', { name: 'Her leanings' }).closest('section');
    expect(leanings).toBeTruthy();
    expect(within(leanings as HTMLElement).queryByRole('button', { name: 'Dark' })).toBeNull();
  });
});
