/**
 * The opening — the AI speaks first (f-onboarding t-122, f-recap t-142)
 *
 * POST /api/v1/app/conversation/opening — no body. Streams (SSE) the
 * facilitator's opening reply, as the role route streams a turn.
 *
 * The pane calls this when the transcript read says `opening: true`. Which
 * opening is the server's to decide: the welcome after onboarding, when
 * nothing has ever been said on the seat; otherwise the recap that opens a new
 * session. The two never overlap — the welcome needs nothing ever said, the
 * recap an earlier exchange. The words are written on the server; nothing the
 * client sends reaches them, and a body is ignored. The rules are in
 * `lib/app/conversation/opening.ts` and `recap.ts`.
 *
 * - **Not owed** (not past the gate, not handed off, or something already said
 *   on the facilitator seat — ever, for the welcome; in this session, for the
 *   recap): `409` with reason `opening_not_due`.
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
import { prepareRecap, runRecap } from '@/lib/app/conversation/recap';

export const POST = withAuth(
  async (request, session) => {
    if (isApiKeySession(session)) {
      throw new ForbiddenError('Only a signed-in person can be spoken to.');
    }
    const userId = session.user.id;

    const log = await getRouteLogger(request);
    const turnRequest = {
      user: session.user,
      requestId: await getRequestId(),
      visitorId: await getVisitorId(),
      signal: request.signal,
      keepAlive: (work: Promise<unknown>) => after(work),
      headers: request.headers,
    };

    const welcome = await prepareOpening(session.user);
    if (welcome.ready) {
      log.info('Opening started', { userId, seat: CONVERSATION_SEAT, kind: 'welcome' });
      const events = await runOpening(welcome.surface, turnRequest);
      return sseResponse(events, { signal: request.signal });
    }

    const recap = await prepareRecap(session.user);
    if (!recap.ready) {
      // The welcome's reason when it had a surface to refuse on, so a seat
      // with no agent is a 404 whichever opening was asked about.
      const reason = welcome.reason === 'no_surface' ? welcome.reason : recap.reason;
      log.info('Opening not started', { userId, reason });
      if (reason === 'no_surface') {
        throw new NotFoundError('The conversation has no agent to speak just now.');
      }
      throw new ConflictError('There is no opening to give.', { reason: OPENING_NOT_DUE });
    }

    log.info('Opening started', {
      userId,
      seat: CONVERSATION_SEAT,
      kind: 'recap',
      words: recap.material.account.words,
      notes: recap.material.account.notes.length,
      journey: recap.material.account.journey,
    });
    const events = await runRecap(recap, turnRequest);
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
