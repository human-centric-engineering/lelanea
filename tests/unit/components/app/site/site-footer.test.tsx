// @vitest-environment happy-dom

/**
 * SiteFooter — the leaf's public footer (t-5).
 *
 * Three things are pinned here, each because losing it is silent.
 *
 * 1. **D3: nothing rather than a dead link.** Her YouTube, Spotify and site
 *    have no URLs yet. The failure this guards is not a crash — it is an `<a>`
 *    with `href=""` or `href="#"` that looks like a link, is announced as a
 *    link, and goes nowhere. Both cases are asserted: absent while the URL is
 *    null, present the moment one arrives, so the test cannot pass by rendering
 *    nothing ever.
 *
 * 2. **The Cookie Preferences control.** Replacing the platform's footer moved
 *    this obligation onto us — `PublicFooter` renders it unconditionally
 *    because consent is a legal requirement rather than a branding choice
 *    (CUSTOMIZATION.md §4). Nothing else in the codebase would notice if it
 *    disappeared from here.
 *
 * 3. **The disclaimer.** "Not a crisis service" is site-wide on purpose. A
 *    refactor that moved it to the home page would be invisible to every other
 *    test in the tree.
 *
 * The brand NAMES on the legal line are pinned separately in
 * `site-footer-brand.test.tsx`: tests/setup.ts pins the brand seam to
 * "unconfigured" for the whole suite, so a value assertion needs a hoisted mock
 * and therefore its own file.
 *
 * The seam is stubbed with `vi.doMock` + a fresh import because `SITE_LINKS` is
 * read at module scope, matching how the platform's own seam tests do it.
 *
 * @see components/app/site/site-footer.tsx · lib/app/site-config.ts
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const openPreferences = vi.fn();

vi.mock('@/lib/consent', () => ({
  useConsent: () => ({ openPreferences }),
}));

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@/lib/site/config');
  vi.clearAllMocks();
});

/** Re-import the footer with `SITE_LINKS` replaced, since it is read at load. */
async function renderWithLinks(links: ReadonlyArray<{ label: string; href: string | null }>) {
  const actual = await vi.importActual<typeof import('@/lib/site/config')>('@/lib/site/config');
  vi.doMock('@/lib/site/config', () => ({ ...actual, SITE_LINKS: links }));
  const { SiteFooter } = await import('@/components/app/site/site-footer');
  render(<SiteFooter />);
}

describe('SiteFooter', () => {
  describe('outbound links (D3)', () => {
    it('renders no link at all for a destination whose URL is not known yet', async () => {
      await renderWithLinks([
        { label: 'YouTube', href: null },
        { label: 'Spotify', href: null },
      ]);

      // The population is non-empty — the footer's own links are there — so
      // this is not an assertion passing against an empty render.
      expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
      expect(screen.queryByRole('link', { name: 'YouTube' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Spotify' })).toBeNull();
      // Not a disabled link, not an empty href, not a `#` — no element at all.
      expect(screen.queryByText('YouTube')).toBeNull();
    });

    it('renders the link as soon as a URL arrives, and leaves the others out', async () => {
      await renderWithLinks([
        { label: 'YouTube', href: 'https://youtube.com/@lelanea' },
        { label: 'Spotify', href: null },
      ]);

      expect(screen.getByRole('link', { name: 'YouTube' })).toHaveAttribute(
        'href',
        'https://youtube.com/@lelanea'
      );
      expect(screen.queryByRole('link', { name: 'Spotify' })).toBeNull();
    });

    it('opens an outbound link safely', async () => {
      await renderWithLinks([{ label: 'YouTube', href: 'https://youtube.com/@lelanea' }]);

      const link = screen.getByRole('link', { name: 'YouTube' });
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link).toHaveAttribute('target', '_blank');
    });
  });

  it('renders the Cookie Preferences control we took responsibility for', async () => {
    await renderWithLinks([]);

    const button = screen.getByRole('button', { name: 'Cookie Preferences' });
    button.click();
    expect(openPreferences).toHaveBeenCalledTimes(1);
  });

  it('carries the disclaimer on every page, not just the home page', async () => {
    await renderWithLinks([]);

    expect(screen.getByText(/not a crisis service/)).toBeTruthy();
    expect(screen.getByText(/contact your local emergency services/)).toBeTruthy();
  });

  describe('the lib/app/footer.ts seam', () => {
    // The copyright half was written out inline at first, which took this
    // footer OUT of the seam while `ProtectedFooter` stayed in it. Setting
    // `footerCopyright = false` — its documented white-label use — would then
    // have dropped the line from the authenticated footer and left it standing
    // on the marketing one. That is the split `lib/footer/copyright.ts` says
    // #561 existed to close, and the protected footer's own suite covers only
    // its own side, so nothing would have failed.
    it('renders no legal line at all when the seam says false', async () => {
      vi.resetModules();
      vi.doMock('@/lib/app/footer', () => ({ footerCopyright: false }));
      const { SiteFooter } = await import('@/components/app/site/site-footer');
      render(<SiteFooter />);

      // Population first — the rest of the footer is there.
      expect(screen.getByRole('button', { name: 'Cookie Preferences' })).toBeTruthy();
      expect(screen.queryByText(/©/)).toBeNull();
      // And no orphaned trademark with nothing after it.
      expect(screen.queryByText(/™/)).toBeNull();

      vi.doMock('@/lib/app/footer', () => ({ footerCopyright: null }));
      vi.resetModules();
    });

    it('renders a fork’s own string verbatim, after the trademark', async () => {
      vi.resetModules();
      vi.doMock('@/lib/app/footer', () => ({
        footerCopyright: 'An All Too Human production',
      }));
      const { SiteFooter } = await import('@/components/app/site/site-footer');
      render(<SiteFooter />);

      const legal = screen.getByText(/An All Too Human production/);
      expect(legal.textContent).toContain('™ · An All Too Human production');
      expect(legal.textContent).not.toContain('©');

      vi.doMock('@/lib/app/footer', () => ({ footerCopyright: null }));
      vi.resetModules();
    });
  });

  it('prints the trademark and the copyright year on the legal line', async () => {
    await renderWithLinks([]);

    // The NAMES on this line come from the brand seam, which tests/setup.ts
    // pins to "unconfigured" suite-wide — so the values are asserted in
    // site-footer-brand.test.tsx, which fills the seam with a hoisted mock.
    // What is checked here is the SHAPE the design specifies.
    const legal = screen.getByText(/©/);
    expect(legal.textContent).toMatch(/™ · © \d{4} /);
  });
});
