/**
 * The values-activation seed: moves values from `draft` to `active` on a
 * fresh database, and touches nothing else (§15 t-106).
 *
 * Same in-memory table as the onboarding unit's test, so "only values, only
 * from draft" is observed on the rows rather than read off the arguments.
 *
 * @see prisma/seeds/app-lelanea/022-activate-values.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ prisma: {} }));

import unit from '@/prisma/seeds/app-lelanea/022-activate-values';

/** Daybreak's `MODULE_STATUS` values; this file may not import the framework tier. */
const MODULE_STATUS = { draft: 'draft', active: 'active', retired: 'retired' } as const;

interface ModuleRow {
  slug: string;
  status: string;
}

let modules: ModuleRow[];
const prisma = {
  module: {
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { slug: string; status: string };
        data: { status: string };
      }) => {
        const hits = modules.filter((m) => m.slug === where.slug && m.status === where.status);
        for (const m of hits) m.status = data.status;
        return { count: hits.length };
      }
    ),
    findFirst: vi.fn(async ({ where }: { where: { slug: string } }) => {
      const row = modules.find((m) => m.slug === where.slug);
      return row ? { status: row.status } : null;
    }),
  },
};
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

async function run(): Promise<void> {
  await unit.run({ prisma: prisma as never, logger: logger as never });
}

const status = (slug: string) => modules.find((m) => m.slug === slug)?.status;

beforeEach(() => {
  vi.clearAllMocks();
  modules = [
    { slug: 'onboarding', status: MODULE_STATUS.active },
    { slug: 'values', status: MODULE_STATUS.draft },
    { slug: 'boundaries', status: MODULE_STATUS.draft },
  ];
});

describe('022-activate-values', () => {
  it('activates values and leaves every other module as it was', async () => {
    await run();

    expect(status('values')).toBe(MODULE_STATUS.active);
    expect(status('onboarding')).toBe(MODULE_STATUS.active);
    expect(status('boundaries')).toBe(MODULE_STATUS.draft);
  });

  it('leaves a status an operator already set', async () => {
    modules[1].status = MODULE_STATUS.retired;

    await run();

    expect(status('values')).toBe(MODULE_STATUS.retired);
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/already retired/));
  });

  it('is safe with no module rows', async () => {
    modules = [];

    await expect(run()).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/No values module row/));
  });
});
