/**
 * The opening turn's id (f-onboarding t-122). Its own module, import-light, for
 * the reason `seats.ts` gives: the pane's client hook needs the value, and
 * `opening.ts` imports Prisma.
 *
 * Versioned: new opening words need a new id, because the turn ledger refuses
 * an id reused for a different message. See `opening.ts`, "Changing the words".
 */
export const OPENING_TURN_ID = 'app_opening_v1';
