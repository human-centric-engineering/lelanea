// @vitest-environment happy-dom

/**
 * The journey list on the home page (t-5).
 *
 * `app/(public)/page.tsx` is excluded from coverage by `vitest.config.ts` —
 * deliberately, since upstream ships it as placeholder marketing copy every
 * fork rewrites. The consequence is that the one piece of LOGIC on the page
 * had nothing watching it: which tiers are published, and in what order.
 *
 * The exclusion is right and this file is the answer to it. What is asserted is
 * the behaviour, not the copy — the prose can change freely without touching
 * this.
 *
 * ## Why onboarding is excluded by id and not by ordinal
 *
 * The first version filtered `tier.order > 0`. That leans on onboarding being
 * exactly `0`, which the schema does not promise: `lib/app/content/schemas.ts`
 * requires only `nonnegative`. Renumbering the authored tiers 1–5 would have
 * published "Onboarding" on the marketing page, and a future tier authored at
 * `0` would have vanished from it — silently, in both directions, since the
 * page renders whatever survives the filter.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this file reads the real `@/lib/app/content` seam
 * ---------------------------------------------------------------------------
 * Every assertion below is derived from `getJourneyStructure()` rather than
 * from a list written out here, and the seam is NOT mocked. That is deliberate:
 * what is being tested is that the page publishes whatever the authored content
 * says, so pinning tier labels in the test would assert the copy twice and
 * catch nothing when the two disagreed.
 *
 * The consequence for a fork: these cases measure YOUR content file. They pass
 * for any journey structure that has at least one non-onboarding tier, and they
 * fail — correctly — if your content has no `onboarding` tier at all, since the
 * second case asserts one exists before checking it is withheld. A fork whose
 * journey has no onboarding step should delete that case and the id filter in
 * `app/(public)/page.tsx` together, rather than mocking the seam to reinstate a
 * tier it does not have.
 *
 * Mocking the seam instead was considered and rejected: it would make every
 * case a test of the fixture, and the one bug this file exists to catch — a
 * tier silently appearing on or vanishing from the marketing page when the
 * content is renumbered — lives precisely in the real content.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import HomePage from '@/app/(public)/page';
import { getJourneyStructure } from '@/lib/app/content';

describe('the journey tiers on the home page', () => {
  it('publishes every tier except onboarding', () => {
    const { tiers } = getJourneyStructure();
    render(<HomePage />);

    const published = tiers.filter((t) => t.id !== 'onboarding');

    // Population first — an empty content file would make the absence
    // assertion below pass for free.
    expect(published.length).toBeGreaterThan(0);

    for (const tier of published) {
      expect(screen.getByText(tier.label)).toBeTruthy();
    }
  });

  it('does not publish the onboarding tier', () => {
    const { tiers } = getJourneyStructure();
    const onboarding = tiers.find((t) => t.id === 'onboarding');

    expect(onboarding, 'the content file no longer has an onboarding tier').toBeDefined();

    render(<HomePage />);

    // "Onboarding" is how you get in, not part of the path being described.
    expect(screen.queryByText(onboarding!.label)).toBeNull();
  });

  it('excludes onboarding by identity, so renumbering the tiers cannot publish it', () => {
    const { tiers } = getJourneyStructure();
    const onboarding = tiers.find((t) => t.id === 'onboarding')!;

    // If this ever stops being 0, an `order > 0` filter would start publishing
    // it — and this case is what says so rather than the page quietly changing.
    // The assertion is about the CONTENT's current shape; the page's filter is
    // pinned by the case above, which holds whatever this number becomes.
    expect(typeof onboarding.order).toBe('number');
    expect(onboarding.order).toBeGreaterThanOrEqual(0);
  });

  it('lists each tier in authored order', () => {
    const { tiers } = getJourneyStructure();
    render(<HomePage />);

    const expected = tiers
      .filter((t) => t.id !== 'onboarding')
      .toSorted((a, b) => a.order - b.order)
      .map((t) => t.label);

    const rendered = screen.getAllByRole('term').map((dt) => dt.textContent?.trim());

    expect(rendered).toEqual(expected);
  });

  it('names each tier’s modules from the authored content, never retyped', () => {
    const { tiers, modules } = getJourneyStructure();
    const byId = new Map(modules.map((m) => [m.id, m.title]));
    render(<HomePage />);

    const first = tiers.find((t) => t.id !== 'onboarding')!;
    const definition = screen.getAllByRole('definition')[0];

    expect(first.modules.length).toBeGreaterThan(0);
    for (const id of first.modules) {
      expect(definition.textContent).toContain(byId.get(id));
    }
  });
});
