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

const { findUnique, upsert, findMany, deleteMany, userFindUnique, mockLogger } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  findMany: vi.fn(),
  deleteMany: vi.fn(),
  userFindUnique: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: { appWaitlistEntry: { findUnique, upsert, findMany } },
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

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(null);
  upsert.mockResolvedValue({ id: 'entry-1' });
  findMany.mockResolvedValue([]);
  deleteMany.mockResolvedValue({ count: 0 });
  userFindUnique.mockResolvedValue({ email: 'Someone@Example.com' });
});

describe('joinWaitlist', () => {
  it('reports a first join as created', async () => {
    findUnique.mockResolvedValue(null);

    await expect(joinWaitlist({ email: 'a@example.com', locale: 'en-GB' })).resolves.toMatchObject({
      created: true,
      entryId: 'entry-1',
    });
  });

  it('reports a repeat as NOT created, so the route can answer 200 rather than 201', async () => {
    findUnique.mockResolvedValue({ id: 'entry-1', name: null, heardFrom: null, intent: null });

    await expect(joinWaitlist({ email: 'a@example.com', locale: 'en' })).resolves.toMatchObject({
      created: false,
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

    const args = upsert.mock.calls[0]?.[0] as {
      where: { email: string };
      create: Record<string, unknown>;
    };
    expect(args.where).toEqual({ email: 'a@example.com' });
    expect(args.create).toMatchObject({
      email: 'a@example.com',
      name: 'Ada',
      heardFrom: 'a friend',
      intent: 'to slow down',
      locale: 'en-GB',
    });
    expect(args.create.consentedAt).toBeInstanceOf(Date);
  });

  it('writes an absent optional answer as NULL, not as an empty string', async () => {
    await joinWaitlist({ email: 'a@example.com', locale: 'en' });

    const args = upsert.mock.calls[0]?.[0] as { create: Record<string, unknown> };
    // `heardFrom IS NOT NULL` must count people who answered, and an empty
    // string in a nullable column reads exactly like an answer.
    expect(args.create).toMatchObject({ name: null, heardFrom: null, intent: null });
  });

  it('fills an answer the visitor had left empty', async () => {
    findUnique.mockResolvedValue({ id: 'entry-1', name: 'Ada', heardFrom: null, intent: null });

    await joinWaitlist({ email: 'a@example.com', intent: 'to slow down', locale: 'en' });

    const args = upsert.mock.calls[0]?.[0] as { update: Record<string, unknown> };
    expect(args.update).toMatchObject({ intent: 'to slow down' });
  });

  it('REFUSES to overwrite an answer that is already stored', async () => {
    findUnique.mockResolvedValue({
      id: 'entry-1',
      name: 'Ada',
      heardFrom: 'a friend',
      intent: 'what she actually wrote',
    });

    // Nothing on this route proves the submitter owns the address — there is no
    // confirmation email this phase and no token. With overwrite allowed, anyone
    // who knows someone's address can replace up to 2000 characters that Lelañea
    // reads herself, attributed to that person, with nothing on screen for them
    // to notice by.
    await joinWaitlist({
      email: 'a@example.com',
      name: 'Not Ada',
      heardFrom: 'somewhere else',
      intent: 'something a stranger typed',
      locale: 'en',
    });

    const args = upsert.mock.calls[0]?.[0] as { update: Record<string, unknown> };
    expect(args.update).toEqual({});
  });

  it('leaves a blank answer alone rather than nulling what is stored', async () => {
    findUnique.mockResolvedValue({
      id: 'entry-1',
      name: 'Ada',
      heardFrom: 'a friend',
      intent: 'to slow down',
    });

    // The form always renders empty, so a returning visitor who re-submits just
    // their email — because they are not sure the first one landed — must not
    // silently lose what they gave the first time.
    await joinWaitlist({ email: 'a@example.com', locale: 'en' });

    const args = upsert.mock.calls[0]?.[0] as { update: Record<string, unknown> };
    // Omitted, not `null`: Prisma leaves an omitted column untouched, and `null`
    // would erase it.
    expect(args.update).toEqual({});
  });

  it('still writes NULL for a blank answer on a FIRST join', async () => {
    findUnique.mockResolvedValue(null);

    await joinWaitlist({ email: 'a@example.com', locale: 'en' });

    // The create half keeps `null` on purpose — there is nothing to preserve,
    // and an empty string in a nullable column reads exactly like an answer.
    const args = upsert.mock.calls[0]?.[0] as { create: Record<string, unknown> };
    expect(args.create).toMatchObject({ name: null, heardFrom: null, intent: null });
  });

  it('does NOT move `consentedAt` on a repeat', async () => {
    findUnique.mockResolvedValue({ id: 'entry-1', name: null, heardFrom: null, intent: null });

    await joinWaitlist({ email: 'a@example.com', name: 'Ada', locale: 'en' });

    const args = upsert.mock.calls[0]?.[0] as { update: Record<string, unknown> };
    // It records that THIS PERSON agreed to the notice above the button, and a
    // third party's POST is not that act. Moving it would write a consent that
    // did not happen into the one field whose whole job is to be true.
    expect(args.update).not.toHaveProperty('consentedAt');
    expect(args.update).toEqual({ name: 'Ada' });
  });

  it('does NOT move `locale` on a repeat', async () => {
    findUnique.mockResolvedValue({ id: 'entry-1', name: null, heardFrom: null, intent: null });

    await joinWaitlist({ email: 'a@example.com', locale: 'pt-BR' });

    const args = upsert.mock.calls[0]?.[0] as { update: Record<string, unknown> };
    // Provenance about the join. A stranger's browser is not evidence about it.
    expect(args.update).not.toHaveProperty('locale');
  });

  it('sets `consentedAt` and `locale` on the FIRST join, where they are evidence', async () => {
    findUnique.mockResolvedValue(null);

    await joinWaitlist({ email: 'a@example.com', locale: 'pt-BR' });

    const args = upsert.mock.calls[0]?.[0] as { create: Record<string, unknown> };
    expect(args.create.consentedAt).toBeInstanceOf(Date);
    expect(args.create).toMatchObject({ locale: 'pt-BR' });
  });

  it('never touches `userId` or `source` on a repeat', async () => {
    findUnique.mockResolvedValue({ id: 'entry-1', name: null, heardFrom: null, intent: null });

    await joinWaitlist({ email: 'a@example.com', name: 'Ada', locale: 'en' });

    const args = upsert.mock.calls[0]?.[0] as { update: Record<string, unknown> };
    // A public-form resubmission must not unlink an entry that has been attached
    // to an account, nor relabel one that arrived some other way.
    expect(args.update).not.toHaveProperty('userId');
    expect(args.update).not.toHaveProperty('source');
  });

  it('reads the stored answers it needs to decide, and nothing more', async () => {
    findUnique.mockResolvedValue({ id: 'entry-1', name: null, heardFrom: null, intent: null });

    await joinWaitlist({ email: 'a@example.com', locale: 'en' });

    // The `select` is what makes "fill only what is empty" possible. Narrowed
    // back to `{ id: true }` by a tidy-up, `fillIfEmpty` would read `undefined`
    // for every field, treat every column as empty, and restore the overwrite.
    expect(findUnique).toHaveBeenCalledWith({
      where: { email: 'a@example.com' },
      select: { id: true, name: true, heardFrom: true, intent: true },
    });
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
