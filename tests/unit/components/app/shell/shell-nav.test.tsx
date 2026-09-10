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
