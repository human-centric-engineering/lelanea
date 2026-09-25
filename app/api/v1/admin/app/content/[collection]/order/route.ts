/**
 * Put a collection's items in a new order (f-content-seeds t-91).
 *
 * `PUT { order: [{ id, revision }] }` — every item once, each with the
 * revision the admin read, so a reorder against a list someone has since
 * changed is refused. Documents set their reading order, questions their
 * numbers, and resources (with `kind`) the drawer's order for videos,
 * audio or articles. Each item that moves gets a revision.
 *
 * Rate limiting: the `admin` section tier from `proxy.ts`.
 */

import type { NextRequest } from 'next/server';

import { NotFoundError } from '@/lib/api/errors';
import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { withAdminAuth } from '@/lib/auth/guards';
import { collectionHandlers } from '@/lib/app/content/admin/registry';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { getClientIP } from '@/lib/security/ip';

export const PUT = withAdminAuth<{ collection: string }>(
  async (request: NextRequest, session, { params }) => {
    const log = await getRouteLogger(request);
    const { collection } = await params;
    const handlers = collectionHandlers(collection);
    if (!handlers.reorder)
      throw new NotFoundError(`The ${collection} collection has no order to change.`);

    const body: unknown = await request.json().catch(() => null);
    const { moved } = await handlers.reorder(body, session.user.id);

    log.info('Content reordered', { collection, moved });
    if (moved > 0) {
      logAdminAction({
        userId: session.user.id,
        action: `app_content.${collection}.reorder`,
        entityType: 'settings',
        entityId: `app_content:${collection}`,
        metadata: { moved, body },
        clientIp: getClientIP(request),
      });
    }
    return successResponse({ moved });
  }
);
