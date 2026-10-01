/**
 * The foundational-documents seed: fills empty tables from Lelañea Fulton's file, with the
 * owner's section keys on the blocks, and never touches them again
 * (f-content-seeds t-86).
 *
 * ## `fp4` — operator-owned, written once
 *
 * The case that matters is the second run. An admin will edit these rows
 * (t-91), and a seed that rewrote them would undo the edit on the next deploy
 * that ran the seeder. So a second run against an edited row must leave the
 * edit in place. That is asserted against a stateful in-memory stand-in for the
 * three tables, through the real unit and the real service, rather than by
 * checking that some write method was not called.
 *
 * @see prisma/seeds/app-lelanea/015-foundational-documents.ts
 * @see lib/app/content/document-store.ts — `seedFoundationalDocuments`
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

vi.mock('@/lib/db/client', () => ({ prisma: {} }));

// The service mirrors into the knowledge base after it writes (t-90). The
// mirror's own behaviour is `tests/unit/lib/app/content/knowledge-mirror.test.ts`;
// here it is only whether, and when, the write service calls it.
const { reconcileKnowledgeMirror } = vi.hoisted(() => ({
  reconcileKnowledgeMirror: vi.fn(),
}));
vi.mock('@/lib/app/content/knowledge-mirror', () => ({ reconcileKnowledgeMirror }));

import unit from '@/prisma/seeds/app-lelanea/015-foundational-documents';
import { DOCUMENT_SNAPSHOT_FIELDS } from '@/lib/app/content/document-store';
import { readFoundationalDocumentsFile } from '@/lib/app/content/seed-input/foundational-seed';
import type { StoredDocumentBlock } from '@/lib/app/content/schemas';

type Row = Record<string, unknown> & { id?: string; slug?: string };

/** Three tables, held in memory, with the calls the service makes. */
function inMemoryDatabase() {
  const tables = {
    collection: [] as Row[],
    document: [] as Row[],
    revision: [] as Row[],
  };
  // t-113: every row gets a generated id, as the database would; the authored
  // name is its `slug`.
  let sequence = 0;
  const generated = (row: Row): Row => ({ id: `gen-${++sequence}`, ...structuredClone(row) });
  const client = {
    appDocumentCollection: {
      findFirst: vi.fn(async () => tables.collection[0] ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = generated(data);
        tables.collection.push(row);
        return { id: row.id };
      }),
    },
    appFoundationalDocument: {
      count: vi.fn(async () => tables.document.length),
      createManyAndReturn: vi.fn(async ({ data }: { data: Row[] }) => {
        const rows = data.map(generated);
        tables.document.push(...rows);
        return rows.map(({ id, slug }) => ({ id, slug }));
      }),
    },
    appFoundationalDocumentRevision: {
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        tables.revision.push(...data.map((row) => structuredClone(row)));
        return { count: data.length };
      }),
    },
    // Interactive form, as the service uses it: the callback gets the client.
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(client)),
  };
  return { tables, client: client as unknown as PrismaClient, raw: client };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

let db: ReturnType<typeof inMemoryDatabase>;

beforeEach(() => {
  vi.clearAllMocks();
  db = inMemoryDatabase();
  reconcileKnowledgeMirror.mockResolvedValue({ status: 'reconciled', failed: [] });
});

async function runSeed() {
  await unit.run({ prisma: db.client, logger } as unknown as Parameters<typeof unit.run>[0]);
}

