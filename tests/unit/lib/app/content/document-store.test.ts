/**
 * The document store's reads (f-content-seeds t-86): her foundational documents
 * as every surface and the API receive them from `app_foundational_document`.
 *
 * Prisma is a stub returning the rows the real seed builds. The cases assert
 * what the store makes of a row — reading order, the served shape, validation on
 * the way OUT, the `null`-not-throw contract on an unknown id — and that an
 * unseeded database is an error rather than an empty answer. The seed's write
 * path, including write-once, is covered through the real unit in
 * `tests/unit/prisma/seeds/app-lelanea/foundational-documents.test.ts`.
 *
 * @see lib/app/content/document-store.ts
 * @see lib/app/content/document-view.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { collectionFindFirst, documentFindMany, documentFindUnique } = vi.hoisted(() => ({
  collectionFindFirst: vi.fn(),
  documentFindMany: vi.fn(),
  documentFindUnique: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    appDocumentCollection: { findFirst: collectionFindFirst },
    appFoundationalDocument: { findMany: documentFindMany, findUnique: documentFindUnique },
  },
}));

import {
  ContentNotSeededError,
  getFoundationalCollectionMeta,
  getFoundationalDocument,
  listFoundationalDocuments,
} from '@/lib/app/content/document-store';
import { seededCollection, seededDocumentRows } from '@/tests/helpers/app/foundational-documents';

const rows = seededDocumentRows();
const byId = (id: string) => rows.find((row) => row.id === id) ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  collectionFindFirst.mockResolvedValue(seededCollection());
  documentFindMany.mockResolvedValue(rows);
  documentFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    byId(where.id)
  );
});

describe('listFoundationalDocuments', () => {
  it('returns the documents in reading order, asking the database for that order', async () => {
    const { documents } = await listFoundationalDocuments();

    expect(documents.map((document) => document.id)).toEqual([
      'the_initiation',
      'the_heart_behind_lelanea',
      'the_mission',
      'about_the_creator',
      'the_lineage_of_lelanea',
      'disclaimer',
      'terms_of_use',
    ]);
    expect(documentFindMany).toHaveBeenCalledWith({ orderBy: { position: 'asc' } });
  });

  it('serves each summary without its blocks, but with its version, revision and keys', async () => {
    const { documents } = await listFoundationalDocuments();
    const disclaimer = documents.find((document) => document.id === 'disclaimer');

    expect(disclaimer).not.toHaveProperty('blocks');
    expect(disclaimer).toMatchObject({
      version: '1.1',
      revision: 1,
      requiresAcknowledgement: true,
      sections: [
        'purpose',
        'purpose_limits',
        'is_not',
        'is_not_context',
        'coaching',
        'crisis',
        'commitment',
      ],
    });
    expect(disclaimer?.blockCount).toBeGreaterThan(0);
  });

  it('normalises the optional members so clients never see undefined', async () => {
    const mission = (await listFoundationalDocuments()).documents.find(
      (document) => document.id === 'the_mission'
    );

    expect(mission).toMatchObject({
      requiresAcknowledgement: false,
      placeholders: [],
      renderStyle: null,
      renderNote: null,
      sections: [],
    });
  });

  it('withholds the editorial review notes and source-file provenance', async () => {
    const index = await listFoundationalDocuments();

    expect(index).not.toHaveProperty('reviewNotes');
    expect(index.documents[0]).not.toHaveProperty('sourceFile');
  });

  it('throws ContentNotSeededError on an unseeded database rather than listing nothing', async () => {
    collectionFindFirst.mockResolvedValue(null);
    documentFindMany.mockResolvedValue([]);

    await expect(listFoundationalDocuments()).rejects.toBeInstanceOf(ContentNotSeededError);
    await expect(getFoundationalCollectionMeta()).rejects.toThrow(/db:seed/);
  });
});

describe('getFoundationalDocument', () => {
  it('returns the stored document with its keyed blocks', async () => {
    const mission = await getFoundationalDocument('the_mission');

    expect(mission?.blocks).toHaveLength(mission!.blockCount);
    expect(mission?.blocks[0]).toMatchObject({ type: 'paragraph', section: null });
  });

  it('serves what the ROW says, not what the file says', async () => {
    // The database is the source. A row that differs from the file is served as
    // the row.
    documentFindUnique.mockResolvedValueOnce({
      ...byId('the_mission')!,
      title: 'Edited title',
      blocks: [{ type: 'paragraph', text: 'Edited words.', section: 'opening' }],
      revision: 4,
    });

    const mission = await getFoundationalDocument('the_mission');

    expect(mission).toMatchObject({
      title: 'Edited title',
      revision: 4,
      sections: ['opening'],
      blocks: [{ type: 'paragraph', text: 'Edited words.', section: 'opening' }],
    });
  });

  it('returns null for an unknown id, leaving the 404 to the caller', async () => {
    expect(await getFoundationalDocument('the_manifesto')).toBeNull();
  });

  it('throws on a row whose blocks fail validation, rather than rendering them', async () => {
    documentFindUnique.mockResolvedValueOnce({
      ...byId('disclaimer')!,
      blocks: [{ type: 'paragraph', text: 'No section field' }],
    });

    await expect(getFoundationalDocument('disclaimer')).rejects.toThrow(/failed validation/);
  });

  it('throws on a row whose category is outside the vocabulary', async () => {
    documentFindUnique.mockResolvedValueOnce({ ...byId('disclaimer')!, category: 'marketing' });

    await expect(getFoundationalDocument('disclaimer')).rejects.toThrow(/category "marketing"/);
  });

  it('throws on a row whose section keys are split, which would splice two passages', async () => {
    documentFindUnique.mockResolvedValueOnce({
      ...byId('disclaimer')!,
      blocks: [
        { type: 'paragraph', text: 'One.', section: 'crisis' },
        { type: 'paragraph', text: 'Two.', section: null },
        { type: 'paragraph', text: 'Three.', section: 'crisis' },
      ],
    });

    await expect(getFoundationalDocument('disclaimer')).rejects.toThrow(/contiguous/);
  });
});
