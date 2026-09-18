/**
 * The pause-flag seed: creates the switch, off — and never touches it again.
 *
 * ## `fp4` — operator-owned, created once
 *
 * An operator who switched the flag on mid-incident must find it still on after
 * a deploy that re-runs seeds. So the case that matters is the second one: a
 * flag that exists — ON, with a description an admin edited — is written by
 * nothing. The first case establishes the population: this unit does write,
 * when there is nothing there.
 *
 * @see prisma/seeds/app-lelanea/008-generation-pause-flag.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ prisma: {} }));

import unit from '@/prisma/seeds/app-lelanea/008-generation-pause-flag';
import { GENERATION_PAUSED_FLAG } from '@/lib/app/agent/availability';

interface FlagRow {
  name: string;
  enabled: boolean;
  description: string | null;
}

let flags: FlagRow[];
const prisma = {
  featureFlag: {
    findUnique: vi.fn(async ({ where }: { where: { name: string } }) => {
      const row = flags.find((flag) => flag.name === where.name);
      return row ? { enabled: row.enabled } : null;
    }),
    create: vi.fn(async ({ data }: { data: FlagRow }) => {
      flags.push({ name: data.name, enabled: data.enabled, description: data.description });
      return data;
    }),
    update: vi.fn(),
    upsert: vi.fn(),
  },
};
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

async function run(): Promise<void> {
  await unit.run({ prisma: prisma as never, logger: logger as never });
}

beforeEach(() => {
  vi.clearAllMocks();
  flags = [{ name: 'MAINTENANCE_MODE', enabled: false, description: null }];
});

describe('008-generation-pause-flag', () => {
  it('creates the switch, off, where there is none', async () => {
    await run();

    expect(flags.find((flag) => flag.name === GENERATION_PAUSED_FLAG)).toMatchObject({
      enabled: false,
      description: expect.stringMatching(/paused/),
    });
  });

  it('never writes a switch that exists — an operator’s pause survives a re-seed', async () => {
    await run();
    expect(prisma.featureFlag.create).toHaveBeenCalledTimes(1); // the population
    const pausedByAnOperator = flags.find((flag) => flag.name === GENERATION_PAUSED_FLAG)!;
    pausedByAnOperator.enabled = true;
    pausedByAnOperator.description = 'Paused during the provider incident — see the on-call log.';
    vi.clearAllMocks();

    await run();

    expect(prisma.featureFlag.create).not.toHaveBeenCalled();
    expect(prisma.featureFlag.update).not.toHaveBeenCalled();
    expect(prisma.featureFlag.upsert).not.toHaveBeenCalled();
    expect(pausedByAnOperator).toMatchObject({
      enabled: true,
      description: 'Paused during the provider incident — see the on-call log.',
    });
  });
});
