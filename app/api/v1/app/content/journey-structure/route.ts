/**
 * Authored Content — Journey Structure
 *
 * GET /api/v1/app/content/journey-structure — the seventeen modules, the five
 * tiers they sit in, and each module's phases.
 *
 * Authentication: none. The shape of the work is part of what the product tells
 * you before you commit to it. The authored copy *inside* a module is not here.
 *
 * Source (t-87): the journey's rows (`app_journey`, `app_journey_tier`,
 * `app_journey_module`) joined with the code roster, through the same service
 * the map drawer, the module pages and the home page call
 * (`lib/app/content/journey-store.ts`). Every tier and module carries its
 * `revision`, and the ETag covers the whole payload, so an edit to any row
 * changes it. The parity test (`journey-structure-parity.test.ts`) proves this
 * is exactly the record the pages render from.
 *
 * Rate limiting: inherited from the `/api/v1/**` section cap in
 * `lib/security/rate-limit-policy.ts`. Caching: an ETag and the platform
 * default, not a `public` directive — see the documents index route.
 */

import type { NextRequest } from 'next/server';
import { successResponse } from '@/lib/api/responses';
import { computeETag, checkConditional } from '@/lib/api/etag';
import { getRouteLogger } from '@/lib/api/context';
import { handleAPIError } from '@/lib/api/errors';
import { getJourneyStructure } from '@/lib/app/content/journey-store';

export async function GET(request: NextRequest): Promise<Response> {
  const log = await getRouteLogger(request);
  try {
    const structure = await getJourneyStructure();

    const etag = computeETag(structure);
    const notModified = checkConditional(request, etag);
    if (notModified) return notModified;

    log.info('Journey structure served', {
      version: structure.collection.version,
      moduleCount: structure.modules.length,
    });

    return successResponse(structure, undefined, {
      headers: { ETag: etag },
    });
  } catch (error) {
    // An unseeded database or a row that fails validation. Both are ours, not
    // the caller's, so the envelope says 500 without the detail.
    return handleAPIError(error);
  }
}
