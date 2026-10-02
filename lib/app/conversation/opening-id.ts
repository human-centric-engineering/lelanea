/**
 * The opening turn's id (f-onboarding t-122). Its own module, import-light, for
 * the reason `seats.ts` gives: the pane's client hook needs the value, and
 * `opening.ts` imports Prisma.
 *
 * Versioned: new opening words need a new id, because the turn ledger refuses
 * an id reused for a different message. See `opening.ts`, "Changing the words".
 */
export const OPENING_TURN_ID = 'app_opening_v1';

/** Every opening id this app has used or will use: the prefix before the version. */
export const OPENING_TURN_ID_PREFIX = 'app_opening_';

/**
 * Whether a turn id is an opening's, of any version. What reads an opening's
 * rows (the transcript, the reply window) asks this rather than comparing with
 * the current id, so bumping the version leaves earlier openings read as
 * openings.
 */
export function isOpeningTurnId(turnId: string): boolean {
  return turnId.startsWith(OPENING_TURN_ID_PREFIX);
}
