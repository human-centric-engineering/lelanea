/**
 * Slot-value engine unit tests — insert-only append + head reads.
 *
 * House style: no live DB in vitest. `appendSlotValue` runs inside
 * `executeTransaction` (mocked to forward its callback a `tx` mock); `getSlotHeads`
 * reads via the mocked prisma client. We assert the insert-only reconcile the engine
 * issues:
 *   - first write (no head): version 1, no supersede, `create`;
 *   - second write: version = head + 1, the outgoing head's `supersededAt` stamped,
 *     `create` — all in ONE transaction, with a single `now` shared by the supersede
 *     stamp and the new row's `capturedAt`;
 *   - `valueJson` omitted ⇒ absent from the create payload (column stays NULL);
 *   - `getSlotHeads` filters `supersededAt: null` + `userId`, newest first, with an
 *     optional slug narrowing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SlotValue } from '@prisma/client';
import type { AppendSlotValueInput } from '@/lib/framework/data-slots/values';

const txMock = {
  slotValue: {
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
};

const prismaMock = {
  slotValue: {
    findMany: vi.fn(),
  },
};

vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));
vi.mock('@/lib/db/utils', () => ({
  executeTransaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(txMock)),
}));

const { appendSlotValue, getSlotHeads } = await import('@/lib/framework/data-slots/values');
const { executeTransaction } = await import('@/lib/db/utils');
const executeTransactionMock = executeTransaction as ReturnType<typeof vi.fn>;

function input(overrides: Partial<AppendSlotValueInput> = {}): AppendSlotValueInput {
  return {
    userId: 'user_1',
    slotSlug: 'primary_goal',
    value: 'run a marathon',
    confidence: 7,
    sourceType: 'direct',
    reasoningNote: 'said so directly',
    provenance: { conversationId: 'conv_1' },
    ...overrides,
  };
}

function headRow(overrides: Partial<SlotValue> & Pick<SlotValue, 'version'>): SlotValue {
  return {
    id: `sv_${overrides.version}`,
    orgId: null,
    userId: 'user_1',
    slotSlug: 'primary_goal',
    value: 'old',
    valueJson: null,
    confidence: 5,
    sourceType: 'direct',
    reasoningNote: 'x',
    provenance: {},
    supersededAt: null,
    capturedAt: new Date(0),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  txMock.slotValue.create.mockImplementation(async (args: { data: unknown }) => args.data);
});

describe('appendSlotValue', () => {
  it('first write for a slug: version 1, no supersede, one create', async () => {
    txMock.slotValue.findFirst.mockResolvedValue(null);

    await appendSlotValue(input());

    expect(executeTransactionMock).toHaveBeenCalledTimes(1);
    expect(txMock.slotValue.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user_1', slotSlug: 'primary_goal', supersededAt: null },
      orderBy: { version: 'desc' },
      select: { id: true, version: true },
    });
    expect(txMock.slotValue.update).not.toHaveBeenCalled();
    expect(txMock.slotValue.create).toHaveBeenCalledTimes(1);
    const data = txMock.slotValue.create.mock.calls[0]?.[0]?.data;
    expect(data.version).toBe(1);
    expect(data.value).toBe('run a marathon');
    expect(data.provenance).toEqual({ conversationId: 'conv_1' });
    // valueJson omitted ⇒ not present (column stays NULL, not JSON null).
    expect('valueJson' in data).toBe(false);
  });

  it('second write: version increments and the prior head is superseded with the same now', async () => {
    txMock.slotValue.findFirst.mockResolvedValue(headRow({ version: 1, id: 'sv_head' }));

    await appendSlotValue(input({ value: 'run an ultra' }));

    // Prior head stamped supersededAt.
    expect(txMock.slotValue.update).toHaveBeenCalledTimes(1);
    const updateArgs = txMock.slotValue.update.mock.calls[0]?.[0];
    expect(updateArgs.where).toEqual({ id: 'sv_head' });
    const supersededAt = updateArgs.data.supersededAt;
    expect(supersededAt).toBeInstanceOf(Date);

    // New row at version 2, capturedAt === the supersede stamp (single shared `now`).
    const createData = txMock.slotValue.create.mock.calls[0]?.[0]?.data;
    expect(createData.version).toBe(2);
    expect(createData.value).toBe('run an ultra');
    expect(createData.capturedAt).toEqual(supersededAt);
  });

  it('includes valueJson when provided', async () => {
    txMock.slotValue.findFirst.mockResolvedValue(null);

    await appendSlotValue(input({ valueJson: { target: 42 } }));

    const data = txMock.slotValue.create.mock.calls[0]?.[0]?.data;
    expect(data.valueJson).toEqual({ target: 42 });
  });

  it('does everything in a single transaction (find → supersede → create on the same tx)', async () => {
    txMock.slotValue.findFirst.mockResolvedValue(headRow({ version: 3 }));

    await appendSlotValue(input());

    expect(executeTransactionMock).toHaveBeenCalledTimes(1);
    // All three ops used the tx mock (not the top-level client).
    expect(txMock.slotValue.findFirst).toHaveBeenCalledTimes(1);
    expect(txMock.slotValue.update).toHaveBeenCalledTimes(1);
    expect(txMock.slotValue.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.slotValue.findMany).not.toHaveBeenCalled();
  });
});

describe('getSlotHeads', () => {
  it('reads only head rows for the user, newest first with a stable tiebreaker', async () => {
    prismaMock.slotValue.findMany.mockResolvedValue([]);

    await getSlotHeads('user_1');

    expect(prismaMock.slotValue.findMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', supersededAt: null },
      orderBy: [{ capturedAt: 'desc' }, { slotSlug: 'asc' }],
    });
  });

  it('narrows to specific slugs when given', async () => {
    prismaMock.slotValue.findMany.mockResolvedValue([]);

    await getSlotHeads('user_1', { slotSlugs: ['primary_goal', 'health_note'] });

    expect(prismaMock.slotValue.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        supersededAt: null,
        slotSlug: { in: ['primary_goal', 'health_note'] },
      },
      orderBy: [{ capturedAt: 'desc' }, { slotSlug: 'asc' }],
    });
  });

  it('treats an empty slotSlugs array as no narrowing (not "match nothing")', async () => {
    prismaMock.slotValue.findMany.mockResolvedValue([]);

    await getSlotHeads('user_1', { slotSlugs: [] });

    // No `slotSlug` predicate — an empty list must NOT become `in: []` (which matches nothing).
    expect(prismaMock.slotValue.findMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', supersededAt: null },
      orderBy: [{ capturedAt: 'desc' }, { slotSlug: 'asc' }],
    });
  });
});
