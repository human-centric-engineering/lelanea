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
import { render, screen } from '@testing-library/react';
import { usePathname } from 'next/navigation';

import { SiteHeader } from '@/components/app/site/site-header';
import { WAITLIST_ANCHOR } from '@/lib/site/config';
import { ThemeProvider } from '@/hooks/use-theme';

const mockUsePathname = vi.mocked(usePathname);

beforeEach(() => {
  mockUsePathname.mockReturnValue('/');
});

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
    // The mark inside is decorative, so the LINK is what carries the name.
    expect(screen.getByRole('link', { name: 'Lelañea, home' })).toHaveAttribute('href', '/');
  });
});
