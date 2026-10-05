/**
 * The leaning changes the AI proposed in the person's previous turn
 * (f-leanings t-137; owner ruling, 5 Oct 2026).
 *
 * A proposal is a `set_leaning` call with `how: proposed`, which writes
 * nothing: its answered trace on the turn's reply is the record. Two readers:
 *
 * - `set_leaning` with `how: agreed` is refused unless the previous turn
 *   proposed the same change, so a yes always comes in a message of the
 *   person's own, after the proposal was put to them.
 * - The per-turn leanings block names a proposal awaiting an answer, so the AI
 *   knows to act on a yes (`leaning-context.ts`).
 *
 * Only the turn immediately before: a yes answers the reply it follows.
 *
 * And a third: the turn seam asks {@link proposedRecently} at the claim, so the
 * cached block never carries an awaiting proposal past the turn that answered
 * it (/code-review).
 *
 * @see lib/app/voice/leaning-capability.ts
 */

import { prisma } from '@/lib/db/client';
import { answeredCalls } from '@/lib/app/agent/capability-answers';
import { leaningChangeForCall, type LeaningChange } from '@/lib/app/voice/leaning-change';

/**
 * The proposals the person's last finished turn on the seat made. Empty when
 * that turn did not complete, or proposed nothing.
 *
 * A turn still running is never "the previous turn": it is this one, or one
 * racing it. `excludeTurnId` names this turn as well, for a caller inside it.
 */
export async function previousProposals(
  userId: string,
  seat: string,
  excludeTurnId?: string
): Promise<LeaningChange[]> {
  const previous = await prisma.appTurn.findFirst({
    where: {
      userId,
      seat,
      status: { not: 'running' },
      ...(excludeTurnId !== undefined && { turnId: { not: excludeTurnId } }),
    },
    orderBy: { startedAt: 'desc' },
    select: { status: true, assistantMessageId: true },
  });
  if (previous?.status !== 'completed' || !previous.assistantMessageId) return [];
  const reply = await prisma.aiMessage.findFirst({
    where: { id: previous.assistantMessageId, conversation: { userId } },
    select: { provenance: true },
  });
  return proposalsIn(reply?.provenance);
}

function proposalsIn(provenance: unknown): LeaningChange[] {
  return answeredCalls(provenance).flatMap((call) => {
    const change = leaningChangeForCall(call);
    return change?.how === 'proposed' ? [change] : [];
  });
}

/**
 * Whether either of the person's last two finished turns on the seat made a
 * proposal. Never throws; an unreadable answer is `true`.
 *
 * The context block is cached for a minute and names a proposal from the last
 * reply as awaiting an answer. A block built in the turn that ANSWERED it
 * still names it, so the turn after that must not be served it from the
 * cache: the proposal is then two replies back, and may have been declined.
 * Those are exactly the two turns whose block could carry the line, so a claim
 * that finds a proposal in either drops the cache. Unknown is "proposed", for
 * the reason the turn seam's own stamp read gives: a rebuild costs less than a
 * stale instruction.
 */
export async function proposedRecently(userId: string, seat: string): Promise<boolean> {
  try {
    const turns = await prisma.appTurn.findMany({
      where: { userId, seat, status: 'completed', assistantMessageId: { not: null } },
      orderBy: { startedAt: 'desc' },
      take: 2,
      select: { assistantMessageId: true },
    });
    const ids = turns.flatMap((turn) => (turn.assistantMessageId ? [turn.assistantMessageId] : []));
    if (ids.length === 0) return false;
    const replies = await prisma.aiMessage.findMany({
      where: { id: { in: ids }, conversation: { userId } },
      select: { provenance: true },
    });
    return replies.some((reply) => proposalsIn(reply.provenance).length > 0);
  } catch {
    return true;
  }
}
