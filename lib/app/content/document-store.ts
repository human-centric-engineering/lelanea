/**
 * Her foundational documents, read from and written to the database
 * (f-content-seeds t-86).
 *
 * **The one service for these tables.** Every read a surface makes and every
 * write — the seed's now, the admin editor's in t-91 — goes through here. The
 * knowledge-base mirror (t-90) and the editor attach to this module, not to the
 * tables, so no write can skip either one.
 *
 * **What reads it:** the public pages (through `@/lib/app/content/sections`), the
 * acknowledgement gate, the welcome and waitlist emails, the waitlist's locale
 * fallback, and `/api/v1/app/content/documents*`. The pages call this service
 * directly and do not fetch their own API. The API is still the contract: the
 * parity test in `tests/unit/app/api/v1/app/content/documents-parity.test.ts`
 * proves that for every document the route serves exactly the record a page
 * renders from.
 *
 * **Read per request, no cache.** Seven small rows. An admin edit (t-91) has to
 * be visible on the next request to every client, and a cache here would be
 * something t-91 must remember to invalidate. Add one only when a measurement
 * asks for it.
 *
 * **Validated on the way out, not just on the way in.** See
 * `document-view.ts`, which every read goes through.
 *
 * **An unseeded database throws {@link ContentNotSeededError}.** It does not
 * fall back to the file. The owner ruled that `content/` is never content the
 * running app refers to, and a silent fallback would hide a missing seed until
 * the first admin edit failed to appear.
 *
 * @see prisma/schema/app.prisma — `AppFoundationalDocument` and its revisions
 * @see lib/app/content/seed-input/foundational-seed.ts — what the seed writes
 */

import type { PrismaClient } from '@prisma/client';
import { prisma as defaultClient } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { storedDocumentBlocksSchema } from '@/lib/app/content/schemas';
import {
  ContentNotSeededError,
  toDocumentDetail,
  toDocumentSummary,
  type ContentCollectionMeta,
  type FoundationalDocumentDetail,
  type FoundationalDocumentIndex,
} from '@/lib/app/content/document-view';
import type { FoundationalSeed } from '@/lib/app/content/document-view';

export {
  ContentNotSeededError,
  type ContentCollectionMeta,
  type FoundationalDocumentDetail,
  type FoundationalDocumentIndex,
  type FoundationalDocumentSummary,
} from '@/lib/app/content/document-view';

// ============================================================================
// Reads
// ============================================================================

/**
 * Identity and version of the collection.
 *
 * @throws ContentNotSeededError when the seed has not run.
 */
