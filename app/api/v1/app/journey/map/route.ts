/**
 * The Journey — Map
 *
 * GET /api/v1/app/journey/map — the published journey map projected for the
 * shell: five tiers (label, intent) and seventeen modules (number, display
 * number, title, slug, tier), each with a `state` that is always `open` this
 * phase. What the map drawer renders and what a module page is built from.
 *
 * Authentication: required. The map is the shape of the members' journey, and
 * `state` will carry per-user progress when journeys arrive — the contract is
 * behind auth from the start so that field never has to move.
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
  async (request) => {
    const log = await getRouteLogger(request);
    const map = await getJourneyMap();
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
    // Ownership: none to decide — see RouteOwnership in lib/auth/guards.ts.
    ownership: {
      decidedBy: 'nothing',
      because:
        'Serves the published journey map, one row per install and owned by nobody. Every member sees the same tiers and modules; `state` is a constant this phase. When per-user progress arrives this becomes a `self` read and the declaration moves with it.',
    },
  }
);
