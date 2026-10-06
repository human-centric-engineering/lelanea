/**
 * "May this person start a turn the agent answers?" (f-safety t-59).
 *
 * The meter is mocked: what is proved here is the comparison and the reset
 * date. The wiring — no claim, no model call, a replay still served — is in
 * `turns.test.ts`, against the real turn seam and a stateful cost log.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getMonthToDate } = vi.hoisted(() => ({ getMonthToDate: vi.fn() }));

vi.mock('@/lib/logging', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/app/agent/metering', () => ({ getMonthToDate }));

import { mayStartGeneratedTurn, nextMonthlyReset } from '@/lib/app/agent/ceiling';

function spent(costUsd: number, ceilingUsd: number): void {
  getMonthToDate.mockResolvedValue({ costUsd, ceiling: { ceilingUsd, source: 'default' } });
}

const NOW = new Date('2026-09-19T15:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mayStartGeneratedTurn', () => {
  it('allows a person under their ceiling', async () => {
    spent(4.99, 5);
    expect(await mayStartGeneratedTurn('user-1', NOW)).toEqual({ allowed: true });
    expect(getMonthToDate).toHaveBeenCalledWith('user-1', NOW);
  });

  it('refuses at the ceiling, with the figures and the next UTC month', async () => {
    spent(5, 5);
    expect(await mayStartGeneratedTurn('user-1', NOW)).toEqual({
      allowed: false,
      reason: 'ceiling_reached',
      spentUsd: 5,
      ceilingUsd: 5,
      resetsAt: new Date('2026-10-01T00:00:00Z'),
    });
  });

  it('treats a zero ceiling as "nothing may be spent"', async () => {
    spent(0, 0);
    expect(await mayStartGeneratedTurn('user-1', NOW)).toMatchObject({ allowed: false });
  });

  it('treats a negative ceiling the same way, rather than as no limit', async () => {
    // The budget route refuses one, but the gate is the last word on spend: a
    // rewrite that read a ceiling at or below zero as "no limit set" would let
    // a corrupt row allow every turn.
    spent(0, -1);
    expect(await mayStartGeneratedTurn('user-1', NOW)).toMatchObject({
      allowed: false,
      reason: 'ceiling_reached',
      ceilingUsd: -1,
    });
  });

  it('fails open when the meter cannot be read', async () => {
    getMonthToDate.mockRejectedValue(new Error('down'));
    expect(await mayStartGeneratedTurn('user-1', NOW)).toEqual({ allowed: true });
  });
});

describe('nextMonthlyReset', () => {
  it('rolls December over into January of the next year', () => {
    expect(nextMonthlyReset(new Date('2026-12-31T23:59:59Z'))).toEqual(
      new Date('2027-01-01T00:00:00Z')
    );
  });

  // The last day of a long month is where "add a month, then go to the 1st"
  // goes wrong: 31 January plus a month is 3 March, whose 1st is a month late.
  it.each([
    ['2026-01-31T12:00:00Z', '2026-02-01T00:00:00Z'],
    ['2026-03-31T12:00:00Z', '2026-04-01T00:00:00Z'],
    ['2026-08-31T12:00:00Z', '2026-09-01T00:00:00Z'],
    ['2028-02-29T12:00:00Z', '2028-03-01T00:00:00Z'],
  ])('resets on the 1st after the last day of a month (%s)', (now, reset) => {
    expect(nextMonthlyReset(new Date(now))).toEqual(new Date(reset));
  });

  it('moves to the month after next at the first instant of a month, not before', () => {
    expect(nextMonthlyReset(new Date('2026-09-30T23:59:59.999Z'))).toEqual(
      new Date('2026-10-01T00:00:00Z')
    );
    expect(nextMonthlyReset(new Date('2026-10-01T00:00:00.000Z'))).toEqual(
      new Date('2026-11-01T00:00:00Z')
    );
  });

  describe('on a machine whose clock is not in UTC', () => {
    const zone = process.env.TZ;
    afterEach(() => {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    });

    // The month resets on UTC wherever the person or the server is. Each
    // instant is in a different local month from its UTC one in that zone, so
    // a rewrite onto local getters lands a month off; on a UTC runner, with
    // no zone set, it would pass.
    it.each([
      ['Pacific/Auckland', '2026-09-30T14:00:00Z', '2026-10-01T00:00:00Z'],
      ['America/Los_Angeles', '2026-10-01T03:00:00Z', '2026-11-01T00:00:00Z'],
    ])('still resets on the UTC 1st in %s', (tz, now, reset) => {
      process.env.TZ = tz;
      expect(nextMonthlyReset(new Date(now))).toEqual(new Date(reset));
    });
  });
});
