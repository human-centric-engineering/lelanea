/**
 * Whether a person may start a turn she answers this month (f-safety t-59).
 *
 * §08 stored a monthly ceiling per person and could read what they had spent,
 * but nothing acted on it: a person could spend without limit (`HB9`). This is
 * the one question the turn seam asks — "may this person start a generated
 * turn; if not, why" — so the billing the owner expects later replaces this
 * module without touching `turns.ts`.
 *
 * **Asked before the turn, never during it.** A turn that starts under the
 * ceiling runs to its end, so the turn that crosses the line completes and may
 * overshoot by one turn's cost. That is the price of never cutting a reply off
 * mid-sentence, and it is accepted.
 *
 * **One turn's cost per turn in flight, strictly.** A turn's cost is recorded
 * when its model call ends and nothing is reserved at the check, so turns that
 * start together (two tabs, a client that does not wait) each pass it. Bounded
 * by how many turns one person runs at once. Trigger to revisit: a month-to-date
 * well past a ceiling in the admin cost view — then count the person's running
 * turns here before allowing another.
 *
 * **Fails open.** A read that errors counts as under the ceiling, as the pause
 * switch does: a database that cannot be read fails the turn by itself a moment
 * later, as `unavailable`, and a meter hiccup should not read as "you have used
 * your month".
 *
 * @see .context/app/agent.md — "The monthly limit"
 */

import { logger } from '@/lib/logging';
import { getMonthToDate } from '@/lib/app/agent/metering';

/** Why a generated turn may not start. One reason today; billing may add more. */
export type TurnAllowance =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'ceiling_reached';
      /** Spent this UTC month — may exceed the ceiling by the turn that crossed it. */
      spentUsd: number;
      ceilingUsd: number;
      /** When the month resets: the first instant of the next UTC month. */
      resetsAt: Date;
    };

/** The first instant of the UTC month after `now`. */
export function nextMonthlyReset(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * May this person start a turn she answers? At or over their effective ceiling
 * (their override, else the default), no. A ceiling of zero is a real answer:
 * nothing may be spent.
 */
export async function mayStartGeneratedTurn(
  userId: string,
  now: Date = new Date()
): Promise<TurnAllowance> {
  try {
    const usage = await getMonthToDate(userId, now);
    if (usage.costUsd < usage.ceiling.ceilingUsd) return { allowed: true };
    return {
      allowed: false,
      reason: 'ceiling_reached',
      spentUsd: usage.costUsd,
      ceilingUsd: usage.ceiling.ceilingUsd,
      resetsAt: nextMonthlyReset(now),
    };
  } catch (err) {
    logger.warn('Monthly ceiling could not be read; the turn is allowed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { allowed: true };
  }
}
