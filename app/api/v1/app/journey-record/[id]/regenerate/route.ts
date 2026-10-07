/**
 * Ask for another draft of a synopsis in my journey record
 * (f-journey-record t-147).
 *
 * - `POST /api/v1/app/journey-record/:id/regenerate`: `{ steer? }`, what was
 *   wrong with this draft, if I want to say. The new draft replaces it and is
 *   returned. A draft can be redrafted a few times (`regenerationsLeft` on the
 *   entry says how many more); the call is charged to me, as a draft is.
 *
 * Another person's entry id answers 404, the same as one that never existed.
 * A second submit while one is being written answers 409, and writes nothing.
 *
 * Authentication: required. Rate limiting: the `/api/v1/**` section cap, and
 * the journey record's sub-cap, because every call reaches a model.
 *
 * @see lib/app/journey-record/synopsis/regenerate.ts
 */

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { validatePathParam, validateRequestBody } from '@/lib/api/validation';
import { withAuth } from '@/lib/auth/guards';
import { createRateLimitResponse } from '@/lib/security/rate-limit';
import { JOURNEY_RECORD_OWNERSHIP } from '@/lib/app/journey-record/ownership';
import { synopsisCallKey, synopsisCallLimiter } from '@/lib/app/journey-record/rate-limit';
import { regenerateSynopsis } from '@/lib/app/journey-record/synopsis/regenerate';
import {
  journeyEntryIdSchema,
  synopsisRegenerateSchema,
} from '@/lib/app/journey-record/validation';

export const POST = withAuth<{ id: string }>(
  async (request, session, { params }) => {
    const log = await getRouteLogger(request);
    const { id: raw } = await params;
    const id = validatePathParam(raw, journeyEntryIdSchema, { label: 'entry id' });
    const body = await validateRequestBody(request, synopsisRegenerateSchema);

    const limit = synopsisCallLimiter.check(synopsisCallKey(session.user.id));
    if (!limit.success) return createRateLimitResponse(limit);

    const entry = await regenerateSynopsis(session.user.id, id, body.steer ?? null);

    // Whether they said why, never what they said.
    log.info('Synopsis redrafted at the person’s request', {
      userId: session.user.id,
      entryId: id,
      steered: body.steer != null,
      regenerationsLeft: entry.regenerationsLeft,
    });

    return successResponse(entry);
  },
  { ownership: JOURNEY_RECORD_OWNERSHIP }
);
