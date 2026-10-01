/**
 * Begin the Journey — the Hand-off from Onboarding
 *
 * POST /api/v1/app/onboarding/begin — no body.
 *
 * §3.9 ends onboarding with "Begin the journey": the caller's onboarding node
 * is completed and Values entered, through Daybreak's `applyJourneyTransition`
 * (`lib/app/onboarding/hand-off.ts`, f-onboarding t-106).
 *
 * - **Only once the discovery set is behind them**: every question in the
 *   caller's current set answered or skipped. Otherwise a `400`.
 * - **Repeating it writes nothing**: `{ outcome: 'already' }`.
 * - **A transition the engine refuses** (Values not live, the map not
 *   published) is a `409`. Nothing is left half-done that a press again
 *   would not finish.
 *
 * The answer names where the person goes next, so the client does not keep a
 * second copy of the path.
 *
 * Authentication: `withAuth`. Refuses an API key: beginning a person's
 * journey is that person's own act.
 *
 * Rate limiting: inherited from the `/api/v1/**` section cap.
 */

import type { NextRequest } from 'next/server';
import { withAuth, type AuthSession } from '@/lib/auth/guards';
import { isApiKeySession } from '@/lib/auth/api-keys';
import { successResponse } from '@/lib/api/responses';
import { ConflictError, ForbiddenError, ValidationError, handleAPIError } from '@/lib/api/errors';
import { getRouteLogger } from '@/lib/api/context';
import { VALUES_NODE_KEY } from '@/lib/app/journey/map-definition';
import { beginJourney } from '@/lib/app/onboarding/hand-off';

export const POST = withAuth(
  async (request: NextRequest, session: AuthSession) => {
    const log = await getRouteLogger(request);
    const userId = session.user.id;
    try {
      if (isApiKeySession(session)) {
        throw new ForbiddenError('Only a signed-in person can begin their journey.');
      }
      const outcome = await beginJourney(userId);
      log.info('Journey begin requested', { userId, outcome });

      if (outcome === 'not_finished') {
        throw new ValidationError('There are still discovery questions to answer or skip first.', {
          discovery: ['Not every question in the current set is answered or skipped'],
        });
      }
      if (outcome === 'unavailable') {
        throw new ConflictError('The journey cannot be begun right now.');
      }
      if (outcome === 'failed') throw new Error('The journey could not be begun');

      return successResponse({ outcome, next: `/app/modules/${VALUES_NODE_KEY}` });
    } catch (error) {
      return handleAPIError(error);
    }
  },
  {
    ownership: {
      decidedBy: 'self',
      because:
        "Every read and transition is keyed on the caller's own id: their journey, their answers. Nothing here names another subject.",
    },
  }
);
