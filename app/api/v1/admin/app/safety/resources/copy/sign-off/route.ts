/**
 * Sign off the crisis resource's shared copy (Admin) — f-safety t-63
 *
 * POST /api/v1/admin/app/safety/resources/copy/sign-off
 *
 * Body: `{ version }` — the version the admin read. 409 if it has moved since
 * (someone edited in between) or the tables are not seeded.
 *
 * Authentication: admin. Rate limiting: the `admin` section tier from `proxy.ts`.
 * Audited: the audit log is where "who signed this off" is kept.
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { getClientIP } from '@/lib/security/ip';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { crisisSignOffSchema } from '@/lib/validations/app-crisis-resources';
import { signOffCrisisCopy } from '@/lib/app/safety/crisis-admin';

export const POST = withAdminAuth(async (request, session) => {
  const log = await getRouteLogger(request);
  const { version } = await validateRequestBody(request, crisisSignOffSchema);

  const copy = await signOffCrisisCopy(version);
  log.info('Crisis copy signed off', { adminId: session.user.id, version });

  logAdminAction({
    userId: session.user.id,
    action: 'app_crisis_copy.sign_off',
    entityType: 'settings',
    entityId: 'app_crisis_copy',
    entityName: 'Crisis resource — shared wording and directory',
    metadata: { version },
    clientIp: getClientIP(request),
  });

  return successResponse({ copy });
});
