/**
 * Waitlist — the admin list (Admin)
 *
 * GET /api/v1/admin/app/waitlist
 *
 * Authentication: admin. `withAdminAuth` answers 401 unauthenticated and 403 for
 * a signed-in non-admin, and also admits an `admin`-scoped API key — which is
 * how this list is reachable headlessly without a second auth path.
 *
 * Query parameters:
 *   - q               optional free-text search over email, name, heardFrom and intent
 *   - includeRemoved  default false — entries an admin took off the list are out
 *   - page            default 1
 *   - limit           default 25, max 100
 *
 * Returns the platform's paginated envelope: `{ success, data: [...], meta: {
 * page, limit, total, totalPages } }`.
 *
 * ## Why this route exists at all
 *
 * §03 t-7 shipped the write with no read. A row nobody can see is
 * indistinguishable from a row that was never written (`HB9`), so until this
 * landed the only evidence the public form worked was its own tests.
 *
 * ## Rate limiting: nothing to do here, and that is the design
 *
 * `proxy.ts` has already applied the `'admin'` section tier before this handler
 * runs — `RATE_LIMIT_POLICY` matches `/api/v1/admin/` as a prefix, so a new
 * admin route inherits the cap with no handler work. Handlers must never call a
 * section limiter themselves. The bulk read next door takes a per-flow sub-cap
 * on top of the tier, because building a file is the expensive act; paging 25
 * rows is not.
 *
 * ## Nothing here reaches the log
 *
 * Not the search term, and not a row. `q` is whatever an admin typed, and the
 * first thing anyone types into this box is somebody's email address — which
 * would put a copy of a person's personal data outside the table the Art. 15
 * export and the Art. 17 erasure know how to reach. The same reason the public
 * POST logs `created` but not the address.
 *
 * **Saying that took more than leaving `q` out of the `meta`.** The platform's
 * `getRouteLogger` binds the full request URL — query string and all — to every
 * line, and `url` is not a key the sanitiser redacts. The logger comes from
 * `_shared/route-logger.ts` for that reason; the security review of this task
 * caught the first version claiming this paragraph while emitting the address.
 *
 * @see lib/app/waitlist/admin.ts · app/api/v1/admin/app/waitlist/export/route.ts
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { paginatedResponse } from '@/lib/api/responses';
import { validateQueryParams } from '@/lib/api/validation';
import { getWaitlistRouteLogger } from '@/app/api/v1/admin/app/waitlist/_shared/route-logger';
import { waitlistAdminQuerySchema } from '@/lib/validations/app-waitlist';
import { listWaitlistEntries } from '@/lib/app/waitlist/admin';

export const GET = withAdminAuth(async (request, _session) => {
  const log = await getWaitlistRouteLogger(request);

  const query = validateQueryParams(request.nextUrl.searchParams, waitlistAdminQuerySchema);

  const { entries, total } = await listWaitlistEntries(query);

  // `searched` rather than `q`: whether the list was filtered is the operational
  // fact, and the term itself is personal data as often as not.
  log.info('Waitlist entries listed', {
    count: entries.length,
    total,
    page: query.page,
    searched: query.q !== undefined,
    includeRemoved: query.includeRemoved,
  });

  return paginatedResponse(entries, {
    page: query.page,
    limit: query.limit,
    total,
  });
});
