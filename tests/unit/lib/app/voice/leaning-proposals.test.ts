/**
 * The proposals the person's previous turn made (f-leanings t-137): read back
 * from that turn's stored tool trace, and only from the turn immediately
 * before, only when it completed.
 *
 * @see lib/app/voice/leaning-proposals.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Db {
  turn: null | { status: string; assistantMessageId: string | null };
  calls: unknown[];
  /** For `proposedRecently`: the last finished turns' replies, newest first. */
  recent: { id: string; calls: unknown[] }[];
  fails: boolean;
}
const db = vi.hoisted((): Db => ({ turn: null, calls: [], recent: [], fails: false }));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    appTurn: {
      findFirst: vi.fn(async () => db.turn),
      findMany: vi.fn(async () => {
        if (db.fails) throw new Error('turn table unreadable');
        return db.recent.slice(0, 2).map((r) => ({ assistantMessageId: r.id }));
      }),
    },
    aiMessage: {
      findFirst: vi.fn(async () => ({ provenance: { capabilityCalls: db.calls } })),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        db.recent
          .filter((r) => where.id.in.includes(r.id))
          .map((r) => ({ provenance: { capabilityCalls: r.calls } }))
      ),
    },
  },
}));

const { prisma } = await import('@/lib/db/client');
const { previousProposals, proposedRecently } = await import('@/lib/app/voice/leaning-proposals');

const call = (data: Record<string, unknown>, success = true) => ({
  slug: 'set_leaning',
  success,
  arguments: {},
  resultPreview: JSON.stringify({ success, data }),
});
const PROPOSED = { leaning: 'length', from: 0, to: 1, how: 'proposed' } as const;

beforeEach(() => {
  vi.clearAllMocks();
  db.turn = { status: 'completed', assistantMessageId: 'msg-1' };
  db.calls = [];
  db.recent = [];
  db.fails = false;
});

describe('previousProposals', () => {
  it('reads the proposals, and only the proposals, from the previous reply’s trace', async () => {
    db.calls = [
      call(PROPOSED),
      call({ leaning: 'imagery', from: 0, to: 1, how: 'asked' }),
      { slug: 'search_knowledge_base', success: true },
    ];

    await expect(previousProposals('u1', 'facilitator')).resolves.toEqual([PROPOSED]);
  });

  it('looks at the person’s own last finished turn on the seat, and their own reply', async () => {
    await previousProposals('u1', 'facilitator', 't-now');

    expect(vi.mocked(prisma.appTurn.findFirst)).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        seat: 'facilitator',
        status: { not: 'running' },
        turnId: { not: 't-now' },
      },
      orderBy: { startedAt: 'desc' },
      select: { status: true, assistantMessageId: true },
    });
    expect(vi.mocked(prisma.aiMessage.findFirst)).toHaveBeenCalledWith({
      where: { id: 'msg-1', conversation: { userId: 'u1' } },
      select: { provenance: true },
    });
  });

  it.each([
    ['there is no previous turn', () => (db.turn = null)],
    ['it did not complete', () => (db.turn = { status: 'failed', assistantMessageId: 'msg-1' })],
    ['it has no reply', () => (db.turn = { status: 'completed', assistantMessageId: null })],
  ])('is empty when %s', async (_case, arrange) => {
    db.calls = [call(PROPOSED)];
    arrange();

    await expect(previousProposals('u1', 'facilitator')).resolves.toEqual([]);
  });

  it('ignores a proposal the call refused', async () => {
    db.calls = [call(PROPOSED, false)];

    await expect(previousProposals('u1', 'facilitator')).resolves.toEqual([]);
  });
});

describe('proposedRecently', () => {
  it('is true while either of the last two finished replies proposed, and false after', async () => {
    db.recent = [
      { id: 'n2', calls: [] },
      { id: 'n1', calls: [call(PROPOSED)] },
    ];
    await expect(proposedRecently('u1', 'facilitator')).resolves.toBe(true);

    db.recent = [{ id: 'n3', calls: [] }, ...db.recent];
    await expect(proposedRecently('u1', 'facilitator')).resolves.toBe(false);
  });

  it('reads only the person’s own finished turns and replies', async () => {
    db.recent = [{ id: 'n1', calls: [] }];
    await proposedRecently('u1', 'facilitator');

    expect(vi.mocked(prisma.appTurn.findMany)).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        seat: 'facilitator',
        status: 'completed',
        assistantMessageId: { not: null },
      },
      orderBy: { startedAt: 'desc' },
      take: 2,
      select: { assistantMessageId: true },
    });
    expect(vi.mocked(prisma.aiMessage.findMany)).toHaveBeenCalledWith({
      where: { id: { in: ['n1'] }, conversation: { userId: 'u1' } },
      select: { provenance: true },
    });
  });

  it('is false with no finished turn, and true when it cannot tell', async () => {
    await expect(proposedRecently('u1', 'facilitator')).resolves.toBe(false);
    db.fails = true;
    await expect(proposedRecently('u1', 'facilitator')).resolves.toBe(true);
  });
});
