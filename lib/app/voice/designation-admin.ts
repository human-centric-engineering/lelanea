/**
 * Reading and writing a document's designation.
 *
 * The admin surface's whole data layer: one list, one write. Both live here
 * rather than in the route handlers so the route stays a thin auth + validation
 * shell, which is the platform's convention and is what lets the write be tested
 * without a request.
 *
 * ## The write is partitioned, and that is the correctness property (`fp4`)
 *
 * Setting a purpose means replacing ONE tag among however many an admin has put
 * on the document through Sunrise's own tag modal. The removal pass therefore
 * touches only the six slugs this feature owns — never `deleteMany({
 * documentId })`, which is the obvious shape and silently throws away every
 * unrelated tag on the row. There is more than one writer here (this surface and
 * `/admin/orchestration/knowledge`), which is exactly the case `fp4` names.
 *
 * ## The tags must already exist
 *
 * `setDesignation` resolves slugs to ids and fails loudly if one is missing,
 * rather than creating it. The tags are the seed's rows (`fp4`: one writer per
 * row), and a tag minted here would carry no description and would differ
 * between environments. The error names the remedy — `npm run db:seed` — because
 * a guard that says "not found" and nothing else is advice rather than a
 * mechanism (`HB10`).
 *
 * @see lib/app/voice/designation.ts — the vocabulary and the rule
 * @see prisma/seeds/app-lelanea/002-knowledge-designation.ts — where the tags come from
 */

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/client';
import { NotFoundError, ValidationError } from '@/lib/api/errors';
import { invalidateAllAgentAccess } from '@/lib/orchestration/knowledge/resolveAgentDocumentAccess';
import { clearContextCache } from '@/lib/orchestration/chat/context-builder';
import { APP_SCOPE } from '@/lib/app/voice/corpus-access';
import {
  PURPOSE_TAG_SLUGS,
  SENSITIVITY_TAG_SLUGS,
  isQuotable,
  purposeTagSlug,
  readDesignation,
  sensitivityTagSlug,
  type DocumentDesignation,
  type DocumentPurpose,
  type DocumentSensitivity,
} from '@/lib/app/voice/designation';
import type {
  DesignationAdminQuery,
  DesignationUpdate,
} from '@/lib/validations/app-knowledge-designation';

/** One row of the admin list: the document, what it is designated, and the consequence. */
export interface DesignatedDocument {
  id: string;
  name: string;
  fileName: string;
  status: string;
  chunkCount: number;
  createdAt: Date;
  purpose: DocumentPurpose | null;
  sensitivity: DocumentSensitivity | null;
  licensing: string | null;
  /**
   * Whether the agent's search tool may retrieve and quote this document.
   *
   * Derived here rather than in the component, because it is the answer the page
   * exists to show and a second implementation of `isQuotable()` in JSX is how
   * the surface and the rule drift apart.
   */
  quotable: boolean;
}

