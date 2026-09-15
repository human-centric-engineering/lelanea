// @vitest-environment happy-dom

/**
 * The account menu — the rows, the role gate, dark mode, sign-out and its
 * failure path, and the two ways it collides with the ≤900px drawer.
 *
 * The theme cases render inside the REAL `ThemeProvider`, not a mocked hook. A
 * mocked hook can only prove the component called it; what needs proving is
 * that the item flips `<html>`'s class and persists the choice, which is the
 * whole observable behaviour of the control.
 *
 * @see components/app/shell/account-menu.tsx
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSignOut = vi.hoisted(() => vi.fn());
const mockTrack = vi.hoisted(() => vi.fn());
const mockReset = vi.hoisted(() => vi.fn());
const mockLoggerError = vi.hoisted(() => vi.fn());
const mockPathname = vi.hoisted(() => ({ current: '/app' }));

vi.mock('@/lib/auth/client', () => ({ authClient: { signOut: mockSignOut } }));
vi.mock('@/lib/analytics', () => ({
  useAnalytics: () => ({ track: mockTrack, reset: mockReset }),
  EVENTS: { USER_LOGGED_OUT: 'user_logged_out' },
}));
vi.mock('@/lib/logging', () => ({
  logger: { error: mockLoggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname.current }));

import { AccountMenu, type AccountMenuUser } from '@/components/app/shell/account-menu';
import { ShellNav } from '@/components/app/shell/shell-nav';
import { ShellTopbar } from '@/components/app/shell/shell-topbar';
import { ThemeProvider } from '@/hooks/use-theme';

import {
  renderInShell,
  stubImageLoading,
  type WidthName,
} from '@/tests/unit/components/app/shell/render-shell';

const USER: AccountMenuUser = {
  name: 'Maya Reyes',
  email: 'maya@example.com',
  image: null,
  role: 'USER',
};

function renderMenu(overrides: Partial<AccountMenuUser> = {}, slim = false) {
  return renderInShell(
    <ThemeProvider>
      <AccountMenu user={{ ...USER, ...overrides }} initials="MR" slim={slim} />
    </ThemeProvider>
  );
}

/** The nav and the burger that opens its drawer, for the collision cases. */
function renderDrawer(width: WidthName = 'small') {
  return renderInShell(
    <ThemeProvider>
      <ShellNav user={USER} />
      <ShellTopbar />
    </ThemeProvider>,
    width
  );
}

/**
 * The trigger's name is the person's name and nothing else, in both widths.
 * An exact string, not a regex: the defect this guards is the avatar's initials
 * joining the name as "MR Maya Reyes", which a `/Maya Reyes/` match would pass.
 */
const NAME = 'Maya Reyes';
const trigger = () => screen.getByRole('button', { name: NAME });

/** Open the popover and wait for its contents — Radix portals them. */
async function openMenu(ui: ReturnType<typeof userEvent.setup>): Promise<void> {
  await ui.click(trigger());
  await screen.findByRole('menu');
}

type SignOutOptions = {
  fetchOptions: {
    onSuccess: () => Promise<void>;
    onError: (ctx: { error: Error }) => void;
  };
};

beforeEach(() => {
  mockSignOut.mockReset();
  mockTrack.mockReset().mockResolvedValue(undefined);
  mockReset.mockReset().mockResolvedValue(undefined);
  mockLoggerError.mockReset();
  window.localStorage.clear();
  document.documentElement.classList.remove('light', 'dark');
  stubImageLoading();
  // The component navigates on a successful sign-out; happy-dom would
  // otherwise attempt a real one.
  Object.defineProperty(window, 'location', {
    value: { href: '' },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AccountMenu — the trigger', () => {
  it('is named by the person, with the initials hidden from the name', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: NAME })).toBeTruthy();
    // Still on screen — hidden from the accessibility tree, not removed.
    expect(screen.getByText('MR')).toBeTruthy();
  });

  it('shows the name only — the email is in the menu, not the row', async () => {
    const ui = userEvent.setup();
    renderMenu();
    expect(screen.queryByText('maya@example.com')).toBeNull();
    await openMenu(ui);
    expect(screen.getByRole('menu').textContent).toContain('maya@example.com');
  });

  it('keeps the name when slim, and gives the avatar a tooltip', () => {
    renderMenu({}, true);
    const button = screen.getByRole('button', { name: NAME });
    expect(button.getAttribute('title')).toBe('Maya Reyes');
  });

  it('renders no menu until it is opened', () => {
    renderMenu();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Sign out' })).toBeNull();
  });

  it('returns focus to the trigger when the menu closes', async () => {
    const ui = userEvent.setup();
    renderMenu();
    await openMenu(ui);

    await ui.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(trigger());
  });
});

