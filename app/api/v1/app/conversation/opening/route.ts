/**
 * The opening — the AI speaks first after onboarding (f-onboarding t-122)
 *
 * POST /api/v1/app/conversation/opening — no body. Streams (SSE) the
 * facilitator's opening reply, as the role route streams a turn.
 *
 * The pane calls this when the transcript read says `opening: true`. The
 * message is written on the server (`OPENING_MESSAGE`); nothing the client
 * sends reaches it, and a body is ignored. The rules are in
 * `lib/app/conversation/opening.ts`.
 *
 * - **Not owed** (not past the gate, not handed off, or the person has already
 *   spoken on the facilitator seat): `409` with reason `opening_not_due`.
 * - **Already running**: `409` with reason `turn_in_flight`, from the turn hook.
 * - **Already completed**: the recorded reply again, with no model call.
 * - **No facilitator agent to speak**: `404`, as the role route answers.
 *
 * Authentication: `withAuth`. Refuses an API key: the opening is spoken to a
 * person, in their own conversation.
 *
 * Rate limiting: the `/api/v1/**` section cap only. The chat sub-caps the role
 * route applies are deliberately not here: they exist to bound model calls, and
 * the ledger already bounds this route to one per person (a repeat is a 409 or
 * a replay). Charging them would let the pane's polling of an opening still in
 * flight use up the person's chat allowance, so their first real message met a
 * 429 (t-122 review round 1).
 */

import { after } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { isApiKeySession } from '@/lib/auth/api-keys';
import { sseResponse } from '@/lib/api/sse';
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors';
import { getRouteLogger } from '@/lib/api/context';
import { getRequestId, getVisitorId } from '@/lib/logging/context';
import { CONVERSATION_SEAT } from '@/lib/app/conversation/seats';
import { OPENING_NOT_DUE, prepareOpening, runOpening } from '@/lib/app/conversation/opening';

export const POST = withAuth(
  async (request, session) => {
    if (isApiKeySession(session)) {
      throw new ForbiddenError('Only a signed-in person can be spoken to.');
    }
    const userId = session.user.id;

    const log = await getRouteLogger(request);
    const prepared = await prepareOpening(session.user);
    if (!prepared.ready) {
      log.info('Opening not started', { userId, reason: prepared.reason });
      if (prepared.reason === 'no_surface') {
        throw new NotFoundError('The conversation has no agent to speak just now.');
      }
      throw new ConflictError('There is no opening to give.', { reason: OPENING_NOT_DUE });
    }

    log.info('Opening started', { userId, seat: CONVERSATION_SEAT });
    const events = await runOpening(prepared.surface, {
      user: session.user,
      requestId: await getRequestId(),
      visitorId: await getVisitorId(),
      signal: request.signal,
      keepAlive: (work) => after(work),
      headers: request.headers,
    });
    return sseResponse(events, { signal: request.signal });
  },
  {
    ownership: {
      decidedBy: 'self',
      because:
        "The opening is a turn on the caller's own facilitator conversation, resolved and recorded under the caller's id. Nothing here names another subject.",
    },
  }
);
