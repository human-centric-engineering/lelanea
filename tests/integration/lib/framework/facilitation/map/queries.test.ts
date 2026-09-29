/**
 * Map read queries (f-map t-3) — `listGraphs` / `getGraphDetail`.
 *
 * The route contract test mocks this module, so the real reads are exercised here
 * directly against a mocked `@/lib/db/client` (house style: no live DB in vitest).
 *
 * @see lib/framework/facilitation/map/queries.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: {
    facilitationGraph: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

import { listGraphs, getGraphDetail, graphExists } from '@/lib/framework/facilitation/map/queries';
import { prisma } from '@/lib/db/client';
import { NotFoundError } from '@/lib/api/errors';

beforeEach(() => vi.clearAllMocks());

describe('listGraphs', () => {
  it('returns every graph ordered by slug', async () => {
    const rows = [{ id: 'g1', slug: 'alpha' }];
    vi.mocked(prisma.facilitationGraph.findMany).mockResolvedValue(rows as never);

    await expect(listGraphs()).resolves.toEqual(rows);
    expect(prisma.facilitationGraph.findMany).toHaveBeenCalledWith({ orderBy: { slug: 'asc' } });
  });

  it('returns [] on a fresh fork', async () => {
    vi.mocked(prisma.facilitationGraph.findMany).mockResolvedValue([] as never);
    await expect(listGraphs()).resolves.toEqual([]);
  });
});

describe('getGraphDetail', () => {
  it('returns the graph with its published version, resolved by slug', async () => {
    const row = { id: 'g1', slug: 'main', publishedVersion: { id: 'v1', version: 1 } };
    vi.mocked(prisma.facilitationGraph.findFirst).mockResolvedValue(row as never);

    await expect(getGraphDetail('main')).resolves.toEqual(row);
    expect(prisma.facilitationGraph.findFirst).toHaveBeenCalledWith({
      where: { slug: 'main' },
      include: { publishedVersion: true },
    });
  });

  it('throws NotFoundError when the map does not exist', async () => {
    vi.mocked(prisma.facilitationGraph.findFirst).mockResolvedValue(null);
    await expect(getGraphDetail('ghost')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('graphExists', () => {
  it('probes id-only and returns true when the map row exists', async () => {
    vi.mocked(prisma.facilitationGraph.findFirst).mockResolvedValue({ id: 'g1' } as never);

    await expect(graphExists('main')).resolves.toBe(true);
    expect(prisma.facilitationGraph.findFirst).toHaveBeenCalledWith({
      where: { slug: 'main' },
      select: { id: true },
    });
  });

  it('returns false for an unknown slug', async () => {
    vi.mocked(prisma.facilitationGraph.findFirst).mockResolvedValue(null);
    await expect(graphExists('ghost')).resolves.toBe(false);
  });
});
