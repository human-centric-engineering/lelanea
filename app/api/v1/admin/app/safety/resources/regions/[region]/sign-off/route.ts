/**
 * Sign off one region of the crisis resource (Admin) — f-safety t-63
 *
 * POST /api/v1/admin/app/safety/resources/regions/:region/sign-off
 *
 * Body: `{ version }` — the version the admin read. 409 if it has moved since,
 * if the stored services are malformed, or before the tables are seeded; 404
 * for a region not listed.
 *
 * Authentication: admin. Rate limiting: the `admin` section tier from `proxy.ts`.
 * Audited: the audit log is where "who signed this off" is kept.
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validatePathParam, validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { getClientIP } from '@/lib/security/ip';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { crisisSignOffSchema, regionCodeSchema } from '@/lib/validations/app-crisis-resources';
import { signOffCrisisRegion } from '@/lib/app/safety/crisis-admin';

export const POST = withAdminAuth<{ region: string }>(async (request, session, { params }) => {
  const log = await getRouteLogger(request);
  const code = validatePathParam((await params).region, regionCodeSchema, { label: 'region' });
  const { version } = await validateRequestBody(request, crisisSignOffSchema);

  const region = await signOffCrisisRegion(code, version);
  log.info('Crisis region signed off', { adminId: session.user.id, region: code, version });

  logAdminAction({
    userId: session.user.id,
    action: 'app_crisis_region.sign_off',
    entityType: 'settings',
    entityId: `app_crisis_region:${code}`,
    entityName: `Crisis resource — ${code}`,
    metadata: { version },
    clientIp: getClientIP(request),
  });

  return successResponse({ region });
});
