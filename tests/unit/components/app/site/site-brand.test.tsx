// @vitest-environment happy-dom

/**
 * Both wordmarks read the brand seam, with the seam FILLED (t-5).
 *
 * ## What this catches that `site-footer-brand.test.tsx` cannot
 *
 * That file pins the legal LINE — `Lelañea™ · © 2026 All Too Human Ltd` — and
 * its "no hardcoded name" assertion is scoped to the element containing `©`.
 * The wordmarks are elsewhere: the header's `<span>` and its link's
 * `aria-label`, and the footer's matching pair. All four were literals while
 * the legal line beside them read from the seam, so changing `leafBrandName`
 * would have renamed the copyright and left four "Lelañea"s behind — including
 * two accessible names, which nobody looks at.
 *
 * ## The fixture is deliberately not our own brand
 *
 * "Acme" is used because it is nothing like the real value: filling the seam
 * with `Lelañea` would let a hardcoded name pass every assertion here, which is
 * the one failure this file exists to catch. That the real values are the ones
 * we intend is pinned separately by the `lib/app/leaf-brand.ts` row in
 * `tests/unit/lib/app/defaults.test.ts`.
 *
 * A hoisted `vi.mock` is required — `tests/setup.ts` pins the seam to null for
 * the whole suite, and the seam is read at module scope, so the
 * `doMock` + `resetModules` + re-import route races the module graph.
 */

import { describe, it, expect, vi } from 'vitest';

const { FORK } = vi.hoisted(() => ({
  FORK: { name: 'Acme', legalName: 'Acme Holdings Ltd' },
}));

vi.mock('@/lib/app/brand', () => ({
  appBrandName: FORK.name,
  appBrandLegalName: FORK.legalName,
  appBrandDescription: null,
}));

vi.mock('@/lib/consent', () => ({ useConsent: () => ({ openPreferences: vi.fn() }) }));

import { render, screen } from '@testing-library/react';

import { SiteHeader } from '@/components/app/site/site-header';
import { SiteFooter } from '@/components/app/site/site-footer';
import { ThemeProvider } from '@/hooks/use-theme';

function renderHeader() {
  return render(
    <ThemeProvider>
      <SiteHeader />
    </ThemeProvider>
  );
}

describe('the wordmarks', () => {
  it('the header wordmark shows the seam name, not a literal', () => {
    renderHeader();

    // Scoped to the wordmark link, NOT the whole header. `SITE_NAV` carries a
    // page called "Lelañea" — the one about her philosophy — and that label is
    // authored copy in `lib/site/config.ts`, not a brand field: a fork renaming
    // the product would rewrite the nav entry, not interpolate into it. A
    // container-wide "contains no Lelañea" assertion fails on that, correctly,
    // which is how this ended up scoped.
    const wordmark = screen.getByRole('link', { name: `${FORK.name}, home` });
    expect(wordmark.textContent).toContain(FORK.name);
    expect(wordmark.textContent).not.toContain('Lelañea');
  });

  it('the header link is announced with the seam name', () => {
    renderHeader();

    // The accessible name is the half a visual check never covers.
    expect(screen.getByRole('link', { name: `${FORK.name}, home` })).toHaveAttribute('href', '/');
  });

  it('the footer wordmark shows the seam name, not a literal', () => {
    render(<SiteFooter />);

    const wordmark = screen.getByRole('link', { name: `${FORK.name}, home` });
    expect(wordmark.textContent).toContain(FORK.name);
    expect(wordmark.textContent).not.toContain('Lelañea');
  });

  it('the footer link is announced with the seam name', () => {
    render(<SiteFooter />);

    expect(screen.getByRole('link', { name: `${FORK.name}, home` })).toHaveAttribute('href', '/');
  });

  it('leaves the disclaimer alone — it names the product as prose, not as a field', () => {
    const { container } = render(<SiteFooter />);

    // The "not a crisis service" paragraph is authored copy that happens to
    // contain the name. It is NOT a brand field: a fork renaming the product
    // would rewrite that sentence, not interpolate into it. So it legitimately
    // still says Lelañea here, and this case records that as intended rather
    // than leaving the next reader to wonder.
    expect(container.textContent).toContain('Lelañea is an educational');
  });
});
