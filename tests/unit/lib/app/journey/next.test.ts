/**
 * The "What's next" signpost: where the map says to go (f-journey-record
 * t-148).
 *
 * Portable logic over a `JourneyMapView`, so these run without a database or
 * `next/*` — only `modulePath` underneath, which is itself a pure string
 * builder.
 *
 * @see lib/app/journey/next.ts
 */

import { describe, expect, it } from 'vitest';

import { moduleLabel, whatIsNext } from '@/lib/app/journey/next';
import type { JourneyMapModule, JourneyMapView } from '@/lib/app/journey/map';

function mod(
  overrides: Partial<JourneyMapModule> & Pick<JourneyMapModule, 'slug'>
): JourneyMapModule {
  return {
    number: 0,
    displayNumber: '00',
    title: 'Untitled',
    tier: 'foundations',
    state: 'open',
    ...overrides,
  };
}

function map(modules: JourneyMapModule[]): JourneyMapView {
  return { slug: 'main', version: 1, tiers: [], modules };
}

describe('moduleLabel', () => {
  it('joins the authored number and the title with the middle dot', () => {
    expect(moduleLabel({ displayNumber: '01', title: 'Values' })).toBe('01 · Values');
  });
});

describe('whatIsNext', () => {
  it('is null when there is no map at all', () => {
    expect(whatIsNext(null)).toBeNull();
  });

  it('is null when every module on the map is done', () => {
    const view = map([
      mod({ slug: 'values', state: 'done' }),
      mod({ slug: 'boundaries', state: 'done' }),
    ]);

    expect(whatIsNext(view)).toBeNull();
  });

  it('points at the module the person is currently in, even if it is not first', () => {
    const view = map([
      mod({ slug: 'values', state: 'done' }),
      mod({ slug: 'boundaries', displayNumber: '02', title: 'Boundaries', state: 'current' }),
      mod({ slug: 'money', state: 'open' }),
    ]);

    expect(whatIsNext(view)).toEqual({
      slug: 'boundaries',
      label: '02 · Boundaries',
      href: '/app/modules/boundaries',
      standing: 'current',
    });
  });

  it('falls back to the first not-done module in the map’s own order, not alphabetical', () => {
    // "money" sorts before "values" alphabetically; the map order says otherwise.
    const view = map([
      mod({ slug: 'values', displayNumber: '01', title: 'Values', state: 'done' }),
      mod({ slug: 'money', displayNumber: '00', title: 'Money', state: 'open' }),
      mod({ slug: 'boundaries', displayNumber: '02', title: 'Boundaries', state: 'open' }),
    ]);

    const next = whatIsNext(view);

    expect(next).toMatchObject({ slug: 'money', standing: 'next' });
    expect(next?.label).toBe('00 · Money');
  });

  it('prefers the current module over an earlier not-done one', () => {
    const view = map([
      mod({ slug: 'money', state: 'open' }),
      mod({ slug: 'values', state: 'current' }),
    ]);

    expect(whatIsNext(view)?.slug).toBe('values');
    expect(whatIsNext(view)?.standing).toBe('current');
  });
});
