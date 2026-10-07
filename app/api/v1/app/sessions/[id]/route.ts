/**
 * Deleting one of my sessions (f-forget-session t-153).
 *
 * - `DELETE /api/v1/app/sessions/:id` — `{ removeAccount }`: delete the
 *   session, the caller's own, with everything derived from it: every turn
 *   stamped with it, the recaps that looked back on it, its draft account, and
 *   its kept account when `removeAccount` is true (flagged when it is false).
 *   All or nothing. A session id that is not the caller's gets the same 404 as
 *   one that does not exist, and a turn still being answered gets a 409 that
 *   says to wait.
 *
 * The response says how many exchanges and messages went and what became of
 * the account, and **not** how many note versions, for the reason the
 * exchanges route gives: a count that included a hidden slot would tell the
 * person one exists. The log carries it, for the operator.
 *
 * Authentication: required. Rate limiting: inherited from the `/api/v1/**`
 * section cap in `proxy.ts`. A deletion is a bounded transaction on the
 * caller's own rows, so it gets no per-flow sub-cap.
 *
 * @see lib/app/memory/delete-session.ts
 * @see .context/app/slots.md — "Deleting a session"
 */

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { validatePathParam, validateRequestBody } from '@/lib/api/validation';
import { withAuth, type WithAuthOptions } from '@/lib/auth/guards';
import { deleteSession } from '@/lib/app/memory/delete-session';
import { sessionDeletionSchema, sessionIdSchema } from '@/lib/app/memory/validation';

/**
 * Ownership: self-scoped by construction. Deliberately **not** `'policy'`, for
 * the reason the exchanges route gives: an admin widening would hand an
 * operator a delete over someone else's conversation.
 */
const OWNERSHIP: WithAuthOptions = {
  ownership: {
    decidedBy: 'self',
    because:
      "The deletion reads the session, its turns, messages, note versions and account under the caller's own id; a session id that is not theirs is refused as not found.",
  },
};

export const DELETE = withAuth<{ id: string }>(async (request, session, { params }) => {
  const log = await getRouteLogger(request);
  const { id: raw } = await params;
  const sessionId = validatePathParam(raw, sessionIdSchema, { label: 'session id' });
  const body = await validateRequestBody(request, sessionDeletionSchema);
  const deleted = await deleteSession({
    userId: session.user.id,
    sessionId,
    removeAccount: body.removeAccount,
  });

  log.info('Session deleted by the person who had it', {
    userId: session.user.id,
    exchanges: deleted.exchanges,
    messages: deleted.messages,
    versions: deleted.versions,
    recaps: deleted.recaps,
    account: deleted.account,
  });

  return successResponse({
    exchanges: deleted.exchanges,
    messages: deleted.messages,
    account: deleted.account,
  });
}, OWNERSHIP);
