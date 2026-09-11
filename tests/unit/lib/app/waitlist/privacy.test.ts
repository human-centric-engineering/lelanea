/**
 * The waitlist's two GDPR duties, end to end through the REAL seams.
 *
 * `service.test.ts` asserts the queries in isolation. This asserts the wiring
 * that makes them run at all — and the wiring is the part that fails silently:
 * a seam left half-filled produces a subject-access bundle that reads exactly
 * like a complete answer, and an erasure that reports success while the row
 * remains. Neither shows up anywhere a person would look.
 *
 * So nothing between the entry point and the table is mocked. `exportUserData()`
 * reaches `lib/app/data-export.ts` → `lib/app/leaf-data-export.ts`, and
 * `eraseUser()` reaches the hook `initLeafApp()` registers. Only Prisma and the
 * object store are stubs.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads `lib/app/leaf-bootstrap.ts` and
 * `lib/app/leaf-data-export.ts` for real, not through a mock
 * ---------------------------------------------------------------------------
 * That is the whole point of the file: mocking either seam would leave the
 * wiring — the thing that silently fails — untested, and would turn every case
 * below into an assertion about a mock.
 *
 * **What a fork should expect.** Upstream, both seams are empty: `initLeafApp()`
 * registers no erasure hook and `collectLeafSubjectData()` returns `{}`, so
 * every case here would fail against a vanilla Daybreak. This file is Lelañea's
 * and exists only because Lelañea filled them; a fork inheriting it should
 * expect to rewrite it around its own tables rather than to pin ours.
 *
 * @see lib/app/leaf-data-export.ts · lib/app/leaf-bootstrap.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { delegateFor, resetDelegates, userFindUnique, userDelete, receiptCreate, prisma } =
  vi.hoisted(() => {
    interface Delegate {
      findMany: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    }

    // The core + framework manifests together touch ~40 delegates. Vending them
    // on demand keeps this file from silently missing one as either grows.
    const delegates = new Map<string, Delegate>();
    const delegateFor = (name: string): Delegate => {
      let delegate = delegates.get(name);
      if (!delegate) {
        delegate = {
          findMany: vi.fn().mockResolvedValue([]),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        };
        delegates.set(name, delegate);
      }
      return delegate;
    };
    const resetDelegates = (): void => {
      for (const delegate of delegates.values()) {
        delegate.findMany.mockReset().mockResolvedValue([]);
        delegate.deleteMany.mockReset().mockResolvedValue({ count: 0 });
        delegate.updateMany.mockReset().mockResolvedValue({ count: 0 });
      }
    };

    const userFindUnique = vi.fn();
    const userDelete = vi.fn().mockResolvedValue({ id: 'user-1' });
    const receiptCreate = vi.fn().mockResolvedValue({
      id: 'receipt-1',
      erasedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const base = {
      get(_target: object, property: string | symbol): unknown {
        if (typeof property !== 'string') return undefined;
        if (property === 'user') return { findUnique: userFindUnique, delete: userDelete };
        // The receipt table is read by the export and written by the erasure,
        // so it needs the vended delegate AND `create`.
        if (property === 'dataErasureReceipt')
          return { ...delegateFor(property), create: receiptCreate };
        return delegateFor(property);
      },
    };

    const txPrisma = new Proxy({}, base);
    const prisma = new Proxy(
      {},
      {
        get(target, property): unknown {
          if (property === '$transaction') {
            return (callback: (tx: unknown) => Promise<unknown>) => callback(txPrisma);
          }
          return base.get(target, property);
        },
      }
    );

    return {
      delegateFor,
      resetDelegates,
      userFindUnique,
      userDelete,
      receiptCreate,
      txPrisma,
      prisma,
    };
  });

vi.mock('@/lib/db/client', () => ({ prisma }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/storage/upload', () => ({
  isStorageEnabled: () => false,
  deleteByPrefix: vi.fn(),
}));

import { exportUserData } from '@/lib/privacy/export-user';
import { eraseUser } from '@/lib/privacy/erase-user';
import { initLeafApp } from '@/lib/app/leaf-bootstrap';
import { __resetErasureCleanupHooksForTests } from '@/lib/privacy/erasure-hooks';
import { __resetAppSubjectSourceRegistryForTests } from '@/lib/privacy/subject-source-registry';

const SUBJECT = { id: 'user-1', email: 'Ada@Example.com', name: 'Ada' };

/** One waitlist row, as the table would hold it: joined before the account. */
const ENTRY = {
  id: 'entry-1',
  email: 'ada@example.com',
  name: 'Ada',
  heardFrom: 'a friend',
  intent: 'to slow down',
  source: 'form',
  locale: 'en-GB',
  consentedAt: new Date('2026-02-01T00:00:00.000Z'),
  userId: null,
  createdAt: new Date('2026-02-01T00:00:00.000Z'),
  updatedAt: new Date('2026-02-01T00:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  resetDelegates();
  __resetAppSubjectSourceRegistryForTests();
  __resetErasureCleanupHooksForTests();
  userFindUnique.mockResolvedValue(SUBJECT);
  userDelete.mockResolvedValue({ id: 'user-1' });
  receiptCreate.mockResolvedValue({
    id: 'receipt-1',
    erasedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
});

describe('subject access (Art. 15) reaches the waitlist', () => {
  it('puts the entry in the bundle under the section the seam declares', async () => {
    delegateFor('appWaitlistEntry').findMany.mockResolvedValue([ENTRY]);

    const bundle = await exportUserData({
      userId: 'user-1',
      actorUserId: 'user-1',
      reason: 'self_service',
    });

    expect(bundle.app.waitlist).toEqual([ENTRY]);
    // The section is described to the subject, not just returned — `meta.app`
    // is what tells them what the key means and how many rows it holds.
    expect(bundle.meta.app).toContainEqual(
      expect.objectContaining({ section: 'waitlist', model: 'AppWaitlistEntry', rows: 1 })
    );
  });

  it('finds it by EMAIL, which is the only handle a pre-signup joiner has', async () => {
    delegateFor('appWaitlistEntry').findMany.mockResolvedValue([ENTRY]);

    await exportUserData({ userId: 'user-1', actorUserId: 'user-1', reason: 'self_service' });

    const args = delegateFor('appWaitlistEntry').findMany.mock.calls[0]?.[0] as {
      where: { OR: unknown[] };
    };
    // Lower-cased exact, not `mode: 'insensitive'` — that compiles to ILIKE and
    // `_`/`%` in an address are wildcards, so the bundle would carry a
    // stranger's rows. See `subjectMatch` in the service.
    expect(args.where.OR).toContainEqual({ email: 'ada@example.com' });
  });

  it('discloses a REMOVED entry, because we still hold it', async () => {
    // §03 t-24. An admin taking someone off the list sets `removedAt` and keeps
    // the row — the email, the name, the stated intent, all of it. Art. 15 is
    // about what we HOLD, so filtering on `removedAt` here would hand the subject
    // a bundle that omits a row sitting in the database, which reads exactly like
    // a complete answer.
    const removed = { ...ENTRY, removedAt: new Date('2026-09-05T09:00:00.000Z') };
    delegateFor('appWaitlistEntry').findMany.mockResolvedValue([removed]);

    const bundle = await exportUserData({
      userId: 'user-1',
      actorUserId: 'user-1',
      reason: 'self_service',
    });

    // Population first: "nothing was filtered" means nothing on an empty result.
    expect(bundle.app.waitlist).toHaveLength(1);
    expect(bundle.app.waitlist).toEqual([removed]);
    // And the query asked for it — no `removedAt` anywhere in the WHERE, which is
    // the clause a future reader would most plausibly add.
    const args = delegateFor('appWaitlistEntry').findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(JSON.stringify(args.where)).not.toContain('removedAt');
  });

  it('still carries the section, empty, for a subject with no entry', async () => {
    const bundle = await exportUserData({
      userId: 'user-1',
      actorUserId: 'user-1',
      reason: 'self_service',
    });

    // Declaring a section is a promise: `exportUserData()` throws on a declared
    // section the collector omits, because a bundle short by a section reads
    // exactly like a complete answer. The key must be present and empty.
    expect(Object.keys(bundle.app)).toContain('waitlist');
    expect(bundle.app.waitlist).toEqual([]);
  });

  it('survives serialisation with the section intact', async () => {
    delegateFor('appWaitlistEntry').findMany.mockResolvedValue([]);

    const bundle = await exportUserData({
      userId: 'user-1',
      actorUserId: 'user-1',
      reason: 'self_service',
    });

    // `undefined` would satisfy an in-memory key check and then be dropped by
    // `JSON.stringify`, certifying a section the subject never receives.
    const roundTripped = JSON.parse(JSON.stringify(bundle)) as { app: Record<string, unknown> };
    expect(Object.keys(roundTripped.app)).toContain('waitlist');
  });
});

describe('erasure (Art. 17) reaches the waitlist', () => {
  it('deletes the entry inside the erasure transaction', async () => {
    await initLeafApp();

    await eraseUser({
      userId: 'user-1',
      userEmail: 'Ada@Example.com',
      actorUserId: 'user-1',
      reason: 'self_service',
    });

    expect(delegateFor('appWaitlistEntry').deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ userId: 'user-1' }, { email: 'ada@example.com' }] },
    });
  });

  it('deletes a REMOVED entry too — removal is not erasure', async () => {
    // §03 t-24, and the mirror of the export case above. `removedAt` is a product
    // state, so it has nothing to say about an erasure request: a `removedAt: null`
    // clause in this `deleteMany` would leave every removed person's email and
    // answers in the database while reporting the erasure complete — and it would
    // look like a sensible filter to whoever added it.
    delegateFor('appWaitlistEntry').deleteMany.mockResolvedValue({ count: 1 });

    await initLeafApp();
    await eraseUser({
      userId: 'user-1',
      userEmail: 'Ada@Example.com',
      actorUserId: 'user-1',
      reason: 'self_service',
    });

    const args = delegateFor('appWaitlistEntry').deleteMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toEqual({ OR: [{ userId: 'user-1' }, { email: 'ada@example.com' }] });
    expect(JSON.stringify(args.where)).not.toContain('removedAt');
  });

  it('deletes BEFORE the user row goes, so the email is still readable', async () => {
    await initLeafApp();

    await eraseUser({
      userId: 'user-1',
      userEmail: 'Ada@Example.com',
      actorUserId: 'user-1',
      reason: 'self_service',
    });

    const deleteOrder = delegateFor('appWaitlistEntry').deleteMany.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(userDelete.mock.invocationCallOrder[0]);
  });

  it('does NOT reach the waitlist when the leaf boot hook never ran', async () => {
    // The negative case that makes the positive one mean something. Without it,
    // "the row is deleted" would pass even if the FK cascade were doing the work
    // — and the FK is `SET NULL`, which for an email-keyed row does nothing at
    // all. This is the failure the hook exists to prevent, so it is asserted.
    await eraseUser({
      userId: 'user-1',
      userEmail: 'Ada@Example.com',
      actorUserId: 'user-1',
      reason: 'self_service',
    });

    expect(delegateFor('appWaitlistEntry').deleteMany).not.toHaveBeenCalled();
  });

  it('rolls the erasure back rather than reporting success if the delete fails', async () => {
    await initLeafApp();
    delegateFor('appWaitlistEntry').deleteMany.mockRejectedValue(new Error('deadlock'));

    await expect(
      eraseUser({
        userId: 'user-1',
        userEmail: 'Ada@Example.com',
        actorUserId: 'user-1',
        reason: 'self_service',
      })
    ).rejects.toThrow('deadlock');

    // The in-transaction phase runs before `tx.user.delete()` precisely so a
    // throw here takes the whole erasure with it.
    expect(userDelete).not.toHaveBeenCalled();
  });
});
