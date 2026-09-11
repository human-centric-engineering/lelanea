/**
 * `createJourney` unit tests (#159) — the journey-creation seam.
 *
 * House style: no live DB in vitest; `@/lib/db/client` is mocked and we assert the
 * query the seam *issues*, not what the mock hands back. What is worth pinning here
 * is the seam's four contracts, each of which is a decision someone could
 * accidentally reverse:
 *
 *   - **guard before write** — a denied viewer throws `ForbiddenError` and Prisma is
 *     never touched (the read queries' discipline, applied to a write);
 *   - **the shape of the write** — an upsert on the natural key with an EMPTY
 *     `update`. That the write is genuinely idempotent is proven against a stateful
 *     store in `tests/integration/.../journey/create-idempotence.test.ts`; a
 *     constant-returning mock structurally cannot show it (the second call would
 *     resolve the same object whatever the code did);
 *   - **the `''` sentinel** — an omitted `contextKey` becomes `''`, never `undefined`
 *     (X3: a nullable discriminator would let duplicate default journeys past the
 *     unique index);
 *   - **idempotence under the race** — a P2002 from two concurrent starts re-reads
 *     the winner's row instead of failing, and any other Prisma error still escapes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { UserJourney } from '@prisma/client';
import { ForbiddenError } from '@/lib/api/errors';

// The journey/state tables the seam must NOT touch are present on purpose: an
// assertion that a call was never made only means something if the call was
// possible. (A mock exposing only `userJourney` would turn a future
// `journeyEvent.create` into a TypeError, whose natural repair is to widen the
// fixture — so the assertion could never fail for the reason it names.)
const prismaMock = {
  userJourney: {
    upsert: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  userNodeState: {
    create: vi.fn(),
    upsert: vi.fn(),
  },
  journeyEvent: {
    create: vi.fn(),
  },
};

vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));

const { createJourney } = await import('@/lib/framework/facilitation/journey/create');

const SUBJECT = 'user_1';
const OTHER = 'user_2';

function journeyRow(overrides: Partial<UserJourney> = {}): UserJourney {
  return {
    id: 'uj_1',
    userId: SUBJECT,
    graphSlug: 'reclaim',
    contextKey: '',
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/** The P2002 Prisma raises when two concurrent starts collide on the natural key. */
function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['userId', 'graphSlug', 'contextKey'] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.userJourney.upsert.mockResolvedValue(journeyRow());
  prismaMock.userJourney.findUniqueOrThrow.mockResolvedValue(journeyRow());
});

