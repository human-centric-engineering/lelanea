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
      aiKnowledgeDocument: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
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

vi.mock('@/lib/orchestration/chat/context-builder', () => ({
  clearContextCache: vi.fn(),
}));

import { prisma } from '@/lib/db/client';
import { invalidateAllAgentAccess } from '@/lib/orchestration/knowledge/resolveAgentDocumentAccess';
import { clearContextCache } from '@/lib/orchestration/chat/context-builder';
import { NotFoundError, ValidationError } from '@/lib/api/errors';
import {
  setDesignation,
  listDesignatedDocuments,
  retrievalState,
} from '@/lib/app/voice/designation-admin';
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
  aiKnowledgeDocument: { findFirst: Mocked; findMany: Mocked; count: Mocked };
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
  db.aiKnowledgeDocument.findFirst
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

  it('evicts the PROMPT-BLOCK cache too, so a re-designated document stops being quoted now', async () => {
    // Two sixty-second caches, not one. `resolveAgentDocumentAccess` memoises
    // which documents an agent may SEARCH; `buildContext` memoises the framed
    // block — her retrieved passages, already in it — per
    // `(contextType, contextId, userId)`. The first version of the voice
    // contributor left the second behind, so a document re-marked
    // `sensitivity-client` went on reaching the system prompt of every
    // conversation whose block was built in the preceding minute. Caught by
    // /code-review.
    documentReadsBackAs([purposeTagSlug('voice'), sensitivityTagSlug('client')]);

    await setDesignation(DOC, { sensitivity: 'client' }, ADMIN);

    expect(clearContextCache).toHaveBeenCalledTimes(1);
  });

  it('refuses a document that does not exist, before writing anything', async () => {
    db.aiKnowledgeDocument.findFirst.mockResolvedValueOnce(null);

    await expect(setDesignation('nope', { purpose: 'voice' }, ADMIN)).rejects.toBeInstanceOf(
      NotFoundError
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('looks the document up scoped to her uploads, so a system document cannot be designated', async () => {
    // The list filtering to `scope: 'app'` and the WRITE not doing so was `B31`
    // again on the surface built to prevent it: the PATCH succeeded, the tag was
    // stored, an audit entry was logged, and the response said `quotable: false`
    // — while `resolveAgentDocumentAccess` returns `includeSystemScope: true`
    // unconditionally and the document stayed searchable by every agent. An
    // operator who marked it `voice` would reasonably have believed it stopped
    // being quotable.
    //
    // Asserted on the WHERE rather than on the outcome, because the outcome with
    // a stubbed client is whatever the stub returns: dropping `scope` from the
    // query is the revert, and it is the query that has to carry it.
    documentReadsBackAs([purposeTagSlug('voice')]);

    await setDesignation(DOC, { purpose: 'voice' }, ADMIN);

    expect(db.aiKnowledgeDocument.findFirst.mock.calls[0]?.[0]?.where).toEqual({
      id: DOC,
      scope: APP_SCOPE,
    });
    // And the read-back afterwards, which is `getDesignation` — same filter, or
    // the write is refused and the answer is still given.
    expect(db.aiKnowledgeDocument.findFirst.mock.calls[1]?.[0]?.where).toEqual({
      id: DOC,
      scope: APP_SCOPE,
    });
  });

  it('refuses to designate a system-scoped document at all', async () => {
    // Scoped-out reads as absent: `findFirst` matches nothing, and the caller
    // turns that into a 404. "This exists but is not yours to designate" is not a
    // distinction worth leaking, and a 404 is the honest answer either way.
    db.aiKnowledgeDocument.findFirst.mockResolvedValueOnce(null);

    await expect(setDesignation('system-doc', { purpose: 'voice' }, ADMIN)).rejects.toBeInstanceOf(
      NotFoundError
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(invalidateAllAgentAccess).not.toHaveBeenCalled();
  });

  it('names the remedy when the vocabulary has not been seeded', async () => {
    db.aiKnowledgeDocument.findFirst.mockResolvedValueOnce({ id: DOC });
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
    expect(where.AND).toEqual([
      {
        tags: {
          none: {
            tag: {
              slug: {
                in: [purposeTagSlug('knowledge'), purposeTagSlug('voice'), purposeTagSlug('both')],
              },
            },
          },
        },
      },
    ]);
  });

  it('ANDs purpose with undesignatedOnly rather than letting one win silently', async () => {
    // The pair is a contradiction and `designationAdminQuerySchema` rejects it on
    // the wire — but this function is also called directly, and it used to answer
    // a caller who passed both by discarding `undesignatedOnly` and returning the
    // purpose matches. A wrong answer presented as an answer. ANDed, the
    // contradiction returns nothing, which is true.
    db.aiKnowledgeDocument.findMany.mockResolvedValueOnce([]);
    db.aiKnowledgeDocument.count.mockResolvedValueOnce(0);
    db.appKnowledgeDesignation.findMany.mockResolvedValueOnce([]);

    await listDesignatedDocuments({
      purpose: 'knowledge',
      undesignatedOnly: true,
      page: 1,
      limit: 25,
    });

    const where = db.aiKnowledgeDocument.findMany.mock.calls[0]?.[0]?.where;
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0].tags.some.tag.slug).toBe(purposeTagSlug('knowledge'));
    expect(where.AND[1].tags.none.tag.slug.in).toContain(purposeTagSlug('knowledge'));
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

describe('retrievalState — whether there is anything to retrieve', () => {
  // The OTHER axis from `isQuotable()`. The bug this pins: the admin list said
  // the agent may quote a `pending_review` document with zero chunks, which the
  // rule does permit and which the search tool cannot reach a word of.
  //
  // Every negative case sits beside the positive one so the claim is not an
  // absence passing on an empty set (`fp6`).
  it('is retrievable only when the document is ready AND has chunks', () => {
    expect(retrievalState({ status: 'ready', chunkCount: 12 })).toBe('retrievable');
    expect(retrievalState({ status: 'ready', chunkCount: 1 })).toBe('retrievable');
  });

  it('is `empty` for a ready document the parser found nothing in', () => {
    // A real state, not a hypothetical: `document-manager.ts` writes
    // `{ status: 'ready', chunkCount: 0 }` on three separate paths when chunking
    // yields nothing, so "ready" on its own is not an answer.
    expect(retrievalState({ status: 'ready', chunkCount: 0 })).toBe('empty');
    expect(retrievalState({ status: 'ready', chunkCount: 12 })).toBe('retrievable');
  });

  it('is `failed` for a document that never parsed', () => {
    expect(retrievalState({ status: 'failed', chunkCount: 0 })).toBe('failed');
  });

  it('is `pending` for every status that is not yet ready', () => {
    // The five the CHECK constraint on `ai_knowledge_document.status` allows,
    // minus the two answered above.
    expect(retrievalState({ status: 'processing', chunkCount: 0 })).toBe('pending');
    expect(retrievalState({ status: 'pending_review', chunkCount: 0 })).toBe('pending');
    expect(retrievalState({ status: 'cleaning', chunkCount: 0 })).toBe('pending');
  });

  it('treats an unrecognised status with nothing in it as pending', () => {
    // The safe direction on a platform sync: a status a later Sunrise release
    // adds must not default into "the agent may quote this".
    expect(retrievalState({ status: 'quarantined', chunkCount: 0 })).toBe('pending');
  });

  // The order of the two checks, which a first draft had the wrong way round.
  //
  // `rechunkDocument`'s catch writes `{ status: 'failed' }` and leaves every
  // existing chunk and the old `chunkCount` in place, and `searchKnowledgeBase`
  // never filters on `d.status` — so the agent goes on quoting the document.
  // Deciding on status first would render "Nothing to quote. Upload it again"
  // about a document being quoted right now, and the re-upload would create a
  // second row while the original's chunks stayed searchable.
  //
  // Reverting the order fails all three of these.
  it('says retrievable when the chunks are still there, whatever the status says', () => {
    expect(retrievalState({ status: 'failed', chunkCount: 9 })).toBe('retrievable');
    expect(retrievalState({ status: 'processing', chunkCount: 9 })).toBe('retrievable');
    expect(retrievalState({ status: 'quarantined', chunkCount: 40 })).toBe('retrievable');
    // And the same statuses with nothing behind them still read as they should,
    // so this is not the chunk check swallowing the status one.
    expect(retrievalState({ status: 'failed', chunkCount: 0 })).toBe('failed');
    expect(retrievalState({ status: 'processing', chunkCount: 0 })).toBe('pending');
  });
});

describe('the list carries both axes', () => {
  it('reports retrieval alongside quotable, so neither can be inferred from the other', async () => {
    // The four combinations that matter, in one list: permitted and reachable,
    // permitted and NOT reachable (the bug), denied and reachable, denied and
    // not. `quotable` must be blind to status and `retrieval` blind to the
    // designation — a single field could not say all four.
    db.aiKnowledgeDocument.findMany.mockResolvedValueOnce([
      {
        id: 'ready-knowledge',
        name: 'A method note',
        fileName: 'method.md',
        status: 'ready',
        chunkCount: 9,
        createdAt: new Date('2026-01-01'),
        tags: [{ tag: { slug: purposeTagSlug('knowledge') } }],
      },
      {
        id: 'awaiting-knowledge',
        name: 'A PDF she just uploaded',
        fileName: 'talk.pdf',
        status: 'pending_review',
        chunkCount: 0,
        createdAt: new Date('2026-01-02'),
        tags: [{ tag: { slug: purposeTagSlug('knowledge') } }],
      },
      {
        id: 'ready-voice',
        name: 'A Substack post',
        fileName: 'post.md',
        status: 'ready',
        chunkCount: 4,
        createdAt: new Date('2026-01-03'),
        tags: [{ tag: { slug: purposeTagSlug('voice') } }],
      },
      {
        id: 'failed-voice',
        name: 'A talk recording',
        fileName: 'talk.wav',
        status: 'failed',
        chunkCount: 0,
        createdAt: new Date('2026-01-04'),
        tags: [{ tag: { slug: purposeTagSlug('voice') } }],
      },
    ]);
    db.aiKnowledgeDocument.count.mockResolvedValueOnce(4);
    db.appKnowledgeDesignation.findMany.mockResolvedValueOnce([]);

    const { documents } = await listDesignatedDocuments({
      undesignatedOnly: false,
      page: 1,
      limit: 25,
    });

    expect(documents.map((d) => [d.id, d.quotable, d.retrieval])).toEqual([
      ['ready-knowledge', true, 'retrievable'],
      // The one the bug was about: the rule permits it, and there is nothing
      // there to permit.
      ['awaiting-knowledge', true, 'pending'],
      ['ready-voice', false, 'retrievable'],
      ['failed-voice', false, 'failed'],
    ]);
  });
});
