/**
 * Slot-definition read queries (f-slots + f-slot-capture t-2/t-4). Mocks `@/lib/db/client`
 * (no live DB, house style). Covers `getSlotDefinition` (the targeted-vs-open lookup
 * `fill_slot` keys on), `listSlotDefinitions`, and `getSlotGroupsScopes` (the batch
 * group/scope join `get_state` uses to enforce a read allowlist).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: { slotDefinition: { findFirst: vi.fn(), findMany: vi.fn() } },
}));

import {
  getSlotDefinition,
  listSlotDefinitions,
  getSlotGroupsScopes,
} from '@/lib/framework/data-slots/queries';
import { prisma } from '@/lib/db/client';

beforeEach(() => vi.clearAllMocks());

describe('getSlotDefinition', () => {
  it('resolves a definition by its unique slug', async () => {
    const row = { slug: 'primary_goal', isActive: true };
    vi.mocked(prisma.slotDefinition.findFirst).mockResolvedValue(row as never);

    await expect(getSlotDefinition('primary_goal')).resolves.toEqual(row);
    expect(prisma.slotDefinition.findFirst).toHaveBeenCalledWith({
      where: { slug: 'primary_goal' },
    });
  });

  it('returns null for an undefined slug (an open-mint candidate)', async () => {
    vi.mocked(prisma.slotDefinition.findFirst).mockResolvedValue(null);
    await expect(getSlotDefinition('never_declared')).resolves.toBeNull();
  });
});

describe('listSlotDefinitions', () => {
  it('lists every definition ordered by slug', async () => {
    vi.mocked(prisma.slotDefinition.findMany).mockResolvedValue([{ slug: 'a' }] as never);
    await expect(listSlotDefinitions()).resolves.toEqual([{ slug: 'a' }]);
    expect(prisma.slotDefinition.findMany).toHaveBeenCalledWith({ orderBy: { slug: 'asc' } });
  });
});

describe('getSlotGroupsScopes', () => {
  it('short-circuits an empty slug list without touching the DB', async () => {
    await expect(getSlotGroupsScopes([])).resolves.toEqual([]);
    expect(prisma.slotDefinition.findMany).not.toHaveBeenCalled();
  });

  it('selects only slug/group/scope for the named slugs', async () => {
    const rows = [{ slug: 'primary_goal', group: 'goals', scope: 'global' }];
    vi.mocked(prisma.slotDefinition.findMany).mockResolvedValue(rows as never);
    await expect(getSlotGroupsScopes(['primary_goal', 'mood'])).resolves.toEqual(rows);
    expect(prisma.slotDefinition.findMany).toHaveBeenCalledWith({
      where: { slug: { in: ['primary_goal', 'mood'] } },
      select: { slug: true, group: true, scope: true },
    });
  });
});