describe('createJourney — access', () => {
  it('creates for the subject themselves', async () => {
    const created = await createJourney(
      { userId: SUBJECT },
      { userId: SUBJECT, graphSlug: 'reclaim' }
    );

    expect(created.userId).toBe(SUBJECT);
    expect(prismaMock.userJourney.upsert).toHaveBeenCalledOnce();
  });

  it('creates for another subject when the viewer holds the admin-support override', async () => {
    prismaMock.userJourney.upsert.mockResolvedValue(journeyRow({ userId: OTHER }));

    const created = await createJourney(
      { userId: SUBJECT, isAdminSupport: true },
      { userId: OTHER, graphSlug: 'reclaim' }
    );

    expect(created.userId).toBe(OTHER);
  });

  it('refuses another subject without the override, and writes nothing', async () => {
    await expect(
      createJourney({ userId: SUBJECT }, { userId: OTHER, graphSlug: 'reclaim' })
    ).rejects.toBeInstanceOf(ForbiddenError);

    // The guard runs BEFORE any write — a denied call must not reach the database.
    expect(prismaMock.userJourney.upsert).not.toHaveBeenCalled();
    expect(prismaMock.userJourney.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});

describe('createJourney — the write it issues', () => {
  it('upserts on the natural key with an empty update, so a restart cannot move startedAt', async () => {
    await createJourney(
      { userId: SUBJECT },
      { userId: SUBJECT, graphSlug: 'reclaim', contextKey: 'run_7' }
    );

    const naturalKey = { userId: SUBJECT, graphSlug: 'reclaim', contextKey: 'run_7' };
    expect(prismaMock.userJourney.upsert).toHaveBeenCalledWith({
      where: { userId_graphSlug_contextKey: naturalKey },
      create: naturalKey,
      update: {},
    });
  });

  it('defaults an omitted contextKey to the empty-string sentinel, never undefined', async () => {
    await createJourney({ userId: SUBJECT }, { userId: SUBJECT, graphSlug: 'reclaim' });

    const [{ create, where }] = prismaMock.userJourney.upsert.mock.calls[0] as [
      { create: Record<string, unknown>; where: Record<string, Record<string, unknown>> },
    ];
    expect(create.contextKey).toBe('');
    expect(where.userId_graphSlug_contextKey.contextKey).toBe('');
  });

  it('returns whatever row the upsert resolved, unmodified', async () => {
    const existing = journeyRow({ id: 'uj_existing', startedAt: new Date('2025-06-01T09:30:00Z') });
    prismaMock.userJourney.upsert.mockResolvedValue(existing);

    await expect(
      createJourney({ userId: SUBJECT }, { userId: SUBJECT, graphSlug: 'reclaim' })
    ).resolves.toBe(existing);
  });

  it('makes no Prisma call other than the upsert on the happy path', async () => {
    await createJourney({ userId: SUBJECT }, { userId: SUBJECT, graphSlug: 'reclaim' });

    // `applyEvent` stays the sole writer of journey STATE. Asserted against the
    // recorded calls on a mock surface that DOES expose the state tables, so adding
    // a `journeyEvent.create` to the seam fails here rather than throwing a
    // TypeError that invites someone to widen the fixture.
    expect(prismaMock.userJourney.upsert).toHaveBeenCalledOnce();
    expect(prismaMock.userJourney.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prismaMock.userNodeState.create).not.toHaveBeenCalled();
    expect(prismaMock.userNodeState.upsert).not.toHaveBeenCalled();
    expect(prismaMock.journeyEvent.create).not.toHaveBeenCalled();
  });
});

describe('createJourney — idempotence under a concurrent start', () => {
  it('re-reads the winner’s row when the upsert loses a P2002 race', async () => {
    const winner = journeyRow({ id: 'uj_winner' });
    prismaMock.userJourney.upsert.mockRejectedValue(uniqueViolation());
    prismaMock.userJourney.findUniqueOrThrow.mockResolvedValue(winner);

    const created = await createJourney(
      { userId: SUBJECT },
      { userId: SUBJECT, graphSlug: 'reclaim', contextKey: 'run_7' }
    );

    expect(created).toEqual(winner);
    expect(prismaMock.userJourney.findUniqueOrThrow).toHaveBeenCalledWith({
      where: {
        userId_graphSlug_contextKey: {
          userId: SUBJECT,
          graphSlug: 'reclaim',
          contextKey: 'run_7',
        },
      },
    });
  });

  it('rethrows a non-P2002 Prisma error rather than masking it as a re-read', async () => {
    const dbDown = new Prisma.PrismaClientKnownRequestError('Timed out', {
      code: 'P2024',
      clientVersion: 'test',
    });
    prismaMock.userJourney.upsert.mockRejectedValue(dbDown);

    await expect(
      createJourney({ userId: SUBJECT }, { userId: SUBJECT, graphSlug: 'reclaim' })
    ).rejects.toBe(dbDown);
    expect(prismaMock.userJourney.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('rethrows a non-Prisma error unchanged', async () => {
    const boom = new Error('boom');
    prismaMock.userJourney.upsert.mockRejectedValue(boom);

    await expect(
      createJourney({ userId: SUBJECT }, { userId: SUBJECT, graphSlug: 'reclaim' })
    ).rejects.toBe(boom);
    expect(prismaMock.userJourney.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
