/**
 * The sitting the person is in, as the conversation pane offers to delete it
 * (f-forget-session t-158).
 *
 * The journey view offers "Delete this session" on synopsis stops only (owner
 * ruling, 8 Oct 2026), and the current session has no synopsis until it
 * closes. So the pane offers it for the current one (owner ruling at t-158's
 * start), and needs two things the transcript read does not carry: which
 * session that is, and whether the person has said anything in it.
 *
 * **Read after arriving**, as the pane's transcript read is, so "current" is
 * the sitting the person is in rather than one that went quiet twelve hours
 * ago and has not been closed yet (`readSessions`). Within a sitting the
 * arrival writes nothing.
 *
 * **"Said anything" means a turn of the person's**: one stamped with the
 * session that the AI did not open. A sitting holding only the AI's recap or
 * welcome has nothing of theirs to delete, and deleting it would only bring
 * the recap straight back (`recap.ts` owes one to a sitting with nothing said
 * in it), so the pane offers nothing there.
 *
 * @see lib/app/memory/delete-session.ts — what the delete takes
 * @see app/api/v1/app/sessions/current/route.ts — the read
 */

import { prisma } from '@/lib/db/client';
import { OPENING_TURN_ID_PREFIX, RECAP_TURN_ID_PREFIX } from '@/lib/app/conversation/opening-id';
import { arriveSessionQuietly, type ArrivalOptions } from '@/lib/app/sessions/store';

/** The current sitting, as the pane's offer needs it. */
export interface CurrentSession {
  /** The `session.started` row's id: what `DELETE /api/v1/app/sessions/:id` takes. */
  id: string;
  /** Whether a turn of the person's is stamped with it, on either seat. */
  hasTurns: boolean;
}

/**
 * The person's current session, or null when it could not be arrived at (the
 * arrival is logged where it failed). Never throws for the arrival; the turn
 * read is a plain query.
 */
export async function readCurrentSession(
  userId: string,
  options: ArrivalOptions = {}
): Promise<CurrentSession | null> {
  const arrival = await arriveSessionQuietly(userId, undefined, options);
  if (!arrival) return null;
  const own = await prisma.appTurn.findFirst({
    where: {
      userId,
      sessionId: arrival.session.id,
      NOT: [
        { turnId: { startsWith: OPENING_TURN_ID_PREFIX } },
        { turnId: { startsWith: RECAP_TURN_ID_PREFIX } },
      ],
    },
    select: { id: true },
  });
  return { id: arrival.session.id, hasTurns: own !== null };
}
