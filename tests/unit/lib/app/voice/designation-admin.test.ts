/**
 * Setting a designation — what the write must and must not touch.
 *
 * Three properties, each of which would be a silent defect:
 *
 *  - **Partitioned clear.** Setting a purpose replaces ONE tag among however many
 *    an admin has put on the document through `/admin/orchestration/knowledge`.
 *    The obvious implementation — `deleteMany({ documentId })` — throws away all
 *    the others, and nothing would report it (`fp4`: more than one writer, so
 *    partition the removal pass to the rows this one owns).
 *  - **Cache eviction.** The rule is composed live but memoised for 60 seconds.
 *    Without the eviction, a document just marked `voice` stays quotable for up
 *    to a minute — which is the minute that matters.
 *  - **A missing tag names its remedy.** The vocabulary comes from the seed. If
 *    the database has not been seeded, the write has to say so and say what to
 *    run, not fail with "not found" (`HB10`).
 *
 * `B9`: no live database in this harness, so the client is mocked and the
 * transaction callback is forwarded to the same mock — which is what lets the
 * `deleteMany` WHERE clause be asserted directly, since it is the thing under
 * test.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/db/client', () => {
  const tx = {
    aiKnowledgeDocumentTag: { deleteMany: vi.fn(), createMany: vi.fn() },
    appKnowledgeDesignation: { upsert: vi.fn() },
  };
  return {
    prisma: {
      aiKnowledgeDocument: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
      appKnowledgeDesignation: { findUnique: vi.fn(), findMany: vi.fn() },
      knowledgeTag: { findMany: vi.fn() },
      // Forwards to the same stubs, so a call inside the transaction is visible
      // on `tx` and the assertions below do not need a second layer.
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
      __tx: tx,
    },
  };
});

vi.mock('@/lib/orchestration/knowledge/resolveAgentDocumentAccess', () => ({
  invalidateAllAgentAccess: vi.fn(),
}));

import { prisma } from '@/lib/db/client';
import { invalidateAllAgentAccess } from '@/lib/orchestration/knowledge/resolveAgentDocumentAccess';
import { NotFoundError, ValidationError } from '@/lib/api/errors';
import { setDesignation, listDesignatedDocuments } from '@/lib/app/voice/designation-admin';
import { purposeTagSlug, sensitivityTagSlug } from '@/lib/app/voice/designation';
import { APP_SCOPE } from '@/lib/app/voice/corpus-access';

type Mocked = ReturnType<typeof vi.fn>;
/**
 * The tag lookup is typed, unlike its siblings, because it is the one whose
 * implementation is REPLACED rather than given a value: a bare `ReturnType<typeof
 * vi.fn>` types `mockImplementation`'s argument as returning `void`, and handing
 * it a promise there is the `no-misused-promises` case.
 */
type TagFindMany = Mock<
  (args: { where: { slug: { in: string[] } } }) => Promise<Array<{ id: string; slug: string }>>
>;
const db = prisma as unknown as {
  aiKnowledgeDocument: { findUnique: Mocked; findMany: Mocked; count: Mocked };
  appKnowledgeDesignation: { findUnique: Mocked; findMany: Mocked };
  knowledgeTag: { findMany: TagFindMany };
  __tx: {
    aiKnowledgeDocumentTag: { deleteMany: Mocked; createMany: Mocked };
    appKnowledgeDesignation: { upsert: Mocked };
  };
};

const DOC = 'doc-1';
const ADMIN = 'admin-1';

/** The read-back `setDesignation` performs after writing. */
function documentReadsBackAs(tagSlugs: string[]): void {
  db.aiKnowledgeDocument.findUnique
    // The existence check at the top of setDesignation.
    .mockResolvedValueOnce({ id: DOC })
    // getDesignation's read afterwards.
    .mockResolvedValueOnce({ tags: tagSlugs.map((slug) => ({ tag: { slug } })) });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.appKnowledgeDesignation.findUnique.mockResolvedValue(null);
  // Resolves every slug it is asked for, so the happy paths below do not each
  // have to enumerate the tag rows.
  db.knowledgeTag.findMany.mockImplementation(({ where }) =>
    Promise.resolve(where.slug.in.map((slug) => ({ id: `tag-${slug}`, slug })))
  );
});

