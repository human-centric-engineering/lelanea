// @vitest-environment happy-dom

/**
 * The settings page guards for itself, and shows the reader's own leanings
 * (f-leanings t-135).
 *
 * It read nothing about the reader until t-135, so the layout's entry check
 * covered it. Now it renders their settings, and a layout is not re-rendered
 * between siblings, so it asks for the session itself, as the account page
 * does (`shell-account-page.test.tsx`).
 *
 * @see app/(lelanea)/app/settings/page.tsx
 */

import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getServerSession = vi.hoisted(() => vi.fn());
const clearInvalidSession = vi.hoisted(() =>
  vi.fn(() => {
    // The real one redirects, which throws; a mock that returned would let the
    // page reach `session.user` and fail for the wrong reason.
    throw new Error('NEXT_REDIRECT');
  })
);
const getLeanings = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/utils', () => ({ getServerSession }));
vi.mock('@/lib/auth/clear-session', () => ({ clearInvalidSession }));
vi.mock('@/lib/app/voice/leanings-store', () => ({ getLeanings }));

import SettingsPage from '@/app/(lelanea)/app/settings/page';
import { ThemeProvider } from '@/hooks/use-theme';
import { LEANING_DIMENSIONS } from '@/lib/app/voice/leanings';

const ME = 'user-me';

beforeEach(() => {
  vi.clearAllMocks();
  getLeanings.mockResolvedValue({
    configured: true,
    dials: LEANING_DIMENSIONS.map((dimension) => ({
      ...dimension,
      stored: dimension.key === 'length' ? 2 : 0,
      position: dimension.key === 'length' ? 2 : 0,
      min: -2,
      max: 2,
      locked: false,
      suggest: true,
    })),
  });
});

describe('without a session', () => {
  it('clears the cookie and sends the reader back, reading nothing', async () => {
    getServerSession.mockResolvedValue(null);

    await expect(SettingsPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(clearInvalidSession).toHaveBeenCalledWith('/app/settings');
    expect(getLeanings).not.toHaveBeenCalled();
  });
});

describe('with a session', () => {
  it('reads the reader’s own leanings and shows where each rests', async () => {
    getServerSession.mockResolvedValue({ user: { id: ME } });

    render(<ThemeProvider>{await SettingsPage()}</ThemeProvider>);

    expect(getLeanings).toHaveBeenCalledWith(ME);
    const length = screen.getByRole('group', {
      name: 'Verbose and exploratory to Concise and spare',
    });
    expect(
      within(length).getByRole('radio', {
        name: 'Strongly toward Concise and spare',
      }).checked
    ).toBe(true);
  });

  it('claims only what is built: settings now, conversation with t-137', async () => {
    getServerSession.mockResolvedValue({ user: { id: ME } });

    render(<ThemeProvider>{await SettingsPage()}</ThemeProvider>);

    expect(screen.queryByText(/mid-conversation/)).toBeNull();
  });
});