describe('AccountMenu — the avatar', () => {
  it('shows the picture once it has loaded, inside the same hidden circle', () => {
    renderMenu({ image: 'https://avatars.example.com/maya.png' });
    const trigger = screen.getByRole('button', { name: NAME });
    const img = trigger.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://avatars.example.com/maya.png');
    // Decoration beside the name: nothing for a screen reader to say about it.
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.closest('[aria-hidden]')).toBeTruthy();
    expect(screen.queryByText('MR')).toBeNull();
  });

  it('falls back to initials when there is no picture', () => {
    renderMenu({ image: null });
    expect(screen.getByText('MR')).toBeTruthy();
    expect(screen.getByRole('button', { name: NAME }).querySelector('img')).toBeNull();
  });

  it('falls back to initials when the picture fails to load — never a broken glyph', () => {
    renderMenu({ image: 'https://avatars.example.com/broken.png' });
    expect(screen.getByText('MR')).toBeTruthy();
    expect(screen.getByRole('button', { name: NAME }).querySelector('img')).toBeNull();
  });

  it('keeps the picture in the rail, where it is the whole control', () => {
    renderMenu({ image: 'https://avatars.example.com/maya.png' }, true);
    const trigger = screen.getByRole('button', { name: NAME });
    expect(trigger.querySelector('img')?.getAttribute('src')).toBe(
      'https://avatars.example.com/maya.png'
    );
  });
});

describe('AccountMenu — the rows', () => {
  it('holds the account, settings and usage rows, in that order, under the person', async () => {
    const ui = userEvent.setup();
    renderMenu();
    await openMenu(ui);

    const menu = screen.getByRole('menu');
    expect(menu.textContent).toContain('maya@example.com');

    const items = screen.getAllByRole('menuitem').map((el) => el.textContent?.trim());
    expect(items).toEqual(['Your account', 'Settings', 'Usage and billing', 'Sign out']);
    expect(screen.getByRole('menuitem', { name: 'Your account' }).getAttribute('href')).toBe(
      '/app/account'
    );
    expect(screen.getByRole('menuitem', { name: 'Settings' }).getAttribute('href')).toBe(
      '/app/settings'
    );
    expect(screen.getByRole('menuitem', { name: 'Usage and billing' }).getAttribute('href')).toBe(
      '/app/usage'
    );
  });

  it('shows Admin to an admin, before the theme and the way out', async () => {
    const ui = userEvent.setup();
    renderMenu({ role: 'ADMIN' });
    await openMenu(ui);

    expect(screen.getByRole('menuitem', { name: 'Admin' }).getAttribute('href')).toBe('/admin');
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent?.trim());
    expect(items).toEqual(['Your account', 'Settings', 'Usage and billing', 'Admin', 'Sign out']);
  });

  it('hides Admin from everyone else, including a null role', async () => {
    const ui = userEvent.setup();
    renderMenu({ role: null });
    await openMenu(ui);
    expect(screen.queryByRole('menuitem', { name: 'Admin' })).toBeNull();
  });
});

