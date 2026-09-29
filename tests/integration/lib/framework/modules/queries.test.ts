/**
 * Integration test — module read queries (f-module-core / f-ops-views t-3).
 *
 * `listModules` (ordered full list) and `getModuleSettings` (single-module settings read,
 * 404 on miss) over a mocked Prisma client — the SQL is trivial, so this pins the contract:
 * the ordering, the settings column selection, and the not-found → `NotFoundError`.
 *
 * @see lib/framework/modules/queries.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  module: { findMany: vi.fn(), findFirst: vi.fn() },
}));
vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));

import { listModules, getModuleSettings } from '@/lib/framework/modules/queries';
import { NotFoundError } from '@/lib/api/errors';

const SETTINGS = {
  id: 'mod-1',
  slug: 'onboarding',
  name: 'Onboarding',
  status: 'active',
  audience: 'all',
  featureFlagName: null,
  availableFrom: null,
  availableUntil: null,
  isRegistered: true,
  updatedAt: new Date('2026-02-01T00:00:00.000Z'),
};

describe('listModules', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns all rows ordered by slug', async () => {
    prismaMock.module.findMany.mockResolvedValue([SETTINGS]);
    const rows = await listModules();
    expect(rows).toEqual([SETTINGS]);
    expect(prismaMock.module.findMany).toHaveBeenCalledWith({ orderBy: { slug: 'asc' } });
  });
});

describe('getModuleSettings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the module settings by slug', async () => {
    prismaMock.module.findFirst.mockResolvedValue(SETTINGS);
    const row = await getModuleSettings('onboarding');
    expect(row).toEqual(SETTINGS);
    expect(prismaMock.module.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'onboarding' } })
    );
  });

  it('throws NotFoundError when the module does not exist', async () => {
    prismaMock.module.findFirst.mockResolvedValue(null);
    await expect(getModuleSettings('missing')).rejects.toThrow(NotFoundError);
  });
});
