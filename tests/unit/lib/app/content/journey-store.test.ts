/**
 * The journey store's read (f-content-seeds t-87): the journey's text as every
 * surface and the API receive it, from `app_journey`, `app_journey_tier` and
 * `app_journey_module`, joined with the code roster.
 *
 * Prisma is a stub returning the rows the real seed builds. The cases assert
 * what the store makes of them: the row's words, the roster's order, validation
 * on the way out, and an unseeded database as an error rather than an empty
 * journey. The write path, including write-once, is covered through the real
 * seed unit in `tests/unit/prisma/seeds/app-lelanea/content-collections.test.ts`.
 *
 * @see lib/app/content/journey-store.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { journeyFindFirst, tierFindMany, moduleFindMany } = vi.hoisted(() => ({
  journeyFindFirst: vi.fn(),
  tierFindMany: vi.fn(),
  moduleFindMany: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    appJourney: { findFirst: journeyFindFirst },
    appJourneyTier: { findMany: tierFindMany },
    appJourneyModule: { findMany: moduleFindMany },
  },
}));

import { ContentNotSeededError } from '@/lib/app/content/document-view';
import { getJourneyStructure } from '@/lib/app/content/journey-store';
import { JOURNEY_MODULES } from '@/lib/app/journey/roster';
import { seededJourneyRows } from '@/tests/helpers/app/content-stores';

let rows: ReturnType<typeof seededJourneyRows>;

beforeEach(() => {
  vi.clearAllMocks();
  rows = seededJourneyRows();
  journeyFindFirst.mockResolvedValue(rows.journey);
  tierFindMany.mockResolvedValue(rows.tiers);
  // Deliberately out of order: the roster, not the query, decides the order.
  moduleFindMany.mockResolvedValue([...rows.modules].reverse());
});

describe('getJourneyStructure', () => {
  it('serves the modules in the roster’s order, whatever order the rows arrive in', async () => {
    const structure = await getJourneyStructure();

    expect(structure.modules.map((m) => m.id)).toEqual(JOURNEY_MODULES.map((m) => m.id));
    expect(structure.modules.map((m) => m.number)).toEqual([...Array(17).keys()]);
  });

  it('serves what the ROW says, not what the file says', async () => {
    moduleFindMany.mockResolvedValue(
      rows.modules.map((row) =>
        row.id === 'module_02_boundaries'
          ? { ...row, title: 'Boundaries, edited', subtitle: 'A new subtitle', revision: 3 }
          : row
      )
    );
    tierFindMany.mockResolvedValue(
      rows.tiers.map((row) => (row.id === 'foundations' ? { ...row, intent: 'Edited.' } : row))
    );

    const structure = await getJourneyStructure();

    expect(structure.modules[2]).toMatchObject({
      title: 'Boundaries, edited',
      subtitle: 'A new subtitle',
      revision: 3,
      tier: 'foundations',
    });
    expect(structure.tiers[1]).toMatchObject({ id: 'foundations', intent: 'Edited.' });
  });

  it('throws ContentNotSeededError on an unseeded database rather than serving nothing', async () => {
    journeyFindFirst.mockResolvedValue(null);
    tierFindMany.mockResolvedValue([]);
    moduleFindMany.mockResolvedValue([]);

    await expect(getJourneyStructure()).rejects.toBeInstanceOf(ContentNotSeededError);
    await expect(getJourneyStructure()).rejects.toThrow(/016-journey-structure/);
  });

  it('throws on a module row whose phases fail validation', async () => {
    moduleFindMany.mockResolvedValue(
      rows.modules.map((row) => (row.id === 'module_01_values' ? { ...row, phases: 'x' } : row))
    );

    await expect(getJourneyStructure()).rejects.toThrow(/failed validation/);
  });
});
