/**
 * One person, both of Lelañea's tables, both rights — end to end through the
 * REAL seams (§06 t-17's done-when).
 *
 * `waitlist/privacy.test.ts` and `gateway/privacy.test.ts` each prove their
 * own table. This proves the two together for one subject, because the
 * failure this feature ships against is a bundle short by a section or an
 * erasure short by a table, and neither of those shows up in a test that
 * knows about only one. Only Prisma and the object store are stubs;
 * `exportUserData()` and `eraseUser()` reach `lib/app/leaf-data-export.ts`
 * and the hook `initLeafApp()` registers for real.
 *
 * The two tables are erased by different mechanisms, and the assertions say
 * which: the waitlist row by the hook (matched by email, because it may
 * pre-date the account), the acknowledgement rows by the hand-written
 * `ON DELETE CASCADE` on `app_acknowledgement.userId` — which a unit test
 * cannot watch fire, so what is asserted here is the delete that fires it and
 * that nothing else pretends to.
 *
 * FORK NOTE — reads `lib/app/leaf-bootstrap.ts` and `lib/app/leaf-data-export.ts`
 * for real, not through a mock: the wiring is the thing under test. Upstream
 * both seams are empty; a fork inheriting this file should rewrite it around
 * its own tables.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { delegateFor, resetDelegates, userFindUnique, userDelete, receiptCreate, prisma } =
  vi.hoisted(() => {
    interface Delegate {
      findMany: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    }
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
    const userDelete = vi.fn();
    const receiptCreate = vi.fn();
    const base = {
      get(_target: object, property: string | symbol): unknown {
        if (typeof property !== 'string') return undefined;
        if (property === 'user') return { findUnique: userFindUnique, delete: userDelete };
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
    return { delegateFor, resetDelegates, userFindUnique, userDelete, receiptCreate, prisma };
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

/** Ada joined the waitlist before she had an account, then reached the gate. */
const ADA = { id: 'user-ada', email: 'Ada@Example.com', name: 'Ada' };

const WAITLIST_ROW = {
  id: 'entry-1',
  email: 'ada@example.com',
  name: 'Ada',
  heardFrom: null,
  intent: 'to slow down',
  source: 'form',
  locale: 'en-GB',
  consentedAt: new Date('2026-02-01T00:00:00.000Z'),
  userId: null,
  createdAt: new Date('2026-02-01T00:00:00.000Z'),
  updatedAt: new Date('2026-02-01T00:00:00.000Z'),
  removedAt: null,
  rejoinRequestedAt: null,
  rejoinRequests: 0,
};

const ACKNOWLEDGEMENT_ROWS = [
  {
    id: 'ack-1',
    userId: 'user-ada',
    kind: 'disclaimer',
    documentVersion: '1.1',
    acknowledgedAt: new Date('2026-09-14T10:00:00.000Z'),
  },
  {
    id: 'ack-2',
    userId: 'user-ada',
    kind: 'terms',
    documentVersion: '1.1',
    acknowledgedAt: new Date('2026-09-14T10:01:00.000Z'),
  },
  {
    id: 'ack-3',
    userId: 'user-ada',
    kind: 'age_18',
    documentVersion: '18',
    acknowledgedAt: new Date('2026-09-14T10:02:00.000Z'),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  resetDelegates();
  __resetAppSubjectSourceRegistryForTests();
  __resetErasureCleanupHooksForTests();
  userFindUnique.mockResolvedValue(ADA);
  userDelete.mockResolvedValue({ id: ADA.id });
  receiptCreate.mockResolvedValue({ id: 'receipt-1', erasedAt: new Date() });
  delegateFor('appWaitlistEntry').findMany.mockResolvedValue([WAITLIST_ROW]);
  delegateFor('appAcknowledgement').findMany.mockResolvedValue(ACKNOWLEDGEMENT_ROWS);
});

describe('Art. 15 — the bundle for one person carries both of our tables', () => {
  it('contains the waitlist entry (by email) and every acknowledgement (by user id)', async () => {
    const bundle = await exportUserData({
      userId: ADA.id,
      actorUserId: ADA.id,
      reason: 'self_service',
    });

    // Population first: both sections hold rows, so the presence assertions
    // below are not passing on empty arrays.
    expect(bundle.app.waitlist).toEqual([WAITLIST_ROW]);
    expect(bundle.app.acknowledgements).toEqual(ACKNOWLEDGEMENT_ROWS);
    expect(bundle.meta.app).toContainEqual(
      expect.objectContaining({ section: 'waitlist', model: 'AppWaitlistEntry', rows: 1 })
    );
    expect(bundle.meta.app).toContainEqual(
      expect.objectContaining({ section: 'acknowledgements', model: 'AppAcknowledgement', rows: 3 })
    );

    // Matched the way each table can be: the waitlist row has no user id
    // (she joined first), so it is found by lower-cased email; the
    // acknowledgements by the account.
    const waitlistWhere = delegateFor('appWaitlistEntry').findMany.mock.calls[0]?.[0] as {
      where: { OR: unknown[] };
    };
    expect(waitlistWhere.where.OR).toContainEqual({ email: 'ada@example.com' });
    const ackWhere = delegateFor('appAcknowledgement').findMany.mock.calls[0]?.[0] as {
      where: unknown;
    };
    expect(ackWhere.where).toEqual({ userId: ADA.id });
  });

  it('survives serialisation with both sections intact — what the export control actually writes', async () => {
    const bundle = await exportUserData({
      userId: ADA.id,
      actorUserId: ADA.id,
      reason: 'self_service',
    });
    const written = JSON.parse(JSON.stringify(bundle)) as {
      app: { waitlist: unknown[]; acknowledgements: unknown[] };
    };
    expect(written.app.waitlist).toHaveLength(1);
    expect(written.app.acknowledgements).toHaveLength(3);
  });
});

describe('Art. 17 — erasure removes both, and the person', () => {
  it('deletes the waitlist row by hook, the user by delete, and leaves the cascade to the FK', async () => {
    await initLeafApp();

    await eraseUser({
      userId: ADA.id,
      userEmail: ADA.email,
      actorUserId: ADA.id,
      reason: 'self_service',
    });

    // The waitlist row cannot cascade — no user id on it — so the hook
    // deletes it, matching on both handles.
    expect(delegateFor('appWaitlistEntry').deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ userId: ADA.id }, { email: 'ada@example.com' }] },
    });
    // The person.
    expect(userDelete).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ADA.id } }));
    // The acknowledgements go WITH the user row — `ON DELETE CASCADE`, pinned
    // by the drift probe — so nothing here deletes them by hand. A `deleteMany`
    // appearing on this delegate would mean the cascade had been duplicated or,
    // worse, replaced.
    expect(delegateFor('appAcknowledgement').deleteMany).not.toHaveBeenCalled();
  });
});