describe('AccountMenu — dark mode', () => {
  it('reports the theme in force to assistive tech', async () => {
    const ui = userEvent.setup();
    window.localStorage.setItem('theme', 'dark');
    renderMenu();
    await openMenu(ui);

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Dark mode' }).getAttribute('aria-checked')
    ).toBe('true');
  });

  it('toggling on puts the dark class on <html>, persists it, and keeps the menu open', async () => {
    const ui = userEvent.setup();
    window.localStorage.setItem('theme', 'light');
    renderMenu();
    await openMenu(ui);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    await ui.click(screen.getByRole('menuitemcheckbox', { name: 'Dark mode' }));

    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true));
    expect(window.localStorage.getItem('theme')).toBe('dark');
    // Selecting normally dismisses a Radix menu; this item preventDefaults so
    // the repaint can be seen without reopening.
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('toggling off returns to light', async () => {
    const ui = userEvent.setup();
    window.localStorage.setItem('theme', 'dark');
    renderMenu();
    await openMenu(ui);

    await ui.click(screen.getByRole('menuitemcheckbox', { name: 'Dark mode' }));

    await waitFor(() => expect(document.documentElement.classList.contains('light')).toBe(true));
    expect(window.localStorage.getItem('theme')).toBe('light');
  });
});

describe('AccountMenu — sign out', () => {
  it('ends the session, resets analytics identity, and hard-redirects to the front door', async () => {
    const ui = userEvent.setup();
    mockSignOut.mockImplementation(async (opts: SignOutOptions) => {
      await opts.fetchOptions.onSuccess();
    });

    renderMenu();
    await openMenu(ui);
    await ui.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    expect(mockTrack).toHaveBeenCalledWith('user_logged_out');
    expect(mockReset).toHaveBeenCalledTimes(1);
    // A document load, not a router push: it is what clears Next's client
    // Router Cache of payloads rendered for the person who just left.
    expect(window.location.href).toBe('/');
  });

  it('keeps the menu open while signing out, so the busy state can be seen', async () => {
    const ui = userEvent.setup();
    mockSignOut.mockImplementation(() => new Promise(() => {}));

    renderMenu();
    await openMenu(ui);
    await ui.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Signing out…' })).toBeTruthy()
    );
    expect(
      screen.getByRole('menuitem', { name: 'Signing out…' }).getAttribute('aria-disabled')
    ).toBe('true');
  });

  it('tells the reader, and logs, when sign-out fails — and stays recoverable', async () => {
    const ui = userEvent.setup();
    const failure = new Error('unauthorized');
    mockSignOut.mockImplementation(async (opts: SignOutOptions) => {
      opts.fetchOptions.onError({ error: failure });
    });

    renderMenu();
    await openMenu(ui);
    await ui.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Couldn’t sign out/);
    expect(mockLoggerError).toHaveBeenCalledWith('Sign out failed', failure);
    expect(window.location.href).toBe('');
    expect(mockReset).not.toHaveBeenCalled();

    const item = screen.getByRole('menuitem', { name: 'Sign out' });
    expect(item.getAttribute('aria-disabled')).not.toBe('true');
    // What reaches a keyboard user: the message is attached to the item they
    // are still focused on. A disabled item would have been dropped from
    // Radix's roving focus entirely.
    expect(item.getAttribute('aria-describedby')).toBe(alert.id);
    expect(alert.id).toBeTruthy();
  });

  it('tells the reader, and logs, when sign-out throws', async () => {
    const ui = userEvent.setup();
    const thrown = new Error('network');
    mockSignOut.mockRejectedValue(thrown);

    renderMenu();
    await openMenu(ui);
    await ui.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Couldn’t sign out/);
    expect(mockLoggerError).toHaveBeenCalledWith('Sign out threw', thrown);
    expect(window.location.href).toBe('');
  });

  it('does not carry a stale failure into the next opening', async () => {
    const ui = userEvent.setup();
    mockSignOut.mockImplementation(async (opts: SignOutOptions) => {
      opts.fetchOptions.onError({ error: new Error('offline') });
    });

    renderMenu();
    await openMenu(ui);
    await ui.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await screen.findByRole('alert');

    await ui.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    await openMenu(ui);
    // The component never unmounts, so the flag survives the close unless it
    // is cleared — a red alert describing an attempt that is long over.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      screen.getByRole('menuitem', { name: 'Sign out' }).hasAttribute('aria-describedby')
    ).toBe(false);
  });

  it('keeps a failure that lands after the menu was dismissed, for the next opening', async () => {
    // The hole in clearing on OPEN: a click outside dismisses the menu while
    // the request is in flight, the failure arrives against a closed menu, and
    // the reopen wiped it before anyone saw it — leaving the reader signed in
    // with a Sign out item that reads as if nothing was tried.
    const ui = userEvent.setup();
    let fail: (() => void) | undefined;
    mockSignOut.mockImplementation(
      (opts: SignOutOptions) =>
        new Promise<void>((resolve) => {
          fail = () => {
            opts.fetchOptions.onError({ error: new Error('offline') });
            resolve();
          };
        })
    );

    renderMenu();
    await openMenu(ui);
    await ui.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));

    await ui.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fail!();

    await openMenu(ui);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn’t sign out/);
    expect(
      screen.getByRole('menuitem', { name: 'Sign out' }).getAttribute('aria-disabled')
    ).not.toBe('true');
  });

  it('still redirects when analytics rejects after the session is already gone', async () => {
    const ui = userEvent.setup();
    mockTrack.mockRejectedValue(new Error('analytics down'));
    mockSignOut.mockImplementation(async (opts: SignOutOptions) => {
      await opts.fetchOptions.onSuccess();
    });

    renderMenu();
    await openMenu(ui);
    await ui.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    // The server session is destroyed by this point; skipping the redirect
    // would strand the reader on an app page with a dead session.
    await waitFor(() => expect(window.location.href).toBe('/'));
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Sign-out analytics failed; redirecting anyway',
      expect.any(Error)
    );
  });
});

