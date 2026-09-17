/**
 * The comparison surface's wire contract.
 *
 * Small on purpose — the surface has one write (queue a comparison, which takes
 * no body at all) and one read that needs validating: which comparison, and
 * optionally which other one to put beside it.
 *
 * @see lib/app/voice/comparison-admin.ts — what the read feeds
 * @see app/api/v1/admin/app/voice/comparisons/route.ts
 */

import { z } from 'zod';

/**
 * How many comparisons may be shown side by side.
 *
 * Two, and the cap is a design decision rather than a performance one: three
 * columns of prose at the widths an admin table actually has stop being readable,
 * and the question this surface answers — *did this change make her better or
 * worse?* — is a comparison between two things. Each comparison already brings
 * its own bare arm, so two comparisons is four columns.
 */
export const MAX_COMPARISONS_SIDE_BY_SIDE = 2;

/**
 * The optional second comparison, read off `?against=<id>`.
 *
 * Deliberately a separate parameter rather than a repeated or comma-joined id
 * list. The primary comparison is in the path, so the query carries exactly one
 * more thing, and a caller cannot express "show me five" and be silently given
 * two.
 */
export const voiceComparisonQuerySchema = z.object({
  against: z.string().trim().min(1).optional(),
});

export type VoiceComparisonQuery = z.infer<typeof voiceComparisonQuerySchema>;

/**
 * The `status` an arm reports once the run behind it is gone.
 *
 * Deliberately not one of the platform's own statuses: `AiEvaluationRun.status`
 * has no value for "deleted", because the row that would carry it is what was
 * deleted. The arm outlives its run on purpose, so this is the word for the half
 * that did not — distinct from `queued`, which the same absent numbers would
 * otherwise look exactly like.
 *
 * It lives here rather than in `comparison-admin.ts` for the same reason
 * `endpoint.ts` exists: the board that renders this status is a client
 * component, and that module imports Prisma — which builds a `pg.Pool` at
 * import time and cannot be bundled for a browser. A status the client
 * compares against is part of the wire contract, so this is its home.
 */
export const VOICE_RUN_DELETED_STATUS = 'run-deleted';
