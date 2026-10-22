// @vitest-environment happy-dom

/**
 * The public footer's legal line, with the brand seam FILLED (t-5).
 *
 * ## Why this is a file of its own
 *
 * `tests/setup.ts` pins `lib/app/brand.ts` to null for the whole suite, so
 * every other test — including `site-footer.test.tsx` next door — sees the
 * platform default and cannot assert a brand value at all. The documented way
 * to need one is a **hoisted** `vi.mock`, which applies to the whole module
 * graph of the file it appears in. That is why this is a separate file rather
 * than one more case in the neighbouring one.
 *
 * It deliberately does NOT use `vi.doMock` + `vi.resetModules()` + a re-import
 * to vary the brand mid-file: the seam is read at module scope and that pattern
 * raced the graph and took out CI twice. It also never calls `vi.doUnmock` on
 * the seam, which REMOVES the pin rather than restoring it —
 * `tests/unit/lib/app/defaults.test.ts` fails the build if any test file does.
 *
 * ## Why not `tests/unit/brand-fork-surfaces.test.tsx`
 *
 * That file holds the platform's brand-bearing surfaces, and its footer table
 * asserts a copyright line contains the legal entity and **not** the product
 * name (#363). Lelañea's line names the product by the owner's ruling (t-171)
 * — `© 2026 Lelañea™ · Built by HCE Studio` — so adding this footer there would
 * mean weakening an assertion that is correct for every other fork.
 *
 * ## The fixture is deliberately not our own brand
 *
 * "Acme" is used precisely because it is nothing like the real values. Filling
 * the seam with `Lelañea` would let a HARDCODED name pass every assertion
 * below, which is the one failure this file exists to catch. That the real
 * values are the ones we intend is a separate question, and it is pinned by the
 * `lib/app/leaf-brand.ts` row in `tests/unit/lib/app/defaults.test.ts`.
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

// The footer renders a Cookie Preferences control, which needs consent context.
// Unrelated to brand; stubbed so the real component can render.
vi.mock('@/lib/consent', () => ({ useConsent: () => ({ openPreferences: vi.fn() }) }));

import { render, screen } from '@testing-library/react';

import { SiteFooter } from '@/components/app/site/site-footer';

describe('SiteFooter legal line', () => {
  it('takes the product name from the seam rather than hardcoding it', () => {
    render(<SiteFooter />);

    const legal = screen.getByText(/©/);

    expect(legal).toHaveTextContent(`${FORK.name}™`);
    // A literal in the component would survive the assertion above only if it
    // happened to be "Acme". This is what makes it mean something.
    expect(legal.textContent).not.toContain('Lelañea');
  });

  it('puts the © before the trademarked name and the studio credit last (t-171)', () => {
    render(<SiteFooter />);

    const text = screen.getByText(/©/).textContent ?? '';

    // Order carries the claim, so it is asserted whole rather than as a set
    // of contains-checks that a reordered line would also satisfy.
    expect(text).toMatch(new RegExp(`^© \\d{4} ${FORK.name}™ · Built by HCE Studio$`));
  });

  it('no longer prints the legal entity on the public footer (owner, t-171)', () => {
    render(<SiteFooter />);

    // The seam is filled, so the entity is there to leak if the line still
    // read it.
    expect(screen.getByText(/©/).textContent).not.toContain(FORK.legalName);
  });

  it('does not reinstate the personal name or the placeholder year from the design file', () => {
    render(<SiteFooter />);

    // The prototype's own line is `Lelañea™ · © [YEAR] Lelañea Fulton`.
    const text = screen.getByText(/©/).textContent ?? '';
    expect(text).not.toContain('Fulton');
    expect(text).not.toContain('[YEAR]');
    expect(text).toMatch(/© \d{4} /);
  });
});