/** The admin list: every document SHE uploaded, newest first, with its designation. */
export async function listDesignatedDocuments(
  query: DesignationAdminQuery
): Promise<{ documents: DesignatedDocument[]; total: number }> {
  // Her material only, never the platform's pre-loaded seed corpus. A
  // `system`-scoped document is searchable by every agent whatever anyone
  // designates it (`includeSystemScope: true` in the resolver), so listing one
  // here with an `Agent may quote` badge would state an answer this feature has
  // no power over — and the first version of this page did exactly that, showing
  // the bundled Agentic Design Patterns reference as "No".
  const where: Prisma.AiKnowledgeDocumentWhereInput = { scope: APP_SCOPE };

  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { fileName: { contains: query.q, mode: 'insensitive' } },
    ];
  }

  // Both filters, ANDed, rather than one winning silently.
  //
  // `purpose` and `undesignatedOnly` together are a contradiction, and the query
  // schema rejects the pair on the wire so an operator gets a sentence rather
  // than a table. This function is also called directly, though, and an `else if`
  // here meant a caller passing both got the purpose matches back with
  // `undesignatedOnly` quietly discarded — a wrong answer presented as an
  // answer. ANDed, the contradiction returns nothing, which is true.
  const tagFilters: Prisma.AiKnowledgeDocumentWhereInput[] = [];

  if (query.purpose) {
    tagFilters.push({ tags: { some: { tag: { slug: purposeTagSlug(query.purpose) } } } });
  }

  if (query.undesignatedOnly) {
    // "Nobody has answered for this one yet" is the absence of a PURPOSE tag —
    // not the absence of every designation tag. A document marked
    // `sensitivity-public` with no purpose is still undesignated in the sense
    // that matters: the rule cannot decide about it, so it reaches nothing.
    tagFilters.push({ tags: { none: { tag: { slug: { in: [...PURPOSE_TAG_SLUGS] } } } } });
  }

  if (tagFilters.length > 0) where.AND = tagFilters;

  const [rows, total] = await Promise.all([
    prisma.aiKnowledgeDocument.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        name: true,
        fileName: true,
        status: true,
        chunkCount: true,
        createdAt: true,
        tags: { select: { tag: { select: { slug: true } } } },
      },
    }),
    prisma.aiKnowledgeDocument.count({ where }),
  ]);

  // One query for the notes rather than one per row: the list is the N+1 shape
  // CLAUDE.md names, and a join is not available because the designation table
  // carries a hand-written FK with no Prisma relation behind it.
  const notes = await prisma.appKnowledgeDesignation.findMany({
    where: { documentId: { in: rows.map((row) => row.id) } },
    select: { documentId: true, licensing: true },
  });
  const licensingByDocument = new Map(notes.map((note) => [note.documentId, note.licensing]));

  const documents = rows.map((row) => {
    const designation = readDesignation(
      row.tags.map((join) => join.tag.slug),
      licensingByDocument.get(row.id) ?? null
    );
    return {
      id: row.id,
      name: row.name,
      fileName: row.fileName,
      status: row.status,
      chunkCount: row.chunkCount,
      createdAt: row.createdAt,
      ...designation,
      quotable: isQuotable(designation),
    };
  });

  return { documents, total };
}

/**
 * One document's designation, or `null` when the document does not exist —
 * or is not hers.
 *
 * Scoped to `APP_SCOPE` for the same reason the list is, and it has to be said
 * twice because these are two lookups rather than one: a `system`-scoped
 * document is searchable by every agent whatever anyone designates it, so
 * answering about one here would state a `quotable` verdict the rule has no
 * power over. Out of scope is indistinguishable from absent on purpose — the
 * caller turns `null` into a 404, and "this document exists but is not yours to
 * designate" is not a distinction worth leaking.
 */
export async function getDesignation(documentId: string): Promise<DocumentDesignation | null> {
  const [document, note] = await Promise.all([
    prisma.aiKnowledgeDocument.findFirst({
      where: { id: documentId, scope: APP_SCOPE },
      select: { tags: { select: { tag: { select: { slug: true } } } } },
    }),
    prisma.appKnowledgeDesignation.findUnique({
      where: { documentId },
      select: { licensing: true },
    }),
  ]);
  if (!document) return null;

  return readDesignation(
    document.tags.map((join) => join.tag.slug),
    note?.licensing ?? null
  );
}

/**
 * Set some or all of a document's designation.
 *
 * `undefined` leaves a field alone; `null` clears it. Returns the designation as
 * it stands afterwards, so the caller re-seeds its state without a second read.
 *
 * Every write is in one transaction: a purpose applied without its sensitivity
 * removed would leave the document in a state neither the admin nor the rule
 * asked for, and the rule is consulted on the very next resolve.
 */
