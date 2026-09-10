// @vitest-environment happy-dom

/**
 * SiteHeader — the leaf's public bar (t-5).
 *
 * Two behaviours are worth a test here, and neither is "the links render".
 *
 * 1. **The CTA routes home before it scrolls.** The design puts "Join the
 *    waitlist" in the header of every public page, and the form it points at
 *    exists on the home page only. A bare `#waitlist-form` — the obvious way to
 *    write it, and what the prototype's hash-router does — is a no-op on
 *    `/mission` and `/data`: the click registers, nothing moves, and there is no
 *    error anywhere to notice. So the assertion is made from a page that is NOT
 *    the home page, which is the only place the two implementations differ.
 *
 * 2. **`aria-current` marks the page.** It is the styling hook for the
 *    underline as well as the announcement, so a nav that looks right cannot be
 *    silently unannounced — but only if something checks the attribute rather
 *    than the class.
 *
 * `usePathname` is globally mocked to '/' in tests/setup.ts; each case sets its
 * own.
 *
 * @see components/app/site/site-header.tsx
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Not mocked suite-wide, and the bar now branches on it. Hoisted so the header
// is BUILT against the stub rather than re-imported around one.
vi.mock('@/lib/auth/client', () => ({
  useSession: vi.fn(),
  authClient: { signOut: vi.fn() },
}));
import { render, screen, within } from '@testing-library/react';
import { usePathname } from 'next/navigation';

import { SiteHeader } from '@/components/app/site/site-header';
import { WAITLIST_ANCHOR } from '@/lib/site/config';
import { ThemeProvider } from '@/hooks/use-theme';
import { BRAND } from '@/lib/brand';
import { useSession } from '@/lib/auth/client';

const mockUsePathname = vi.mocked(usePathname);
const mockUseSession = vi.mocked(useSession);

beforeEach(() => {
  mockUsePathname.mockReturnValue('/');
  signedOut();
});

/** No session — the stranger the marketing page is written for. */
function signedOut() {
  mockUseSession.mockReturnValue({ data: null, isPending: false } as ReturnType<typeof useSession>);
}

/** A member who has wandered onto a public page. */
function signedIn() {
  mockUseSession.mockReturnValue({
    data: { user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' } },
    isPending: false,
  } as unknown as ReturnType<typeof useSession>);
}

/**
 * The bar embeds the platform's `ThemeToggle`, which throws outside a
 * `ThemeProvider`. Wrapping in the real provider rather than stubbing the
 * toggle keeps the header under test as it actually renders — including the
 * fact that it depends on that provider being present in the tree at all.
 */
function renderHeader() {
  return render(
    <ThemeProvider>
      <SiteHeader />
    </ThemeProvider>
  );
}

describe('SiteHeader', () => {
  describe('the way in, and the way back', () => {
    // The regression this pins: `AppHeader` rendered `UserButton`, and the
    // first version of this bar replaced it with a static "Log in" link
    // because that is what the design shows — the design having no auth state
    // to show. A signed-in member clicking the wordmark from /dashboard was
    // then told to log in, with no avatar, no sign-out and no route back into
    // the app from any public page. `UserButton`'s sign-out redirects to `/`,
    // so it deposited every user on exactly the page that had lost the menu.
    it('offers a stranger the design’s plain Log in link', () => {
      signedOut();
      renderHeader();

      expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    });

    it('gives a signed-in visitor their user menu instead', () => {
      signedIn();
      renderHeader();

      // `UserButton`'s authenticated trigger is the avatar, whose accessible
      // name is the user's initials. (That it is only initials is upstream's
      // choice and not this branch's to change.)
      expect(screen.getByRole('button', { name: 'AL' })).toBeTruthy();
      // And does NOT invite someone already signed in to sign in again.
      expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull();
    });
  });

  describe('landmarks', () => {
    it('puts the page links in a labelled navigation landmark', () => {
      renderHeader();

      // `PublicNav` provided this; putting the links straight into the
      // `<header>` left the site with a footer nav landmark and no primary
      // one, so landmark navigation could reach the footer and not the bar.
      const nav = screen.getByRole('navigation', { name: 'Main' });
      expect(nav).toBeTruthy();

      for (const label of ['Lelañea', 'The mission', 'Your data']) {
        expect(within(nav).getByRole('link', { name: label })).toBeTruthy();
      }
    });
  });

  describe('the waitlist CTA', () => {
    it('points at the home route AND the anchor when the visitor is on another page', () => {
      mockUsePathname.mockReturnValue('/mission');

      renderHeader();

      const cta = screen.getByRole('link', { name: 'Join the waitlist' });

      // The whole point: a route, then a fragment. `/#waitlist-form` navigates
      // home and lands on the form; `#waitlist-form` would do nothing at all
      // from here, which is what this pins.
      expect(cta).toHaveAttribute('href', `/#${WAITLIST_ANCHOR}`);
      expect(cta.getAttribute('href')).not.toBe(`#${WAITLIST_ANCHOR}`);
      expect(cta.getAttribute('href')?.startsWith('/')).toBe(true);
    });

    it('still carries the route on the home page, so one href serves both', () => {
      mockUsePathname.mockReturnValue('/');

      renderHeader();

      expect(screen.getByRole('link', { name: 'Join the waitlist' })).toHaveAttribute(
        'href',
        `/#${WAITLIST_ANCHOR}`
      );
    });
  });

  describe('the current page', () => {
    it('marks the page being viewed with aria-current', () => {
      mockUsePathname.mockReturnValue('/mission');

      renderHeader();

      expect(screen.getByRole('link', { name: 'The mission' })).toHaveAttribute(
        'aria-current',
        'page'
      );
    });

    it('leaves aria-current off every other page link', () => {
      mockUsePathname.mockReturnValue('/mission');

      renderHeader();

      // Establish the population first — an "is absent" assertion passes for
      // free on an empty result set.
      const others = [
        screen.getByRole('link', { name: 'Lelañea' }),
        screen.getByRole('link', { name: 'Your data' }),
      ];
      expect(others).toHaveLength(2);
      for (const link of others) {
        expect(link).not.toHaveAttribute('aria-current');
      }
    });

    it('marks nothing when the visitor is on a page the nav does not list', () => {
      mockUsePathname.mockReturnValue('/privacy');

      renderHeader();

      const nav = screen.getAllByRole('link');
      expect(nav.length).toBeGreaterThan(0);
      expect(nav.filter((l) => l.getAttribute('aria-current') === 'page')).toHaveLength(0);
    });
  });

  it('offers the way back in and the home wordmark', () => {
    renderHeader();

    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    // The mark inside is decorative, so the LINK is what carries the name. Read
    // from `BRAND` rather than written out: tests/setup.ts pins the seam to the
    // platform default suite-wide, so a literal here would assert the value of
    // an unconfigured install. That the wordmark tracks the seam AT ALL is the
    // separate question, pinned in site-brand.test.tsx with the seam filled.
    expect(screen.getByRole('link', { name: `${BRAND.name}, home` })).toHaveAttribute('href', '/');
  });
});
