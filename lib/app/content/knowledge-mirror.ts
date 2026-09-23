/**
 * Her words about the work, mirrored into the knowledge base so the agent can
 * recall them by meaning (f-content-seeds t-90).
 *
 * The foundational documents live in `app_foundational_document`, and every
 * surface reads them from there by key. That is enough for a page. It is not
 * enough for the agent: asked what this work is, or why it exists, it can only
 * find what `search_knowledge_base` can find, which is the knowledge base. So
 * each mirrored document is copied, as markdown, into one `AiKnowledgeDocument`
 * and designated `knowledge`, which is the purpose the grant rule admits.
 *
 * **The row is authoritative; the mirror is an index.** Nothing reads the
 * mirror back into the app. It is rebuilt from the row whenever they disagree,
 * and deleted when the row is gone. See the journal decision "Storage:
 * relational is authoritative…" for the per-collection table.
 *
 * ## What is mirrored, and why
 *
 * Every foundational document whose category is not `legal`: the welcome
 * statement (`onboarding`) and the four `about` documents (heart, mission,
 * creator, lineage). These are her words about the work, which is what someone
 * asking "what is this?" should hear.
 *
 * **The legal documents are never mirrored.** The disclaimer and the Terms are
 * read by key and acknowledged by version. Legal text is not a retrieval target,
 * and a paraphrase of a retrieved clause would be worse than none.
 *
 * **Values reuses this for the explorations** (her prose per value) when it is
 * built, by adding a source prefix and a reader here rather than a second path.
 * Nothing else the seeds write is mirrored. It is all fetched by key.
 *
 * ## Designation
 *
 * Purpose `knowledge`, never `voice` or `both`: these are her words about the
 * app, not examples of her register. Sensitivity `public`, because every one of
 * them is already on a public page. **They are written once, when the
 * designation row is created, and never again.** The row and its tags land in
 * one transaction, so once the row exists, whatever tags the document carries
 * are somebody's choice. An admin who re-designates a mirrored document through
 * `/admin/app/knowledge`, or clears its purpose so the agent stops retrieving
 * it, keeps that choice through every later reconcile and re-ingest.
 *
 * The designation is written in one transaction immediately after the upload,
 * not inside it. `uploadDocument` commits the document itself, and doing better
 * would mean copying the platform's private chunk insert (`fp5`). An
 * undesignated document reaches nothing, which is the safe direction. If the
 * designation write fails, the next reconcile finds the same document again
 * (the upload deduplicates by hash) and designates it, so the window is
 * momentary and never permanent (idea #23; the upstream ask for an
 * in-transaction hook is sunrise#848).
 *
 * ## Who runs it
 *
 * {@link reconcileKnowledgeMirror} is the only entry point. Three callers:
 *
 * - `seedFoundationalDocuments` in `document-store.ts`, after it writes. t-91's
 *   editor writes go through the same service and must call it too.
 * - Seed `app-lelanea/020-knowledge-mirror`. On `db:reset` the documents arrive
 *   by migration and seed 015 writes nothing, so the first mirror comes from
 *   this seed unit.
 * - `GET /api/v1/app/cron/knowledge-mirror`, scheduled by `vercel.json`, which
 *   is how production gets its first mirror and how a failed ingest is retried.
 *   Not a migration, because nothing can embed from SQL. Not the maintenance
 *   tick, because nothing calls it on Vercel.
 *
 * ## Correctness (`fp4`)
 *
 * - **Idempotent.** The mirror's `fileHash` is the SHA-256 of the text
 *   `uploadDocument` ingested. Equal hash and `ready` means nothing is written:
 *   no upload, no re-chunk, no embedding call, no revision.
 * - **Safe on empty.** With no foundational rows at all, the database is
 *   unseeded, and the reconcile returns without a removal pass. A missing seed
 *   must never read as "every document was deleted".
 * - **Partitioned.** It touches only documents whose designation carries a
 *   `foundational:` source key. An admin's uploads have none. If the upload
 *   deduplicates to a document somebody else uploaded or designated, that one
 *   document fails rather than being adopted, because adopting it would put an
 *   admin's upload under a reconcile that rewrites and deletes.
 *
 * **Cost accepted:** an embedding call per mirrored document per change. A
 * handful of documents, edited rarely.
 *
 * @see lib/app/voice/designation.ts — the vocabulary and the grant rule
 * @see prisma/seeds/app-lelanea/020-knowledge-mirror.ts
 * @see app/api/v1/app/cron/knowledge-mirror/route.ts
 */

