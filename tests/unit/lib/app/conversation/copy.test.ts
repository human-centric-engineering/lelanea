/**
 * The monthly-limit ending's words (f-budget t-96).
 *
 * The frame carries figures, so the copy is a function — and every figure it
 * takes can be missing or unusable, because the client parses them leniently.
 * The property is that it always produces a sentence, never a hole: no
 * `$undefined`, no `Invalid Date`, no `$NaN`. And a limit of nothing is told
 * apart from a month used up, because the reset date would be a false promise
 * there.
 *
 * @see lib/app/conversation/copy.ts — `ceilingEnding`
 */

import { describe, expect, it } from 'vitest';

import { ceilingEnding } from '@/lib/app/conversation/copy';

const RESET = '2026-10-01T00:00:00.000Z';
const HOLES = /undefined|NaN|Invalid Date|null/;

describe('ceilingEnding', () => {
  it('says what was spent, the limit, the date, and that nothing else stopped', () => {
    expect(ceilingEnding({ spentUsd: 4, ceilingUsd: 4, resetsAt: RESET })).toBe(
      "That's this month's conversations used up — $4.00 of your $4.00 limit.\n" +
        'I can reply again from 1 October.\n' +
        'What you wrote is still in the box, and everything you can read and write here still works.'
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

  it('gives a limit of nothing no date — it will still be nothing next month', () => {
    const words = ceilingEnding({ spentUsd: 0, ceilingUsd: 0, resetsAt: RESET });
    expect(words).toContain('set to nothing');
    expect(words).not.toContain('October');
    expect(words).not.toContain('reply again');
    expect(words).toContain('still works');
  });

  it('still says what happened and when, with no figures at all', () => {
    const words = ceilingEnding(undefined);
    expect(words).toBe(
      "That's this month's conversations used up.\n" +
        'I can reply again from the start of next month.\n' +
        'What you wrote is still in the box, and everything you can read and write here still works.'
    );
  });

  it.each([
    ['a date that does not parse', { spentUsd: 4, ceilingUsd: 4, resetsAt: 'soon' }],
    ['a negative figure', { spentUsd: -1, ceilingUsd: 4, resetsAt: RESET }],
    ['an infinite limit', { spentUsd: 4, ceilingUsd: Infinity, resetsAt: RESET }],
    ['NaN spend', { spentUsd: NaN, ceilingUsd: 4, resetsAt: RESET }],
    ['only a date', { resetsAt: RESET }],
    ['only the amounts', { spentUsd: 4, ceilingUsd: 4 }],
  ])('drops only the clause it cannot state, given %s', (_case, figures) => {
    const words = ceilingEnding(figures);
    expect(words).not.toMatch(HOLES);
    expect(words.split('\n')).toHaveLength(3);
    expect(words).toContain('still works');
  });

  it('keeps each clause it CAN state when another is unusable', () => {
    // A bad date must not cost the figures, nor bad figures the date.
    expect(ceilingEnding({ spentUsd: 4, ceilingUsd: 4, resetsAt: 'soon' })).toContain(
      '$4.00 of your $4.00 limit'
    );
    expect(ceilingEnding({ spentUsd: -1, ceilingUsd: 4, resetsAt: RESET })).toContain(
      'from 1 October.'
    );
  });
});
