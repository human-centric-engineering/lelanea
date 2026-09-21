/**
 * Authored Content — Resources for whatever is open
 *
 * GET /api/v1/app/content/resources/:key — her words on the open thing, two
 * films and three readings chosen for it: what belongs to it first, then what
 * belongs to everything. `:key` is what the shell has — a module slug
 * (`values`), or `journey`, `situations` or `default`. `?film=<id>` puts one
 * film first, which is how a suggestion made in conversation opens the drawer
 * on the thing suggested (t-77).
 *
 * The response carries the module's `title` and `tier`, so the drawer can name
 * itself ("On Values.") and take the arc's colour without a second request.
 *
 * Authentication: required — see the library route. Rate limiting: inherited
 * from the `/api/v1/**` section cap. Caching: an ETag per key and the platform's
 * private default.
 *
 * 404 for a key that is not a module on the published structure and not one
 * of the three fixed keys. A module with nothing of its own is NOT a 404: it
 * answers with `default`'s words and the general pieces, and says the words
 * are not its own (`wordsAreOwn: false`) — a typo and an empty module must not
 * look the same.
 */

import { z } from 'zod';

import { withAuth, type WithAuthOptions } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { NotFoundError } from '@/lib/api/errors';
import { computeETag, checkConditional } from '@/lib/api/etag';
import { getRouteLogger } from '@/lib/api/context';
import { validatePathParam, validateQueryParams } from '@/lib/api/validation';
import { slugSchema } from '@/lib/validations/common';
import { selectResourcesFor } from '@/lib/app/content/resources';

/** `?film=` is a resource id, which has the slug's shape. Absent is fine. */
const querySchema = z.object({ film: slugSchema.optional() });

const OWNERSHIP: WithAuthOptions<{ key: string }> = {
  // Ownership: none to decide — see RouteOwnership in lib/auth/guards.ts.
  ownership: {
    decidedBy: 'nothing',
    because:
      'Serves a selection of the published resource library keyed by what is open, which is authored content compiled into the build. There are no per-user rows: every member opening Values is offered the same two films.',
  },
};

export const GET = withAuth<{ key: string }>(async (request, _session, { params }) => {
  const log = await getRouteLogger(request);
  const { key: raw } = await params;
  const key = validatePathParam(raw, slugSchema, { label: 'resource key', field: 'key' });
  const { film } = validateQueryParams(request.nextUrl.searchParams, querySchema);

  const selection = selectResourcesFor(key, { pin: film });
  if (!selection) {
    // A validated slug, so bounded; logged so a client asking for a module
    // that was renamed shows up rather than silently falling to the drawer's
    // error state.
    log.warn('Unknown resource key requested', { key });
    throw new NotFoundError('No resources for that key');
  }

  const etag = computeETag(selection);
  const notModified = checkConditional(request, etag);
  if (notModified) return notModified;

  log.info('Resources selection served', {
    key,
    wordsAreOwn: selection.wordsAreOwn,
    films: selection.films.length,
    readings: selection.readings.length,
    pinned: film ?? null,
  });

  return successResponse(selection, undefined, { headers: { ETag: etag } });
}, OWNERSHIP);
