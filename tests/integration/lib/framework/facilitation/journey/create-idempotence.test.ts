/**
 * `createJourney` against a stateful store (#159) — the seam's real contract.
 *
 * The unit test (`tests/unit/.../journey/create.test.ts`) pins the *shape* of the
 * write: an upsert on the natural key with an empty `update`. It structurally
 * cannot prove the behaviour that shape exists for, because a constant-returning
 * mock resolves the same object on both calls whatever the code does — so
 * "the second start returned the first row" is true for an implementation that
 * ignores the upsert entirely.
 *
 * This file closes that gap the way `access-through-reads.test.ts` does for the
 * read seam: a small **stateful** in-memory Prisma fake implementing real upsert
 * semantics against a seeded store, so the **real** `createJourney` runs against
 * coherent data. House style — no live DB in vitest. What it proves:
 *
 *   - a second start returns the FIRST row, with `startedAt` unmoved (idempotence,
 *     the headline contract);
 *   - the store holds exactly one row afterwards (no duplicate journey);
 *   - a different `contextKey` is a DIFFERENT run — the natural key discriminates,
 *     which is what makes `contextKey` usable as a run id (#167);
 *   - two subjects on the same map get their own rows, and a denied viewer writes
 *     nothing into the store at all.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { UserJourney } from '@prisma/client';

interface NaturalKey {
  userId: string;
  graphSlug: string;
  contextKey: string;
}

const { prismaFake, resetStore, allJourneys } = vi.hoisted(() => {
  const journeys = new Map<string, UserJourney>();
  let seq = 0;

  const find = (k: NaturalKey): UserJourney | undefined =>
    [...journeys.values()].find(
      (j) => j.userId === k.userId && j.graphSlug === k.graphSlug && j.contextKey === k.contextKey
    );

  const prismaFake = {
    userJourney: {
      // Real upsert semantics: hit → apply `update` to the STORED row and return it
      // (so an empty update is observably a no-op); miss → insert `create`. This is
      // the behaviour the empty `update` is chosen for, and the reason a constant
      // mock cannot test it.
      upsert: async (args: {
        where: { userId_graphSlug_contextKey: NaturalKey };
        create: NaturalKey;
        update: Partial<UserJourney>;
      }) => {
        const existing = find(args.where.userId_graphSlug_contextKey);
        if (existing) {
          Object.assign(existing, args.update);
          return { ...existing };
        }
        seq += 1;
        const row: UserJourney = {
          id: `uj_${seq}`,
          startedAt: new Date(1_700_000_000_000 + seq * 1_000),
          ...args.create,
        };
        journeys.set(row.id, row);
        return { ...row };
      },
      findUniqueOrThrow: async (args: { where: { userId_graphSlug_contextKey: NaturalKey } }) => {
        const hit = find(args.where.userId_graphSlug_contextKey);
        if (!hit) throw new Error('not found');
        return { ...hit };
      },
    },
  };

  return {
    prismaFake,
    resetStore: () => {
      journeys.clear();
      seq = 0;
    },
    allJourneys: () => [...journeys.values()],
  };
});

vi.mock('@/lib/db/client', () => ({ prisma: prismaFake }));

const { createJourney } = await import('@/lib/framework/facilitation/journey/create');
const { ForbiddenError } = await import('@/lib/api/errors');

const alice = { userId: 'user_alice' };

beforeEach(() => {
  resetStore();
});

describe('createJourney against a stateful store', () => {
  it('returns the first row on a second start, with startedAt unmoved', async () => {
    const first = await createJourney(alice, { userId: 'user_alice', graphSlug: 'main' });
    const second = await createJourney(alice, { userId: 'user_alice', graphSlug: 'main' });

    expect(second.id).toBe(first.id);
    expect(second.startedAt).toEqual(first.startedAt);
  });

  it('leaves exactly one row in the store after repeated starts', async () => {
    await createJourney(alice, { userId: 'user_alice', graphSlug: 'main' });
    await createJourney(alice, { userId: 'user_alice', graphSlug: 'main' });
    await createJourney(alice, { userId: 'user_alice', graphSlug: 'main' });

    expect(allJourneys()).toHaveLength(1);
  });

  it('treats an omitted contextKey and an explicit "" as the same run', async () => {
    const implicit = await createJourney(alice, { userId: 'user_alice', graphSlug: 'main' });
    const explicit = await createJourney(alice, {
      userId: 'user_alice',
      graphSlug: 'main',
      contextKey: '',
    });

    expect(explicit.id).toBe(implicit.id);
    expect(allJourneys()).toHaveLength(1);
  });

  it('treats a different contextKey as a different run — the property #167 relies on', async () => {
    const runA = await createJourney(alice, {
      userId: 'user_alice',
      graphSlug: 'main',
      contextKey: 'run_a',
    });
    const runB = await createJourney(alice, {
      userId: 'user_alice',
      graphSlug: 'main',
      contextKey: 'run_b',
    });

    expect(runB.id).not.toBe(runA.id);
    expect(allJourneys()).toHaveLength(2);
  });

  it('gives two subjects on the same map their own rows', async () => {
    const forAlice = await createJourney(alice, { userId: 'user_alice', graphSlug: 'main' });
    const forBob = await createJourney(
      { userId: 'user_bob' },
      { userId: 'user_bob', graphSlug: 'main' }
    );

    expect(forBob.id).not.toBe(forAlice.id);
    expect(
      allJourneys()
        .map((j) => j.userId)
        .sort()
    ).toEqual(['user_alice', 'user_bob']);
  });

  it('writes nothing to the store when the real canWrite denies the viewer', async () => {
    await expect(
      createJourney(alice, { userId: 'user_bob', graphSlug: 'main' })
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(allJourneys()).toHaveLength(0);
  });

  it('lets an admin-support viewer start a journey for another subject', async () => {
    const created = await createJourney(
      { userId: 'user_support', isAdminSupport: true },
      { userId: 'user_bob', graphSlug: 'main' }
    );

    expect(created.userId).toBe('user_bob');
    expect(allJourneys()).toHaveLength(1);
  });
});