export async function setDesignation(
  documentId: string,
  update: DesignationUpdate,
  adminId: string
): Promise<DocumentDesignation> {
  // Scoped, and this is the load-bearing one of the three scope filters. The
  // list showing a `system` document was a cosmetic lie; WRITING one is a
  // functional one — the tag is stored, the audit log records a designation, and
  // the response says `quotable: false` while `resolveAgentDocumentAccess`
  // returns `includeSystemScope: true` and keeps the document searchable by
  // every agent. That is `B31` again, on the surface built to prevent it.
  const document = await prisma.aiKnowledgeDocument.findFirst({
    where: { id: documentId, scope: APP_SCOPE },
    select: { id: true },
  });
  if (!document) throw new NotFoundError(`Document ${documentId} not found`);

  // Resolve every slug this write could need up front, so a missing tag fails
  // before anything is written rather than half-way through the transaction.
  const wantedSlugs: string[] = [];
  if (update.purpose) wantedSlugs.push(purposeTagSlug(update.purpose));
  if (update.sensitivity) wantedSlugs.push(sensitivityTagSlug(update.sensitivity));

  const tags = await prisma.knowledgeTag.findMany({
    where: { slug: { in: wantedSlugs } },
    select: { id: true, slug: true },
  });
  const tagIdBySlug = new Map(tags.map((tag) => [tag.slug, tag.id]));
  const missing = wantedSlugs.filter((slug) => !tagIdBySlug.has(slug));
  if (missing.length > 0) {
    throw new ValidationError(
      `The designation vocabulary is not in this database: ${missing.join(', ')} missing. Run "npm run db:seed" to create it, then try again.`
    );
  }

  // Which of the six slugs this write replaces. A field left `undefined` is not
  // in either list, so its existing tag survives untouched.
  //
  // Taken from the exported per-family lists rather than re-derived by prefix
  // here. A local `startsWith('purpose-')` duplicates a constant `designation.ts`
  // keeps private, and drifting the two fails in the UNSAFE direction with
  // nothing to report it: `slugsToClear` silently becomes empty while
  // `slugsToApply` stays correct, so setting a purpose ADDS the new tag without
  // removing the old one and the document ends up carrying both
  // `purpose-knowledge` and `purpose-voice`.
  const slugsToClear: string[] = [
    ...(update.purpose !== undefined ? PURPOSE_TAG_SLUGS : []),
    ...(update.sensitivity !== undefined ? SENSITIVITY_TAG_SLUGS : []),
  ];
  const slugsToApply = wantedSlugs;

  await prisma.$transaction(async (tx) => {
    if (slugsToClear.length > 0) {
      // Partitioned to this feature's own slugs — an admin's unrelated tags on
      // the same document are not this write's to remove.
      await tx.aiKnowledgeDocumentTag.deleteMany({
        where: { documentId, tag: { slug: { in: slugsToClear } } },
      });
    }

    if (slugsToApply.length > 0) {
      await tx.aiKnowledgeDocumentTag.createMany({
        data: slugsToApply.map((slug) => ({ documentId, tagId: tagIdBySlug.get(slug)! })),
        skipDuplicates: true,
      });
    }

    if (update.licensing !== undefined) {
      await tx.appKnowledgeDesignation.upsert({
        where: { documentId },
        create: { documentId, licensing: update.licensing, designatedBy: adminId },
        update: { licensing: update.licensing, designatedBy: adminId },
      });
    }
  });

  // The rule is composed live from these tags, and `resolveAgentDocumentAccess`
  // memoises for 60 seconds. Without this, a document just marked `voice` stays
  // quotable for up to a minute — which is the one minute that matters.
  // `invalidateAll` rather than per-agent for the same reason Sunrise's own tag
  // route does it: the affected set is every agent the rule widens.
  invalidateAllAgentAccess();

  // And the OTHER sixty-second cache, which the first version of the voice
  // contributor left behind. `buildContext` memoises the FRAMED BLOCK — her
  // retrieved passages included — per `(contextType, contextId, userId)`, so a
  // document re-designated `sensitivity-client` here goes on reaching the system
  // prompt of every conversation whose block was built in the preceding minute.
  // That is the same "one minute that matters" as above, on the path where the
  // material in question is her client transcripts. Caught by /code-review.
  //
  // Whole-cache rather than targeted: a designation is not scoped to a situation
  // or a user, so the affected entries are every `voice` block for every user —
  // and the platform exports no way to enumerate its keys. The cost is a rebuild
  // of the framework's `module` blocks too, which is one extra query on the next
  // turn that asks for one.
  //
  // **It clears THIS process's cache, and that is the honest limit of it.**
  // `buildContext`'s cache is a plain module-scoped `Map`, unlike the contributor
  // registry twelve lines above it in the same file, which Sunrise deliberately
  // backs with `globalThis` because Turbopack loads `instrumentation.ts` in a
  // separate module graph. So on more than one instance, a designation made
  // through instance A leaves instance B serving the cached block — with that
  // document's passage still in it — for up to the remaining TTL. An
  // `upstream-gap` for Sunrise (the file is identical in all three tiers), not
  // something a leaf can close. Caught by /code-review.
  clearContextCache();

  const after = await getDesignation(documentId);
  // The document existed at the top of this function and the FK cascades only on
  // delete, so `null` here means it was deleted mid-write — a 404 is the honest
  // answer, not a designation object built from nothing.
  if (!after) throw new NotFoundError(`Document ${documentId} not found`);
  return after;
}
