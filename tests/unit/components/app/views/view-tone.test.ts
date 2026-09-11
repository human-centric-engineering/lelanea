/**
 * The tone table — one hue per destination, published above the view.
 *
 * The property worth pinning is COVERAGE, not the individual colours: a
 * destination added to the nav without an entry here gets no band, which looks
 * like a styling accident rather than a missing table row, and nothing else in
 * the suite would notice. So this derives its list from `SHELL_NAV` the way the
 * route test does.
 *
 * @see components/app/views/view-tone.ts
 */
import { describe, expect, it } from 'vitest';

import { isNavItem, SHELL_NAV } from '@/components/app/shell/nav-items';
import { toneStyleFor, VIEW_TONES } from '@/components/app/views/view-tone';

/** Every destination the nav offers, other than the shell root, plus account. */
const TONED = [
  ...SHELL_NAV.filter(isNavItem)
    .map((item) => item.href)
    .filter((href) => href !== '/app'),
  '/app/account',
];

describe('every destination carries a tone', () => {
  it.each(TONED)('%s has one', (href) => {
    expect(VIEW_TONES[href]).toBeTruthy();
  });

  it('names a token and never a colour', () => {
    for (const value of Object.values(VIEW_TONES)) {
      // A literal here would be invisible to `tests/unit/app/brand-theme.test.ts`,
      // where every contrast ruling in this product is measured, and could not
      // follow the theme. `tokens-only.test.ts` guards the components; this
      // guards the one table that hands them a colour.
      expect(value).toMatch(/^var\(--color-[a-z-]+\)$/);
    }
  });

  it('has no row for a path the nav does not offer', () => {
    // A stale row is a band that paints on a route nobody meant to tint, and it
    // would survive a rename of the route it was written for.
    expect(Object.keys(VIEW_TONES).sort()).toEqual([...TONED].sort());
  });
});

describe('the style it publishes', () => {
  it('sets the custom property the surface reads', () => {
    expect(toneStyleFor('/app/settings')).toEqual({ '--tone': 'var(--color-status-purple)' });
  });

  it('publishes nothing for the conversation itself', () => {
    // `/app` is deliberately untoned: the band falls back to `transparent`, and
    // a default here would put a coloured rule across the clean view — the
    // exact defect t-10 shipped and had to fix.
    expect(toneStyleFor('/app')).toBeUndefined();
  });

  it('publishes nothing for a path with no entry', () => {
    expect(toneStyleFor('/app/nonsense')).toBeUndefined();
  });
});
