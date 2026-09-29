/**
 * Journey admin-surface reads (f-ops-views t-5a) — `listJourneysForAdmin` /
 * `getJourneyDetailForAdmin`.
 *
 * These COMPOSE the gated primitives (mocked here — their own gating is proven in
 * `queries.test.ts`) and stitch in authored map metadata. What's under test is the
 * composition: batched (no-N+1) name/progress stitching, honest date→ISO shaping,
 * and the degrade-to-null branches (missing map, no published version, unparseable
 * definition). The map parser (`mapDefinitionSchema`) and vocabulary are REAL so the
 * structure parse/degrade is exercised for real.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: {
    facilitationGraph: { findMany: vi.fn(), findFirst: vi.fn() },
    userNodeState: { groupBy: vi.fn() },
  },
}));

vi.mock('@/lib/framework/facilitation/journey/queries', () => ({
  listJourneys: vi.fn(),
  getJourneyById: vi.fn(),
  getNodeStates: vi.fn(),
  getJourneyTimeline: vi.fn(),
}));

import {
  listJourneysForAdmin,
  getJourneyDetailForAdmin,
} from '@/lib/framework/facilitation/journey/admin-queries';
import { prisma } from '@/lib/db/client';
import {
  listJourneys,
  getJourneyById,
  getNodeStates,
  getJourneyTimeline,
} from '@/lib/framework/facilitation/journey/queries';
import { ForbiddenError } from '@/lib/api/errors';
import type { JourneyViewer } from '@/lib/framework/shared/access';

const support: JourneyViewer = { userId: 'user_support', isAdminSupport: true };

beforeEach(() => vi.clearAllMocks());

describe('listJourneysForAdmin', () => {
  it('stitches map names + batched progress counts and shapes ISO dates', async () => {
    const journeys = [
      {
        id: 'j1',
        orgId: null,
        userId: 'user_alice',
        graphSlug: 'main',
        contextKey: '',
        startedAt: new Date('2026-06-01T10:00:00.000Z'),
      },
      {
        id: 'j2',
        orgId: null,
        userId: 'user_bob',
        graphSlug: 'gone',
        contextKey: 'ctx',
        startedAt: new Date('2026-06-02T10:00:00.000Z'),
      },
    ];
    vi.mocked(listJourneys).mockResolvedValue({ journeys: journeys, total: 2 });
    vi.mocked(prisma.facilitationGraph.findMany).mockResolvedValue([
      { slug: 'main', name: 'Main Map' },
    ] as never);
    vi.mocked(prisma.userNodeState.groupBy).mockResolvedValue([
      { journeyId: 'j1', status: 'completed', _count: { _all: 3 } },
      { journeyId: 'j1', status: 'active', _count: { _all: 1 } },
    ] as never);

    const { items, total } = await listJourneysForAdmin(support, { page: 1, limit: 10 });

    expect(total).toBe(2);
    // Batched — one query each, keyed on the page's slugs / ids (no per-row fetch).
    expect(prisma.facilitationGraph.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.userNodeState.groupBy).toHaveBeenCalledTimes(1);

    expect(items[0]).toEqual({
      id: 'j1',
      userId: 'user_alice',
      graphSlug: 'main',
      contextKey: '',
      startedAt: '2026-06-01T10:00:00.000Z',
      graph: { name: 'Main Map', slug: 'main' },
      progress: { total: 4, completed: 3 },
    });
    // A journey whose map is gone → graph null; a journey with no states → {0,0}.
    expect(items[1].graph).toBeNull();
    expect(items[1].progress).toEqual({ total: 0, completed: 0 });
  });

  it('translates page → skip and forwards the graphSlug filter to listJourneys', async () => {
    vi.mocked(listJourneys).mockResolvedValue({ journeys: [], total: 0 });

    await listJourneysForAdmin(support, { page: 3, limit: 20, graphSlug: 'onboarding' });
    expect(listJourneys).toHaveBeenCalledWith(
      support,
      { skip: 40, limit: 20, graphSlug: 'onboarding' },
      undefined
    );
  });

  it('short-circuits the enrichment queries on an empty page', async () => {
    vi.mocked(listJourneys).mockResolvedValue({ journeys: [], total: 0 });

    const { items, total } = await listJourneysForAdmin(support, { page: 1, limit: 10 });
    expect(items).toEqual([]);
    expect(total).toBe(0);
    expect(prisma.facilitationGraph.findMany).not.toHaveBeenCalled();
    expect(prisma.userNodeState.groupBy).not.toHaveBeenCalled();
  });
});

describe('getJourneyDetailForAdmin', () => {
  const journeyRow = {
    id: 'j1',
    orgId: null,
    userId: 'user_alice',
    graphSlug: 'main',
    contextKey: '',
    startedAt: new Date('2026-06-01T10:00:00.000Z'),
  };

  it('returns null when the journey row is absent', async () => {
    vi.mocked(getJourneyById).mockResolvedValue(null);
    await expect(getJourneyDetailForAdmin(support, 'missing')).resolves.toBeNull();
    // Never reaches the enrichment reads.
    expect(getNodeStates).not.toHaveBeenCalled();
  });

  it('composes identity + parsed structure + node states + timeline with ISO dates', async () => {
    vi.mocked(getJourneyById).mockResolvedValue(journeyRow);
    vi.mocked(prisma.facilitationGraph.findFirst).mockResolvedValue({
      name: 'Main Map',
      slug: 'main',
      publishedVersion: { definition: { nodes: [{ key: 'n1', type: 'stage' }], edges: [] } },
    } as never);
    vi.mocked(getNodeStates).mockResolvedValue([
      {
        nodeKey: 'n1',
        status: 'active',
        timesCompleted: 0,
        firstEnteredAt: new Date('2026-06-01T11:00:00.000Z'),
        lastActiveAt: new Date('2026-06-01T12:00:00.000Z'),
        completedAt: null,
      },
    ] as never);
    vi.mocked(getJourneyTimeline).mockResolvedValue([
      {
        id: 'e1',
        type: 'node_entered',
        nodeKey: 'n1',
        moduleSlug: null,
        occurredAt: new Date('2026-06-01T11:00:00.000Z'),
      },
    ] as never);

    const detail = await getJourneyDetailForAdmin(support, 'j1');

    expect(detail?.journey.startedAt).toBe('2026-06-01T10:00:00.000Z');
    // Structure parsed by the real map schema (completionMode default materialised).
    expect(detail?.graph?.structure?.nodes[0]).toMatchObject({ key: 'n1', type: 'stage' });
    expect(detail?.nodeStates[0]).toEqual({
      nodeKey: 'n1',
      status: 'active',
      timesCompleted: 0,
      firstEnteredAt: '2026-06-01T11:00:00.000Z',
      lastActiveAt: '2026-06-01T12:00:00.000Z',
      completedAt: null,
    });
    expect(detail?.timeline[0].occurredAt).toBe('2026-06-01T11:00:00.000Z');
    // Timeline read unbounded (full history for replay) — chronological default.
    expect(getJourneyTimeline).toHaveBeenCalledWith(
      support,
      { journeyId: 'j1', subject: 'user_alice' },
      undefined,
      undefined
    );
  });

  it('degrades graph to null when the map is gone', async () => {
    vi.mocked(getJourneyById).mockResolvedValue(journeyRow);
    vi.mocked(prisma.facilitationGraph.findFirst).mockResolvedValue(null);
    vi.mocked(getNodeStates).mockResolvedValue([] as never);
    vi.mocked(getJourneyTimeline).mockResolvedValue([] as never);

    const detail = await getJourneyDetailForAdmin(support, 'j1');
    expect(detail?.graph).toBeNull();
  });

  it('degrades structure to null when there is no published version', async () => {
    vi.mocked(getJourneyById).mockResolvedValue(journeyRow);
    vi.mocked(prisma.facilitationGraph.findFirst).mockResolvedValue({
      name: 'Main Map',
      slug: 'main',
      publishedVersion: null,
    } as never);
    vi.mocked(getNodeStates).mockResolvedValue([] as never);
    vi.mocked(getJourneyTimeline).mockResolvedValue([] as never);

    const detail = await getJourneyDetailForAdmin(support, 'j1');
    expect(detail?.graph).toEqual({ name: 'Main Map', slug: 'main', structure: null });
  });

  it('degrades structure to null when the published definition does not parse', async () => {
    vi.mocked(getJourneyById).mockResolvedValue(journeyRow);
    vi.mocked(prisma.facilitationGraph.findFirst).mockResolvedValue({
      name: 'Main Map',
      slug: 'main',
      publishedVersion: { definition: { nodes: 'not-an-array' } },
    } as never);
    vi.mocked(getNodeStates).mockResolvedValue([] as never);
    vi.mocked(getJourneyTimeline).mockResolvedValue([] as never);

    const detail = await getJourneyDetailForAdmin(support, 'j1');
    expect(detail?.graph?.structure).toBeNull();
  });

  it('propagates a ForbiddenError from the gated by-id read', async () => {
    vi.mocked(getJourneyById).mockRejectedValue(new ForbiddenError('nope'));
    await expect(getJourneyDetailForAdmin(support, 'j1')).rejects.toBeInstanceOf(ForbiddenError);
  });
});