import { createHash } from 'crypto';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { serviceAccountWhere } from '@/lib/auth/account';
import {
  deleteDocument,
  parseDocumentMetadata,
  rechunkDocument,
  uploadDocument,
} from '@/lib/orchestration/knowledge/document-manager';
import { invalidateAllAgentAccess } from '@/lib/orchestration/knowledge/resolveAgentDocumentAccess';
import { clearContextCache } from '@/lib/orchestration/chat/context-builder';
import {
  PURPOSE_TAG_SLUGS,
  SENSITIVITY_TAG_SLUGS,
  purposeTagSlug,
  sensitivityTagSlug,
  type DocumentPurpose,
  type DocumentSensitivity,
} from '@/lib/app/voice/designation';
import { toDocumentDetail, type FoundationalDocumentDetail } from '@/lib/app/content/document-view';
import type { StoredDocumentBlock } from '@/lib/app/content/schemas';

/** The source-key prefix for a mirrored foundational document. */
export const FOUNDATIONAL_SOURCE_PREFIX = 'foundational:';

/** The purpose a mirrored document is given when it has none. */
export const MIRROR_PURPOSE: DocumentPurpose = 'knowledge';

/** The sensitivity a mirrored document is given when it has none. */
export const MIRROR_SENSITIVITY: DocumentSensitivity = 'public';

/** `'the_mission'` → `'foundational:the_mission'`. */
export function foundationalSourceKey(documentId: string): string {
  return `${FOUNDATIONAL_SOURCE_PREFIX}${documentId}`;
}

/** Is this foundational document mirrored? Everything but the legal texts. */
export function isMirrored(document: Pick<FoundationalDocumentDetail, 'category'>): boolean {
  return document.category !== 'legal';
}

/**
 * Drop a merge field together with the comma that sets it off.
 *
 * `Welcome, {{first_name}}.` → `Welcome.` and `You, {{first_name}}, are` →
 * `You are`. A retrieved passage is quoted to a person, and a literal
 * `{{first_name}}` in the agent's reply would be worse than the name's absence.
 */
function withoutMergeFields(text: string): string {
  return text.replace(/,\s*\{\{\w+\}\}(,)?/g, '');
}

function renderBlock(block: StoredDocumentBlock): string {
  switch (block.type) {
    case 'heading':
      // The title is the only `#`; the document's own headings sit under it.
      return `${'#'.repeat(Math.min(block.level + 1, 6))} ${withoutMergeFields(block.text)}`;
    case 'paragraph':
      return withoutMergeFields(block.text);
    case 'list':
      return block.items.map((item) => `- ${withoutMergeFields(item)}`).join('\n');
  }
}

/**
 * The markdown a foundational document is ingested as.
 *
 * Title, subtitle, then the blocks in order. Headings keep their level under the
 * title, so the chunker splits where she did.
 */
export function renderMirrorText(
  document: Pick<FoundationalDocumentDetail, 'title' | 'subtitle' | 'blocks'>
): string {
  return [
    `# ${document.title}`,
    ...(document.subtitle ? [document.subtitle] : []),
    ...document.blocks.map(renderBlock),
  ].join('\n\n');
}

/** What `uploadDocument` stores as `fileHash` for this text. */
function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** One document the mirror should hold. */
interface MirrorTarget {
  sourceKey: string;
  name: string;
  fileName: string;
  text: string;
  hash: string;
}

export interface KnowledgeMirrorResult {
  /** `not_seeded`: no foundational rows, so nothing was read or written. */
  status: 'reconciled' | 'not_seeded';
  /** Source keys whose document was uploaded for the first time. */
  created: string[];
  /** Source keys whose text had changed and was ingested again. */
  reingested: string[];
  /** Source keys that are no longer mirrored, and whose document was deleted. */
  removed: string[];
  /** Source keys already in step: nothing written. */
  unchanged: string[];
  /** One entry per document that failed. The others still ran. */
  failed: { sourceKey: string; error: string }[];
}

/**
 * Bring the knowledge base into step with the foundational documents.
 *
 * Safe to call as often as anyone likes: in step, it reads and writes nothing
 * else. Each document is handled on its own, so one failed embedding call does
 * not hold up the rest, and the failure is reported rather than thrown.
 */
