/**
 * "May this person start a turn she answers?" (f-safety t-59).
 *
 * The meter is mocked: what is proved here is the comparison and the reset
 * date. The wiring — no claim, no model call, a replay still served — is in
 * `turns.test.ts`, against the real turn seam and a stateful cost log.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
});