export async function getFoundationalCollectionMeta(): Promise<ContentCollectionMeta> {
  const collection = await defaultClient.appDocumentCollection.findFirst({
    select: { id: true, title: true, version: true, locale: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!collection) throw new ContentNotSeededError();
  return collection;
}

/**
 * Every foundational document in reading order, without its blocks.
 *
 * @throws ContentNotSeededError when the seed has not run.
 */
export async function listFoundationalDocuments(): Promise<FoundationalDocumentIndex> {
  const [collection, rows] = await Promise.all([
    getFoundationalCollectionMeta(),
    defaultClient.appFoundationalDocument.findMany({ orderBy: { position: 'asc' } }),
  ]);
  return { collection, documents: rows.map((row) => toDocumentSummary(toDocumentDetail(row))) };
}

/**
 * One foundational document with its blocks, or `null` for an unknown id.
 *
 * `null` rather than a throw keeps the 404 decision with the caller: the route
 * answers `NOT_FOUND`, and a page uses `requireDocument`, which treats a
 * missing document as broken content.
 */
export async function getFoundationalDocument(
  id: string
): Promise<FoundationalDocumentDetail | null> {
  const row = await defaultClient.appFoundationalDocument.findUnique({ where: { id } });
  return row ? toDocumentDetail(row) : null;
}

// ============================================================================
// Writes
// ============================================================================

/** The fields a revision snapshots. At revision 1 every one is "changed". */
export const DOCUMENT_SNAPSHOT_FIELDS = [
  'position',
  'title',
  'subtitle',
  'category',
  'surface',
  'requiresAcknowledgement',
  'placeholders',
  'renderStyle',
  'renderNote',
  'blocks',
  'version',
  'locale',
] as const;

export type SeedDocumentsResult =
  | { status: 'seeded'; documents: number }
  /** A collection row already exists. Nothing was written. */
  | { status: 'skipped'; documents: number };

/**
 * Write the collection, its documents and each one's first revision, once.
 *
 * **Write-once (`fp4`).** The rows are operator-owned as soon as an admin can
 * edit them (t-91). So if any collection row exists this writes nothing, whatever
 * the file now says, and a re-seed can never undo an edit. The marker is the
 * collection row because all three tables are written in one transaction: if the
 * row is present, the rest landed with it.
 *
 * **Safe on empty.** There is no removal pass. A seed with no documents writes a
 * collection and nothing else, which `ContentNotSeededError` does not mistake
 * for an unseeded database. The file's schema requires documents anyway.
 *
 * `client` is the seed runner's Prisma client. Other callers leave it out.
 */
export async function seedFoundationalDocuments(
  seed: FoundationalSeed,
  client: PrismaClient = defaultClient
): Promise<SeedDocumentsResult> {
  const existing = await client.appDocumentCollection.findFirst({ select: { id: true } });
  if (existing) {
    return { status: 'skipped', documents: await client.appFoundationalDocument.count() };
  }

  const now = new Date();
  const rows = seed.documents.map((document) => ({
    position: document.position,
    title: document.title,
    subtitle: document.subtitle,
    category: document.category,
    surface: document.surface,
    requiresAcknowledgement: document.requiresAcknowledgement,
    placeholders: document.placeholders,
    renderStyle: document.renderStyle,
    renderNote: document.renderNote,
    // Validated again at the write, not just when the seed was built. The
    // editor's writes will pass through here too.
    blocks: storedDocumentBlocksSchema.parse(document.blocks),
    version: document.version,
    locale: document.locale,
  }));

  await client.$transaction([
    client.appDocumentCollection.create({
      data: { ...seed.collection, createdAt: now, updatedAt: now },
    }),
    client.appFoundationalDocument.createMany({
      data: seed.documents.map((document, index) => ({
        id: document.id,
        collectionId: seed.collection.id,
        ...rows[index],
        revision: 1,
        createdAt: now,
        updatedAt: now,
      })),
    }),
    client.appFoundationalDocumentRevision.createMany({
      data: seed.documents.map((document, index) => ({
        documentId: document.id,
        revision: 1,
        ...rows[index],
        // Against nothing, everything is new.
        changedFields: [...DOCUMENT_SNAPSHOT_FIELDS],
        origin: 'seed' as const,
        // The operator wrote this, not a person. `origin` says so; a null
        // `editorId` alone would read the same as an erased admin.
        editorId: null,
        changedAt: now,
      })),
    }),
  ]);

  await syncKnowledgeMirror();
  return { status: 'seeded', documents: seed.documents.length };
}

/**
 * Bring the knowledge-base mirror into step after a write (t-90). **Every write
 * to these tables calls it**: the seed's here, and every admin write in
 * `lib/app/content/admin/documents.ts` (t-91), so no edit can leave the agent
 * recalling the old words.
 *
 * Best-effort: the rows are already committed and are what every surface reads.
 * A failed mirror is logged and retried by the next reconcile (the seed unit or
 * the cron route), so it must not turn a successful write into an error.
 *
 * ## Overlapping saves (t-91)
 *
 * The t-90 review declined this as unreachable while the seed was the only
 * writer; the editor makes it reachable. Two saves A then B, each followed by a
 * reconcile: A's reconcile can read A's text, B's reconcile writes B's, and A's
 * finishes last with the older words. So after reconciling, this reads the
 * documents' revisions again, and reconciles once more if they moved while it
 * ran. Whichever reconcile finishes last does that check after its own write,
 * so the last word the mirror holds is the rows' current one. The saves
 * themselves are serialised by the revision lock. **Rejected:** a lock held
 * across the reconcile, which would hold a database lock across embedding
 * calls, the reason the t-90 review gave for not adding one.
 *
 * Imported dynamically so the pages that read this service do not load the
 * ingestion pipeline to render a document.
 */
export async function syncKnowledgeMirror(): Promise<void> {
  // The documents' revisions, as one string, or null when they cannot be read.
  // A failed read must not cost the mirror: it just means reconciling once,
  // which is what every write did before overlapping saves were possible.
  const revisions = async (): Promise<string | null> => {
    try {
      const rows = await defaultClient.appFoundationalDocument.findMany({
        select: { id: true, revision: true },
        orderBy: { id: 'asc' },
      });
      return rows.map((row) => `${row.id}@${row.revision}`).join(',');
    } catch {
      return null;
    }
  };

  try {
    const { reconcileKnowledgeMirror } = await import('@/lib/app/content/knowledge-mirror');
    // Bounded: a third pass means saves are arriving faster than a reconcile
    // runs, and the next save's own call picks up where this one stops.
    for (let pass = 0; pass < MIRROR_PASSES; pass++) {
      const before = await revisions();
      const result = await reconcileKnowledgeMirror();
      if (result.failed.length > 0) {
        logger.warn(
          'Knowledge mirror incomplete after a documents write; the next reconcile retries',
          { failed: result.failed.map((failure) => failure.sourceKey) }
        );
      }
      const after = await revisions();
      if (before === null || after === null || after === before) return;
    }
  } catch (error) {
    logger.warn('Knowledge mirror failed after a documents write; the next reconcile retries', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** How many times one write's mirror sync reconciles, at most. */
const MIRROR_PASSES = 3;
