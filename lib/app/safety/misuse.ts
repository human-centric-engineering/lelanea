/**
 * An attempt on one of her seats is written down (f-safety t-60).
 *
 * The platform's inline guards run on every turn. On her seats they are pinned
 * to observe (`GUARD_MODES`), so a detection never stops a turn, and without an
 * observer it would reach nothing but a log line. Two observers pick it up:
 *
 * - **Daybreak's escalation contributor** turns an input-guard detection into a
 *   notification plus an audit entry, driven by the policies her seed writes
 *   (`ESCALATION_POLICIES`).
 * - **This one** writes it to the safety record, beside the crisis events, so the
 *   person's own export shows it (Art. 15) and it is erased with their account.
 *
 * **Only the input guard.** It is the one that reads what the PERSON wrote. The
 * output and citation guards read her reply, so a hit there is about her, not an
 * attempt by them, and a row in their safety record saying otherwise would be
 * false. It would also reach them in their Art. 15 export under wording that
 * calls it theirs. A guard an operator switched off (`none`) emits an event with
 * nothing flagged in it and is not recorded either.
 *
 * Registered through `lib/app/guard-event-contributors.ts`. Contributors run
 * fire-and-forget after the guard has acted. This one also catches its own
 * failure, so a failed write is logged with every field except the person.
 */

import type { GuardEvent, GuardEventContext } from '@/lib/orchestration/chat/guard-events';
import { FACILITATION_SURFACE_CONTEXT_TYPE } from '@/lib/framework/facilitation/agents/surface';
import { logger } from '@/lib/logging';
import { SEATED_ROLES } from '@/lib/app/agent/pins';
import { recordMisuseEvent } from '@/lib/app/safety/record';

/** The registry key. Exported so the seam's test asserts the registration by name. */
export const MISUSE_RECORD_CONTRIBUTOR = 'lelanea:misuse-record';

export async function recordGuardDetection(
  ctx: GuardEventContext,
  event: GuardEvent
): Promise<void> {
  if (ctx.contextType !== FACILITATION_SURFACE_CONTEXT_TYPE || !ctx.contextId) return;
  if (!SEATED_ROLES.includes(ctx.contextId)) return;
  if (event.guard !== 'input' || event.outcome === 'none') return;

  try {
    await recordMisuseEvent({
      userId: ctx.userId,
      seat: ctx.contextId,
      guard: event.guard,
      guardOutcome: event.outcome,
    });
  } catch (err) {
    logger.error('misuse record: could not write the safety event', {
      seat: ctx.contextId,
      guard: event.guard,
      guardOutcome: event.outcome,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
