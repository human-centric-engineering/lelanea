/**
 * One content collection as the admin editor reads it (f-content-seeds t-91).
 *
 * `GET /api/v1/admin/app/content/:collection` — `documents`, `journey`,
 * `questions` or `resources`, every field the seed writes, with the revision
 * (or `updatedAt`) each save must send back, and who reads what. Retired
 * resources included: they are what someone comes here to bring back.
 *
 * Rate limiting: the `admin` section tier from `proxy.ts`.
 *
 * @see lib/app/content/admin/registry.ts — which service serves which collection
 */

import type { NextRequest } from 'next/server';

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { withAdminAuth } from '@/lib/auth/guards';
import { collectionHandlers } from '@/lib/app/content/admin/registry';

export const GET = withAdminAuth<{ collection: string }>(
  async (request: NextRequest, _session, { params }) => {
    const log = await getRouteLogger(request);
    const { collection } = await params;
    const view = await collectionHandlers(collection).view();
    log.info('Content collection fetched for editing', { collection });
    return successResponse(view);
  }
);
