// @vitest-environment happy-dom

/**
 * The left nav — the two things about it that a screenshot cannot check.
 *
 * 1. **Which item is current.** `/app` is every view's prefix, so the obvious
 *    `startsWith` implementation lights "The conversation" on every page in the
 *    product — including the page that is actually current, so two items claim
 *    it at once. That is invisible in a screenshot of `/app` itself, which is
 *    the screen anyone checking would look at.
 *
 * 2. **The account footer carries the real person.** It is the one part of the
 *    nav fed by the session rather than by a constant, and `initialsFor` has to
 *    survive names the prototype's "Maya Reyes" never tested it against.
 *
 * @see components/app/shell/shell-nav.tsx
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initialsFor, ShellNav } from '@/components/app/shell/shell-nav';

const mockPathname = vi.hoisted(() => ({ current: '/app' }));

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname.current,
}));

const USER = { name: 'Maya Reyes', email: 'maya@example.com' };

function renderAt(pathname: string) {
  mockPathname.current = pathname;
  return render(<ShellNav user={USER} />);
}

/** The nav item whose `aria-current` is set, by accessible name. */
function currentItems(): string[] {
  return screen
    .getAllByRole('link')
    .filter((el) => el.getAttribute('aria-current') === 'page')
    .map((el) => el.textContent?.trim() ?? '');
}

beforeEach(() => {
  window.localStorage.clear();
  mockPathname.current = '/app';
});

describe('ShellNav — which destination reads as current', () => {
  it('marks exactly one item on the shell root', () => {
    renderAt('/app');
    expect(currentItems()).toEqual(['The conversation']);
  });

  it('does not leave "The conversation" current on a nested view', () => {
    // The `startsWith('/app')` bug, stated directly: this is the assertion that
    // fails if the prefix test is ever loosened.
    renderAt('/app/situations');
    expect(currentItems()).toEqual(['Life situations']);
  });

  it('keeps the section current on a deeper path within it', () => {
    renderAt('/app/situations/3');
    expect(currentItems()).toEqual(['Life situations']);
  });

  it('does not mark a sibling that merely shares a prefix', () => {
    // `/app/share` vs a hypothetical `/app/shared`: a bare `startsWith` with no
    // separator would light "Share with Lelañea" on both.
    renderAt('/app/shared-thing');
    expect(currentItems()).toEqual([]);
  });

  it('renders all seven destinations', () => {
    renderAt('/app');
    for (const label of [
      'The conversation',
      'Workspace',
      'Your journey',
      'Life situations',
      'Share with Lelañea',
      'Usage and billing',
      'Settings',
    ]) {
      expect(screen.getByRole('link', { name: new RegExp(label) })).toBeTruthy();
    }
  });
});

describe('ShellNav — the account footer is the real person', () => {
  it('shows the session name and email, not a placeholder', () => {
    renderAt('/app');
    expect(screen.getByText('Maya Reyes')).toBeTruthy();
    expect(screen.getByText('maya@example.com')).toBeTruthy();
    expect(screen.getByText('MR')).toBeTruthy();
  });

  it('invents no session count', () => {
    // The prototype's footer reads "eleven sessions". Nothing counts sessions
    // yet, so D6 says omit rather than fake — and a digit in this subtree is
    // how that would come back.
    const { container } = renderAt('/app');
    const footer = screen.getByRole('link', { name: /Maya Reyes/ });
    expect(footer.textContent).not.toMatch(/\d/);
    expect(container.querySelector('[href="/app/account"]')).toBeTruthy();
  });
});

describe('ShellNav — slim mode', () => {
  const toggle = () => screen.getByRole('button', { name: /the menu/ });

  it('starts labelled', () => {
    renderAt('/app');
    expect(screen.getByText('Lelañea')).toBeTruthy();
    expect(toggle().getAttribute('aria-label')).toBe('Collapse the menu');
  });

  it('hides the labels and keeps the destinations reachable', async () => {
    renderAt('/app');
    await userEvent.click(toggle());

    // The wordmark and the visible labels go; the accessible names must not,
    // or a screen-reader user loses the nav entirely at 64px.
    expect(screen.queryByText('Lelañea')).toBeNull();
    expect(screen.getByRole('link', { name: 'Life situations' })).toBeTruthy();
    // Seven destinations, the account footer, and the wordmark — which keeps
    // its own `aria-label` when its text is hidden, so it stays a link.
    expect(screen.getAllByRole('link')).toHaveLength(9);
    expect(screen.getByRole('link', { name: 'Lelañea, back to the site' })).toBeTruthy();
  });

  it('gives every item a tooltip carrying its hint', async () => {
    // In slim mode the label is hidden, so `label — hint` on the title is the
    // only thing telling two icons apart.
    renderAt('/app');
    await userEvent.click(toggle());

    expect(screen.getByRole('link', { name: 'Life situations' }).getAttribute('title')).toBe(
      'Life situations — What you are living through'
    );
  });

  it('drops the tooltips again when labelled, so they are not doubled', async () => {
    renderAt('/app');
    const item = screen.getByRole('link', { name: /Life situations/ });
    expect(item.getAttribute('title')).toBeNull();
  });

  it('offers the way back', async () => {
    renderAt('/app');
    await userEvent.click(toggle());
    expect(toggle().getAttribute('aria-label')).toBe('Expand the menu');

    await userEvent.click(toggle());
    expect(screen.getByText('Lelañea')).toBeTruthy();
  });

  it('remembers the choice for this browser', async () => {
    renderAt('/app');
    await userEvent.click(toggle());
    expect(window.localStorage.getItem('lelanea.nav.slim')).toBe('true');
  });

  it('keeps the account footer reachable at 64px', async () => {
    renderAt('/app');
    await userEvent.click(toggle());

    const account = screen.getByRole('link', { name: /Your account/ });
    expect(account.getAttribute('href')).toBe('/app/account');
    expect(screen.getByText('MR')).toBeTruthy();
  });

  it('still marks the current item', async () => {
    renderAt('/app/situations');
    await userEvent.click(toggle());
    expect(currentItems()).toEqual(['Life situations']);
  });
});

describe('initialsFor', () => {
  it.each([
    ['Maya Reyes', 'maya@example.com', 'MR'],
    // One word: a single letter beats nothing.
    ['Prince', 'p@example.com', 'P'],
    // Three words take the first and the LAST, not the first two.
    ['Ada Byron Lovelace', 'ada@example.com', 'AL'],
    ['  padded   name  ', 'p@example.com', 'PN'],
    ['ñora Díaz', 'n@example.com', 'ÑD'],
  ])('%s → %s', (name, email, expected) => {
    expect(initialsFor(name, email)).toBe(expected);
  });

  it('falls back to the email when there is no name', () => {
    // An OAuth provider that returned none, or an invite accepted before the
    // profile was filled in. The avatar must not be blank.
    expect(initialsFor('', 'zoe@example.com')).toBe('Z');
    expect(initialsFor('   ', 'zoe@example.com')).toBe('Z');
  });

  it('takes a whole astral character, not half a surrogate pair', () => {
    // `charAt(0)` here returns a lone high surrogate, which renders as a
    // replacement glyph in the avatar.
    expect(initialsFor('😀 Smith', 'a@example.com')).toBe('😀S');
  });
});
