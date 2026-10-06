/**
 * Where one sitting ends and the next begins (f-recap t-141).
 *
 * Owner ruling, 6 Oct 2026 (journalled on f-recap): **a session starts when the
 * person arrives, or takes a turn, after twelve hours with no turn.** One quiet
 * day is one sitting. The number matches the register lean's sitting
 * (`LEAN_HOLD_HOURS`), and deliberately not Daybreak's 30-minute engagement
 * dwell gap, which measures something else: how long a person stayed, not
 * whether they came back.
 *
 * Pure, so the rule is table-tested on its own (`fp6`); `store.ts` reads the
 * two times it needs and writes what it decides.
 */

/** The quiet that ends a sitting. */
export const SESSION_GAP_HOURS = 12;

const SESSION_GAP_MS = SESSION_GAP_HOURS * 60 * 60 * 1000;

/** What an arrival does. */
export type SessionDecision =
  /** No session has ever started: open the first. Nothing to close. */
  | { kind: 'open' }
  /** Inside the current sitting: write nothing. */
  | { kind: 'resume' }
  /** The current sitting went quiet: close it at its last activity, then open the next. */
  | { kind: 'roll'; closeAt: Date };

/**
 * Decide what an arrival at `now` does.
 *
 * The current sitting's last activity is its own start or the person's latest
 * turn, whichever is later. Its start counts so that an arrival with no turn
 * after it still holds the sitting open for twelve hours, and a sitting that
 * had no turns closes at the moment it began rather than at a turn from an
 * earlier one.
 *
 * **Twelve hours exactly is a new sitting.** A gap of at least
 * {@link SESSION_GAP_HOURS} rolls; anything shorter resumes. A clock that
 * reads earlier than the last activity (skew between instances) resumes.
 *
 * @param current - the latest session's start, or null when there has never been one
 * @param lastTurnAt - when the person's latest turn finished (or began, while it runs)
 */
export function decideSession(
  current: { startedAt: Date } | null,
  lastTurnAt: Date | null,
  now: Date
): SessionDecision {
  if (!current) return { kind: 'open' };
  const lastActivity =
    lastTurnAt && lastTurnAt.getTime() > current.startedAt.getTime()
      ? lastTurnAt
      : current.startedAt;
  return now.getTime() - lastActivity.getTime() >= SESSION_GAP_MS
    ? { kind: 'roll', closeAt: lastActivity }
    : { kind: 'resume' };
}
