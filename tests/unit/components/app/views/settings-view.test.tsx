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
import { beforeEach, describe, expect, it } from 'vitest';

import { SettingsView } from '@/components/app/views/settings-view';
import { ThemeProvider } from '@/hooks/use-theme';

function renderSettings() {
  return render(
    <ThemeProvider>
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

  it('shows which one is in force', async () => {
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

  it('moves the pressed state when the other is chosen', async () => {
    renderSettings();
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
