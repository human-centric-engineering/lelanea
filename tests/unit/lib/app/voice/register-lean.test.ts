/**
 * A person's lean (f-registers t-126): read off the module node's ledger, for
 * a sitting, and written through Daybreak's progress seam.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/framework/facilitation/journey/progress', () => ({
  recordNodeProgress: vi.fn(),
}));

import { recordNodeProgress } from '@/lib/framework/facilitation/journey/progress';
import {
  LEAN_HOLD_HOURS,
  LEAN_PROGRESS_KEY,
  leanInForce,
  leanLapsesAt,
  recordRegisterLean,
} from '@/lib/app/voice/register-lean';

const record = vi.mocked(recordNodeProgress);
const NOW = new Date('2026-10-02T12:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('leanInForce', () => {
  it('reads a lean asked within the sitting', () => {
    const progress = { [LEAN_PROGRESS_KEY]: { register: 'guiding', askedAt: hoursAgo(1) } };
    expect(leanInForce(progress, NOW)).toBe('guiding');
  });

  it('lets it lapse after the hold, and not before', () => {
    const at = (hours: number) => ({
      [LEAN_PROGRESS_KEY]: { register: 'teaching', askedAt: hoursAgo(hours) },
    });
    expect(leanInForce(at(LEAN_HOLD_HOURS - 0.01), NOW)).toBe('teaching');
    expect(leanInForce(at(LEAN_HOLD_HOURS + 0.01), NOW)).toBeNull();
  });

  it('reads a cleared lean, no lean, a lean from the future or an odd shape as none', () => {
    // Population first: the same ledger with a lean in force reads one.
    expect(
      leanInForce({ [LEAN_PROGRESS_KEY]: { register: 'guiding', askedAt: hoursAgo(0) } }, NOW)
    ).toBe('guiding');
    expect(leanInForce({ [LEAN_PROGRESS_KEY]: null }, NOW)).toBeNull();
    expect(leanInForce({ other: 1 }, NOW)).toBeNull();
    expect(leanInForce(null, NOW)).toBeNull();
    expect(
      leanInForce({ [LEAN_PROGRESS_KEY]: { register: 'guiding', askedAt: hoursAgo(-1) } }, NOW)
    ).toBeNull();
    expect(
      leanInForce({ [LEAN_PROGRESS_KEY]: { register: 'stern', askedAt: hoursAgo(1) } }, NOW)
    ).toBeNull();
  });

  it('says when a lean lapses', () => {
    expect(leanLapsesAt(NOW).toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });
});

describe('recordRegisterLean', () => {
  it('writes the lean on the module’s node, as the person, under one flat key', async () => {
    record.mockResolvedValue({ ok: true, nodeState: {} as never });

    await expect(recordRegisterLean('u1', 'values', 'guiding', NOW)).resolves.toBe('recorded');
    expect(record).toHaveBeenCalledWith(
      { userId: 'u1' },
      { userId: 'u1', graphSlug: 'lelanea-journey' },
      'values',
      { [LEAN_PROGRESS_KEY]: { register: 'guiding', askedAt: NOW.toISOString() } }
    );
  });

  it('clears it with a tombstone, since the seam merges and cannot delete', async () => {
    record.mockResolvedValue({ ok: true, nodeState: {} as never });

    await recordRegisterLean('u1', 'values', null, NOW);
    expect(record.mock.calls[0][3]).toEqual({ [LEAN_PROGRESS_KEY]: null });
  });

  it('answers no_module when the node was never entered', async () => {
    record.mockResolvedValue({
      ok: false,
      rejection: { code: 'node_not_entered', message: 'no' },
    });

    await expect(recordRegisterLean('u1', 'values', 'guiding', NOW)).resolves.toBe('no_module');
  });
});
