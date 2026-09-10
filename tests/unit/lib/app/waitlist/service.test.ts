/**
 * The waitlist service — the write, the Art. 15 read, and the Art. 17 delete.
 *
 * Every case asserts the ARGUMENTS that reach Prisma rather than the rows that
 * come back. A row asserted out of a mock only proves the mock returned what it
 * was told to; the `where` clause is what decides whether a subject's data is
 * found and whether their erasure reaches it.
 *
 * @see lib/app/waitlist/service.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  create,
  findUnique,
  updateMany,
  findMany,
  deleteMany,
  userFindUnique,
  transaction,
  mockLogger,
} = vi.hoisted(() => {
  const create = vi.fn();
  const findUnique = vi.fn();
  const updateMany = vi.fn();
  const findMany = vi.fn();
  const tx = { appWaitlistEntry: { findUnique, updateMany } };
  return {
    create,
    findUnique,
    updateMany,
    findMany,
    deleteMany: vi.fn(),
    userFindUnique: vi.fn(),
    // Forwards to the same delegates, so `tx.X === prisma.X` and the
    // assertions below are about the real calls rather than about a no-op.
    transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('@/lib/db/client', () => ({
  prisma: {
    appWaitlistEntry: { create, findUnique, updateMany, findMany },
    $transaction: transaction,
  },
}));
vi.mock('@/lib/logging', () => ({ logger: mockLogger }));

import {
  joinWaitlist,
  findWaitlistEntriesForSubject,
  eraseWaitlistEntriesForUser,
  registerWaitlistErasureHook,
  WAITLIST_ERASURE_HOOK,
} from '@/lib/app/waitlist/service';
import {
  getErasureCleanupHooks,
  __resetErasureCleanupHooksForTests,
} from '@/lib/privacy/erasure-hooks';

/** The shape `eraseUser()` hands a hook: a transaction client and a user id. */
function txContext() {
  return {
    tx: {
      user: { findUnique: userFindUnique },
      appWaitlistEntry: { deleteMany },
    } as never,
    userId: 'user-1',
  };
}

/**
 * The `P2002` Prisma throws when the unique index on `email` rejects an insert.
 *
 * Shaped by hand rather than constructed from `Prisma.PrismaClientKnownRequestError`:
 * the service duck-types on `.code` because the ESLint boundary forbids
 * `lib/app/**` a runtime import of `@prisma/client`, so building a real one here
 * would test a stricter contract than the code has.
 */
function uniqueViolation(): unknown {
  return Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: { target: ['email'] },
  });
}

/** Arrange the "row already exists" path: the insert loses, the update runs. */
function entryExists(): void {
  create.mockRejectedValue(uniqueViolation());
  findUnique.mockResolvedValue({ id: 'entry-1' });
}

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({ id: 'entry-1' });
  findUnique.mockResolvedValue({ id: 'entry-1' });
  updateMany.mockResolvedValue({ count: 1 });
  findMany.mockResolvedValue([]);
  deleteMany.mockResolvedValue({ count: 0 });
  userFindUnique.mockResolvedValue({ email: 'Someone@Example.com' });
});

