/**
 * The proposals the person's previous turn made (f-leanings t-137): read back
 * from that turn's stored tool trace, and only from the turn immediately
 * before, only when it completed.
 *
 * @see lib/app/voice/leaning-proposals.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  turn: null as null | { status: string; assistantMessageId: string | null },
  calls: [] as unknown[],
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    appTurn: { findFirst: vi.fn(async () => db.turn) },
    aiMessage: { findFirst: vi.fn(async () => ({ provenance: { capabilityCalls: db.calls } })) },
  },
}));

const { prisma } = await import('@/lib/db/client');
const { previousProposals } = await import('@/lib/app/voice/leaning-proposals');

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
