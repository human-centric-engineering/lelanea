/**
 * The monthly-limit ending's words (f-budget t-96).
 *
 * The frame carries figures, so the copy is a function — and each figure can
 * arrive missing, because `events.ts` drops an unusable one on its own. The
 * properties: every form is a sentence with no hole in it; a missing spend or
 * date costs only its own clause; a limit of nothing gets no date; and without
 * the limit there are no words of hers at all (`null`), so the row shows the
 * frame's own, which the server built truthfully.
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

  it('gives a limit of nothing no date — it will be the same next month', () => {
    const words = ceilingEnding({ spentUsd: 0, ceilingUsd: 0, resetsAt: RESET });
    expect(words).toBe(
      "Your limit for conversations is set to nothing at the moment, so I can't reply.\n" +
        STILL_WORKS
    );
  });

  it('keeps the date for a limit under a cent — the gate lets a reply through after the reset', () => {
    // `ceiling.ts` allows a turn while spend < a positive limit, so $0.004 is
    // NOT nothing: on the 1st one reply runs. "Set to nothing" would deny it.
    expect(ceilingEnding({ spentUsd: 0.004, ceilingUsd: 0.004, resetsAt: RESET })).toContain(
      'I can reply again from 1 October.'
    );
  });

  it('has no words without the limit, so the frame\u2019s true ones are shown', () => {
    expect(ceilingEnding({ spentUsd: 4, resetsAt: RESET })).toBeNull();
    expect(ceilingEnding({})).toBeNull();
    expect(ceilingEnding(undefined)).toBeNull();
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

  it('never prints a hole, whichever of the spend and the date is missing', () => {
    const shapes = [
      { ceilingUsd: 4 },
      { spentUsd: 4, ceilingUsd: 4 },
      { ceilingUsd: 4, resetsAt: RESET },
      { spentUsd: 4, ceilingUsd: 4, resetsAt: RESET },
    ];
    for (const figures of shapes) {
      const words = ceilingEnding(figures) ?? '';
      expect(words).not.toMatch(HOLES);
      expect(words.endsWith(STILL_WORKS)).toBe(true);
    }
  });
});
