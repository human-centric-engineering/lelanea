/**
 * An in-memory stand-in for `@/lib/app/content/document-store`, holding exactly
 * the rows the seed writes (f-content-seeds t-86).
 *
 * Unit tests have no database, and her documents now live in one. The fake is
 * built from the REAL file through the REAL seed builder and the REAL row
 * projection, so a page, email or gate test still renders her actual words. Only
 * the query is replaced. A test that wants to prove the database is what gets
 * read edits a row with {@link FakeDocumentStore.editBlocks} and asserts that
 * the change is what renders.
 *
 * Use it from a `vi.mock` factory, which is hoisted, so import it dynamically:
 *
 * ```ts
 * vi.mock('@/lib/app/content/document-store', async () =>
 *   (await import('@/tests/helpers/app/foundational-documents')).fakeDocumentStore()
 * );
 * import { fakeDocumentStore } from '@/tests/helpers/app/foundational-documents';
 * beforeEach(() => fakeDocumentStore().reset());
 * ```
 *
 * `fakeDocumentStore()` returns one instance per test file (Vitest gives each
 * file its own module registry), so the mock and the test's own import are the
 * same object and the test controls what the mocked module serves.
 *
 * `@/lib/app/content` re-exports these reads, so that one mock covers callers
 * of either path.
 */

import { vi } from 'vitest';
import { buildFoundationalSeed } from '@/lib/app/content/seed-input/foundational-seed';
import {
  ContentNotSeededError,
  toDocumentDetail,
  toDocumentSummary,
  type DocumentRow,
} from '@/lib/app/content/document-view';
import type { StoredDocumentBlock } from '@/lib/app/content/schemas';

/** The rows the seed writes, as `app_foundational_document` would hold them. */
export function seededDocumentRows(): (DocumentRow & { position: number })[] {
  return buildFoundationalSeed().documents.map((document) => ({ ...document, revision: 1 }));
}

/** The collection row the seed writes. */
export function seededCollection() {
  return buildFoundationalSeed().collection;
}

export function createFakeDocumentStore() {
  let rows = seededDocumentRows();
  let collection: ReturnType<typeof seededCollection> | null = seededCollection();

  const store = {
    ContentNotSeededError,
    DOCUMENT_SNAPSHOT_FIELDS: [] as const,
    getFoundationalCollectionMeta: vi.fn(async () => {
      if (!collection) throw new ContentNotSeededError();
      return { ...collection };
    }),
    listFoundationalDocuments: vi.fn(async () => {
      if (!collection) throw new ContentNotSeededError();
      return {
        collection: { ...collection },
        documents: [...rows]
          .sort((a, b) => a.position - b.position)
          .map((row) => toDocumentSummary(toDocumentDetail(row))),
      };
    }),
    getFoundationalDocument: vi.fn(async (id: string) => {
      const row = rows.find((candidate) => candidate.id === id);
      return row ? toDocumentDetail(row) : null;
    }),
    seedFoundationalDocuments: vi.fn(),

    // ---- Test controls. Not part of the real module. ----

    /** Back to exactly what the seed writes. Call from `beforeEach`. */
    reset(): void {
      rows = seededDocumentRows();
      collection = seededCollection();
    },
    /** An environment the seed never ran against. */
    empty(): void {
      rows = [];
      collection = null;
    },
    /**
     * Rewrite one document's blocks, as an admin edit would, and bump its
     * revision. Returns the new blocks.
     */
    editBlocks(
      id: string,
      edit: (blocks: StoredDocumentBlock[]) => StoredDocumentBlock[]
    ): StoredDocumentBlock[] {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) throw new Error(`No seeded document "${id}"`);
      const blocks = edit(structuredClone(row.blocks as StoredDocumentBlock[]));
      rows = rows.map((candidate) =>
        candidate.id === id ? { ...candidate, blocks, revision: candidate.revision + 1 } : candidate
      );
      return blocks;
    },
    /** Change one document's columns other than its blocks. */
    editRow(id: string, patch: Partial<Omit<DocumentRow, 'id' | 'blocks'>>): void {
      rows = rows.map((candidate) =>
        candidate.id === id ? { ...candidate, ...patch } : candidate
      );
    },
  };

  return store;
}

export type FakeDocumentStore = ReturnType<typeof createFakeDocumentStore>;

let instance: FakeDocumentStore | null = null;

/** The file's one fake store. See the module docblock. */
export function fakeDocumentStore(): FakeDocumentStore {
  instance ??= createFakeDocumentStore();
  return instance;
}

/**
 * Replace the words of every block in one section, so a render that shows the
 * replacement can only have read the row.
 */
export function rewriteSection(
  blocks: StoredDocumentBlock[],
  section: string,
  text: (index: number) => string
): StoredDocumentBlock[] {
  let index = 0;
  return blocks.map((block) => {
    if (block.section !== section) return block;
    if (block.type === 'list') return { ...block, items: block.items.map(() => text(index++)) };
    if (block.type === 'heading') return block;
    return { ...block, text: text(index++) };
  });
}
