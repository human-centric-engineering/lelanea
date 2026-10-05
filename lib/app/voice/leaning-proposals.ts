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
  return answeredCalls(reply?.provenance).flatMap((call) => {
    const change = leaningChangeForCall(call);
    return change?.how === 'proposed' ? [change] : [];
  });
}
