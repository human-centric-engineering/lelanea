/**
 * The crisis resource seed: fills empty tables from the bundled file — and never
 * touches them again (f-safety t-63).
 *
 * ## `fp4` — operator-owned, written once
 *
 * The cases that matter come after the first: a re-run must leave an admin's
 * edit alone, and must not bring back a region an admin removed. A per-region
 * "create if absent" would pass the first and fail the second, which is why the
 * copy row, not each region, is what decides.
 *
 * @see prisma/seeds/app-lelanea/010-crisis-resources.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ prisma: {} }));

import unit from '@/prisma/seeds/app-lelanea/010-crisis-resources';
import { getCrisisResources } from '@/lib/app/content/crisis-resources';

interface RegionRow {
  region: string;
  emergencyNumber: string;
  services: unknown;
  status: string;
}

let copy: Record<string, unknown> | null;
let regions: RegionRow[];

const prisma = {
  appCrisisCopy: {
    findUnique: vi.fn(async () => (copy ? { version: copy.version, status: copy.status } : null)),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      copy = { version: 1, ...data };
      return copy;
    }),
  },
  appCrisisRegion: {
    createMany: vi.fn(async ({ data }: { data: RegionRow[] }) => {
      for (const row of data) {
        if (!regions.some((r) => r.region === row.region)) regions.push({ ...row });
      }
      return { count: data.length };
    }),
  },
  $transaction: vi.fn(async (writes: Array<Promise<unknown>>) => Promise.all(writes)),
};
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

async function run(): Promise<void> {
  await unit.run({ prisma: prisma as never, logger: logger as never });
}

beforeEach(() => {
  vi.clearAllMocks();
  copy = null;
  regions = [];
});

describe('010-crisis-resources', () => {
  it('fills empty tables from the file: every region, the copy and the directory, as drafts', async () => {
    await run();

    const file = getCrisisResources();
    expect(regions.map((r) => r.region)).toEqual(file.regions.map((r) => r.region));
    expect(regions.find((r) => r.region === 'GB')).toMatchObject({
      emergencyNumber: '999',
      services: file.regions.find((r) => r.region === 'GB')?.services,
      status: 'draft',
    });
    expect(copy).toMatchObject({
      hardIntro: file.copy.hardIntro,
      keptMessage: file.copy.keptMessage,
      internationalUrl: file.international.url,
      status: 'draft',
    });
  });

  it('leaves an admin’s edit alone on a re-run', async () => {
    await run();
    expect(prisma.appCrisisRegion.createMany).toHaveBeenCalledTimes(1); // the population
    const gb = regions.find((r) => r.region === 'GB')!;
    gb.emergencyNumber = '999 or 112';
    gb.services = [{ name: 'Edited by an admin', contact: 'Call 1', hours: 'Always' }];
    copy!.hardIntro = 'Reworded by an admin.';
    copy!.version = 4;
    vi.clearAllMocks();

    await run();

    expect(prisma.appCrisisCopy.create).not.toHaveBeenCalled();
    expect(prisma.appCrisisRegion.createMany).not.toHaveBeenCalled();
    expect(regions.find((r) => r.region === 'GB')).toMatchObject({
      emergencyNumber: '999 or 112',
      services: [{ name: 'Edited by an admin', contact: 'Call 1', hours: 'Always' }],
    });
    expect(copy!.hardIntro).toBe('Reworded by an admin.');
  });

  it('does not bring back a region an admin removed', async () => {
    await run();
    regions = regions.filter((r) => r.region !== 'NZ');
    vi.clearAllMocks();

    await run();

    expect(prisma.appCrisisRegion.createMany).not.toHaveBeenCalled();
    expect(regions.some((r) => r.region === 'NZ')).toBe(false);
  });
});
