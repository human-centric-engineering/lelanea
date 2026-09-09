/**
 * Authored Content — Foundational Document Index
 *
 * GET /api/v1/app/content/documents — every foundational document in the
 * collection's authored reading order, without its prose.
 *
 * Authentication: none. The welcome statement, the three pieces about Lelañea,
 * the Disclaimer and the Terms of Use are what a person reads *before* they
 * decide to sign up; putting them behind auth would make the app impossible to
 * evaluate honestly.
 *
 * Rate limiting: inherited from the `/api/v1/**` section cap applied by
 * `proxy.ts` (see `lib/security/rate-limit-policy.ts`). No handler limiter —
 * this reads a parsed, memoised constant.
 *
 * Caching: the payload is identical for every caller and changes only on
 * deploy, so it overrides the private default with a public, revalidate-every-
 * time directive and carries an ETag. A shared cache in front of the origin can
 * hold it; the conditional GET keeps the transfer at 304.
 */

import type { NextRequest } from 'next/server';
import { successResponse } from '@/lib/api/responses';
import { computeETag, checkConditional } from '@/lib/api/etag';
import { getRouteLogger } from '@/lib/api/context';
import { listFoundationalDocuments } from '@/lib/app/content';
import { PUBLIC_CONTENT_CACHE_CONTROL } from '@/lib/app/content/http';

export async function GET(request: NextRequest): Promise<Response> {
  const log = await getRouteLogger(request);
  const index = listFoundationalDocuments();

  const etag = computeETag(index);
  const notModified = checkConditional(request, etag);
  if (notModified) return notModified;

  log.info('Foundational document index served', {
    version: index.collection.version,
    documentCount: index.documents.length,
  });

  return successResponse(index, undefined, {
    headers: { ETag: etag, 'Cache-Control': PUBLIC_CONTENT_CACHE_CONTROL },
  });
}
