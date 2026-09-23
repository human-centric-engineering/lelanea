/**
 * Add an item to a collection (f-content-seeds t-91).
 *
 * `POST` — a discovery question (appended, with the next id), a film or
 * reading (with its permanent id, appended to its kind), or a key's words.
 * Documents, tiers and modules are not added here: the journey's structure is
 * the roster's, and a new document needs a surface to show it.
 *
 * Rate limiting: the `admin` section tier from `proxy.ts`.
 */

import type { NextRequest } from 'next/server';

import { NotFoundError } from '@/lib/api/errors';
import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { withAdminAuth } from '@/lib/auth/guards';
import { entityHandlers } from '@/lib/app/content/admin/registry';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { getClientIP } from '@/lib/security/ip';

export const POST = withAdminAuth<{ collection: string; entity: string }>(
  async (request: NextRequest, session, { params }) => {
    const log = await getRouteLogger(request);
    const { collection, entity } = await params;
    const handlers = entityHandlers(collection, entity);
    if (!handlers.create) throw new NotFoundError(`A ${handlers.label} is not added here.`);

    const body: unknown = await request.json().catch(() => null);
    const outcome = await handlers.create(body, session.user.id);

    log.info('Content item added', { collection, entity, id: outcome.id });
    logAdminAction({
      userId: session.user.id,
      action: `app_content.${collection}.${entity}.create`,
      entityType: 'settings',
      entityId: `app_content:${collection}/${entity}:${outcome.id}`,
      entityName: outcome.id,
      metadata: { body },
      clientIp: getClientIP(request),
    });
    return successResponse({ id: outcome.id, ...outcome.result }, undefined, { status: 201 });
  }
);
