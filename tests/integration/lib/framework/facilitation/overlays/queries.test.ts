/**
 * Node-embedding + nudge read queries (f-overlays t-1/t-2/t-3b). Mocks the DB client; proves the count
 * is scoped to the (graphSlug, version) pair, the similarity query's params + row mapping, and the
 * nudge-throttle read.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: {
    frameworkNodeEmbedding: { count: vi.fn() },
    frameworkJourneyNudge: { findMany: vi.fn() },
    $queryRawUnsafe: vi.fn(),
  },
}));

import {
  countNodeEmbeddings,
  findRelatedNodes,
  listRecentlyNudgedJourneyIds,
} from '@/lib/framework/facilitation/overlays/queries';
import { prisma } from '@/lib/db/client';

beforeEach(() => vi.clearAllMocks());

describe('countNodeEmbeddings', () => {
  it('counts rows for the given graph slug and version', async () => {
    vi.mocked(prisma.frameworkNodeEmbedding.count).mockResolvedValue(7);
    const n = await countNodeEmbeddings('primary', 4);
    expect(n).toBe(7);
    expect(prisma.frameworkNodeEmbedding.count).toHaveBeenCalledWith({
      where: { graphSlug: 'primary', version: 4 },
    });
  });
});

describe('findRelatedNodes', () => {
  it('passes the key/version/threshold/limit params and maps rows to node keys', async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([{ nodeKey: 'b' }, { nodeKey: 'c' }]);

    const related = await findRelatedNodes('primary', 4, 'a', 3, 0.6);
    expect(related).toEqual(['b', 'c']);

    const call = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0];
    // SQL is a self-join over the same (graphSlug, version), cosine <=>, self-excluded, threshold-gated.
    expect(call[0]).toContain('<=>');
    expect(call[0]).toContain('"nodeKey" <> s."nodeKey"');
    // Neighbours come from the same org's copy of the map only (§34: graphSlug is unique per org,
    // so without this two orgs' nodes could pair whenever RLS is off or bypassed).
    expect(call[0]).toContain('o."orgId" IS NOT DISTINCT FROM s."orgId"');
    expect(call.slice(1)).toEqual(['primary', 4, 'a', 0.6, 3]); // $1..$5
  });

  it('returns [] when the node has no neighbours within the threshold', async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);
    expect(await findRelatedNodes('primary', 4, 'lonely', 3, 0.6)).toEqual([]);
  });
});

describe('listRecentlyNudgedJourneyIds', () => {
  it('returns the set of journeys nudged since the cutoff', async () => {
    vi.mocked(prisma.frameworkJourneyNudge.findMany).mockResolvedValue([
      { journeyId: 'j2' },
    ] as never);
    const since = new Date('2026-07-01T00:00:00Z');

    const set = await listRecentlyNudgedJourneyIds(['j1', 'j2'], since);
    expect(set).toEqual(new Set(['j2']));
    expect(prisma.frameworkJourneyNudge.findMany).toHaveBeenCalledWith({
      where: { journeyId: { in: ['j1', 'j2'] }, nudgedAt: { gte: since } },
      select: { journeyId: true },
    });
  });

  it('short-circuits an empty input without a query', async () => {
    const set = await listRecentlyNudgedJourneyIds([], new Date());
    expect(set).toEqual(new Set());
    expect(prisma.frameworkJourneyNudge.findMany).not.toHaveBeenCalled();
  });
});
