/**
 * Acknowledgements — where a person stands at the gate, and one more step past it.
 *
 * GET  /api/v1/app/acknowledgements — the caller's gate status: every kind, the
 *      version it currently requires, whether the caller has satisfied it, and
 *      when. What t-16's gate page renders and what it re-reads after a POST.
 * POST /api/v1/app/acknowledgements — record one kind for the caller. Body:
 *      `{ kind: 'disclaimer' | 'terms' | 'age_18' }`. Answers 201 when this call
 *      recorded it and 200 when it already stood, both with the same body — the
 *      gate status AFTER the write, so the client needs no second call.
 *
 * Authentication: `withAuth`, and then one refusal of its own — an API-key
 * session is answered 403. Acknowledging the terms and confirming one's age are
 * identity acts: they mean something only when the person did them. A key
 * minted for headless use acts *as* its owner, which is exactly the property
 * that makes it wrong here, so both verbs refuse it rather than only the write.
 * Reading through a key would be harmless, but answering one verb and not the
 * other invites a client to treat the read as proof the key can proceed.
 *
 * The version is never in the request. `recordAcknowledgement` records
 * against what is currently served, so a client cannot satisfy the gate by
 * naming a version it read last year.
 *
 * Rate limiting: inherited from the `/api/v1/**` section cap applied by
 * `proxy.ts`, keyed on the session user. No handler limiter — three writes per
 * person per version is the entire lifetime traffic of this route.
 *
 * @see lib/app/gateway/acknowledgements.ts · lib/validations/app-acknowledgement.ts
 */

import type { NextRequest } from 'next/server';
import { withAuth, type AuthSession } from '@/lib/auth/guards';
import { isApiKeySession } from '@/lib/auth/api-keys';
import { successResponse } from '@/lib/api/responses';
import { ForbiddenError, handleAPIError } from '@/lib/api/errors';
import { validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { acknowledgeSchema } from '@/lib/validations/app-acknowledgement';
import { getGateStatus, recordAcknowledgement } from '@/lib/app/gateway/acknowledgements';

/** Both verbs refuse a key for the same reason; one place says it. */
function assertPersonPresent(session: AuthSession): void {
  if (isApiKeySession(session)) {
    throw new ForbiddenError('Acknowledgements can only be given by a signed-in person.');
  }
}

export const GET = withAuth(async (request: NextRequest, session: AuthSession) => {
  const log = await getRouteLogger(request);
  try {
    assertPersonPresent(session);
    const status = await getGateStatus(session.user.id);
    log.info('Gate status read', { userId: session.user.id, complete: status.complete });
    return successResponse(status);
  } catch (error) {
    return handleAPIError(error);
  }
});

export const POST = withAuth(async (request: NextRequest, session: AuthSession) => {
  const log = await getRouteLogger(request);
  try {
    assertPersonPresent(session);
    const { kind } = await validateRequestBody(request, acknowledgeSchema);
    const result = await recordAcknowledgement(session.user.id, kind);
    const status = await getGateStatus(session.user.id);
    log.info('Acknowledgement received', {
      userId: session.user.id,
      kind,
      documentVersion: result.row.documentVersion,
      created: result.created,
      complete: status.complete,
    });
    return successResponse(status, undefined, { status: result.created ? 201 : 200 });
  } catch (error) {
    return handleAPIError(error);
  }
});
