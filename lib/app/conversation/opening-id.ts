/**
 * The ids of the turns the agent opens: the welcome (f-onboarding t-122) and
 * each session's recap (f-recap t-142). Their own module, import-light, for
 * the reason `seats.ts` gives: the pane's client hook needs the values, and
 * `opening.ts` and `recap.ts` import Prisma.
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

/**
 * The prefix of a session recap's turn id (f-recap t-142): the AI opens each
 * new session after the first with what changed since the last one
 * (`recap.ts`). Versioned as {@link OPENING_TURN_ID} is, and for the same
 * reason: the ledger refuses an id reused for different words.
 */
export const RECAP_TURN_ID_PREFIX = 'app_recap_';

const RECAP_TURN_ID_VERSION = `${RECAP_TURN_ID_PREFIX}v1_`;

/**
 * The recap's turn id for one session: keyed on the session, so it is given
 * once per sitting and a reload inside the sitting replays it rather than
 * running a second one.
 */
export function recapTurnId(sessionId: string): string {
  return `${RECAP_TURN_ID_VERSION}${sessionId}`;
}

/** Whether a turn id is a recap's, of any version. */
export function isRecapTurnId(turnId: string): boolean {
  return turnId.startsWith(RECAP_TURN_ID_PREFIX);
}

/**
 * Whether the agent opened the turn: the opening after onboarding or a session
 * recap. Such a turn has no row of the person's to bound its reply by, so what
 * finds the reply reads from the claim instead (`turnWindowStart`).
 */
export function isAgentOpenedTurnId(turnId: string): boolean {
  return isOpeningTurnId(turnId) || isRecapTurnId(turnId);
}
