/**
 * Authored Content — Journey Structure
 *
 * GET /api/v1/app/content/journey-structure — the seventeen modules, the five
 * tiers they sit in, and each module's phases.
 *
 * Authentication: none. The shape of the work is part of what the product tells
 * you before you commit to it. The authored copy *inside* a module is not here.
 *
 * Rate limiting: inherited from the `/api/v1/**` section cap in
 * `lib/security/rate-limit-policy.ts`.
 */

import type { NextRequest } from 'next/server';
import { successResponse } from '@/lib/api/responses';
import { computeETag, checkConditional } from '@/lib/api/etag';
import { getRouteLogger } from '@/lib/api/context';
import { getJourneyStructure } from '@/lib/app/content';
import { PUBLIC_CONTENT_CACHE_CONTROL } from '@/lib/app/content/http';

export async function GET(request: NextRequest): Promise<Response> {
  const log = await getRouteLogger(request);
  const structure = getJourneyStructure();

  const etag = computeETag(structure);
  const notModified = checkConditional(request, etag);
  if (notModified) return notModified;

  log.info('Journey structure served', {
    version: structure.collection.version,
    moduleCount: structure.modules.length,
  });

  return successResponse(structure, undefined, {
    headers: { ETag: etag, 'Cache-Control': PUBLIC_CONTENT_CACHE_CONTROL },
  });
}