describe('015-foundational-documents', () => {
  it('writes the collection and all seven documents in reading order', async () => {
    await runSeed();

    const file = readFoundationalDocumentsFile();
    expect(db.tables.collection).toEqual([
      expect.objectContaining({ slug: file.collection.id, version: '1.1', locale: 'en-US' }),
    ]);
    expect(db.tables.document.map((row) => row.slug)).toEqual(file.collection.suggestedOrder);
    // Each document points at the collection's generated id, and keeps its name.
    for (const row of db.tables.document) {
      expect(row).toMatchObject({
        collectionId: db.tables.collection[0].id,
        collectionSlug: file.collection.id,
      });
    }
    expect(db.tables.document.map((row) => row.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('gives every document its v1 revision, origin seed, with every field changed', async () => {
    await runSeed();

    expect(db.tables.revision).toHaveLength(7);
    for (const revision of db.tables.revision) {
      expect(revision).toMatchObject({
        revision: 1,
        origin: 'seed',
        editorId: null,
        changedFields: [...DOCUMENT_SNAPSHOT_FIELDS],
      });
    }
    // A full snapshot, not a pointer: the revision holds the same blocks.
    const terms = db.tables.document.find((row) => row.slug === 'terms_of_use');
    const termsV1 = db.tables.revision.find((row) => row.documentSlug === 'terms_of_use');
    expect(termsV1?.blocks).toEqual(terms?.blocks);
    // And it points at its document's generated id, not its name.
    expect(termsV1?.documentId).toBe(terms?.id);
  });

  it('writes the three tables in one transaction', async () => {
    await runSeed();

    expect(db.raw.$transaction).toHaveBeenCalledTimes(1);
  });

  it('keeps the acknowledged version, so the move re-gates nobody', async () => {
    await runSeed();

    expect(new Set(db.tables.document.map((row) => row.version))).toEqual(new Set(['1.1']));
  });

  it('writes the words exactly as the file has them, plus the section keys', async () => {
    await runSeed();

    const file = readFoundationalDocumentsFile();
    for (const authored of file.documents) {
      const row = db.tables.document.find((candidate) => candidate.slug === authored.id);
      const stored = row?.blocks as StoredDocumentBlock[];
      expect(stored.map(({ section: _section, ...block }) => block)).toEqual(authored.blocks);
    }
    const disclaimer = db.tables.document.find((row) => row.slug === 'disclaimer');
    const keys = new Set((disclaimer?.blocks as StoredDocumentBlock[]).map((b) => b.section));
    expect(keys).toEqual(
      new Set([
        null,
        'purpose',
        'purpose_limits',
        'is_not',
        'is_not_context',
        'coaching',
        'crisis',
        'commitment',
      ])
    );
  });

  it('leaves an edited row in place on a second run', async () => {
    await runSeed();

    // An admin edit, as t-91 will make it: new words, a new revision.
    const terms = db.tables.document.find((row) => row.slug === 'terms_of_use')!;
    const edited: StoredDocumentBlock[] = [
      { type: 'paragraph', text: 'Edited by an admin.', section: null },
    ];
    terms.blocks = edited;
    terms.revision = 2;

    await runSeed();

    const after = db.tables.document.find((row) => row.slug === 'terms_of_use');
    expect(after?.blocks).toEqual(edited);
    expect(after?.revision).toBe(2);
    // And nothing was added: still one collection, seven documents, seven revisions.
    expect(db.tables.collection).toHaveLength(1);
    expect(db.tables.document).toHaveLength(7);
    expect(db.tables.revision).toHaveLength(7);
    expect(db.raw.$transaction).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenLastCalledWith(expect.stringMatching(/left as they are/));
  });

  it('mirrors into the knowledge base after it writes, and not when it writes nothing', async () => {
    await runSeed();
    expect(reconcileKnowledgeMirror).toHaveBeenCalledTimes(1);
    // After the rows landed, so the mirror reads what was just written.
    expect(db.raw.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      reconcileKnowledgeMirror.mock.invocationCallOrder[0]
    );

    await runSeed();
    expect(reconcileKnowledgeMirror).toHaveBeenCalledTimes(1);
  });

  it('does not fail the write when the mirror fails; the next reconcile retries', async () => {
    reconcileKnowledgeMirror.mockRejectedValue(new Error('Embedding provider unavailable'));

    await expect(runSeed()).resolves.toBeUndefined();

    expect(db.tables.document).toHaveLength(7);
  });

  it('declares no hashInputs over the file, so an edit to it cannot imply it landed', () => {
    expect(unit.hashInputs).toBeUndefined();
  });
});