describe('AccountMenu — inside the ≤900px drawer', () => {
  const navEl = () => document.querySelector('nav[aria-label="Main"]')!;

  it('closes on Escape without closing the drawer under it', async () => {
    // The layout's Escape chain closes the nav on any document-level Escape,
    // and Radix does not stop the event it dismisses on — so without the
    // menu stopping it, one press closed both.
    const ui = userEvent.setup();
    renderDrawer();
    await ui.click(screen.getByRole('button', { name: 'Open the menu' }));
    expect(navEl().className).toContain('visible');

    await openMenu(ui);
    await ui.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(navEl().className).not.toContain('invisible');
  });

  it('closes the drawer behind a row, as a nav item does', async () => {
    const ui = userEvent.setup();
    renderDrawer();
    await ui.click(screen.getByRole('button', { name: 'Open the menu' }));
    await openMenu(ui);

    await ui.click(screen.getByRole('menuitem', { name: 'Settings' }));

    await waitFor(() => expect(navEl().className).toContain('invisible'));
  });

  it('does not close the drawer behind a row above 900px, where there is none', async () => {
    const ui = userEvent.setup();
    renderDrawer('large');
    await openMenu(ui);

    await ui.click(screen.getByRole('menuitem', { name: 'Settings' }));

    // The column has no open/closed state; a `closeNav` here would be a no-op
    // at best, and the nav must not acquire the drawer's classes.
    expect(navEl().className).not.toContain('invisible');
    expect(navEl().className).not.toContain('fixed');
  });

  it('stacks above the drawer panel', async () => {
    // The panel is `z-[60]`; Sunrise's content is `z-50` in a portal on body,
    // so without the override the menu opened behind the drawer.
    const ui = userEvent.setup();
    renderDrawer();
    await ui.click(screen.getByRole('button', { name: 'Open the menu' }));
    await openMenu(ui);

    expect(screen.getByRole('menu').className).toContain('z-[70]');
    expect(screen.getByRole('menu').className).not.toMatch(/\bz-50\b/);
  });
});
