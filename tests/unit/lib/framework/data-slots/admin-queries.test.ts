/**
 * Slot admin-queries unit tests (f-admin-surfaces t-1).
 *
 * House style: no live DB. `@/lib/db/client` is mocked; we drive
 * `listSlotValueHeadsForAdmin` with canned `slotValue.findMany` / `count` rows and a
 * `slotDefinition.findMany` sensitivity lookup, and assert the load-bearing behaviour:
 *   - the `where` narrows on `supersededAt: null` (+ optional slotSlug / userId);
 *   - sensitivity is stitched with ONE batched definition lookup over distinct slugs;
 *   - read-masking: `sensitive` / `special_category` are masked by default (value →
 *     sentinel, valueJson → null, masked: true); `reveal` returns the stored form;
 *     `standard` and open-minted (no definition) slugs are never masked.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SlotValue } from '@prisma/client';

const prismaMock = {
  slotValue: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  slotDefinition: {
    findMany: vi.fn(),
  },
};

vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));

const { listSlotValueHeadsForAdmin } = await import('@/lib/framework/data-slots/admin-queries');

function row(overrides: Partial<SlotValue> & Pick<SlotValue, 'id' | 'slotSlug'>): SlotValue {
  return {
    orgId: null,
    userId: 'user_1',
    version: 1,
    value: 'the real value',
    valueJson: { n: 42 },
    confidence: 8,
    sourceType: 'direct',
    reasoningNote: 'x',
    provenance: {},
    supersededAt: null,
    capturedAt: new Date('2026-06-01T10:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.slotValue.count.mockResolvedValue(0);
  prismaMock.slotDefinition.findMany.mockResolvedValue([]);
});

describe('listSlotValueHeadsForAdmin', () => {
  it('narrows on supersededAt:null plus the optional filters, and paginates', async () => {
    prismaMock.slotValue.findMany.mockResolvedValue([]);
    prismaMock.slotValue.count.mockResolvedValue(0);

    await listSlotValueHeadsForAdmin({
      page: 2,
      limit: 10,
      slotSlug: 'primary_goal',
      userId: 'user_9',
      reveal: false,
    });

    const where = { supersededAt: null, slotSlug: 'primary_goal', userId: 'user_9' };
    expect(prismaMock.slotValue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 10, take: 10 })
    );
    expect(prismaMock.slotValue.count).toHaveBeenCalledWith({ where });
  });

  it('orders by capturedAt desc with a unique id tiebreaker for deterministic paging', async () => {
    prismaMock.slotValue.findMany.mockResolvedValue([]);

    await listSlotValueHeadsForAdmin({ page: 1, limit: 10, reveal: false });

    // The final `id` key breaks capturedAt/slotSlug ties so the SSR page and the reveal
    // re-fetch return the same window (no dead "Reveal") and `?page=` is stable.
    expect(prismaMock.slotValue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ capturedAt: 'desc' }, { slotSlug: 'asc' }, { id: 'asc' }],
      })
    );
  });

  it('omits absent filters from the where clause', async () => {
    prismaMock.slotValue.findMany.mockResolvedValue([]);

    await listSlotValueHeadsForAdmin({ page: 1, limit: 10, reveal: false });

    expect(prismaMock.slotValue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { supersededAt: null }, skip: 0, take: 10 })
    );
  });

  it('masks a sensitive value by default and drops its typed form', async () => {
    prismaMock.slotValue.findMany.mockResolvedValue([row({ id: 'v1', slotSlug: 'health_note' })]);
    prismaMock.slotValue.count.mockResolvedValue(1);
    prismaMock.slotDefinition.findMany.mockResolvedValue([
      { slug: 'health_note', sensitivity: 'sensitive' },
    ]);

    const { items } = await listSlotValueHeadsForAdmin({ page: 1, limit: 10, reveal: false });

    expect(items[0]).toMatchObject({
      id: 'v1',
      masked: true,
      sensitivity: 'sensitive',
      value: '<redacted: sensitive>',
      valueJson: null,
    });
  });

  it('returns the stored form when reveal is set', async () => {
    prismaMock.slotValue.findMany.mockResolvedValue([row({ id: 'v1', slotSlug: 'health_note' })]);
    prismaMock.slotValue.count.mockResolvedValue(1);
    prismaMock.slotDefinition.findMany.mockResolvedValue([
      { slug: 'health_note', sensitivity: 'sensitive' },
    ]);

    const { items } = await listSlotValueHeadsForAdmin({ page: 1, limit: 10, reveal: true });

    expect(items[0]).toMatchObject({
      masked: false,
      value: 'the real value',
      valueJson: { n: 42 },
    });
  });

  it('masks special_category by default too', async () => {
    prismaMock.slotValue.findMany.mockResolvedValue([row({ id: 'v1', slotSlug: 'diagnosis' })]);
    prismaMock.slotValue.count.mockResolvedValue(1);
    prismaMock.slotDefinition.findMany.mockResolvedValue([
      { slug: 'diagnosis', sensitivity: 'special_category' },
    ]);

    const { items } = await listSlotValueHeadsForAdmin({ page: 1, limit: 10, reveal: false });

    expect(items[0].masked).toBe(true);
    expect(items[0].value).toBe('<redacted: special_category>');
  });

  it('never masks a standard slot', async () => {
    prismaMock.slotValue.findMany.mockResolvedValue([row({ id: 'v1', slotSlug: 'primary_goal' })]);
    prismaMock.slotValue.count.mockResolvedValue(1);
    prismaMock.slotDefinition.findMany.mockResolvedValue([
      { slug: 'primary_goal', sensitivity: 'standard' },
    ]);

    const { items } = await listSlotValueHeadsForAdmin({ page: 1, limit: 10, reveal: false });

    expect(items[0]).toMatchObject({ masked: false, value: 'the real value' });
  });

  it('treats an open-minted slug with no definition as standard (unmasked)', async () => {
    prismaMock.slotValue.findMany.mockResolvedValue([row({ id: 'v1', slotSlug: 'minted_thing' })]);
    prismaMock.slotValue.count.mockResolvedValue(1);
    prismaMock.slotDefinition.findMany.mockResolvedValue([]); // no definition for the slug

    const { items } = await listSlotValueHeadsForAdmin({ page: 1, limit: 10, reveal: false });

    expect(items[0]).toMatchObject({
      masked: false,
      sensitivity: 'standard',
      value: 'the real value',
    });
  });

  it('stitches sensitivity with one batched lookup over the distinct slugs', async () => {
    prismaMock.slotValue.findMany.mockResolvedValue([
      row({ id: 'v1', slotSlug: 'a' }),
      row({ id: 'v2', slotSlug: 'a' }),
      row({ id: 'v3', slotSlug: 'b' }),
    ]);
    prismaMock.slotValue.count.mockResolvedValue(3);
    prismaMock.slotDefinition.findMany.mockResolvedValue([
      { slug: 'a', sensitivity: 'standard' },
      { slug: 'b', sensitivity: 'standard' },
    ]);

    await listSlotValueHeadsForAdmin({ page: 1, limit: 10, reveal: false });

    expect(prismaMock.slotDefinition.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.slotDefinition.findMany).toHaveBeenCalledWith({
      where: { slug: { in: ['a', 'b'] } },
      select: { slug: true, sensitivity: true },
    });
  });

  it('short-circuits the definition lookup on an empty page', async () => {
    prismaMock.slotValue.findMany.mockResolvedValue([]);
    prismaMock.slotValue.count.mockResolvedValue(0);

    const { items, total } = await listSlotValueHeadsForAdmin({
      page: 1,
      limit: 10,
      reveal: false,
    });

    expect(items).toEqual([]);
    expect(total).toBe(0);
    expect(prismaMock.slotDefinition.findMany).not.toHaveBeenCalled();
  });
});