describe('joinWaitlist', () => {
  it('reports a first join as created', async () => {
    await expect(joinWaitlist({ email: 'a@example.com', locale: 'en-GB' })).resolves.toMatchObject({
      created: true,
      entryId: 'entry-1',
    });
  });

  it('reports a repeat as NOT created', async () => {
    entryExists();

    await expect(joinWaitlist({ email: 'a@example.com', locale: 'en' })).resolves.toMatchObject({
      created: false,
      entryId: 'entry-1',
    });
  });

  it('stores the answers on a first join, with a server-set consent time', async () => {
    await joinWaitlist({
      email: 'a@example.com',
      name: 'Ada',
      heardFrom: 'a friend',
      intent: 'to slow down',
      locale: 'en-GB',
    });

    const args = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(args.data).toMatchObject({
      email: 'a@example.com',
      name: 'Ada',
      heardFrom: 'a friend',
      intent: 'to slow down',
      locale: 'en-GB',
    });
    expect(args.data.consentedAt).toBeInstanceOf(Date);
  });

  it('writes an absent optional answer as NULL, not as an empty string', async () => {
    await joinWaitlist({ email: 'a@example.com', locale: 'en' });

    const args = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    // `heardFrom IS NOT NULL` must count people who answered, and an empty
    // string in a nullable column reads exactly like an answer.
    expect(args.data).toMatchObject({ name: null, heardFrom: null, intent: null });
  });

  it('does not run the update path at all when the insert succeeds', async () => {
    await joinWaitlist({ email: 'a@example.com', name: 'Ada', locale: 'en' });

    expect(updateMany).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  describe('a repeat, where nothing proves the caller owns the address', () => {
    it('GUARDS every fill in the WHERE, so the rule holds under a race', async () => {
      entryExists();

      await joinWaitlist({
        email: 'a@example.com',
        name: 'Ada',
        heardFrom: 'a friend',
        intent: 'to slow down',
        locale: 'en',
      });

      // THE finding this shape exists for. Read-then-decide-then-write let two
      // POSTs for the same fresh address both see "empty" and the loser
      // overwrite the winner — the exact write the rule refuses, reached by
      // racing it. `name: null` in the WHERE is evaluated by Postgres while it
      // holds the row lock, so it cannot be stale.
      const wheres = updateMany.mock.calls.map(
        (call) => (call[0] as { where: Record<string, unknown> }).where
      );
      expect(wheres).toEqual([
        { email: 'a@example.com', name: null },
        { email: 'a@example.com', heardFrom: null },
        { email: 'a@example.com', intent: null },
      ]);
    });

    it('issues no update for a field the caller left blank', async () => {
      entryExists();

      await joinWaitlist({ email: 'a@example.com', intent: 'to slow down', locale: 'en' });

      // The form always renders empty, so a returning visitor re-submitting just
      // their email must not touch what they wrote before.
      expect(updateMany).toHaveBeenCalledTimes(1);
      expect(updateMany.mock.calls[0]?.[0]).toMatchObject({ data: { intent: 'to slow down' } });
    });

    it('issues no update at all when the caller supplied only an email', async () => {
      entryExists();

      await joinWaitlist({ email: 'a@example.com', locale: 'en' });

      expect(updateMany).not.toHaveBeenCalled();
    });

    it('never writes `consentedAt`, `locale`, `userId` or `source`', async () => {
      entryExists();

      await joinWaitlist({ email: 'a@example.com', name: 'Ada', locale: 'pt-BR' });

      for (const call of updateMany.mock.calls) {
        const { data } = call[0] as { data: Record<string, unknown> };
        // `consentedAt` records that THIS PERSON agreed to the notice above the
        // button; a third party's POST is not that act. `locale` is provenance
        // about the join. `userId`/`source` must not be relinked or relabelled.
        expect(Object.keys(data)).not.toContain('consentedAt');
        expect(Object.keys(data)).not.toContain('locale');
        expect(Object.keys(data)).not.toContain('userId');
        expect(Object.keys(data)).not.toContain('source');
      }
    });

    it('runs the reads and the fills in ONE transaction', async () => {
      entryExists();

      await joinWaitlist({ email: 'a@example.com', name: 'Ada', locale: 'en' });

      expect(transaction).toHaveBeenCalledTimes(1);
    });
  });

  it('rethrows a Prisma failure that is not the unique violation', async () => {
    // Only P2002 means "somebody is already there". Swallowing anything else
    // would turn a real write failure into a reported success.
    create.mockRejectedValue(Object.assign(new Error('deadlock'), { code: 'P2034' }));

    await expect(joinWaitlist({ email: 'a@example.com', locale: 'en' })).rejects.toThrow(
      'deadlock'
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rethrows a non-Prisma failure untouched', async () => {
    create.mockRejectedValue(new Error('connection terminated'));

    await expect(joinWaitlist({ email: 'a@example.com', locale: 'en' })).rejects.toThrow(
      'connection terminated'
    );
  });

  it('refuses to invent an id when the row vanished after the conflict', async () => {
    create.mockRejectedValue(uniqueViolation());
    findUnique.mockResolvedValue(null);

    // Erased between the failed insert and the read. Reporting a made-up id
    // would put a wrong entry id in the log and a success in the response.
    await expect(joinWaitlist({ email: 'a@example.com', locale: 'en' })).rejects.toThrow(
      /disappeared/i
    );
  });
});

describe('findWaitlistEntriesForSubject (GDPR Art. 15)', () => {
  it('matches on email as well as user id, case-insensitively', async () => {
    await findWaitlistEntriesForSubject({ userId: 'user-1', email: 'Someone@Example.com' });

    const args = findMany.mock.calls[0]?.[0] as { where: { OR: unknown[] } };
    // Everyone on the list today joined before there was an account, so `userId`
    // is null for all of them — matching on it alone would return nothing and
    // the bundle would look like a complete answer saying "we hold none".
    expect(args.where.OR).toEqual([
      { userId: 'user-1' },
      { email: { equals: 'Someone@Example.com', mode: 'insensitive' } },
    ]);
  });

  it('returns the rows it was given, in the order the query asked for', async () => {
    findMany.mockResolvedValue([{ id: 'entry-1' }]);

    await expect(
      findWaitlistEntriesForSubject({ userId: 'user-1', email: 'a@example.com' })
    ).resolves.toEqual([{ id: 'entry-1' }]);

    const args = findMany.mock.calls[0]?.[0] as { orderBy: unknown };
    expect(args.orderBy).toEqual({ createdAt: 'asc' });
  });
});

describe('eraseWaitlistEntriesForUser (GDPR Art. 17)', () => {
  it('deletes by email as well as by user id', async () => {
    await eraseWaitlistEntriesForUser(txContext());

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { userId: 'user-1' },
          { email: { equals: 'Someone@Example.com', mode: 'insensitive' } },
        ],
      },
    });
  });

  it('reads the subject email from the TRANSACTION client, not the global one', async () => {
    await eraseWaitlistEntriesForUser(txContext());

    // The hook runs inside the erasure transaction and before `tx.user.delete()`.
    // Reaching for the global client here would read outside the transaction and
    // would be a different connection's view of the row.
    expect(userFindUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { email: true },
    });
  });

  it('still deletes by user id when the account row has no email', async () => {
    userFindUnique.mockResolvedValue(null);

    await eraseWaitlistEntriesForUser(txContext());

    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
  });

  it('logs a count without logging the address it just erased', async () => {
    deleteMany.mockResolvedValue({ count: 2 });

    await eraseWaitlistEntriesForUser(txContext());

    const [, meta] = mockLogger.info.mock.calls[0] as [string, Record<string, unknown>];
    expect(meta).toEqual({ userId: 'user-1', count: 2 });
    // The whole point of the erasure is that neither the address nor the row id
    // survives it — copying either into an application log undoes that.
    expect(JSON.stringify(meta)).not.toContain('Example.com');
  });

  it('says nothing when there was nothing to erase', async () => {
    deleteMany.mockResolvedValue({ count: 0 });

    await eraseWaitlistEntriesForUser(txContext());

    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it('lets a delete failure propagate, so the erasure transaction rolls back', async () => {
    deleteMany.mockRejectedValue(new Error('deadlock'));

    // Swallowing here would report a successful erasure while leaving the
    // person's email on a public-form table.
    await expect(eraseWaitlistEntriesForUser(txContext())).rejects.toThrow('deadlock');
  });
});

describe('registerWaitlistErasureHook', () => {
  beforeEach(() => __resetErasureCleanupHooksForTests());

  it('registers the in-transaction phase under a stable name', () => {
    registerWaitlistErasureHook();

    const hooks = getErasureCleanupHooks();
    expect(hooks.map((hook) => hook.name)).toEqual([WAITLIST_ERASURE_HOOK]);
    expect(hooks[0]?.scrubInTransaction).toBe(eraseWaitlistEntriesForUser);
    // NOT `cleanupExternal`: that phase is best-effort and its failures are
    // swallowed, which is wrong for a delete that must roll the erasure back.
    expect(hooks[0]?.cleanupExternal).toBeUndefined();
  });

  it('is idempotent, so a repeated import under HMR does not double-register', () => {
    registerWaitlistErasureHook();
    registerWaitlistErasureHook();

    expect(getErasureCleanupHooks()).toHaveLength(1);
  });
});
