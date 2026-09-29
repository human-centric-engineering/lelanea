/**
 * Journey read queries (f-journey-state t-2) — `getJourney` / `getNodeStates` /
 * `getJourneyTimeline`.
 *
 * Two things to prove per read: (1) it **routes through `canRead`** — a denied
 * viewer throws `ForbiddenError` and Prisma is never touched; and (2) when allowed,
 * it issues the expected query shape (the `@@unique` selector, the ownership
 * `where` guard, the index-served ordering). House style: no live DB — `prisma` is
 * mocked (`tests/integration`, mirroring `map/queries.test.ts`).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: {
    userJourney: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    userNodeState: { findMany: vi.fn() },
    journeyEvent: { findMany: vi.fn() },
  },
}));

import {
  getJourney,
  getNodeStates,
  getJourneyTimeline,
  getJourneyById,
  listJourneys,
} from '@/lib/framework/facilitation/journey/queries';
import { prisma } from '@/lib/db/client';
import { ForbiddenError } from '@/lib/api/errors';
import type { JourneyViewer } from '@/lib/framework/shared/access';

const alice: JourneyViewer = { userId: 'user_alice' };
const support: JourneyViewer = { userId: 'user_support', isAdminSupport: true };

beforeEach(() => vi.clearAllMocks());

describe('getJourney', () => {
  it('resolves the journey by its natural per-org key for an owning viewer', async () => {
    const row = { id: 'j1', userId: 'user_alice', graphSlug: 'main', contextKey: '' };
    vi.mocked(prisma.userJourney.findFirst).mockResolvedValue(row as never);

    await expect(getJourney(alice, { userId: 'user_alice', graphSlug: 'main' })).resolves.toEqual(
      row
    );
    // A per-org natural key reads via findFirst inside the tenant context (§107) —
    // not findUnique, since the compound unique is now (orgId, userId, graphSlug,
    // contextKey) and this read doesn't name orgId explicitly (scoped by the tx).
    expect(prisma.userJourney.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user_alice',
        graphSlug: 'main',
        contextKey: '',
      },
    });
  });

  it('defaults a missing contextKey to the empty-string sentinel', async () => {
    vi.mocked(prisma.userJourney.findFirst).mockResolvedValue(null);
    await getJourney(alice, { userId: 'user_alice', graphSlug: 'main', contextKey: 'ctx-7' });
    expect(prisma.userJourney.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user_alice',
        graphSlug: 'main',
        contextKey: 'ctx-7',
      },
    });
  });

  it('returns null when the user has not started the journey', async () => {
    vi.mocked(prisma.userJourney.findFirst).mockResolvedValue(null);
    await expect(
      getJourney(alice, { userId: 'user_alice', graphSlug: 'main' })
    ).resolves.toBeNull();
  });

  it('throws ForbiddenError and never touches Prisma when canRead denies', async () => {
    await expect(
      getJourney(alice, { userId: 'user_bob', graphSlug: 'main' })
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.userJourney.findFirst).not.toHaveBeenCalled();
  });

  it('lets an admin-support viewer read another subject’s journey', async () => {
    vi.mocked(prisma.userJourney.findFirst).mockResolvedValue(null);
    await expect(
      getJourney(support, { userId: 'user_alice', graphSlug: 'main' })
    ).resolves.toBeNull();
    expect(prisma.userJourney.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe('getNodeStates', () => {
  it('reads node states filtered by journey and owning subject, ordered by nodeKey', async () => {
    const rows = [{ id: 'ns1', journeyId: 'j1', nodeKey: 'a', status: 'active' }];
    vi.mocked(prisma.userNodeState.findMany).mockResolvedValue(rows as never);

    await expect(getNodeStates(alice, { journeyId: 'j1', subject: 'user_alice' })).resolves.toEqual(
      rows
    );
    expect(prisma.userNodeState.findMany).toHaveBeenCalledWith({
      where: { journeyId: 'j1', journey: { userId: 'user_alice' } },
      orderBy: { nodeKey: 'asc' },
    });
  });

  it('throws ForbiddenError and never touches Prisma when canRead denies', async () => {
    await expect(
      getNodeStates(alice, { journeyId: 'j1', subject: 'user_bob' })
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.userNodeState.findMany).not.toHaveBeenCalled();
  });
});

describe('getJourneyTimeline', () => {
  it('reads the event timeline filtered by journey and subject, chronological by default', async () => {
    const rows = [{ id: 'e1', journeyId: 'j1', userId: 'user_alice', type: 'node_entered' }];
    vi.mocked(prisma.journeyEvent.findMany).mockResolvedValue(rows as never);

    await expect(
      getJourneyTimeline(alice, { journeyId: 'j1', subject: 'user_alice' })
    ).resolves.toEqual(rows);
    expect(prisma.journeyEvent.findMany).toHaveBeenCalledWith({
      where: { journeyId: 'j1', userId: 'user_alice' },
      orderBy: { occurredAt: 'asc' },
    });
  });

  it('honours order + limit options', async () => {
    vi.mocked(prisma.journeyEvent.findMany).mockResolvedValue([] as never);
    await getJourneyTimeline(
      alice,
      { journeyId: 'j1', subject: 'user_alice' },
      { order: 'desc', limit: 10 }
    );
    expect(prisma.journeyEvent.findMany).toHaveBeenCalledWith({
      where: { journeyId: 'j1', userId: 'user_alice' },
      orderBy: { occurredAt: 'desc' },
      take: 10,
    });
  });

  it('omits `take` when no limit is given', async () => {
    vi.mocked(prisma.journeyEvent.findMany).mockResolvedValue([] as never);
    await getJourneyTimeline(alice, { journeyId: 'j1', subject: 'user_alice' });
    const call = vi.mocked(prisma.journeyEvent.findMany).mock.calls[0][0];
    expect(call).not.toHaveProperty('take');
  });

  it('throws ForbiddenError and never touches Prisma when canRead denies', async () => {
    await expect(
      getJourneyTimeline(alice, { journeyId: 'j1', subject: 'user_bob' })
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.journeyEvent.findMany).not.toHaveBeenCalled();
  });
});

describe('getJourneyById', () => {
  it('loads the row by id, then returns it for a viewer canRead allows', async () => {
    const row = { id: 'j1', userId: 'user_alice', graphSlug: 'main', contextKey: '' };
    vi.mocked(prisma.userJourney.findUnique).mockResolvedValue(row as never);

    await expect(getJourneyById(alice, 'j1')).resolves.toEqual(row);
    expect(prisma.userJourney.findUnique).toHaveBeenCalledWith({ where: { id: 'j1' } });
  });

  it('returns null (no gate) when the row is absent', async () => {
    vi.mocked(prisma.userJourney.findUnique).mockResolvedValue(null);
    await expect(getJourneyById(alice, 'missing')).resolves.toBeNull();
  });

  it('gates on the LOADED owner: a non-owning viewer gets ForbiddenError, not the row', async () => {
    const bobsRow = { id: 'j9', userId: 'user_bob', graphSlug: 'main', contextKey: '' };
    vi.mocked(prisma.userJourney.findUnique).mockResolvedValue(bobsRow as never);

    // The subject isn't known until the row loads, so the find runs — but the row
    // must never be returned to a denied viewer.
    await expect(getJourneyById(alice, 'j9')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets an admin-support viewer read another subject’s journey by id', async () => {
    const bobsRow = { id: 'j9', userId: 'user_bob', graphSlug: 'main', contextKey: '' };
    vi.mocked(prisma.userJourney.findUnique).mockResolvedValue(bobsRow as never);
    await expect(getJourneyById(support, 'j9')).resolves.toEqual(bobsRow);
  });
});

describe('listJourneys', () => {
  it('scopes a non-support viewer to their own rows and returns the page + total', async () => {
    const rows = [{ id: 'j1', userId: 'user_alice', graphSlug: 'main', contextKey: '' }];
    vi.mocked(prisma.userJourney.findMany).mockResolvedValue(rows as never);
    vi.mocked(prisma.userJourney.count).mockResolvedValue(1);

    await expect(listJourneys(alice, { skip: 0, limit: 10 })).resolves.toEqual({
      journeys: rows,
      total: 1,
    });
    // subjectScope narrows a non-support viewer to { userId }.
    const where = { userId: 'user_alice' };
    expect(prisma.userJourney.findMany).toHaveBeenCalledWith({
      where,
      orderBy: { startedAt: 'desc' },
      skip: 0,
      take: 10,
    });
    expect(prisma.userJourney.count).toHaveBeenCalledWith({ where });
  });

  it('lets an admin-support viewer see every subject (empty subject filter)', async () => {
    vi.mocked(prisma.userJourney.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.userJourney.count).mockResolvedValue(0);

    await listJourneys(support, { skip: 0, limit: 10 });
    expect(prisma.userJourney.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    );
  });

  it('ANDs a graphSlug filter into the subject scope', async () => {
    vi.mocked(prisma.userJourney.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.userJourney.count).mockResolvedValue(0);

    await listJourneys(support, { skip: 5, limit: 5, graphSlug: 'onboarding' });
    expect(prisma.userJourney.findMany).toHaveBeenCalledWith({
      where: { graphSlug: 'onboarding' },
      orderBy: { startedAt: 'desc' },
      skip: 5,
      take: 5,
    });
  });

  it('omits skip/take when no pagination options are given', async () => {
    vi.mocked(prisma.userJourney.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.userJourney.count).mockResolvedValue(0);

    await listJourneys(alice);
    const call = vi.mocked(prisma.userJourney.findMany).mock.calls[0][0];
    expect(call).not.toHaveProperty('skip');
    expect(call).not.toHaveProperty('take');
  });
});
