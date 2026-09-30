/**
 * The First-Run Sequence — What the Caller Has Been Shown
 *
 * GET  /api/v1/app/onboarding/first-run — the beats recorded for the caller,
 *      and those still to come, in order.
 * POST /api/v1/app/onboarding/first-run — record that the caller has moved
 *      past one beat: `{ "beat": "initiation" }` or `{ "beat": "read:<id>" }`.
 *
 * The web shell renders the sequence server-side (`app/(lelanea)/app/page.tsx`)
 * and posts here as the person moves through it; the GET is the same answer for
 * any other client. The rules are in `lib/app/onboarding/first-run.ts`.
 *
 * Authentication: `withAuth`. The POST refuses an API key, as the
 * acknowledgements route does: a beat says a person has seen her words, which
 * a key cannot have done.
 *
 * Idempotent: a beat already recorded answers `200` with nothing written. A
 * beat that could not be recorded (no journey yet) is still a `200` with
 * `recorded: false`. The person has moved on either way, and the shell's next
 * entry starts their journey (`ensureJourneyStarted`), so the replayed beat
 * records then. Nothing for the client to retry.
 *
 * Rate limiting: inherited from the `/api/v1/**` section cap.
 */

import type { NextRequest } from 'next/server';
import { withAuth, type AuthSession, type WithAuthOptions } from '@/lib/auth/guards';
import { isApiKeySession } from '@/lib/auth/api-keys';
import { successResponse } from '@/lib/api/responses';
import { ForbiddenError, handleAPIError } from '@/lib/api/errors';
import { validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { firstRunBeatSchema, pendingBeats } from '@/lib/app/onboarding/first-run';
import { getFirstRunProgress, recordFirstRunBeat } from '@/lib/app/onboarding/first-run-store';

const OWNERSHIP: WithAuthOptions = {
  ownership: {
    decidedBy: 'self',
    because:
      "Every read and write is keyed on the caller's own id — the beats are recorded on the caller's own journey. Nothing here names another subject.",
  },
};

export const GET = withAuth(async (request: NextRequest, session: AuthSession) => {
  const log = await getRouteLogger(request);
  try {
    const progress = await getFirstRunProgress(session.user.id);
    if (progress === null) throw new Error('First-run progress could not be read');
    log.info('First-run progress read', {
      userId: session.user.id,
      initiationShown: progress.initiationShown,
      readsOffered: progress.readsOffered.length,
    });
    return successResponse({ ...progress, pending: pendingBeats(progress) });
  } catch (error) {
    return handleAPIError(error);
  }
}, OWNERSHIP);

export const POST = withAuth(async (request: NextRequest, session: AuthSession) => {
  const log = await getRouteLogger(request);
  try {
    if (isApiKeySession(session)) {
      throw new ForbiddenError('Only a signed-in person can move through the first run.');
    }
    const { beat } = await validateRequestBody(request, firstRunBeatSchema);
    const outcome = await recordFirstRunBeat(session.user.id, beat);
    log.info('First-run beat received', { userId: session.user.id, beat, outcome });
    return successResponse({
      beat,
      recorded: outcome !== 'failed',
      already: outcome === 'already',
    });
  } catch (error) {
    return handleAPIError(error);
  }
}, OWNERSHIP);
