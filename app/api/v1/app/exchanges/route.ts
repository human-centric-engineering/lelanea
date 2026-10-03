/**
 * Deleting exchanges from a person's conversation (f-memory t-127).
 *
 * - `DELETE /api/v1/app/exchanges` — `{ exchangeIds }`: delete those exchanges,
 *   the caller's own, with everything derived from them: every message in each
 *   one's window, its turn record, and the note versions it wrote (each left as
 *   a placeholder). All or nothing. An id that is not the caller's gets the same
 *   404 as one that does not exist, and a turn still being answered gets a 409
 *   that says to wait.
 *
 * Offered from the notes page, after a note an exchange wrote is removed (owner
 * ruling 4, 3 Oct 2026). The ids are the ones the notes read hands out per note.
 *
 * The response says how many exchanges and messages went, and **not** how many
 * note versions. A turn can write a hidden slot, and a count that included it
 * would tell the person that one exists and was filled (§12). The log carries
 * it, for the operator.
 *
 * Authentication: required. Rate limiting: inherited from the `/api/v1/**`
 * section cap in `proxy.ts`. A deletion is a bounded transaction on the
 * caller's own rows, so it gets no per-flow sub-cap.
 *
 * @see lib/app/memory/delete-exchange.ts
 * @see .context/app/slots.md — "Deleting an exchange"
 */

import type { NextRequest } from 'next/server';

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { validateRequestBody } from '@/lib/api/validation';
import { withAuth, type WithAuthOptions } from '@/lib/auth/guards';
import { deleteExchanges } from '@/lib/app/memory/delete-exchange';
import { exchangeDeletionSchema } from '@/lib/app/memory/validation';

/**
 * Ownership: self-scoped by construction. Deliberately **not** `'policy'`, for
 * the reason the notes route gives: an admin widening would hand an operator a
 * delete over someone else's conversation.
 */
const OWNERSHIP: WithAuthOptions = {
  ownership: {
    decidedBy: 'self',
    because:
      "The deletion reads and deletes only turns, messages and note versions carrying the caller's own id; an id in the body that is not theirs is refused as not found.",
  },
};

export const DELETE = withAuth(async (request: NextRequest, session) => {
  const log = await getRouteLogger(request);
  const body = await validateRequestBody(request, exchangeDeletionSchema);
  const deleted = await deleteExchanges({
    userId: session.user.id,
    exchangeIds: body.exchangeIds,
  });

  log.info('Exchanges deleted by the person who had them', {
    userId: session.user.id,
    exchanges: deleted.exchanges,
    messages: deleted.messages,
    versions: deleted.versions,
  });

  return successResponse({ exchanges: deleted.exchanges, messages: deleted.messages });
}, OWNERSHIP);
