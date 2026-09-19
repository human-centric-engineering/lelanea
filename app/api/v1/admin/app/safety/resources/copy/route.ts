/**
 * The crisis resource's shared copy and directory (Admin) — f-safety t-63
 *
 * PUT /api/v1/admin/app/safety/resources/copy
 *
 * Body: every field of the copy, every time (`crisisCopyUpdateSchema`). A save
 * that changes something returns the copy to `draft` and bumps its version; one
 * that changes nothing leaves both alone and writes no audit entry. 409 before
 * the tables are seeded.
 *
 * Authentication: admin. Rate limiting: the `admin` section tier from `proxy.ts`.
 * Audited with the before and after — who reworded what a person in danger
 * reads is the record this surface exists to keep.
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { getClientIP } from '@/lib/security/ip';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { crisisCopyUpdateSchema } from '@/lib/validations/app-crisis-resources';
import { updateCrisisCopy } from '@/lib/app/safety/crisis-admin';

export const PUT = withAdminAuth(async (request, session) => {
  const log = await getRouteLogger(request);
  const body = await validateRequestBody(request, crisisCopyUpdateSchema);

  const { copy, changes } = await updateCrisisCopy(body);
  const changed = Object.keys(changes);
  log.info('Crisis copy saved', { adminId: session.user.id, changed, version: copy.version });

  if (changed.length > 0) {
    logAdminAction({
      userId: session.user.id,
      action: 'app_crisis_copy.update',
      entityType: 'settings',
      entityId: 'app_crisis_copy',
      entityName: 'Crisis resource — shared wording and directory',
      changes,
      metadata: { version: copy.version, status: copy.status },
      clientIp: getClientIP(request),
    });
  }

  return successResponse({ copy, changed });
});
