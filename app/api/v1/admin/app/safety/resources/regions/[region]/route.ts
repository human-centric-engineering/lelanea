/**
 * One region of the crisis resource (Admin) — f-safety t-63
 *
 * PUT    /api/v1/admin/app/safety/resources/regions/:region — replace its number and services
 * DELETE /api/v1/admin/app/safety/resources/regions/:region — stop listing it
 *
 * PUT body: `{ emergencyNumber, services }` (`crisisRegionUpdateSchema`). A save
 * that changes something returns the region to `draft` and bumps its version;
 * one that changes nothing writes nothing and no audit entry.
 *
 * DELETE: people there then get the directory and "your local emergency
 * number", as for any unlisted region — never a guessed number.
 *
 * Both: 404 for a region not listed, 409 before the tables are seeded.
 * Authentication: admin. Rate limiting: the `admin` section tier from `proxy.ts`.
 * Audited with the before and after.
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validatePathParam, validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { getClientIP } from '@/lib/security/ip';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { crisisRegionUpdateSchema, regionCodeSchema } from '@/lib/validations/app-crisis-resources';
import { removeCrisisRegion, updateCrisisRegion } from '@/lib/app/safety/crisis-admin';

export const PUT = withAdminAuth<{ region: string }>(async (request, session, { params }) => {
  const log = await getRouteLogger(request);
  const code = validatePathParam((await params).region, regionCodeSchema, { label: 'region' });
  const body = await validateRequestBody(request, crisisRegionUpdateSchema);

  const { region, changes } = await updateCrisisRegion(code, body);
  const changed = Object.keys(changes);
  log.info('Crisis region saved', { adminId: session.user.id, region: code, changed });

  if (changed.length > 0) {
    logAdminAction({
      userId: session.user.id,
      action: 'app_crisis_region.update',
      entityType: 'settings',
      entityId: `app_crisis_region:${code}`,
      entityName: `Crisis resource — ${code}`,
      changes,
      metadata: { version: region.version, status: region.status },
      clientIp: getClientIP(request),
    });
  }

  return successResponse({ region, changed });
});

export const DELETE = withAdminAuth<{ region: string }>(async (request, session, { params }) => {
  const log = await getRouteLogger(request);
  const code = validatePathParam((await params).region, regionCodeSchema, { label: 'region' });

  const removed = await removeCrisisRegion(code);
  log.info('Crisis region removed', { adminId: session.user.id, region: code });

  logAdminAction({
    userId: session.user.id,
    action: 'app_crisis_region.delete',
    entityType: 'settings',
    entityId: `app_crisis_region:${code}`,
    entityName: `Crisis resource — ${code}`,
    metadata: {
      emergencyNumber: removed.emergencyNumber,
      services: removed.services,
      version: removed.version,
    },
    clientIp: getClientIP(request),
  });

  return successResponse({ removed: code });
});