describe('setDesignation', () => {
  it('clears only this feature’s own tags, never the rest of the document’s', async () => {
    documentReadsBackAs([purposeTagSlug('voice')]);

    await setDesignation(DOC, { purpose: 'voice' }, ADMIN);

    const where = db.__tx.aiKnowledgeDocumentTag.deleteMany.mock.calls[0]?.[0]?.where;
    expect(where.documentId).toBe(DOC);
    // Exactly the three purpose slugs. Not `{ documentId }` alone, and not the
    // sensitivity family either — this call set a purpose and nothing else.
    expect(where.tag.slug.in).toEqual([
      purposeTagSlug('knowledge'),
      purposeTagSlug('voice'),
      purposeTagSlug('both'),
    ]);
  });

  it('leaves the sensitivity alone when only the purpose is given', async () => {
    documentReadsBackAs([purposeTagSlug('knowledge'), sensitivityTagSlug('client')]);

    const after = await setDesignation(DOC, { purpose: 'knowledge' }, ADMIN);

    const cleared = db.__tx.aiKnowledgeDocumentTag.deleteMany.mock.calls[0]?.[0]?.where.tag.slug.in;
    expect(cleared).not.toContain(sensitivityTagSlug('client'));
    // And the untouched sensitivity survives into the answer, which is what stops
    // a purpose edit quietly re-admitting deferred client material.
    expect(after.sensitivity).toBe('client');
  });

  it('writes both families when both are given, in one transaction', async () => {
    documentReadsBackAs([purposeTagSlug('both'), sensitivityTagSlug('private')]);

    await setDesignation(DOC, { purpose: 'both', sensitivity: 'private' }, ADMIN);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(db.__tx.aiKnowledgeDocumentTag.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          { documentId: DOC, tagId: `tag-${purposeTagSlug('both')}` },
          { documentId: DOC, tagId: `tag-${sensitivityTagSlug('private')}` },
        ],
      })
    );
  });

  it('clears a purpose when asked for `null`, and applies no tag in its place', async () => {
    documentReadsBackAs([]);

    const after = await setDesignation(DOC, { purpose: null }, ADMIN);

    expect(db.__tx.aiKnowledgeDocumentTag.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.__tx.aiKnowledgeDocumentTag.createMany).not.toHaveBeenCalled();
    expect(after.purpose).toBeNull();
  });

  it('touches no tags at all when only the licensing note changes', async () => {
    documentReadsBackAs([purposeTagSlug('knowledge')]);
    db.appKnowledgeDesignation.findUnique.mockResolvedValue({ licensing: 'Hers, CC BY.' });

    const after = await setDesignation(DOC, { licensing: 'Hers, CC BY.' }, ADMIN);

    expect(db.__tx.aiKnowledgeDocumentTag.deleteMany).not.toHaveBeenCalled();
    expect(db.__tx.aiKnowledgeDocumentTag.createMany).not.toHaveBeenCalled();
    expect(db.__tx.appKnowledgeDesignation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { documentId: DOC },
        create: { documentId: DOC, licensing: 'Hers, CC BY.', designatedBy: ADMIN },
        update: { licensing: 'Hers, CC BY.', designatedBy: ADMIN },
      })
    );
    expect(after.licensing).toBe('Hers, CC BY.');
  });

  it('evicts the resolver’s cache, so a `voice` mark takes effect now and not in a minute', async () => {
    documentReadsBackAs([purposeTagSlug('voice')]);

    await setDesignation(DOC, { purpose: 'voice' }, ADMIN);

    expect(invalidateAllAgentAccess).toHaveBeenCalledTimes(1);
  });

  it('refuses a document that does not exist, before writing anything', async () => {
    db.aiKnowledgeDocument.findUnique.mockResolvedValueOnce(null);

    await expect(setDesignation('nope', { purpose: 'voice' }, ADMIN)).rejects.toBeInstanceOf(
      NotFoundError
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('names the remedy when the vocabulary has not been seeded', async () => {
    db.aiKnowledgeDocument.findUnique.mockResolvedValueOnce({ id: DOC });
    db.knowledgeTag.findMany.mockResolvedValueOnce([]);

    // `HB10`: a guard that rejects with "not found" and nothing else is advice.
    // The remedy has to be in the message, and it has to be a command that exists.
    // One call, both assertions on the caught error — calling twice would consume
    // a second `...Once` document stub that is not there, and the failure would
    // read as the wrong error type rather than as a test-setup mistake.
    const caught = await setDesignation(DOC, { purpose: 'voice' }, ADMIN).catch(
      (error: unknown) => error
    );

    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as Error).message).toMatch(/npm run db:seed/);
    expect((caught as Error).message).toContain(purposeTagSlug('voice'));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('listDesignatedDocuments', () => {
  it('reads the licensing notes in ONE query, not one per row', async () => {
    db.aiKnowledgeDocument.findMany.mockResolvedValueOnce([
      {
        id: 'a',
        name: 'A',
        fileName: 'a.md',
        status: 'ready',
        chunkCount: 3,
        createdAt: new Date('2026-01-01'),
        tags: [{ tag: { slug: purposeTagSlug('knowledge') } }],
      },
      {
        id: 'b',
        name: 'B',
        fileName: 'b.md',
        status: 'ready',
        chunkCount: 1,
        createdAt: new Date('2026-01-02'),
        tags: [{ tag: { slug: purposeTagSlug('voice') } }],
      },
    ]);
    db.aiKnowledgeDocument.count.mockResolvedValueOnce(2);
    db.appKnowledgeDesignation.findMany.mockResolvedValueOnce([
      { documentId: 'b', licensing: 'Substack' },
    ]);

    const { documents } = await listDesignatedDocuments({
      undesignatedOnly: false,
      page: 1,
      limit: 25,
    });

    // The N+1 CLAUDE.md names: a per-row fetch would be two calls here and two
    // hundred on a real corpus.
    expect(db.appKnowledgeDesignation.findMany).toHaveBeenCalledTimes(1);
    expect(db.appKnowledgeDesignation.findUnique).not.toHaveBeenCalled();
    expect(documents.map((d) => [d.id, d.licensing, d.quotable])).toEqual([
      ['a', null, true],
      ['b', 'Substack', false],
    ]);
  });

  it('finds the undesignated by the absence of a PURPOSE, not of every tag', async () => {
    db.aiKnowledgeDocument.findMany.mockResolvedValueOnce([]);
    db.aiKnowledgeDocument.count.mockResolvedValueOnce(0);
    db.appKnowledgeDesignation.findMany.mockResolvedValueOnce([]);

    await listDesignatedDocuments({ undesignatedOnly: true, page: 1, limit: 25 });

    const where = db.aiKnowledgeDocument.findMany.mock.calls[0]?.[0]?.where;
    // A document marked `sensitivity-public` with no purpose is still one nobody
    // has answered for — the rule cannot decide about it, so it reaches nothing.
    expect(where.tags.none.tag.slug.in).toEqual([
      purposeTagSlug('knowledge'),
      purposeTagSlug('voice'),
      purposeTagSlug('both'),
    ]);
  });

  it('lists her uploads only, never the platform’s pre-loaded corpus', async () => {
    // Not cosmetic. A `system`-scoped document is searchable by every agent
    // whatever anyone designates it (`includeSystemScope: true` in the resolver),
    // so listing one beside an `Agent may quote` badge states an answer this
    // feature has no power over — which is exactly what the first version did,
    // showing the bundled Agentic Design Patterns reference as "No".
    db.aiKnowledgeDocument.findMany.mockResolvedValueOnce([]);
    db.aiKnowledgeDocument.count.mockResolvedValueOnce(0);
    db.appKnowledgeDesignation.findMany.mockResolvedValueOnce([]);

    await listDesignatedDocuments({ undesignatedOnly: false, page: 1, limit: 25 });

    expect(db.aiKnowledgeDocument.findMany.mock.calls[0]?.[0]?.where.scope).toBe(APP_SCOPE);
    // And the COUNT takes the same filter, or the pager would report a total the
    // rows cannot add up to.
    expect(db.aiKnowledgeDocument.count.mock.calls[0]?.[0]?.where.scope).toBe(APP_SCOPE);
  });
});
