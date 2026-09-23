/**
 * The monthly-limit ending's words (f-budget t-96).
 *
 * The frame carries figures, so the copy is a function — and each figure can
 * arrive missing, because `events.ts` drops an unusable one on its own. The
 * properties: every form is a sentence with no hole in it; a missing figure
 * costs only its own clause; and a date is named only where the month keeps
 * the promise — never for a limit of nothing, and never when the limit is
 * unknown and might be one.
 *
 * What counts as unusable (negative, non-finite, not an instant) is decided in
 * `events.test.ts`, where it is decided in the code.
 *
 * @see lib/app/conversation/copy.ts — `ceilingEnding`
 */

import { describe, expect, it } from 'vitest';

import { ceilingEnding } from '@/lib/app/conversation/copy';

const RESET = '2026-10-01T00:00:00.000Z';
const HOLES = /undefined|NaN|Invalid Date|null/;
const STILL_WORKS =
  'What you wrote is still in the box, and everything you can read and write here still works.';

describe('ceilingEnding', () => {
  it('says what was spent, the limit, the date, and that nothing else stopped', () => {
    expect(ceilingEnding({ spentUsd: 4, ceilingUsd: 4, resetsAt: RESET })).toBe(
      "That's this month's conversations used up — $4.00 of your $4.00 limit.\n" +
        'I can reply again from 1 October.\n' +
        STILL_WORKS
    );
  });

  it('states spend past the limit as it is, not clamped to the limit', () => {
    // The turn that crosses the line completes (t-59), so this is reachable.
    expect(ceilingEnding({ spentUsd: 4.07, ceilingUsd: 4, resetsAt: RESET })).toContain(
      '$4.07 of your $4.00 limit'
    );
  });

  it('reads the reset in UTC, so the 1st is the 1st wherever the reader is', () => {
    expect(
      ceilingEnding({ spentUsd: 4, ceilingUsd: 4, resetsAt: '2027-01-01T00:00:00.000Z' })
    ).toContain('from 1 January.');
  });

  it.each([
    ['zero', 0],
    ['under half a cent, which prints as $0.00', 0.004],
  ])('gives a limit of nothing (%s) no date — it will be the same next month', (_c, limit) => {
    const words = ceilingEnding({ spentUsd: 0, ceilingUsd: limit, resetsAt: RESET });
    expect(words).toBe(
      "Your limit for conversations is set to nothing at the moment, so I can't reply.\n" +
        STILL_WORKS
    );
  });

  it('names no date when the limit is unknown — it might be a limit of nothing', () => {
    const words = ceilingEnding({ spentUsd: 4, resetsAt: RESET });
    expect(words).toBe(
      "You've reached your limit for conversations, so I can't reply for now.\n" + STILL_WORKS
    );
  });

  it('says the same with no figures at all', () => {
    expect(ceilingEnding(undefined)).toBe(ceilingEnding({}));
    expect(ceilingEnding(undefined)).toContain("I can't reply for now");
  });

  it('drops only the amounts when the spend is unknown, and keeps the date', () => {
    expect(ceilingEnding({ ceilingUsd: 4, resetsAt: RESET })).toBe(
      "That's this month's conversations used up.\nI can reply again from 1 October.\n" +
        STILL_WORKS
    );
  });

  it('falls back to the start of next month when only the date is unknown', () => {
    const words = ceilingEnding({ spentUsd: 4, ceilingUsd: 4 });
    expect(words).toContain('$4.00 of your $4.00 limit');
    expect(words).toContain('I can reply again from the start of next month.');
  });

  it('never prints a hole, whichever figures are missing', () => {
    const shapes = [
      {},
      { spentUsd: 4 },
      { ceilingUsd: 4 },
      { resetsAt: RESET },
      { spentUsd: 4, ceilingUsd: 4 },
      { ceilingUsd: 4, resetsAt: RESET },
      { spentUsd: 4, resetsAt: RESET },
    ];
    for (const figures of shapes) {
      const words = ceilingEnding(figures);
      expect(words).not.toMatch(HOLES);
      expect(words.endsWith(STILL_WORKS)).toBe(true);
    }
  });
});
