/**
 * A leaning changed in conversation: the shape the account under a reply reads
 * (f-leanings t-137).
 *
 * `set_leaning` answers with one of these as its result's `data`. The account
 * says what moved and whether the person asked for it or agreed to a
 * suggestion, so it needs the call's outcome, not only its slug. Three paths
 * carry it, and all three read it here:
 *
 * - **Live**, off the `capability_result(s)` frame ({@link leaningChangeFromResult}).
 * - **Reload**, off the stored trace's `resultPreview`, which is the same
 *   result as JSON ({@link leaningChangeForCall}); the capability keeps it well
 *   under the platform's preview cap.
 * - **Replay**, which rebuilds the frame from the stored trace (`turns.ts`).
 *
 * Import-light, like `lib/app/resources/suggestion.ts`: the browser reads it.
 *
 * @see lib/app/voice/leaning-capability.ts — what writes it
 * @see lib/app/conversation/account.ts — what says it
 */

import { z } from 'zod';

import type { AnsweredCall } from '@/lib/app/agent/capability-answers';
import { leaningKeySchema, leaningStopSchema } from '@/lib/app/voice/leanings';

/** The capability's slug: the tool name the model calls. */
export const SET_LEANING_SLUG = 'set_leaning';

/**
 * How a call came about: the person asked; the AI proposed a change (which
 * moves nothing); or the person said yes to a proposal from their previous
 * turn.
 */
export const LEANING_CHANGE_HOWS = ['asked', 'proposed', 'agreed'] as const;
export type LeaningChangeHow = (typeof LEANING_CHANGE_HOWS)[number];

/**
 * One call's outcome: the dial, where it applied before and where it applies
 * (or, for a proposal, would apply) after, both inside the bounds, and how it
 * came about. `from === to` on an ask is a change that moved nothing, because
 * the dial was already as far as it goes. A proposal never moves the dial.
 */
export const leaningChangeSchema = z.object({
  leaning: leaningKeySchema,
  from: leaningStopSchema,
  to: leaningStopSchema,
  how: z.enum(LEANING_CHANGE_HOWS),
});

export type LeaningChange = z.infer<typeof leaningChangeSchema>;

const changeResultSchema = z.object({ success: z.literal(true), data: leaningChangeSchema });

/** The change a `set_leaning` result carries, or `null` for one that refused or is not one. */
export function leaningChangeFromResult(result: unknown): LeaningChange | null {
  const parsed = changeResultSchema.safeParse(result);
  return parsed.success ? parsed.data.data : null;
}

/** The change one answered call made, read from its stored preview; `null` for any other call. */
export function leaningChangeForCall(call: AnsweredCall): LeaningChange | null {
  if (call.slug !== SET_LEANING_SLUG || typeof call.resultPreview !== 'string') return null;
  try {
    return leaningChangeFromResult(JSON.parse(call.resultPreview));
  } catch {
    // A preview that is not JSON (truncated, or from a build that wrote another
    // shape) costs this call's sentence, not the account.
    return null;
  }
}
