/**
 * What a request to delete exchanges (f-memory t-127), a session
 * (f-forget-session t-153) or a module's worth (t-155) may carry.
 *
 * The ids are `app_turn` record ids, which the notes read hands out per note.
 * Bounded so one request can't ask the transaction to walk an unbounded list:
 * a note's exchanges are the turns that wrote its versions, which is a handful.
 */

import { z } from 'zod';

import { cuidSchema, slugSchema } from '@/lib/validations/common';

/** The most exchanges one request may delete. */
export const MAX_EXCHANGES_PER_REQUEST = 50;

export const exchangeDeletionSchema = z.strictObject({
  exchangeIds: z
    .array(cuidSchema)
    .min(1, 'Name at least one exchange to delete.')
    .max(MAX_EXCHANGES_PER_REQUEST, `At most ${MAX_EXCHANGES_PER_REQUEST} exchanges at a time.`),
});

export type ExchangeDeletionRequest = z.infer<typeof exchangeDeletionSchema>;

/**
 * A session's id, as `sessionEventId` (`sessions/store.ts`) derives it: `ses_`
 * and 32 hex digits (f-forget-session t-153).
 */
export const sessionIdSchema = z.string().regex(/^ses_[0-9a-f]{32}$/, 'That is not a session id.');

/** What a request to delete a session carries. */
export const sessionDeletionSchema = z.strictObject({
  /** Remove the session's kept account too. Ticked by default where it is offered (owner ruling 1). */
  removeAccount: z.boolean(),
});

export type SessionDeletionRequest = z.infer<typeof sessionDeletionSchema>;

/**
 * A module's slug, as `moduleSlugFromId` (`modules/definitions.ts`) derives it
 * and `app_turn.moduleSlug` stamps it: `values`, `inner-authority` (t-155).
 */
export const moduleSlugSchema = slugSchema.max(80, 'That is not a module.');
