/**
 * The acknowledgement ledger's two GDPR duties, through the REAL seams.
 *
 * Art. 15: `exportUserData()` reaches `lib/app/data-export.ts` →
 * `lib/app/leaf-data-export.ts` → the gateway module, with only Prisma stubbed,
 * so a seam left half-filled fails here rather than shipping a bundle that
 * reads like a complete answer.
 *
 * Art. 17 is different from the waitlist's, and the difference is the point of
 * the second block. There is NO erasure hook for this table: the policy is the
 * hand-written `ON DELETE CASCADE` on `app_acknowledgement.userId`, which
 * Postgres applies when `eraseUser()` deletes the user row. A unit test cannot
 * watch Postgres cascade, so what is pinned is the chain that makes it happen —
 * the migration declares the cascade against the real `user` table, the drift
 * probe asserts it in every environment (`tests/unit/lib/app/db-drift.test.ts`),
 * and erasure still deletes the user. If someone later adds a hook that
 * deletes these rows explicitly, the assertion that none does will tell them
 * the cascade already did.
 *
 * FORK NOTE — this reads `lib/app/leaf-bootstrap.ts` and
 * `lib/app/leaf-data-export.ts` for real, not through a mock, for the same
 * reason `tests/unit/lib/app/waitlist/privacy.test.ts` does: the wiring is the
 * thing under test. Upstream both seams are empty, so a fork inheriting this
 * file should expect to rewrite it around its own tables rather than pin ours.
 *
 * @see lib/app/leaf-data-export.ts · prisma/migrations/20260914121123_app_acknowledgement
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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
    const userDelete = vi.fn().mockResolvedValue({ id: 'user-1' });
    const receiptCreate = vi.fn().mockResolvedValue({
      id: 'receipt-1',
      erasedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

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

const SUBJECT = { id: 'user-1', email: 'ada@example.com', name: 'Ada' };

const ROWS = [
  {
    id: 'ack-1',
    userId: 'user-1',
    kind: 'terms',
    documentVersion: '1.0',
    acknowledgedAt: new Date('2026-02-01T00:00:00.000Z'),
  },
  {
    id: 'ack-2',
    userId: 'user-1',
    kind: 'terms',
    documentVersion: '1.1',
    acknowledgedAt: new Date('2026-09-01T00:00:00.000Z'),
  },
];

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

describe('subject access (Art. 15) reaches the acknowledgement ledger', () => {
  it('puts every row — superseded versions included — under the declared section', async () => {
    delegateFor('appAcknowledgement').findMany.mockResolvedValue(ROWS);

    const bundle = await exportUserData({
      userId: 'user-1',
      actorUserId: 'user-1',
      reason: 'self_service',
    });

    expect(bundle.app.acknowledgements).toEqual(ROWS);
    expect(bundle.meta.app).toContainEqual(
      expect.objectContaining({ section: 'acknowledgements', model: 'AppAcknowledgement', rows: 2 })
    );
    // By user id, with no version clause: Art. 15 is about what we HOLD.
    const args = delegateFor('appAcknowledgement').findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toEqual({ userId: 'user-1' });
  });

  it('still carries the section, empty, for someone who never reached the gate', async () => {
    const bundle = await exportUserData({
      userId: 'user-1',
      actorUserId: 'user-1',
      reason: 'self_service',
    });

    const roundTripped = JSON.parse(JSON.stringify(bundle)) as { app: Record<string, unknown> };
    expect(Object.keys(roundTripped.app)).toContain('acknowledgements');
    expect(roundTripped.app.acknowledgements).toEqual([]);
  });
});

describe('erasure (Art. 17) — the cascade is the policy', () => {
  it('the migration declares ON DELETE CASCADE against the real `user` table', () => {
    const sql = readFileSync(
      path.join(
        process.cwd(),
        'prisma',
        'migrations',
        '20260914121123_app_acknowledgement',
        'migration.sql'
      ),
      'utf8'
    );
    // One statement, matched loosely on whitespace: the constraint name the
    // drift probe pins, the mapped table name (`"user"`, not `"User"` — B11),
    // and the action. `SET NULL` would fail on the NOT NULL column; `NO ACTION`
    // would fail every erasure with P2003.
    expect(sql).toMatch(
      /ADD CONSTRAINT "app_acknowledgement_userId_fkey"\s+FOREIGN KEY \("userId"\) REFERENCES "user"\("id"\)\s+ON DELETE CASCADE/
    );
    // And nothing outside our table survived from the generated SQL (B13).
    // The header COMMENT names what was stripped, so match statements only.
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(statements).not.toMatch(/DROP (CONSTRAINT|INDEX)/);
    expect(statements).not.toMatch(/ALTER TABLE "(?!app_acknowledgement")/);
  });

  it('erasure deletes the user row inside the transaction, and no hook touches this table', async () => {
    await initLeafApp();

    await eraseUser({
      userId: 'user-1',
      userEmail: 'ada@example.com',
      actorUserId: 'user-1',
      reason: 'self_service',
    });

    // The cascade fires off this delete; it is the only thing the code has to do.
    expect(userDelete).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' } }));
    // No explicit delete: if one appears, someone has duplicated the cascade
    // (harmless) or replaced it (not) — either way the migration comment and
    // the drift probe are now telling a different story from the code.
    expect(delegateFor('appAcknowledgement').deleteMany).not.toHaveBeenCalled();
  });
});
