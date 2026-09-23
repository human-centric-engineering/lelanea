/**
 * The crisis resource as stored (Admin) — f-safety t-63
 *
 * GET /api/v1/admin/app/safety/resources
 *
 * `{ seeded, unservable, copy, regions }`. `seeded: false` means the tables
 * are empty and every crisis turn FAILS — t-88 removed the bundled fallback,
 * so nothing is served in its place. A non-null `unservable` means the stored
 * rows cannot be read and turns are failing for that reason instead. The page
 * says so in both cases, and every write refuses 409 until the rows exist.
 *
 * Authentication: admin. Rate limiting: the `admin` section tier from `proxy.ts`.
 *
 * @see lib/app/safety/crisis-admin.ts
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { getRouteLogger } from '@/lib/api/context';
import { getCrisisAdminView } from '@/lib/app/safety/crisis-admin';

export const GET = withAdminAuth(async (request, _session) => {
  const log = await getRouteLogger(request);
  const view = await getCrisisAdminView();
  log.info('Crisis resources fetched', { seeded: view.seeded, regions: view.regions.length });
  return successResponse(view);
});
