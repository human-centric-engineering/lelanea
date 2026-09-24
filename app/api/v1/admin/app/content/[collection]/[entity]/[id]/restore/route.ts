/**
 * Put one content item back to an earlier revision (f-content-seeds t-91).
 *
 * `POST { revision, revisionRead }` — a restore is a NEW revision carrying the
 * old words, never a rewind: the history keeps every step, including this one.
 * For a document people agree to, restoring changed words mints a new
 * acknowledgement version like any other edit.
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

export const POST = withAdminAuth<{ collection: string; entity: string; id: string }>(
  async (request: NextRequest, session, { params }) => {
    const log = await getRouteLogger(request);
    const { collection, entity, id } = await params;
    const handlers = entityHandlers(collection, entity);
    if (!handlers.restore || !CONTENT_ID_PATTERN.test(id)) {
      throw new NotFoundError(`A ${handlers.label} has no history to restore from.`);
    }
    const body: unknown = await request.json().catch(() => {
      throw new ValidationError('Invalid JSON in request body');
    });
    const outcome = await handlers.restore(id, body, session.user.id);

    log.info('Content item restored', { collection, entity, id, changed: outcome.changed });
    if (outcome.changed.length > 0) {
      logAdminAction({
        userId: session.user.id,
        action: `app_content.${collection}.${entity}.restore`,
        entityType: 'settings',
        entityId: `app_content:${collection}/${entity}:${id}`,
        entityName: id,
        changes: outcome.changes,
        metadata: { body, ...(outcome.audit ?? outcome.result) },
        clientIp: getClientIP(request),
      });
    }
    return successResponse({ changed: outcome.changed, ...outcome.result });
  }
);
