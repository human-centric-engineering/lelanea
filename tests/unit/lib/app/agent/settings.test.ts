/**
 * The agent's deadlines and monthly limits — the store and its resolvers (§08 t-53).
 *
 * Nothing enforces these values yet, so these tests are what proves the write
 * meanwhile (`HB9`). They run against a small stateful in-memory fake of the
 * three tables rather than a mock that returns canned rows: the properties worth
 * proving are about STATE — a change to the store changes the next read, a
 * cleared override falls back — and a canned mock can only echo what it was told.
 *
 * "A fresh store" is built from the migration's own `INSERT`, parsed out of the
 * SQL file, so the defaults asserted here are the ones a new database actually
 * gets — and the same test holds them equal to the code constants.
 *
 * @see lib/app/agent/settings.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface SettingsRow {
  slug: string;
  firstWordsDeadlineMs: number;
  turnDeadlineMs: number;
  defaultMonthlyCeilingUsd: number;
  updatedAt: Date;
}
interface BudgetRow {
  userId: string;
  monthlyCeilingUsd: number;
  createdAt: Date;
  updatedAt: Date;
}
interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string | null;
  createdAt: Date;
}

const db = vi.hoisted(() => ({
  settings: new Map<string, SettingsRow>(),
  budgets: new Map<string, BudgetRow>(),
  users: [] as UserRow[],
}));

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

function pick<T extends object>(row: T, select?: Record<string, boolean>): Partial<T> {
  if (!select) return row;
  return Object.fromEntries(Object.entries(row).filter(([key]) => select[key])) as Partial<T>;
}

vi.mock('@/lib/logging', () => ({
  logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    appAgentSettings: {
      findUnique: vi.fn(
        async ({
          where,
          select,
        }: {
          where: { slug: string };
          select?: Record<string, boolean>;
        }) => {
          const row = db.settings.get(where.slug);
          return row ? pick({ ...row }, select) : null;
        }
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
          select,
        }: {
          where: { slug: string };
          create: Omit<SettingsRow, 'updatedAt'>;
          update: Partial<SettingsRow>;
          select?: Record<string, boolean>;
        }) => {
          const existing = db.settings.get(where.slug);
          const row: SettingsRow = existing
            ? { ...existing, ...update, updatedAt: new Date() }
            : { ...create, updatedAt: new Date() };
          db.settings.set(where.slug, row);
          return pick({ ...row }, select);
        }
      ),
    },
    appUserBudget: {
      findUnique: vi.fn(
        async ({
          where,
          select,
        }: {
          where: { userId: string };
          select?: Record<string, boolean>;
        }) => {
          const row = db.budgets.get(where.userId);
          return row ? pick({ ...row }, select) : null;
        }
      ),
      findMany: vi.fn(
        async (args?: {
          where?: { userId?: string | { in: string[] } };
          select?: Record<string, boolean>;
        }) => {
          const filter = args?.where?.userId;
          return [...db.budgets.values()]
            .filter((row) =>
              filter === undefined
                ? true
                : typeof filter === 'string'
                  ? row.userId === filter
                  : filter.in.includes(row.userId)
            )
            .map((row) => pick({ ...row }, args?.select));
        }
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { userId: string };
          create: { userId: string; monthlyCeilingUsd: number };
          update: { monthlyCeilingUsd: number };
        }) => {
          const existing = db.budgets.get(where.userId);
          const now = new Date();
          const row: BudgetRow = existing
            ? { ...existing, ...update, updatedAt: now }
            : { ...create, createdAt: now, updatedAt: now };
          db.budgets.set(where.userId, row);
          return row;
        }
      ),
      deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
        const had = db.budgets.delete(where.userId);
        return { count: had ? 1 : 0 };
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const user = db.users.find((row) => row.id === where.id);
        return user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null;
      }),
      findMany: vi.fn(
        async ({
          where,
          skip,
          take,
        }: {
          where: { id?: { in: string[] }; OR?: unknown };
          skip: number;
          take: number;
        }) =>
          db.users
            .filter((row) => (where.id ? where.id.in.includes(row.id) : true))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(skip, skip + take)
            .map(({ id, name, email, role }) => ({ id, name, email, role }))
      ),
      count: vi.fn(
        async ({ where }: { where: { id?: { in: string[] } } }) =>
          db.users.filter((row) => (where.id ? where.id.in.includes(row.id) : true)).length
      ),
    },
  },
}));

import { prisma } from '@/lib/db/client';
import {
  DEFAULT_AGENT_SETTINGS,
  clearUserBudget,
  findUserBudgetsForSubject,
  getAgentDeadlines,
  getAgentSettings,
  getEffectiveMonthlyCeiling,
  listUserBudgets,
  setUserBudget,
  updateAgentSettings,
} from '@/lib/app/agent/settings';

const MIGRATION = join(
  process.cwd(),
  'prisma/migrations/20260918120000_app_agent_settings/migration.sql'
);

/** The singleton the migration writes, read out of its `INSERT … VALUES (…)`. */
function migrationSingleton(): Omit<SettingsRow, 'updatedAt'> {
  const sql = readFileSync(MIGRATION, 'utf8');
  const match =
    /INSERT INTO "app_agent_settings"[^;]*?VALUES\s*\(\s*'(\w+)',\s*(\d+),\s*(\d+),\s*([\d.]+),/.exec(
      sql
    );
  if (!match)
    throw new Error('The migration no longer inserts the singleton in the expected shape');
  return {
    slug: match[1],
    firstWordsDeadlineMs: Number(match[2]),
    turnDeadlineMs: Number(match[3]),
    defaultMonthlyCeilingUsd: Number(match[4]),
  };
}

const ADA = 'cmtu71ttv0000ch5n72hhqhtu';
const BO = 'cmttsnyfa0000pu5nuxzzm44i';
const NOBODY = 'cmtso8tdu000p0bgmhn1v7lao';

beforeEach(() => {
  vi.clearAllMocks();
  db.settings.clear();
  db.budgets.clear();
  db.settings.set('global', { ...migrationSingleton(), updatedAt: new Date('2026-09-18') });
  db.users = [
    {
      id: ADA,
      name: 'Ada',
      email: 'ada@example.com',
      role: 'USER',
      createdAt: new Date('2026-09-01'),
    },
    {
      id: BO,
      name: 'Bo',
      email: 'bo@example.com',
      role: 'ADMIN',
      createdAt: new Date('2026-09-10'),
    },
  ];
});

describe('a fresh store', () => {
  it('holds the ruled defaults: 8000 ms, 60000 ms, $5', async () => {
    await expect(getAgentDeadlines()).resolves.toEqual({
      firstWordsDeadlineMs: 8000,
      turnDeadlineMs: 60000,
    });
    await expect(getEffectiveMonthlyCeiling(ADA)).resolves.toEqual({
      ceilingUsd: 5,
      source: 'default',
    });
  });

  it('is written by the migration with exactly the values the code falls back to', () => {
    // The two copies of the ruling. If they drift, a database whose row was
    // deleted by hand would answer differently from one that never lost it.
    const { slug, ...values } = migrationSingleton();
    expect(slug).toBe('global');
    expect(values).toEqual(DEFAULT_AGENT_SETTINGS);
  });
});

describe('a missing singleton', () => {
  it('answers the ruling, says so, and reports it as not stored', async () => {
    db.settings.clear();
    const settings = await getAgentSettings();
    expect(settings).toEqual({ ...DEFAULT_AGENT_SETTINGS, updatedAt: null });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('is put back by saving, which is the remedy the warning names', async () => {
    db.settings.clear();
    await updateAgentSettings({
      firstWordsDeadlineMs: 5000,
      turnDeadlineMs: 45000,
      defaultMonthlyCeilingUsd: 3,
    });
    await expect(getAgentDeadlines()).resolves.toEqual({
      firstWordsDeadlineMs: 5000,
      turnDeadlineMs: 45000,
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('read per request', () => {
  it('a change to the store changes the very next read', async () => {
    await expect(getAgentDeadlines()).resolves.toMatchObject({ turnDeadlineMs: 60000 });

    // Changed underneath the module, not through it: a value cached at import or
    // on first read would still answer 60000 here.
    db.settings.set('global', { ...db.settings.get('global')!, turnDeadlineMs: 30000 });
    await expect(getAgentDeadlines()).resolves.toMatchObject({ turnDeadlineMs: 30000 });

    db.settings.set('global', { ...db.settings.get('global')!, defaultMonthlyCeilingUsd: 9 });
    await expect(getEffectiveMonthlyCeiling(ADA)).resolves.toEqual({
      ceilingUsd: 9,
      source: 'default',
    });
  });

  it('goes to the database on every call', async () => {
    await getAgentDeadlines();
    await getAgentDeadlines();
    await getEffectiveMonthlyCeiling(ADA);
    expect(prisma.appAgentSettings.findUnique).toHaveBeenCalledTimes(3);
    expect(prisma.appUserBudget.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('a person’s own limit', () => {
  it('beats the default', async () => {
    await setUserBudget(ADA, 12.5);
    await expect(getEffectiveMonthlyCeiling(ADA)).resolves.toEqual({
      ceilingUsd: 12.5,
      source: 'override',
    });
    // Nobody else is touched.
    await expect(getEffectiveMonthlyCeiling(BO)).resolves.toEqual({
      ceilingUsd: 5,
      source: 'default',
    });
  });

  it('of zero is an answer, not an absence', async () => {
    await setUserBudget(ADA, 0);
    await expect(getEffectiveMonthlyCeiling(ADA)).resolves.toEqual({
      ceilingUsd: 0,
      source: 'override',
    });
  });

  it('once cleared, falls back to the default — by deleting the row', async () => {
    await setUserBudget(ADA, 12.5);
    const result = await clearUserBudget(ADA);

    expect(result?.cleared).toBe(true);
    expect(result?.row).toMatchObject({ overrideUsd: null, effectiveCeilingUsd: 5 });
    expect(db.budgets.has(ADA)).toBe(false);
    await expect(getEffectiveMonthlyCeiling(ADA)).resolves.toEqual({
      ceilingUsd: 5,
      source: 'default',
    });
  });

  it('clearing one nobody set is the state already reached, not an error', async () => {
    const result = await clearUserBudget(ADA);
    expect(result).toMatchObject({ cleared: false, row: { userId: ADA, overrideUsd: null } });
  });

  it('cannot be set or cleared for an account that does not exist', async () => {
    await expect(setUserBudget(NOBODY, 3)).resolves.toBeNull();
    await expect(clearUserBudget(NOBODY)).resolves.toBeNull();
    expect(db.budgets.size).toBe(0);
  });

  it('follows the default when the default moves, and an override does not', async () => {
    await setUserBudget(BO, 20);
    await updateAgentSettings({
      firstWordsDeadlineMs: 8000,
      turnDeadlineMs: 60000,
      defaultMonthlyCeilingUsd: 2,
    });
    await expect(getEffectiveMonthlyCeiling(ADA)).resolves.toMatchObject({ ceilingUsd: 2 });
    await expect(getEffectiveMonthlyCeiling(BO)).resolves.toMatchObject({ ceilingUsd: 20 });
  });
});

describe('the admin list', () => {
  it('enriches every person with their effective limit from one overrides query', async () => {
    await setUserBudget(ADA, 12.5);
    vi.mocked(prisma.appUserBudget.findMany).mockClear();

    const { users, total } = await listUserBudgets({ overriddenOnly: false, page: 1, limit: 25 });

    expect(total).toBe(2);
    expect(users).toEqual([
      expect.objectContaining({ userId: BO, overrideUsd: null, effectiveCeilingUsd: 5 }),
      expect.objectContaining({ userId: ADA, overrideUsd: 12.5, effectiveCeilingUsd: 12.5 }),
    ]);
    // One query for the page's overrides, whatever the page size — not one per row.
    expect(prisma.appUserBudget.findMany).toHaveBeenCalledTimes(1);
  });

  it('narrows to the people with their own limit', async () => {
    await setUserBudget(ADA, 12.5);
    const { users, total } = await listUserBudgets({ overriddenOnly: true, page: 1, limit: 25 });
    expect(total).toBe(1);
    expect(users.map((user) => user.userId)).toEqual([ADA]);
  });
});

describe('the subject-access read', () => {
  it('returns this person’s override and nobody else’s, and an empty array for none', async () => {
    await setUserBudget(ADA, 12.5);
    await setUserBudget(BO, 1);

    const ada = await findUserBudgetsForSubject({ userId: ADA });
    expect(ada).toHaveLength(1);
    expect(ada[0]).toMatchObject({ userId: ADA, monthlyCeilingUsd: 12.5 });

    await clearUserBudget(ADA);
    await expect(findUserBudgetsForSubject({ userId: ADA })).resolves.toEqual([]);
  });
});
