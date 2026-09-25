/**
 * `detectCrisis` — the tier a turn acts on, the resource, and the record
 * (f-safety t-58). Real detection and real authored content; the context check
 * and the database are the only things mocked.
 *
 * The failure outcomes are where an inverted fallback would show: each one is
 * asserted to leave the tier `hard`, so a change that softened on `error`,
 * `timeout` or `unavailable` fails its own case.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  create: vi.fn(),
}));

vi.mock('@/lib/logging', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/app/safety/context-check', () => ({ checkCrisisContext: mocks.check }));
vi.mock('@/lib/db/client', async () => {
  // Since t-88 there is no bundled floor under the crisis path: an unseeded
  // database throws rather than serving the file. So the crisis tables are
  // seeded here exactly as `010-crisis-resources.ts` seeds them, and these
  // cases go on asserting against her authored words — now by way of a row.
  // Built inside the factory because `vi.mock` is hoisted above any const.
  const { getCrisisResources } = await import('@/lib/app/content/seed-input/crisis-resources');
  const file = getCrisisResources();
  const crisisTables = {
    appCrisisCopy: {
      findUnique: vi.fn(() =>
        Promise.resolve({
          slug: 'global',
          ...file.copy,
          internationalName: file.international.name,
          internationalContact: file.international.contact,
          internationalUrl: file.international.url,
          internationalHours: file.international.hours,
          status: file.resources.provenance!.status,
          signedOffAt: null,
          version: 1,
        })
      ),
    },
    appCrisisRegion: {
      findMany: vi.fn(() =>
        Promise.resolve(
          file.regions.map((r) => ({
            region: r.region,
            emergencyNumber: r.emergencyNumber,
            services: r.services.map((s) => ({ ...s })),
            status: file.resources.provenance!.status,
            signedOffAt: null,
            version: 1,
          }))
        )
      ),
    },
  };
  return { prisma: { appSafetyEvent: { create: mocks.create }, ...crisisTables } };
});

import { detectCrisis, recordCrisisShown } from '@/lib/app/safety/assess';

const WHO = { userId: 'user-1', seat: 'onboarding' };
const HARD_TEXT = 'I want to kill myself';
const SOFT_TEXT = "I can't go on like this";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({});
});

describe('detectCrisis', () => {
  it('does nothing for a message that matched nothing: no check, no record, no resource', async () => {
    const result = await detectCrisis('I want to be braver at work', 'en-GB', WHO);
    expect(result).toMatchObject({ tier: 'none', resource: null });
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('decides without writing: the record waits until the resource is shown', async () => {
    mocks.check.mockResolvedValue('confirmed');
    await detectCrisis(HARD_TEXT, 'en-GB', WHO);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('shows a soft hit the resource without asking the context check', async () => {
    const result = await detectCrisis(SOFT_TEXT, 'en-GB', WHO);
    expect(result).toMatchObject({ tier: 'soft', contextCheck: 'not_run' });
    expect(result.resource).toMatchObject({ tier: 'soft', region: 'GB' });
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it('keeps a hard hit hard when the check confirms it', async () => {
    mocks.check.mockResolvedValue('confirmed');
    const result = await detectCrisis(HARD_TEXT, 'en-GB', WHO);
    expect(result).toMatchObject({ tier: 'hard', detectedTier: 'hard', contextCheck: 'confirmed' });
    expect(result.resource?.tier).toBe('hard');
  });

  it('moves a hard hit to soft when the check says figurative — and still shows the resource', async () => {
    mocks.check.mockResolvedValue('softened');
    const result = await detectCrisis(HARD_TEXT, 'en-GB', WHO);
    expect(result).toMatchObject({ tier: 'soft', detectedTier: 'hard', contextCheck: 'softened' });
    expect(result.resource).toMatchObject({ tier: 'soft', region: 'GB' });
  });

  it.each(['error', 'timeout', 'unavailable'])(
    'leaves the deterministic tier standing when the check returns %s',
    async (outcome) => {
      mocks.check.mockResolvedValue(outcome);
      const result = await detectCrisis(HARD_TEXT, 'en-GB', WHO);
      expect(result).toMatchObject({ tier: 'hard', contextCheck: outcome });
      expect(result.resource?.tier).toBe('hard');
    }
  );

  it('asks the check about the message, for the person and seat', async () => {
    mocks.check.mockResolvedValue('confirmed');
    await detectCrisis(HARD_TEXT, null, WHO);
    expect(mocks.check).toHaveBeenCalledWith({
      message: HARD_TEXT,
      userId: 'user-1',
      seat: 'onboarding',
    });
  });

  describe('the record', () => {
    it('writes what happened and never the words', async () => {
      mocks.check.mockResolvedValue('softened');
      const text = `${HARD_TEXT} tonight, after work`;
      await recordCrisisShown(await detectCrisis(text, 'en-GB', WHO), WHO);

      expect(mocks.create).toHaveBeenCalledTimes(1);
      const { data } = mocks.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(data).toEqual({
        kind: 'crisis',
        userId: 'user-1',
        seat: 'onboarding',
        detectedTier: 'hard',
        actedTier: 'soft',
        categories: ['suicide'],
        contextCheck: 'softened',
        locale: 'en-GB',
        resourceRegion: 'GB',
      });
      // No field holds any part of the message.
      const stored = JSON.stringify(data);
      for (const word of ['kill', 'myself', 'tonight', 'work']) expect(stored).not.toContain(word);
    });

    it('records a pre-signup event with no user', async () => {
      const who = { userId: null, seat: 'pre-signup' };
      await recordCrisisShown(await detectCrisis(SOFT_TEXT, null, who), who);
      const { data } = mocks.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(data).toMatchObject({ userId: null, seat: 'pre-signup', resourceRegion: null });
    });

    it('never throws when the record cannot be written', async () => {
      mocks.check.mockResolvedValue('confirmed');
      mocks.create.mockRejectedValue(new Error('connection lost'));
      const result = await detectCrisis(HARD_TEXT, 'en-US', WHO);
      await expect(recordCrisisShown(result, WHO)).resolves.toBeUndefined();
      expect(mocks.create).toHaveBeenCalledTimes(1);
    });

    it('records nothing for a message that matched nothing', async () => {
      await recordCrisisShown(await detectCrisis('Plan my week', 'en-GB', WHO), WHO);
      expect(mocks.create).not.toHaveBeenCalled();
    });
  });
});
