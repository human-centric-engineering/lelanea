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
 * Caching: an ETag and the platform default (`private, no-cache`), so a repeat
 * caller gets a 304 with an empty body. The payload IS identical for every
 * caller, and an earlier draft marked it `public` for that reason — twice
 * wrong. `checkConditional` hard-codes the private default on its 304
 * (`lib/api/etag.ts`, Sunrise-owned), so the first revalidation flips a shared
 * cache's stored entry back to private and it stops serving it. And `proxy.ts`
 * attaches a per-visitor `Set-Cookie` to these responses, which a shared cache
 * would then replay to other visitors. The directive bought nothing and risked
 * that; the ETag delivers the saving on its own.
 */

import type { NextRequest } from 'next/server';
import { successResponse } from '@/lib/api/responses';
import { computeETag, checkConditional } from '@/lib/api/etag';
import { getRouteLogger } from '@/lib/api/context';
import { listFoundationalDocuments } from '@/lib/app/content';

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
    headers: { ETag: etag },
  });
}
