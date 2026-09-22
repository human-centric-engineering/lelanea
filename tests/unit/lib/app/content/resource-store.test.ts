/**
 * The resource store's reads (f-content-seeds t-87): the library from
 * `app_resource_collection`, `app_resource` and `app_resource_words`, one item
 * by id, and the drawer's selection.
 *
 * Prisma is a stub returning the rows the real seed builds, plus a film and a
 * reading added here, since the shipped library has none yet. The write path is
 * covered through the real seed unit in
 * `tests/unit/prisma/seeds/app-lelanea/content-collections.test.ts`.
 *
 * @see lib/app/content/resource-store.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  collectionFindFirst: vi.fn(),
  resourceFindMany: vi.fn(),
  resourceFindUnique: vi.fn(),
  wordsFindMany: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    appResourceCollection: { findFirst: db.collectionFindFirst },
    appResource: { findMany: db.resourceFindMany, findUnique: db.resourceFindUnique },
    appResourceWords: { findMany: db.wordsFindMany },
  },
}));
vi.mock('@/lib/app/content/journey-store', async () =>
  (await import('@/tests/helpers/app/content-stores')).fakeJourneyStore()
);

import { ContentNotSeededError } from '@/lib/app/content/document-view';
import {
  getResource,
  getResourcesLibrary,
  selectResourcesFor,
} from '@/lib/app/content/resource-store';
import type { ResourceRow } from '@/lib/app/content/resource-view';
import {
  fakeJourneyStore,
  filmRow,
  readingRow,
  seededResourceRows,
} from '@/tests/helpers/app/content-stores';

let resources: ResourceRow[];

beforeEach(() => {
  vi.clearAllMocks();
  fakeJourneyStore().reset();
  const rows = seededResourceRows();
  resources = [
    { ...filmRow('the-quiet', { relatesTo: 'module_01_values' }), position: 0, revision: 1 },
    { ...readingRow('the-heart'), position: 0, revision: 1 },
  ];
  db.collectionFindFirst.mockResolvedValue(rows.collection);
  db.resourceFindMany.mockImplementation(async () => resources);
  db.resourceFindUnique.mockImplementation(
    async ({ where }: { where: { id: string } }) => resources.find((r) => r.id === where.id) ?? null
  );
  db.wordsFindMany.mockResolvedValue(rows.words);
});

describe('getResourcesLibrary', () => {
  it('serves films and readings from their rows, and her words by key', async () => {
    const library = await getResourcesLibrary();

    expect(library.collection).toMatchObject({
      id: 'lelanea_resources',
      provenance: { status: 'draft' },
    });
    expect(library.films).toEqual([expect.objectContaining({ id: 'the-quiet', revision: 1 })]);
    expect(library.readings).toEqual([
      expect.objectContaining({ id: 'the-heart', documentId: 'the_heart_behind_lelanea' }),
    ]);
    expect(Object.keys(library.words).sort()).toEqual(['default', 'module_01_values']);
  });

  it('serves what the ROW says, not what the file says', async () => {
    const rows = seededResourceRows();
    db.wordsFindMany.mockResolvedValue(
      rows.words.map((w) =>
        w.key === 'default' ? { ...w, quote: 'An edited quote.', revision: 2 } : w
      )
    );

    const library = await getResourcesLibrary();

    expect(library.words.default).toMatchObject({ quote: 'An edited quote.', revision: 2 });
  });

  it('throws ContentNotSeededError on an unseeded database rather than serving nothing', async () => {
    db.collectionFindFirst.mockResolvedValue(null);

    await expect(getResourcesLibrary()).rejects.toBeInstanceOf(ContentNotSeededError);
    await expect(getResourcesLibrary()).rejects.toThrow(/018-resources/);
  });
});

describe('getResource', () => {
  it('looks one id up, as a film or a reading by its kind', async () => {
    await expect(getResource('the-quiet')).resolves.toMatchObject({ duration: '6:12' });
    await expect(getResource('the-heart')).resolves.toMatchObject({ readingTime: '8 min' });
    expect(db.resourceFindMany).not.toHaveBeenCalled();
  });

  it('is null for an id the library does not have', async () => {
    await expect(getResource('ghost')).resolves.toBeNull();
  });
});

describe('selectResourcesFor', () => {
  it('selects from the rows and names the drawer from the module row', async () => {
    fakeJourneyStore().editModule('module_01_values', { title: 'Values, edited' });

    const selection = await selectResourcesFor('values');

    expect(selection).toMatchObject({
      title: 'Values, edited',
      tier: 'foundations',
      wordsAreOwn: true,
    });
    expect(selection?.films.map((f) => f.id)).toEqual(['the-quiet']);
    expect(selection?.readings.map((r) => r.id)).toEqual(['the-heart']);
  });

  it('is null for a key that is nothing', async () => {
    await expect(selectResourcesFor('nope')).resolves.toBeNull();
  });
});
