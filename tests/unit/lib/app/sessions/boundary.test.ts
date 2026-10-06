/**
 * Where one sitting ends and the next begins (f-recap t-141).
 *
 * The rule is a pure function of the current session's start, the person's
 * latest turn and the clock, so it is a table.
 *
 * @see lib/app/sessions/boundary.ts
 */

import { describe, expect, it } from 'vitest';

import { decideSession, SESSION_GAP_HOURS } from '@/lib/app/sessions/boundary';

const HOUR = 60 * 60 * 1000;
const START = new Date('2026-10-01T09:00:00.000Z');
const at = (hoursAfterStart: number, ms = 0): Date =>
  new Date(START.getTime() + hoursAfterStart * HOUR + ms);

describe('decideSession', () => {
  it('is twelve hours, the sitting the register lean also holds for', () => {
    expect(SESSION_GAP_HOURS).toBe(12);
  });

  it('opens the first session, with nothing to close, when there has never been one', () => {
    // Turns from before sessions existed do not invent a phantom one to close.
    expect(decideSession(null, at(0), at(48))).toEqual({ kind: 'open' });
    expect(decideSession(null, null, at(0))).toEqual({ kind: 'open' });
  });

  it.each([
    ['a reload a minute after the last turn', at(1), at(1, 60_000)],
    ['just under twelve hours after the last turn', at(1), at(13, -1)],
    ['a turn still running (no completion yet), timed from its start', at(5), at(16)],
  ])('resumes on %s', (_label, lastTurnAt, now) => {
    expect(decideSession({ startedAt: START }, lastTurnAt, now)).toEqual({ kind: 'resume' });
  });

  it('rolls at exactly twelve hours, closing the sitting at its last turn', () => {
    const lastTurnAt = at(2);
    expect(decideSession({ startedAt: START }, lastTurnAt, at(14))).toEqual({
      kind: 'roll',
      closeAt: lastTurnAt,
    });
  });

  it('rolls long after, still closing at the last turn rather than at the arrival', () => {
    expect(decideSession({ startedAt: START }, at(3), at(24 * 7))).toEqual({
      kind: 'roll',
      closeAt: at(3),
    });
  });

  it('times a sitting with no turn of its own from its start, and closes it there', () => {
    // The latest turn belongs to an earlier sitting: it is older than this one's start.
    const earlierTurn = at(-30);
    expect(decideSession({ startedAt: START }, earlierTurn, at(12, -1))).toEqual({
      kind: 'resume',
    });
    expect(decideSession({ startedAt: START }, earlierTurn, at(12))).toEqual({
      kind: 'roll',
      closeAt: START,
    });
    expect(decideSession({ startedAt: START }, null, at(12))).toEqual({
      kind: 'roll',
      closeAt: START,
    });
  });

  it('resumes when this clock reads earlier than the last activity', () => {
    expect(decideSession({ startedAt: START }, at(1), at(0))).toEqual({ kind: 'resume' });
  });
});
