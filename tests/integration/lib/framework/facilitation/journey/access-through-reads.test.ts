/**
 * End-to-end access-through-reads (f-journey-state t-2).
 *
 * Proves the seam composes: the **real** `canRead` gates the **real** journey read
 * queries against a coherent backing store, so a viewer sees only the rows they may
 * — and a cross-user read is refused before any row is returned. This is the chain
 * `f-engine` / `f-guidance` rely on, with nothing a fork strips (the fixture lives
 * here in `tests/`).
 *
 * No live DB in vitest (house style), so Prisma is a small STATEFUL in-memory fake:
 * `findFirst`/`findMany` read a seeded store, and `userNodeState.findMany` honours
 * the `journey: { userId }` relation filter by joining back to the journey store —
 * so the real ownership `where` guard runs against real data. Mirrors
 * tests/integration/lib/framework/data-slots/registration-visibility.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { UserJourney, UserNodeState, JourneyEvent } from '@prisma/client';

const { prismaFake, resetStore, seedJourney, seedNodeState, seedEvent } = vi.hoisted(() => {
  const journeys = new Map<string, UserJourney>();
  const nodeStates = new Map<string, UserNodeState>();
  const events = new Map<string, JourneyEvent>();

  const prismaFake = {
    userJourney: {
      findFirst: async (args: {
        where: { userId: string; graphSlug: string; contextKey: string };
      }) => {
        const { userId, graphSlug, contextKey } = args.where;
        const hit = [...journeys.values()].find(
          (j) => j.userId === userId && j.graphSlug === graphSlug && j.contextKey === contextKey
        );
        return hit ? { ...hit } : null;
      },
    },
    userNodeState: {
      findMany: async (args: {
        where: { journeyId: string; journey?: { userId?: string } };
        orderBy?: { nodeKey?: 'asc' | 'desc' };
      }) => {
        let rows = [...nodeStates.values()].filter((r) => r.journeyId === args.where.journeyId);
        // The ownership guard: join back to the journey store, drop rows whose
        // journey isn't owned by the named subject.
        const wantUser = args.where.journey?.userId;
        if (wantUser !== undefined) {
          rows = rows.filter((r) => journeys.get(r.journeyId)?.userId === wantUser);
        }
        if (args.orderBy?.nodeKey === 'asc') {
          rows.sort((a, b) => (a.nodeKey < b.nodeKey ? -1 : a.nodeKey > b.nodeKey ? 1 : 0));
        }
        return rows.map((r) => ({ ...r }));
      },
    },
    journeyEvent: {
      findMany: async (args: {
        where: { journeyId: string; userId: string };
        orderBy?: { occurredAt?: 'asc' | 'desc' };
        take?: number;
      }) => {
        let rows = [...events.values()].filter(
          (r) => r.journeyId === args.where.journeyId && r.userId === args.where.userId
        );
        const dir = args.orderBy?.occurredAt === 'desc' ? -1 : 1;
        rows.sort((a, b) => dir * (a.occurredAt.getTime() - b.occurredAt.getTime()));
        if (args.take !== undefined) rows = rows.slice(0, args.take);
        return rows.map((r) => ({ ...r }));
      },
    },
  };

  return {
    prismaFake,
    resetStore: () => {
      journeys.clear();
      nodeStates.clear();
      events.clear();
    },
    seedJourney: (
      j: Pick<UserJourney, 'id' | 'userId' | 'graphSlug'> & { contextKey?: string }
    ) => {
      journeys.set(j.id, {
        orgId: null,
        contextKey: '',
        startedAt: new Date(0),
        ...j,
      });
    },
    seedNodeState: (n: Pick<UserNodeState, 'id' | 'journeyId' | 'nodeKey' | 'status'>) => {
      nodeStates.set(n.id, {
        orgId: null,
        timesCompleted: 0,
        progress: null,
        firstEnteredAt: null,
        lastActiveAt: null,
        completedAt: null,
        ...n,
      });
    },
    seedEvent: (
      e: Pick<JourneyEvent, 'id' | 'userId' | 'journeyId' | 'type'> & { occurredAt: Date }
    ) => {
      events.set(e.id, {
        orgId: null,
        nodeKey: null,
        moduleSlug: null,
        payload: null,
        ...e,
      });
    },
  };
});

vi.mock('@/lib/db/client', () => ({ prisma: prismaFake }));

const { getJourney, getNodeStates, getJourneyTimeline } =
  await import('@/lib/framework/facilitation/journey/queries');
const { ForbiddenError } = await import('@/lib/api/errors');

const alice = { userId: 'user_alice' };
const support = { userId: 'user_support', isAdminSupport: true };

beforeEach(() => {
  resetStore();
  // Two users, each walking the same map with their own rows.
  seedJourney({ id: 'j_alice', userId: 'user_alice', graphSlug: 'main' });
  seedJourney({ id: 'j_bob', userId: 'user_bob', graphSlug: 'main' });
  seedNodeState({ id: 'ns_a1', journeyId: 'j_alice', nodeKey: 'intro', status: 'completed' });
  seedNodeState({ id: 'ns_a2', journeyId: 'j_alice', nodeKey: 'goal', status: 'active' });
  seedNodeState({ id: 'ns_b1', journeyId: 'j_bob', nodeKey: 'intro', status: 'active' });
  seedEvent({
    id: 'e_a1',
    userId: 'user_alice',
    journeyId: 'j_alice',
    type: 'node_entered',
    occurredAt: new Date(1_000),
  });
  seedEvent({
    id: 'e_a2',
    userId: 'user_alice',
    journeyId: 'j_alice',
    type: 'node_completed',
    occurredAt: new Date(2_000),
  });
  seedEvent({
    id: 'e_b1',
    userId: 'user_bob',
    journeyId: 'j_bob',
    type: 'node_entered',
    occurredAt: new Date(1_500),
  });
});

describe('a viewer reads only their own journey rows through the guarded queries', () => {
  it('resolves the viewer’s own journey', async () => {
    const j = await getJourney(alice, { userId: 'user_alice', graphSlug: 'main' });
    expect(j?.id).toBe('j_alice');
  });

  it('returns only the viewer’s own node states, ordered by nodeKey', async () => {
    const states = await getNodeStates(alice, { journeyId: 'j_alice', subject: 'user_alice' });
    expect(states.map((s) => s.id)).toEqual(['ns_a2', 'ns_a1']); // goal < intro
  });

  it('returns only the viewer’s own timeline, chronological', async () => {
    const events = await getJourneyTimeline(alice, { journeyId: 'j_alice', subject: 'user_alice' });
    expect(events.map((e) => e.id)).toEqual(['e_a1', 'e_a2']);
  });
});

describe('a viewer cannot reach another user’s journey rows', () => {
  it('refuses to resolve another user’s journey (ForbiddenError, no rows leaked)', async () => {
    await expect(
      getJourney(alice, { userId: 'user_bob', graphSlug: 'main' })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses another user’s node states', async () => {
    await expect(
      getNodeStates(alice, { journeyId: 'j_bob', subject: 'user_bob' })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses another user’s timeline', async () => {
    await expect(
      getJourneyTimeline(alice, { journeyId: 'j_bob', subject: 'user_bob' })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('yields no rows if a viewer pairs a foreign journeyId with their own subject (in-query guard)', async () => {
    // canRead passes (own subject) but the ownership `where` holds rows to Alice —
    // Bob's journey has no Alice-owned node states, so the result is empty, not a leak.
    const states = await getNodeStates(alice, { journeyId: 'j_bob', subject: 'user_alice' });
    expect(states).toEqual([]);
  });
});

describe('admin-support tooling reads across subjects', () => {
  it('resolves another subject’s journey under the explicit support override', async () => {
    const j = await getJourney(support, { userId: 'user_bob', graphSlug: 'main' });
    expect(j?.id).toBe('j_bob');
  });

  it('reads another subject’s node states', async () => {
    const states = await getNodeStates(support, { journeyId: 'j_bob', subject: 'user_bob' });
    expect(states.map((s) => s.id)).toEqual(['ns_b1']);
  });
});