export async function reconcileKnowledgeMirror(): Promise<KnowledgeMirrorResult> {
  const result: KnowledgeMirrorResult = {
    status: 'reconciled',
    created: [],
    reingested: [],
    removed: [],
    unchanged: [],
    failed: [],
  };

  const rows = await prisma.appFoundationalDocument.findMany({ orderBy: { position: 'asc' } });
  if (rows.length === 0) {
    // Unseeded, not emptied. A removal pass here would delete every mirror
    // because a seed had not run.
    return { ...result, status: 'not_seeded' };
  }

  const targets: MirrorTarget[] = rows
    .map(toDocumentDetail)
    .filter(isMirrored)
    .map((document) => {
      const text = renderMirrorText(document);
      return {
        sourceKey: foundationalSourceKey(document.id),
        name: document.title,
        fileName: `${document.id}.md`,
        text,
        hash: hashText(text),
      };
    });

  const mirrors = await prisma.appKnowledgeDesignation.findMany({
    where: { sourceKey: { startsWith: FOUNDATIONAL_SOURCE_PREFIX } },
    select: { documentId: true, sourceKey: true },
  });
  const documents = await prisma.aiKnowledgeDocument.findMany({
    where: { id: { in: mirrors.map((mirror) => mirror.documentId) } },
    select: { id: true, fileHash: true, status: true, chunkCount: true, metadata: true },
  });
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const documentIdByKey = new Map<string, string>();
  for (const mirror of mirrors) {
    if (mirror.sourceKey) documentIdByKey.set(mirror.sourceKey, mirror.documentId);
  }

  let uploaderId: string | undefined;
  const uploader = async (): Promise<string> => (uploaderId ??= await resolveUploader());

  for (const target of targets) {
    try {
      const documentId = documentIdByKey.get(target.sourceKey);
      const existing = documentId ? documentById.get(documentId) : undefined;

      if (!existing) {
        const created = await uploadMirror(target, await uploader());
        await designate(created, target.sourceKey);
        result.created.push(target.sourceKey);
        continue;
      }

      if (existing.fileHash === target.hash && existing.status === 'ready') {
        result.unchanged.push(target.sourceKey);
        continue;
      }

      if (existing.chunkCount > 0) {
        // Same document, new text: its id, tags and any re-designation an admin
        // made all survive. `rechunkDocument` ingests `metadata.rawContent`, so
        // the new text goes there first. Status leaves `ready` in the same write
        // so the new hash never meets the partial unique index on ready hashes
        // before the chunks match it.
        const metadata = parseDocumentMetadata(existing.metadata) ?? {};
        await prisma.aiKnowledgeDocument.update({
          where: { id: existing.id },
          data: {
            name: target.name,
            fileHash: target.hash,
            status: 'processing',
            metadata: { ...metadata, rawContent: target.text },
          },
        });
        await rechunkDocument(existing.id);
      } else {
        // `rechunkDocument` will not rebuild a document with no chunks, so this
        // one is replaced. The designation row cascades with it and is written
        // again with the defaults.
        await deleteDocument(existing.id);
        const uploadedBy = await uploader();
        const replaced = await uploadMirror(target, uploadedBy);
        await designate(replaced, target.sourceKey);
      }
      result.reingested.push(target.sourceKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Knowledge mirror: document failed', {
        sourceKey: target.sourceKey,
        error: message,
      });
      result.failed.push({ sourceKey: target.sourceKey, error: message });
    }
  }

  // Removal, partitioned to this source's keys: a mirror whose row is gone or
  // stopped being mirrored.
  const wanted = new Set(targets.map((target) => target.sourceKey));
  for (const [sourceKey, documentId] of documentIdByKey) {
    if (wanted.has(sourceKey)) continue;
    try {
      await deleteDocument(documentId);
      result.removed.push(sourceKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Knowledge mirror: removal failed', { sourceKey, error: message });
      result.failed.push({ sourceKey, error: message });
    }
  }

  const changed = result.created.length + result.reingested.length + result.removed.length;
  if (changed > 0) {
    // The same two sixty-second caches `setDesignation` clears, for the same
    // reason: a document that just appeared, or just went, must not wait a
    // minute to be found or forgotten.
    invalidateAllAgentAccess();
    clearContextCache();
  }

  logger.info('Knowledge mirror reconciled', {
    created: result.created.length,
    reingested: result.reingested.length,
    removed: result.removed.length,
    unchanged: result.unchanged.length,
    failed: result.failed.length,
  });
  return result;
}

