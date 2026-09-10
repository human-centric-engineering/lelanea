// @vitest-environment happy-dom

/**
 * ProtectedNav default-vs-override (issue #473)
 *
 * The authenticated header renders `protectedNavItems` from the fork-owned
 * `lib/app/protected-nav.ts` when non-null, else `DEFAULT_PROTECTED_NAV`. The
 * override list *replaces* the default wholesale. `navItems` is resolved at
 * module load, so the override case stubs the scaffold via `vi.doMock` and
 * re-imports fresh.
 *
 * The component previously had no test at all, which is part of why an app could
 * ship a header that never linked to its own product — there was nothing to
 * notice. These cases pin both halves: the platform default a fork inherits, and
 * that a fork's own items keep the platform's admin filtering and active-state
 * behaviour rather than having to reimplement them.
 *
 * `usePathname` is globally mocked to '/' (tests/setup.ts).
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — filling `protectedNavItems` is EXPECTED to fail cases here
 * ---------------------------------------------------------------------------
 * The `afterEach` only `doUnmock`s the seam, so the default-case tests below
 * render whatever `lib/app/protected-nav.ts` actually exports. A non-null
 * override replaces the authenticated nav wholesale and those cases go red.
 * Pin your own list rather than deleting them — the `adminOnly` and
 * prefix-matching behaviour they cover is behaviour you still want. See #636
 * for the sweep that would let this file be rewritten seam-independent.
 *
 * @see components/layouts/protected-nav.tsx · lib/app/protected-nav.ts · lib/protected-nav/types.ts
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { usePathname } from 'next/navigation';
import * as React from 'react';

const mockUseSession = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/client', () => ({
  useSession: () => mockUseSession(),
}));

/** Signed in as a plain user (the default for most cases below). */
function asUser() {
  mockUseSession.mockReturnValue({ data: { user: { role: 'USER' } } });
}

/** Signed in as an admin. */
function asAdmin() {
  mockUseSession.mockReturnValue({ data: { user: { role: 'ADMIN' } } });
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@/lib/app/protected-nav');
  vi.mocked(usePathname).mockReturnValue('/'); // restore the global mock default
  mockUseSession.mockReset();
});

describe('ProtectedNav', () => {
  // FORK NOTE — PINNED to this fork's seam, not deleted (`HB2`).
  //
  // Upstream this case reads `lib/app/protected-nav.ts` unmocked and asserts
  // the platform default (`/dashboard`, `/profile`, `/settings`). §04 t-9 fills
  // that seam, so the default is no longer what this repo renders and the case
  // necessarily fails — working as designed, exactly as `defaults.test.ts` says.
  //
  // Pinned rather than removed because what it actually protects is the
  // component's end of the seam: that `ProtectedNav` reads the list, renders
  // every entry, and gets the hrefs right. Deleting it would lose that for the
  // sake of a value that moved. Update the three literals when the nav changes.
  //
  // `/app` is labelled with the PRODUCT name, not "Your journey" — that phrase
  // is a shell-nav item pointing at `/app/journey`, and using it here too made
  // one phrase mean two destinations. Owner ruling, 10 September 2026.
  //
  // The platform-default path is unreachable here once the seam is filled, and
  // the case below (`replaces the default wholesale…`) mocks the seam and still
  // covers the replacement mechanism generically.
  it("renders this fork's nav from the filled seam", async () => {
    asUser();
    vi.resetModules();
    const { ProtectedNav } = await import('@/components/layouts/protected-nav');
    render(React.createElement(ProtectedNav));

    expect(screen.getByRole('link', { name: /lelañea/i })).toHaveAttribute('href', '/app');
    expect(screen.getByRole('link', { name: /profile/i })).toHaveAttribute('href', '/profile');
    expect(screen.getByRole('link', { name: /settings/i })).toHaveAttribute('href', '/settings');
    // The reason the seam was filled: the header must not offer a way out of
    // the product from `/profile` and `/settings`.
    expect(screen.queryByRole('link', { name: /dashboard/i })).toBeNull();
  });

  it('hides an adminOnly item from a non-admin and shows it to an admin', async () => {
    asUser();
    vi.resetModules();
    const { ProtectedNav } = await import('@/components/layouts/protected-nav');
    const { unmount } = render(React.createElement(ProtectedNav));

    expect(screen.queryByRole('link', { name: /admin/i })).toBeNull();
    unmount();

    asAdmin();
    render(React.createElement(ProtectedNav));
    expect(screen.getByRole('link', { name: /admin/i })).toHaveAttribute('href', '/admin');
  });

  it('replaces the default wholesale with a non-null override list', async () => {
    asUser();
    vi.resetModules();
    vi.doMock('@/lib/app/protected-nav', () => ({
      protectedNavItems: [
        { href: '/programme', label: 'Programme' },
        { href: '/reports', label: 'Reports' },
      ],
    }));

    const { ProtectedNav } = await import('@/components/layouts/protected-nav');
    render(React.createElement(ProtectedNav));

    expect(screen.getByRole('link', { name: /programme/i })).toHaveAttribute('href', '/programme');
    expect(screen.getByRole('link', { name: /reports/i })).toHaveAttribute('href', '/reports');
    // Default links are gone — replacement, not append.
    expect(screen.queryByRole('link', { name: /profile/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /settings/i })).toBeNull();
  });

  it("applies adminOnly to a fork's own items", async () => {
    asUser();
    vi.resetModules();
    vi.doMock('@/lib/app/protected-nav', () => ({
      protectedNavItems: [
        { href: '/programme', label: 'Programme' },
        { href: '/billing', label: 'Billing', adminOnly: true },
      ],
    }));

    const { ProtectedNav } = await import('@/components/layouts/protected-nav');
    render(React.createElement(ProtectedNav));

    expect(screen.getByRole('link', { name: /programme/i })).toBeInTheDocument();
    // The platform's admin filtering covers fork items — no reimplementation.
    expect(screen.queryByRole('link', { name: /billing/i })).toBeNull();
  });

  it('renders an item with no icon', async () => {
    asUser();
    vi.resetModules();
    vi.doMock('@/lib/app/protected-nav', () => ({
      protectedNavItems: [{ href: '/programme', label: 'Programme' }],
    }));

    const { ProtectedNav } = await import('@/components/layouts/protected-nav');
    render(React.createElement(ProtectedNav));

    // `icon` is optional on ProtectedNavItem; omitting it must not throw.
    expect(screen.getByRole('link', { name: /programme/i })).toHaveAttribute('href', '/programme');
  });

  it('an `exact` item is NOT active on child routes', async () => {
    asUser();
    vi.resetModules();
    vi.mocked(usePathname).mockReturnValue('/projects/123');
    vi.doMock('@/lib/app/protected-nav', () => ({
      protectedNavItems: [{ href: '/projects', label: 'Projects', exact: true }],
    }));

    const { ProtectedNav } = await import('@/components/layouts/protected-nav');
    render(React.createElement(ProtectedNav));

    expect(screen.getByRole('link', { name: /projects/i })).not.toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('a non-exact item prefix-matches child routes (default)', async () => {
    asUser();
    vi.resetModules();
    vi.mocked(usePathname).mockReturnValue('/projects/123');
    vi.doMock('@/lib/app/protected-nav', () => ({
      protectedNavItems: [{ href: '/projects', label: 'Projects' }],
    }));

    const { ProtectedNav } = await import('@/components/layouts/protected-nav');
    render(React.createElement(ProtectedNav));

    expect(screen.getByRole('link', { name: /projects/i })).toHaveAttribute('aria-current', 'page');
  });
});
