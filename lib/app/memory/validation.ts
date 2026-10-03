/**
 * What a request to delete exchanges may carry (f-memory t-127).
 *
 * The ids are `app_turn` record ids, which the notes read hands out per note.
 * Bounded so one request can't ask the transaction to walk an unbounded list:
 * a note's exchanges are the turns that wrote its versions, which is a handful.
 */

import { z } from 'zod';

import { cuidSchema } from '@/lib/validations/common';

/** The most exchanges one request may delete. */
export const MAX_EXCHANGES_PER_REQUEST = 50;

export const exchangeDeletionSchema = z.strictObject({
  exchangeIds: z
    .array(cuidSchema)
    .min(1, 'Name at least one exchange to delete.')
    .max(MAX_EXCHANGES_PER_REQUEST, `At most ${MAX_EXCHANGES_PER_REQUEST} exchanges at a time.`),
});

export type ExchangeDeletionRequest = z.infer<typeof exchangeDeletionSchema>;
