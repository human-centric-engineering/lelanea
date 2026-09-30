/**
 * The Journey — Map
 *
 * GET /api/v1/app/journey/map — the published journey map projected for the
 * shell: five tiers (label, intent) and seventeen modules (number, display
 * number, title, slug, tier), each with the caller's own `state` on it —
 * `current`, `done` or `open` (§15, t-102). What the map drawer renders.
 *
 * Authentication: required. `state` is the caller's journey, read as them.
 * An API-key session reads its owner's, which is what the key is for.
 *
 * Rate limiting: inherited from the `/api/v1/**` section cap.
 *
 * Caching: the platform default (`private, no-cache`) and an ETag over the
 * projection, so a drawer re-opened a dozen times costs a 304 each time after
 * the first.
 *
 * 404 when no version is published (a fresh database before `db:seed`); 500
 * with `JOURNEY_MAP_INCONSISTENT` and the offending slugs in `details` when the
 * map names a module the running code does not register — reported, never
 * silently dropped. See `lib/app/journey/map.ts`.
 */

import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { NotFoundError } from '@/lib/api/errors';
import { computeETag, checkConditional } from '@/lib/api/etag';
import { getRouteLogger } from '@/lib/api/context';
import { getJourneyMap } from '@/lib/app/journey/map';

export const GET = withAuth(
  async (request, session) => {
    const log = await getRouteLogger(request);
    const map = await getJourneyMap(session.user.id);
    if (!map) throw new NotFoundError('No journey map is published');

    const etag = computeETag(map);
    const notModified = checkConditional(request, etag);
    if (notModified) return notModified;

    log.info('Journey map served', {
      version: map.version,
      tierCount: map.tiers.length,
      moduleCount: map.modules.length,
    });

    return successResponse(map, undefined, { headers: { ETag: etag } });
  },
  {
    // Ownership: self-scoped — see RouteOwnership in lib/auth/guards.ts.
    ownership: {
      decidedBy: 'self',
      because:
        "The map's structure is one row per install and owned by nobody; the only per-person part is `state`, which is read from the caller's own journey by `session.user.id`. Nothing here names another subject.",
    },
  }
);
