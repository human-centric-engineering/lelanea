/**
 * What Lelañea hands Daybreak as its global slot definitions: the taxonomy and
 * the eleven voice leanings (f-leanings t-135).
 *
 * @see lib/app/slots/global-provider.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { loadGlobalSlotDefinitions } = vi.hoisted(() => ({
  loadGlobalSlotDefinitions: vi.fn(),
}));
vi.mock('@/lib/app/slots/taxonomy-store', () => ({ loadGlobalSlotDefinitions }));

const { loadAppGlobalSlotDefinitions } = await import('@/lib/app/slots/global-provider');

beforeEach(() => vi.clearAllMocks());

describe('the global provider', () => {
  it('hands over the taxonomy, then the eleven leanings', async () => {
    loadGlobalSlotDefinitions.mockResolvedValue([{ slug: 'life_work', group: 'life_areas' }]);

    const slugs = (await loadAppGlobalSlotDefinitions()).map((definition) => definition.slug);

    expect(slugs[0]).toBe('life_work');
    expect(slugs.slice(1)).toHaveLength(11);
    expect(slugs.slice(1).every((slug) => slug.startsWith('leaning_'))).toBe(true);
  });

  it('hands over nothing when the taxonomy gave nothing, so Daybreak still reads it as a fluke', async () => {
    // Daybreak retires nothing on an empty provider, but deactivates every slug
    // it stops receiving. Eleven leanings alone would retire the taxonomy.
    loadGlobalSlotDefinitions.mockResolvedValue([]);

    expect(await loadAppGlobalSlotDefinitions()).toEqual([]);
  });

  it('lets a failed taxonomy read fail, as it did before', async () => {
    loadGlobalSlotDefinitions.mockRejectedValue(new Error('database down'));

    await expect(loadAppGlobalSlotDefinitions()).rejects.toThrow('database down');
  });
});