/**
 * Upload one document and return its id.
 *
 * `uploadDocument` returns any `ready` document with the same hash, including
 * one an admin uploaded and never designated, which the designation guard
 * cannot see. So a document the mirror's own uploader did not upload is
 * refused here. The mirror's own earlier upload, left undesignated by a failed
 * designation write, passes and is designated: that is the repair.
 *
 * A failed upload leaves a `failed` row behind, which `uploadDocument` does not
 * dedup against. Left there, every later retry would add another, so it is
 * removed before the error goes on.
 */
async function uploadMirror(target: MirrorTarget, uploadedBy: string): Promise<string> {
  let document: Awaited<ReturnType<typeof uploadDocument>>;
  try {
    document = await uploadDocument(
      target.text,
      target.fileName,
      uploadedBy,
      undefined,
      target.name
    );
  } catch (error) {
    await prisma.aiKnowledgeDocument.deleteMany({
      where: { fileHash: target.hash, fileName: target.fileName, status: 'failed' },
    });
    throw error;
  }
  if (document.uploadedBy !== uploadedBy) {
    throw new Error(
      `Knowledge document ${document.id} holds the same text but was uploaded by someone else; not mirroring ${target.sourceKey} onto it`
    );
  }
  return document.id;
}

/**
 * Give a newly uploaded mirror its source key and default designation.
 *
 * Writes the defaults only while the document has no designation row, in one
 * transaction with the row, and only for a family with no tag yet. Once the
 * row exists, the document's tags are an admin's to change, including to
 * nothing.
 *
 * @throws when the document already has a designation of its own: an admin's
 *   (no source key) or another source's. Adopting it would take the document
 *   out of the admin's hands.
 */
async function designate(documentId: string, sourceKey: string): Promise<void> {
  const designation = await prisma.appKnowledgeDesignation.findUnique({
    where: { documentId },
    select: { sourceKey: true },
  });
  if (designation) {
    if (designation.sourceKey === sourceKey) return;
    throw new Error(
      `Knowledge document ${documentId} is already designated as ${
        designation.sourceKey ?? 'an admin upload'
      }; not mirroring ${sourceKey} onto it`
    );
  }

  // A family already tagged keeps its tag: an admin can tag a document through
  // Sunrise's own modal, or `setDesignation`, before this row exists, and
  // neither writes the row unless a licensing note is set.
  const current = await prisma.aiKnowledgeDocumentTag.findMany({
    where: {
      documentId,
      tag: { slug: { in: [...PURPOSE_TAG_SLUGS, ...SENSITIVITY_TAG_SLUGS] } },
    },
    select: { tag: { select: { slug: true } } },
  });
  const slugs = current.map((row) => row.tag.slug);
  const wanted = [
    ...(slugs.some((slug) => PURPOSE_TAG_SLUGS.includes(slug))
      ? []
      : [purposeTagSlug(MIRROR_PURPOSE)]),
    ...(slugs.some((slug) => SENSITIVITY_TAG_SLUGS.includes(slug))
      ? []
      : [sensitivityTagSlug(MIRROR_SENSITIVITY)]),
  ];
  const tags = await prisma.knowledgeTag.findMany({
    where: { slug: { in: wanted } },
    select: { id: true, slug: true },
  });
  const missing = wanted.filter((slug) => !tags.some((tag) => tag.slug === slug));
  if (missing.length > 0) {
    // Undesignated reaches nothing, so the document is safe as it stands; the
    // next reconcile after the seed has run designates it.
    throw new Error(
      `The designation vocabulary is not in this database: ${missing.join(', ')} missing. Run "npm run db:seed" to create it.`
    );
  }

  await prisma.$transaction([
    prisma.aiKnowledgeDocumentTag.createMany({
      data: tags.map((tag) => ({ documentId, tagId: tag.id })),
      skipDuplicates: true,
    }),
    // `designatedBy` null: the operator wrote this, not a person.
    prisma.appKnowledgeDesignation.create({
      data: { documentId, sourceKey, designatedBy: null },
    }),
  ]);
}

/**
 * Who a mirrored document is recorded as uploaded by: the service account, as
 * the platform's own knowledge seeder does, or failing that any user.
 */
async function resolveUploader(): Promise<string> {
  const service = await prisma.user.findFirst({
    where: serviceAccountWhere,
    select: { id: true },
  });
  const anyone = service ?? (await prisma.user.findFirst({ select: { id: true } }));
  if (!anyone) {
    throw new Error('No user to record as the uploader. Run "npm run db:seed" first.');
  }
  return anyone.id;
}
