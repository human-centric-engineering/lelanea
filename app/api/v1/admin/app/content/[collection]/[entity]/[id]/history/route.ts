/**
 * Every past revision of one content item, newest first (f-content-seeds
 * t-91). Each is the item whole, not a diff, with which fields it changed, who
 * made it (null for the seed and for an erased admin; `origin` tells them
 * apart) and when.
 *
 * Rate limiting: the `admin` section tier from `proxy.ts`.
 */

import type { NextRequest } from 'next/server';

import { NotFoundError } from '@/lib/api/errors';
import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { withAdminAuth } from '@/lib/auth/guards';
import { CONTENT_ID_PATTERN, entityHandlers } from '@/lib/app/content/admin/registry';

export const GET = withAdminAuth<{ collection: string; entity: string; id: string }>(
  async (request: NextRequest, _session, { params }) => {
    const log = await getRouteLogger(request);
    const { collection, entity, id } = await params;
    const handlers = entityHandlers(collection, entity);
    if (!handlers.history || !CONTENT_ID_PATTERN.test(id)) {
      throw new NotFoundError(`There is no history for that ${handlers.label}.`);
    }
    const revisions = await handlers.history(id);
    log.info('Content item history fetched', {
      collection,
      entity,
      id,
      revisions: revisions.length,
    });
    return successResponse({ revisions });
  }
);
