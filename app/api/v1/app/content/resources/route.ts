/**
 * Authored Content — Resources, the library
 *
 * GET /api/v1/app/content/resources — every film and every piece of reading,
 * with what each is for and which module it belongs beside, and her words per
 * key. The whole library, for browsing directly (product description §9:
 * "surfaced by the Curator agent and browsable directly"). What the drawer
 * shows for one open thing is `/resources/:key`.
 *
 * Authentication: required. The passages are excerpts of programme content —
 * the Values lesson is release-2 material — and the list is what a member is
 * offered, not what a visitor is told.
 *
 * Rate limiting: inherited from the `/api/v1/**` section cap in
 * `lib/security/rate-limit-policy.ts`.
 *
 * Caching: the platform default (`private, no-cache`) and an ETag, as every
 * content route. None marks a payload `public` — see the documents index route
 * for the two reasons why.
 *
 * Source (t-87): `app_resource_collection`, `app_resource` and
 * `app_resource_words`, through `lib/app/content/resource-store.ts` — the same
 * service the drawer's selection, the offering in the voice block and
 * `suggest_resource` read.
 *
 * `collection.provenance` is served, not withheld: the file ships as a draft
 * awaiting her sign-off, and a surface that shows the resource can say so.
 */

import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { computeETag, checkConditional } from '@/lib/api/etag';
import { getRouteLogger } from '@/lib/api/context';
import { getResourcesLibrary } from '@/lib/app/content/resource-store';

export const GET = withAuth(
  async (request) => {
    const log = await getRouteLogger(request);
    const library = await getResourcesLibrary();

    const etag = computeETag(library);
    const notModified = checkConditional(request, etag);
    if (notModified) return notModified;

    log.info('Resources library served', {
      version: library.collection.version,
      provenance: library.collection.provenance.status,
      films: library.films.length,
      readings: library.readings.length,
    });

    return successResponse(library, undefined, { headers: { ETag: etag } });
  },
  {
    // Ownership: none to decide — see RouteOwnership in lib/auth/guards.ts.
    ownership: {
      decidedBy: 'nothing',
      because:
        'Serves the published resource library, which is authored content every member shares. There are no per-user rows: every member is offered the same films and reading, and narrowing would have nothing to narrow.',
    },
  }
);
