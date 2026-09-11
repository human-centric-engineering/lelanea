/**
 * `recordNodeProgress` unit tests (#168) — the module-owned progress seam.
 *
 * House style: no live DB in vitest; `@/lib/db/client` is mocked and we assert the
 * query the seam *issues*. That the jsonb merge is genuinely a MERGE is **not**
 * provable here, and deliberately has no stateful-fake integration test either —
 * the merge lives in Postgres, so a fake implementing `||` as `Object.assign` would
 * pass whatever the seam did. `npm run smoke:journey-progress` is the proof, and it
 * runs by hand, not in CI (see that script's header).
 *
 * What is worth pinning here is the set of decisions someone could reverse without
 * any test noticing:
 *
 *   - **guard before write** — a denied viewer throws and Prisma is never touched;
 *   - **`canWrite`, not `canRead`** — today those two are value-identical, so no
 *     behavioural test can tell them apart. See the block for why it is pinned
 *     structurally anyway;
 *   - **the journeyId is RESOLVED, never accepted** — the write is keyed on a row
 *     the guarded natural key found, which is what makes it impossible to address
 *     another subject's row;
 *   - **it refuses to create a `UserNodeState`** — a missing row is a refusal, not
 *     an insert, because inserting one would mean inventing a `status`;
 *   - **the SQL is parameterised** — the patch reaches Postgres as a bound value,
 *     not as text spliced into the statement;
 *   - **the lifecycle fields are not in the statement at all** — `status`,
 *     `timesCompleted` and the timestamps stay `applyEvent`'s.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { UserNodeState } from '@prisma/client';
import { ForbiddenError } from '@/lib/api/errors';

// `$executeRaw` is a tagged template: Prisma hands it the literal chunks and the
// interpolated values separately. Capturing both is what lets the parameterisation
// assertion below mean something — a splice would show up as a literal chunk.
const rawCalls: Array<{ sql: string; values: unknown[] }> = [];

const prismaMock = {
  $executeRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    rawCalls.push({ sql: strings.join('?'), values });
    return Promise.resolve(rawResult);
  }),
  userJourney: {
    findUnique: vi.fn(),
  },
  userNodeState: {
    findUniqueOrThrow: vi.fn(),
    // Present on purpose: "it never inserts" only means something if inserting was
    // reachable. A mock without these would turn a regression into a TypeError,
    // whose natural repair is to widen the fixture.
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
};

let rawResult = 1;

vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));

// The merge and its read-back run inside one transaction, so the seam reaches the
// mock through `tx`, not through the module-level client. Handing the callback the
// same object keeps every assertion below unchanged — and `executeTransaction`
// being called at all is itself asserted, since the pairing is what stops a
// committed write's read-back throwing P2025 out of the ok/rejection contract.
const executeTransaction = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db/utils', () => ({ executeTransaction }));

// The access seam is wrapped, not replaced: both predicates keep their REAL bodies,
// so the behavioural tests below still exercise the genuine grant, while the spies
// record which one the seam consulted. That is the only way to pin decision 4 —
// `canWrite` is value-identical to `canRead` today, so no input can distinguish
// them, and the regression it guards against (swapping back to `canRead`) only
// becomes observable on the day Sunrise #367 widens reads and silently widens this
// write with them. By then there is no diff to notice.
const accessSpies = vi.hoisted(() => ({ canRead: vi.fn(), canWrite: vi.fn() }));
vi.mock('@/lib/framework/shared/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/framework/shared/access')>();
  accessSpies.canRead.mockImplementation(actual.canRead);
  accessSpies.canWrite.mockImplementation(actual.canWrite);
  return { ...actual, canRead: accessSpies.canRead, canWrite: accessSpies.canWrite };
});

const { recordNodeProgress } = await import('@/lib/framework/facilitation/journey/progress');

const SUBJECT = 'user_1';
const OTHER = 'user_2';
const JOURNEY_ID = 'uj_1';

function nodeStateRow(overrides: Partial<UserNodeState> = {}): UserNodeState {
  return {
    id: 'uns_1',
    journeyId: JOURNEY_ID,
    nodeKey: 'chart',
    status: 'active',
    timesCompleted: 0,
    progress: { chartShown: true },
    firstEnteredAt: new Date('2026-01-01T00:00:00.000Z'),
    lastActiveAt: new Date('2026-01-01T00:00:00.000Z'),
    completedAt: null,
    ...overrides,
  };
}

const key = { userId: SUBJECT, graphSlug: 'reclaim' };

beforeEach(() => {
  vi.clearAllMocks();
  rawCalls.length = 0;
  rawResult = 1;
  // Hand the callback the same mock the module-level client uses, so an assertion
  // reads the same whether the call happens inside the transaction or before it.
  executeTransaction.mockImplementation((cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock));
  prismaMock.userJourney.findUnique.mockResolvedValue({ id: JOURNEY_ID });
  prismaMock.userNodeState.findUniqueOrThrow.mockResolvedValue(nodeStateRow());
});

describe('recordNodeProgress — access', () => {
  it('records for the subject themselves', async () => {
    const result = await recordNodeProgress({ userId: SUBJECT }, key, 'chart', {
      chartShown: true,
    });

    expect(result.ok).toBe(true);
    expect(prismaMock.$executeRaw).toHaveBeenCalledOnce();
  });

  it('records for another subject when the viewer holds the admin-support override', async () => {
    const result = await recordNodeProgress(
      { userId: SUBJECT, isAdminSupport: true },
      { userId: OTHER, graphSlug: 'reclaim' },
      'chart',
      { chartShown: true }
    );

    expect(result.ok).toBe(true);
  });

  it('guards on canWrite, the pinned grant — NOT on the widening canRead', async () => {
    await recordNodeProgress({ userId: SUBJECT }, key, 'chart', { chartShown: true });

    expect(accessSpies.canWrite).toHaveBeenCalledWith({ userId: SUBJECT }, SUBJECT, undefined);
    // One guard, and it is the narrow one. `canWrite` composes `canRead` inside
    // `access.ts`, but that is a module-INTERNAL call and so does not route through
    // this mocked export — which is what makes the second assertion sharp rather
    // than incidental: the export being untouched means the seam never reached for
    // it. Swap `canWrite` for `canRead` in the seam and both lines fail.
    expect(accessSpies.canWrite).toHaveBeenCalledOnce();
    expect(accessSpies.canRead).not.toHaveBeenCalled();
  });

  it('passes the caller scope through to the guard', async () => {
    await recordNodeProgress(
      { userId: SUBJECT },
      key,
      'chart',
      { chartShown: true },
      {
        ownership: 'team',
      }
    );

    expect(accessSpies.canWrite).toHaveBeenCalledWith({ userId: SUBJECT }, SUBJECT, {
      ownership: 'team',
    });
  });

  it('refuses another subject without the override, and writes nothing', async () => {
    await expect(
      recordNodeProgress({ userId: SUBJECT }, { userId: OTHER, graphSlug: 'reclaim' }, 'chart', {
        chartShown: true,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    // The guard runs BEFORE anything — a denied call must not even resolve the
    // journey, let alone issue the update.
    expect(prismaMock.userJourney.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('recordNodeProgress — the journey it resolves', () => {
  it('looks the journey up by the natural key it was access-checked on', async () => {
    await recordNodeProgress({ userId: SUBJECT }, { ...key, contextKey: 'run_7' }, 'chart', {
      chartShown: true,
    });

    // Decision 3: the caller never supplies a `journeyId`, so there is no argument
    // through which a row belonging to an unguarded subject could be named.
    expect(prismaMock.userJourney.findUnique).toHaveBeenCalledWith({
      where: {
        userId_graphSlug_contextKey: {
          userId: SUBJECT,
          graphSlug: 'reclaim',
          contextKey: 'run_7',
        },
      },
      select: { id: true },
    });
  });

  it('defaults an omitted contextKey to the empty-string sentinel, never undefined', async () => {
    await recordNodeProgress({ userId: SUBJECT }, key, 'chart', { chartShown: true });

    const where = prismaMock.userJourney.findUnique.mock.calls[0]?.[0] as {
      where: { userId_graphSlug_contextKey: { contextKey: unknown } };
    };
    expect(where.where.userId_graphSlug_contextKey.contextKey).toBe('');
  });

  it('refuses with journey_not_started when the journey does not exist, and issues no update', async () => {
    prismaMock.userJourney.findUnique.mockResolvedValue(null);

    const result = await recordNodeProgress({ userId: SUBJECT }, key, 'chart', {
      chartShown: true,
    });

    expect(result).toEqual({
      ok: false,
      rejection: {
        code: 'journey_not_started',
        message: 'No journey for map "reclaim" has been started.',
      },
    });
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('recordNodeProgress — the write it issues', () => {
  it('merges into the existing payload rather than replacing it', async () => {
    await recordNodeProgress({ userId: SUBJECT }, key, 'chart', { chartShown: true });

    const { sql } = rawCalls[0] ?? { sql: '' };
    // `||` is the merge; COALESCE is what makes the FIRST write work against the
    // NULL the column starts as. A plain `SET progress = patch` would pass every
    // other assertion in this file while silently dropping every earlier key.
    expect(sql).toMatch(/COALESCE\("progress",\s*'\{\}'::jsonb\)\s*\|\|/);
  });

  it('binds the patch as a parameter instead of splicing it into the statement', async () => {
    const patch = { chartShown: true, note: "'; DROP TABLE framework_user_node_state; --" };

    await recordNodeProgress({ userId: SUBJECT }, key, 'chart', patch);

    const { sql, values } = rawCalls[0] ?? { sql: '', values: [] };
    expect(values).toEqual([JSON.stringify(patch), JOURNEY_ID, 'chart']);
    // The literal chunks of the template carry none of the caller's data.
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toContain('chartShown');
    expect(sql).not.toContain(JOURNEY_ID);
  });

  it('touches only progress — the lifecycle fields are not in the statement', async () => {
    await recordNodeProgress({ userId: SUBJECT }, key, 'chart', { chartShown: true });

    const { sql } = rawCalls[0] ?? { sql: '' };
    for (const owned of [
      'status',
      'timesCompleted',
      'firstEnteredAt',
      'lastActiveAt',
      'completedAt',
    ]) {
      expect(sql).not.toContain(owned);
    }
  });

  it('scopes the update to the resolved journey AND the node key', async () => {
    await recordNodeProgress({ userId: SUBJECT }, key, 'chart', { chartShown: true });

    const { sql } = rawCalls[0] ?? { sql: '' };
    expect(sql).toMatch(/WHERE\s+"journeyId"\s*=\s*\?\s+AND\s+"nodeKey"\s*=\s*\?/);
  });
});

describe('recordNodeProgress — no row to record against', () => {
  it('refuses with node_not_entered rather than creating a UserNodeState', async () => {
    rawResult = 0;

    const result = await recordNodeProgress({ userId: SUBJECT }, key, 'chart', {
      chartShown: true,
    });

    expect(result).toEqual({
      ok: false,
      rejection: {
        code: 'node_not_entered',
        message: 'Node "chart" has no state on this journey to record against.',
      },
    });
    // Decision 2: creating the row would mean inventing a `status`, the field
    // `applyEvent` is the sole writer of. Refusing is the whole point.
    expect(prismaMock.userNodeState.create).not.toHaveBeenCalled();
    expect(prismaMock.userNodeState.upsert).not.toHaveBeenCalled();
    // …and it does not read back a row it did not write.
    expect(prismaMock.userNodeState.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});

describe('recordNodeProgress — the merge and its read-back are paired', () => {
  it('runs both inside one transaction, so a committed write cannot read back a vanished row', async () => {
    await recordNodeProgress({ userId: SUBJECT }, key, 'chart', { chartShown: true });

    // Without the pairing, a row erased between the UPDATE and the read-back makes
    // `findUniqueOrThrow` raise Prisma P2025 — an outcome this function's result
    // type says cannot happen.
    expect(executeTransaction).toHaveBeenCalledOnce();
    expect(prismaMock.$executeRaw).toHaveBeenCalledOnce();
    expect(prismaMock.userNodeState.findUniqueOrThrow).toHaveBeenCalledOnce();
  });

  it('does not open a transaction when the guard or the journey lookup refuses', async () => {
    prismaMock.userJourney.findUnique.mockResolvedValue(null);
    await recordNodeProgress({ userId: SUBJECT }, key, 'chart', { chartShown: true });
    expect(executeTransaction).not.toHaveBeenCalled();

    await expect(
      recordNodeProgress({ userId: SUBJECT }, { userId: OTHER, graphSlug: 'reclaim' }, 'chart', {
        chartShown: true,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(executeTransaction).not.toHaveBeenCalled();
  });
});

describe('recordNodeProgress — what it returns', () => {
  it('reads the row back through the typed client and returns it', async () => {
    const row = nodeStateRow({ progress: { chartShown: true, gapShown: true } });
    prismaMock.userNodeState.findUniqueOrThrow.mockResolvedValue(row);

    const result = await recordNodeProgress({ userId: SUBJECT }, key, 'chart', { gapShown: true });

    expect(prismaMock.userNodeState.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { journeyId_nodeKey: { journeyId: JOURNEY_ID, nodeKey: 'chart' } },
    });
    expect(result).toEqual({ ok: true, nodeState: row });
  });
});
