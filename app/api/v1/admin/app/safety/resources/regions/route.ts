/**
 * Add a region to the crisis resource (Admin) — f-safety t-63
 *
 * POST /api/v1/admin/app/safety/resources/regions
 *
 * Body: `{ region, emergencyNumber, services }` (`crisisRegionCreateSchema`).
 * The code is upper-cased. Born `draft`. 201 with the row; 409 if the region is
 * already listed or the tables are not seeded.
 *
 * Authentication: admin. Rate limiting: the `admin` section tier from `proxy.ts`.
 * Audited with what was added.
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { getClientIP } from '@/lib/security/ip';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { crisisRegionCreateSchema } from '@/lib/validations/app-crisis-resources';
import { createCrisisRegion } from '@/lib/app/safety/crisis-admin';

export const POST = withAdminAuth(async (request, session) => {
  const log = await getRouteLogger(request);
  const body = await validateRequestBody(request, crisisRegionCreateSchema);

  const region = await createCrisisRegion(body);
  log.info('Crisis region added', { adminId: session.user.id, region: region.region });

  logAdminAction({
    userId: session.user.id,
    action: 'app_crisis_region.create',
    entityType: 'settings',
    entityId: `app_crisis_region:${region.region}`,
    entityName: `Crisis resource — ${region.region}`,
    metadata: { emergencyNumber: region.emergencyNumber, services: region.services },
    clientIp: getClientIP(request),
  });

  return successResponse({ region }, undefined, { status: 201 });
});
