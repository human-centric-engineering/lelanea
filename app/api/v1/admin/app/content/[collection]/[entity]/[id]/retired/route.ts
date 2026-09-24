/**
 * Retire a resource, or bring one back (f-content-seeds t-91).
 *
 * `PUT { retired, revision }`. A retired resource is no longer offered,
 * listed or suggestable, and a past suggestion's chip still resolves to it. It
 * is the only removal a resource has; see `lib/app/content/admin/resources.ts`.
 *
 * Rate limiting: the `admin` section tier from `proxy.ts`.
 */

import type { NextRequest } from 'next/server';

import { NotFoundError, ValidationError } from '@/lib/api/errors';
import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { withAdminAuth } from '@/lib/auth/guards';
import { CONTENT_ID_PATTERN, entityHandlers } from '@/lib/app/content/admin/registry';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { getClientIP } from '@/lib/security/ip';

export const PUT = withAdminAuth<{ collection: string; entity: string; id: string }>(
  async (request: NextRequest, session, { params }) => {
    const log = await getRouteLogger(request);
    const { collection, entity, id } = await params;
    const handlers = entityHandlers(collection, entity);
    if (!handlers.retire || !CONTENT_ID_PATTERN.test(id)) {
      throw new NotFoundError(`A ${handlers.label} is not retired.`);
    }
    const body: unknown = await request.json().catch(() => {
      throw new ValidationError('Invalid JSON in request body');
    });
    const outcome = await handlers.retire(id, body, session.user.id);

    log.info('Resource retirement changed', { collection, entity, id, changed: outcome.changed });
    if (outcome.changed.length > 0) {
      logAdminAction({
        userId: session.user.id,
        action: `app_content.${collection}.${entity}.${outcome.result?.retired ? 'retire' : 'unretire'}`,
        entityType: 'settings',
        entityId: `app_content:${collection}/${entity}:${id}`,
        entityName: id,
        changes: outcome.changes,
        clientIp: getClientIP(request),
      });
    }
    return successResponse({ changed: outcome.changed, ...outcome.result });
  }
);
